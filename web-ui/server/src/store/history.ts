/**
 * Reads Claude Code's persisted session history from
 *   ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
 * and converts it into a sequence of DecodedEvents suitable for replay over
 * the WebSocket protocol.
 *
 * Empirically verified facts about the stored format (Claude Code 2.1.x):
 * - One JSON object per line.
 * - Content is aggregated, not streamed: assistant events carry a complete
 *   `message.content` array with full text / thinking / tool_use blocks.
 *   No `stream_event` delta entries are persisted.
 * - User events are either:
 *     - a plain user prompt:    content: [{type: "text", text: "..."}]
 *     - a tool result injection: content: [{type: "tool_result", tool_use_id, content, is_error}]
 * - `result` events (turn boundaries) carry `total_cost_usd`, `duration_ms`,
 *   `num_turns`.
 * - Many metadata event types exist (system, progress, permission-mode,
 *   hook_*, skill_listing, rate_limit_event, …). We ignore everything we
 *   don't explicitly understand.
 *
 * The cwd encoding: apply `fs.realpath` (so /tmp → /private/tmp on macOS),
 * then replace every `/` AND every `.` with `-`. The result is the leaf
 * directory name under ~/.claude/projects/. Examples:
 *   /Users/alice/dev                 → -Users-alice-dev
 *   /Users/alice/sites/foo.example   → -Users-alice-sites-foo-example
 *   /tmp (→ /private/tmp on macOS)   → -private-tmp
 */

import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DecodedEvent } from "../sessions/proto.js";
import { summarizeToolInput, summarizeToolResult } from "../sessions/proto.js";

const CLAUDE_PROJECTS = join(homedir(), ".claude", "projects");

/**
 * Compute the on-disk path for a given (cwd, sessionId) pair. Exported for
 * the smoke test.
 */
export async function sessionHistoryPath(cwd: string, sessionId: string): Promise<string> {
  const resolved = await realpath(cwd);
  // Claude Code encodes both "/" and "." as "-" in the project directory name.
  const encoded = resolved.replace(/[/.]/g, "-");
  return join(CLAUDE_PROJECTS, encoded, `${sessionId}.jsonl`);
}

/**
 * Load and parse the session history. Returns a flat list of DecodedEvents in
 * chronological order. Throws if the file doesn't exist — caller is expected
 * to catch and treat that as "no history".
 */
export async function loadSessionHistory(
  cwd: string,
  sessionId: string,
): Promise<DecodedEvent[]> {
  const path = await sessionHistoryPath(cwd, sessionId);
  const raw = await readFile(path, "utf8");
  const events: DecodedEvent[] = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Skip malformed lines silently — better than aborting the whole replay.
      continue;
    }
    for (const e of convertStoredEvent(parsed)) {
      events.push(e);
    }
  }
  return events;
}

/**
 * Map a single stored JSONL event to zero or more DecodedEvents.
 * Keep this shape-only — no side effects, no logging.
 */
function convertStoredEvent(raw: any): DecodedEvent[] {
  const type = raw?.type;

  if (type === "user") return convertUserEvent(raw);
  if (type === "assistant") return convertAssistantEvent(raw);
  if (type === "result") return convertResultEvent(raw);

  // Intentionally ignored: system, progress, rate_limit_event,
  // file-history-snapshot, permission-mode, skill_listing, hook_*,
  // deferred_tools_delta, attachment, last-prompt, task_reminder, direct.
  return [];
}

function convertUserEvent(raw: any): DecodedEvent[] {
  const content = raw?.message?.content;
  if (!Array.isArray(content)) return [];
  const out: DecodedEvent[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;

    if (block.type === "text" && typeof block.text === "string") {
      out.push({ kind: "history_user_text", text: block.text });
      continue;
    }

    if (block.type === "tool_result") {
      out.push({
        kind: "tool_result",
        toolUseId: String(block.tool_use_id ?? ""),
        isError: Boolean(block.is_error),
        summary: summarizeToolResult(block.content),
      });
      continue;
    }
  }
  return out;
}

function convertAssistantEvent(raw: any): DecodedEvent[] {
  const content = raw?.message?.content;
  if (!Array.isArray(content)) return [];
  const out: DecodedEvent[] = [];

  for (const block of content) {
    if (!block || typeof block !== "object") continue;

    if (block.type === "text" && typeof block.text === "string") {
      // Emit the full text as a single delta+end pair. The UI treats this
      // identically to a live stream that finished instantly.
      out.push({ kind: "text_delta", text: block.text });
      out.push({ kind: "text_end" });
      continue;
    }

    if (block.type === "thinking" && typeof block.thinking === "string") {
      out.push({ kind: "thinking_delta", text: block.thinking });
      out.push({ kind: "thinking_end" });
      continue;
    }

    if (block.type === "tool_use") {
      const name = String(block.name ?? "");
      // Skip the legacy built-in AskUserQuestion — matches the live filter
      // in proto.ts. Our custom mcp__ccweb__ask_user_question is allowed
      // through as a generic tool indicator.
      if (name === "AskUserQuestion") continue;
      out.push({
        kind: "tool_use",
        toolUseId: String(block.id ?? ""),
        name,
        inputSummary: summarizeToolInput(name, block.input),
      });
      continue;
    }
  }
  return out;
}

function convertResultEvent(raw: any): DecodedEvent[] {
  return [
    {
      kind: "turn_complete",
      costUsd: Number(raw.total_cost_usd ?? 0),
      durationMs: Number(raw.duration_ms ?? 0),
      numTurns: Number(raw.num_turns ?? 0),
    },
  ];
}
