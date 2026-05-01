/**
 * stream-json protocol codec.
 *
 * Encoder: builds stdin payloads the `claude -p --input-format stream-json`
 * subprocess expects. One JSON object per line.
 *
 * Decoder: parses stdout JSONL from claude and emits high-level events
 * (DecodedEvent) that the session layer turns into ServerMessage broadcasts.
 *
 * Empirically verified event shapes (see scripts/probe-stream-json.ts):
 *
 *   Outbound (encoder → claude stdin):
 *     { type: "user", message: { role: "user", content: [{ type: "text", text }] } }
 *
 *   Inbound (decoder ← claude stdout):
 *     { type: "system", subtype: "hook_started" | "hook_response", ... }
 *     { type: "system", subtype: "init", session_id, cwd, model, permissionMode,
 *                        plugins, slash_commands, skills, agents, tools, ... }
 *     { type: "stream_event", event: { type: "message_start" | "content_block_start"
 *                                      | "content_block_delta" | "content_block_stop"
 *                                      | "message_delta" | "message_stop", ... } }
 *     { type: "assistant", message: { content: [{ type: "text"|"thinking"|"tool_use", ... }] } }
 *     { type: "user", message: { content: [{ type: "tool_result", ... }] } }
 *     { type: "rate_limit_event", rate_limit_info: { ... } }
 *     { type: "result", subtype: "success", total_cost_usd, duration_ms, num_turns }
 *
 * The decoder is a thin stateful mapper. It prefers stream_event deltas for
 * character-level text streaming and uses assistant messages to detect tool
 * uses with their complete input (deltas carry only partial JSON fragments).
 */

import type { SessionInfo } from "@ccweb/shared";

// ─── Public decoder output ─────────────────────────────────────────────────

export type DecodedEvent =
  | { kind: "session_ready"; info: SessionInfo }
  | { kind: "text_delta"; text: string }
  | { kind: "text_end" }
  | { kind: "thinking_delta"; text: string }
  | { kind: "thinking_end" }
  | { kind: "tool_use"; toolUseId: string; name: string; inputSummary: string }
  | { kind: "tool_result"; toolUseId: string; isError: boolean; summary: string }
  | { kind: "rate_limit"; info: RawRateLimitInfo }
  | { kind: "turn_complete"; costUsd: number; durationMs: number; numTurns: number }
  | { kind: "history_user_text"; text: string }
  | { kind: "error"; message: string };

interface RawRateLimitInfo {
  status?: string;
  resetsAt?: number;
  rateLimitType?: string;
  overageStatus?: string;
}

// ─── Encoder ───────────────────────────────────────────────────────────────

export function encodeUserText(text: string): string {
  const payload = {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  };
  return JSON.stringify(payload) + "\n";
}

// ─── Decoder ───────────────────────────────────────────────────────────────

export class StreamJsonDecoder {
  private buffer = "";
  private seenInit = false;
  // Track the type of the currently-open content block so we can emit the
  // correct end event on content_block_stop.
  private currentBlockType: "text" | "thinking" | "tool_use" | "other" | null = null;

  /**
   * Feed a chunk of stdout. Returns zero or more decoded events in order.
   */
  push(chunk: string | Buffer): DecodedEvent[] {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const events: DecodedEvent[] = [];
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (!line.trim()) continue;
      const decoded = this.decodeLine(line);
      for (const e of decoded) events.push(e);
    }
    return events;
  }

  /**
   * Flush any trailing buffered line (called on subprocess exit).
   */
  flush(): DecodedEvent[] {
    const tail = this.buffer;
    this.buffer = "";
    if (!tail.trim()) return [];
    return this.decodeLine(tail);
  }

  private decodeLine(line: string): DecodedEvent[] {
    let raw: any;
    try {
      raw = JSON.parse(line);
    } catch {
      return [{ kind: "error", message: `failed to parse stream-json line: ${line.slice(0, 200)}` }];
    }

    const type = raw?.type;
    if (type === "system") return this.decodeSystem(raw);
    if (type === "stream_event") return this.decodeStreamEvent(raw);
    if (type === "assistant") return this.decodeAssistant(raw);
    if (type === "user") return this.decodeUserEvent(raw);
    if (type === "rate_limit_event") return this.decodeRateLimit(raw);
    if (type === "result") return this.decodeResult(raw);
    return [];
  }

  private decodeSystem(raw: any): DecodedEvent[] {
    if (raw.subtype !== "init") return [];
    // The CLI emits `system/init` once per turn; only surface it the first
    // time so the UI doesn't re-initialize on every turn.
    if (this.seenInit) return [];
    this.seenInit = true;
    const info: SessionInfo = {
      sessionId: raw.session_id ?? "",
      cwd: raw.cwd ?? "",
      model: raw.model ?? "",
      permissionMode: raw.permissionMode ?? "",
      plugins: Array.isArray(raw.plugins) ? raw.plugins.map((p: any) => ({ name: p.name, path: p.path })) : [],
      slashCommands: Array.isArray(raw.slash_commands) ? raw.slash_commands : [],
      skills: Array.isArray(raw.skills) ? raw.skills : [],
      agents: Array.isArray(raw.agents) ? raw.agents : [],
      tools: Array.isArray(raw.tools) ? raw.tools : [],
    };
    return [{ kind: "session_ready", info }];
  }

  private decodeStreamEvent(raw: any): DecodedEvent[] {
    const ev = raw.event;
    if (!ev || typeof ev !== "object") return [];

    if (ev.type === "content_block_start") {
      const block = ev.content_block;
      const t = block?.type;
      if (t === "text" || t === "thinking" || t === "tool_use") {
        this.currentBlockType = t;
      } else {
        this.currentBlockType = "other";
      }
      return [];
    }

    if (ev.type === "content_block_delta") {
      const delta = ev.delta;
      if (!delta) return [];
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        return [{ kind: "text_delta", text: delta.text }];
      }
      if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
        return [{ kind: "thinking_delta", text: delta.thinking }];
      }
      // signature_delta and input_json_delta are present but we rely on the
      // assistant-level event for final tool_use extraction instead of
      // reassembling partial_json fragments here.
      return [];
    }

    if (ev.type === "content_block_stop") {
      const prev = this.currentBlockType;
      this.currentBlockType = null;
      if (prev === "text") return [{ kind: "text_end" }];
      if (prev === "thinking") return [{ kind: "thinking_end" }];
      return [];
    }

    return [];
  }

  private decodeAssistant(raw: any): DecodedEvent[] {
    // Full aggregated assistant message — we use this to surface tool_use
    // blocks (inputs are fully assembled here, unlike the streaming deltas).
    const content = raw?.message?.content;
    if (!Array.isArray(content)) return [];
    const events: DecodedEvent[] = [];
    for (const block of content) {
      if (block?.type === "tool_use") {
        const name = String(block.name ?? "");
        // AskUserQuestion should never reach here because we spawn with
        // --disallowed-tools AskUserQuestion, but defend anyway.
        if (name === "AskUserQuestion") continue;
        events.push({
          kind: "tool_use",
          toolUseId: String(block.id ?? ""),
          name,
          inputSummary: summarizeToolInput(name, block.input),
        });
      }
    }
    return events;
  }

  private decodeUserEvent(raw: any): DecodedEvent[] {
    // `user` events in the stream are tool_result injections from the CLI
    // (e.g. auto-errors for disallowed tools). Surface them so the UI can
    // render the tool-result line, but treat them as informational.
    const content = raw?.message?.content;
    if (!Array.isArray(content)) return [];
    const events: DecodedEvent[] = [];
    for (const block of content) {
      if (block?.type === "tool_result") {
        events.push({
          kind: "tool_result",
          toolUseId: String(block.tool_use_id ?? ""),
          isError: Boolean(block.is_error),
          summary: summarizeToolResult(block.content),
        });
      }
    }
    return events;
  }

  private decodeRateLimit(raw: any): DecodedEvent[] {
    const info = raw?.rate_limit_info;
    if (!info) return [];
    return [
      {
        kind: "rate_limit",
        info: {
          status: info.status,
          resetsAt: info.resetsAt,
          rateLimitType: info.rateLimitType,
          overageStatus: info.overageStatus,
        },
      },
    ];
  }

  private decodeResult(raw: any): DecodedEvent[] {
    return [
      {
        kind: "turn_complete",
        costUsd: Number(raw.total_cost_usd ?? 0),
        durationMs: Number(raw.duration_ms ?? 0),
        numTurns: Number(raw.num_turns ?? 0),
      },
    ];
  }
}

// ─── Summarizers (keep the wire protocol tiny) ─────────────────────────────

export function summarizeToolInput(name: string, input: unknown): string {
  if (input == null) return name + "()";
  if (typeof input !== "object") return `${name}(${String(input).slice(0, 80)})`;
  // Common shapes: Read({file_path: "..."}), Bash({command: "..."}),
  // Edit({file_path, old_string, new_string}), Grep({pattern, path})
  const obj = input as Record<string, unknown>;
  const keys = ["file_path", "path", "command", "pattern", "query"];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string") return `${name}(${truncate(v, 80)})`;
  }
  // Fall back to a compact JSON summary.
  try {
    return `${name}(${truncate(JSON.stringify(obj), 80)})`;
  } catch {
    return name + "(...)";
  }
}

export function summarizeToolResult(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return truncate(content, 200);
  if (Array.isArray(content)) {
    const text = content
      .map((c) => (typeof c === "object" && c && "text" in c ? String((c as { text: unknown }).text) : String(c)))
      .join(" ");
    return truncate(text, 200);
  }
  try {
    return truncate(JSON.stringify(content), 200);
  } catch {
    return "";
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
