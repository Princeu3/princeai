/**
 * One Claude subprocess, its stdin/stdout plumbing, and the fan-out of
 * DecodedEvents to subscribers (typically one WebSocket connection).
 *
 * Lifecycle:
 *   new Session(opts)       – prepare, don't spawn yet
 *   session.start()         – spawn claude, start reading stdout
 *   session.sendUserText(s) – write a stream-json user message to stdin
 *   session.stop()          – SIGTERM the subprocess
 *
 * Events are broadcast via subscribe(cb); the callback gets every
 * DecodedEvent in order plus special lifecycle events (exit, error).
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamJsonDecoder, encodeUserText, type DecodedEvent } from "./proto.js";
import type { PermissionMode } from "@ccweb/shared";
import { config } from "../config.js";
import { internalToken } from "../routes/internal.js";

const here = dirname(fileURLToPath(import.meta.url));
// server/src/sessions → server/src/mcp/worker.ts
const MCP_WORKER_PATH = join(here, "..", "mcp", "worker.ts");

export interface SessionStartOptions {
  cwd: string;
  permissionMode: PermissionMode;
  resumeSessionId?: string;
}

export type SessionEvent =
  | { kind: "decoded"; event: DecodedEvent }
  | { kind: "stderr"; text: string }
  | { kind: "exit"; code: number | null; signal: NodeJS.Signals | null }
  | { kind: "error"; message: string };

export type SessionSubscriber = (event: SessionEvent) => void;

// System-prompt nudge that repoints Claude from the built-in AskUserQuestion
// (which auto-errors in headless mode) to our custom MCP tool. The MCP tool
// has the exact same schema so Claude's prompting habits transfer cleanly.
const UI_SYSTEM_PROMPT = `You are running inside a web chat UI. Structured multi-choice questions are available via the \`mcp__ccweb__ask_user_question\` tool — use it whenever you would normally call \`AskUserQuestion\`. It accepts the same { questions: [{ question, header, multiSelect, options: [{ label, description }] }] } shape and the user's picks are returned as plain text. Do NOT call \`AskUserQuestion\` itself — it is disabled in this environment.`;

export class Session {
  readonly id: string;
  readonly cwd: string;
  readonly permissionMode: PermissionMode;

  private child?: ChildProcessWithoutNullStreams;
  private decoder = new StreamJsonDecoder();
  private subscribers = new Set<SessionSubscriber>();
  private buffer: SessionEvent[] = [];
  private stopped = false;
  // Claude's authoritative session_id, learned from the `system/init` event.
  // Distinct from `this.id` which is our local placeholder before init lands.
  private claudeSessionId?: string;

  constructor(opts: SessionStartOptions & { localId?: string }) {
    this.id = opts.localId ?? randomUUID();
    this.cwd = opts.cwd;
    this.permissionMode = opts.permissionMode;
  }

  subscribe(cb: SessionSubscriber): () => void {
    this.subscribers.add(cb);
    // Replay buffered events so a late subscriber still sees them.
    for (const e of this.buffer) cb(e);
    return () => this.subscribers.delete(cb);
  }

  getClaudeSessionId(): string | undefined {
    return this.claudeSessionId;
  }

  start(opts: { resumeSessionId?: string }) {
    if (this.child) throw new Error("already started");

    const args = this.buildArgs(opts.resumeSessionId);
    // The MCP worker subprocess inherits these env vars from claude (which
    // inherits from us) so it knows which ccweb session to talk to.
    const env = {
      ...process.env,
      CCWEB_SESSION_ID: this.id,
      CCWEB_INTERNAL_URL: `http://${config.host}:${config.port}`,
      CCWEB_INTERNAL_TOKEN: internalToken(),
    };
    try {
      this.child = spawn(config.claudeBinary, args, {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Defer emit so subscribers attached after start() still see it.
      setImmediate(() => this.emit({ kind: "error", message: `spawn failed: ${message}` }));
      setImmediate(() => this.emit({ kind: "exit", code: null, signal: null }));
      return;
    }

    this.child.on("error", (err) => {
      this.emit({ kind: "error", message: `subprocess spawn error: ${err.message}` });
    });

    this.child.stdout.on("data", (chunk: Buffer) => {
      const events = this.decoder.push(chunk);
      for (const event of events) {
        if (event.kind === "session_ready") {
          this.claudeSessionId = event.info.sessionId;
        }
        this.emit({ kind: "decoded", event });
      }
    });

    this.child.stdout.on("end", () => {
      const tail = this.decoder.flush();
      for (const event of tail) this.emit({ kind: "decoded", event });
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      this.emit({ kind: "stderr", text: chunk.toString("utf8") });
    });

    this.child.on("exit", (code, signal) => {
      this.emit({ kind: "exit", code, signal });
    });
  }

  sendUserText(text: string) {
    if (!this.child || !this.child.stdin.writable) {
      this.emit({ kind: "error", message: "cannot send user text: subprocess not running" });
      return;
    }
    this.child.stdin.write(encodeUserText(text));
  }

  interrupt() {
    this.child?.kill("SIGINT");
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (!this.child) return;
    try {
      this.child.stdin.end();
    } catch {
      // ignore
    }
    this.child.kill("SIGTERM");
    // Fallback: force-kill after 5s if it didn't exit cleanly.
    setTimeout(() => {
      if (this.child && !this.child.killed) {
        this.child.kill("SIGKILL");
      }
    }, 5000).unref();
  }

  private buildArgs(resumeSessionId?: string): string[] {
    // Load our stdio MCP worker via a JSON config passed as a string.
    // The worker forwards `ask_user_question` calls to the main server
    // over HTTP; see server/src/mcp/worker.ts.
    const mcpConfig = JSON.stringify({
      mcpServers: {
        ccweb: {
          type: "stdio",
          command: "npx",
          args: ["--yes", "tsx", MCP_WORKER_PATH],
        },
      },
    });

    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--include-partial-messages",
      "--permission-mode",
      this.permissionMode,
      "--mcp-config",
      mcpConfig,
      "--disallowed-tools",
      "AskUserQuestion",
      "--append-system-prompt",
      UI_SYSTEM_PROMPT,
      "--verbose",
    ];
    if (resumeSessionId) {
      args.push("--resume", resumeSessionId);
    }
    return args;
  }

  private emit(event: SessionEvent) {
    this.buffer.push(event);
    // Keep the buffer from growing unbounded across long sessions: cap at
    // 2000 events (enough for typical reconnection replay but not forever).
    if (this.buffer.length > 2000) this.buffer.splice(0, this.buffer.length - 2000);
    for (const cb of this.subscribers) cb(event);
  }
}
