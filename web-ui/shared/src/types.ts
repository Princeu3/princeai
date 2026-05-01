/**
 * Wire protocol between the browser UI and the Node.js server.
 * Both sides import from here; a mismatch is a TypeScript error.
 */

// ─── Permission modes surfaced in the UI ──────────────────────────────────
// Only the three headless-compatible modes are exposed. "default", "auto",
// "dontAsk" are not supported because they hang in `-p` mode without
// --permission-prompt-tool (which is absent in the current claude version).
export type PermissionMode = "acceptEdits" | "bypassPermissions" | "plan";

// ─── Per-session integration toggles ──────────────────────────────────────
// The Connections panel (Sprint 3+) discovers available integrations from a
// JSON registry on the server. This wire-protocol layer carries only the
// IDs the user has enabled for a given session — the server resolves each
// ID against the registry to compute --mcp-config / --allowed-tools flags.
export type Platform =
  | "reddit"
  | "twitter"
  | "linkedin"
  | "github"
  | "youtube"
  | "exa"
  | "tavily"
  | "gmail"
  | "context7";

export type ConnectionState = "connected" | "missing" | "expired" | "unsupported";

export interface PlatformStatus {
  platform: Platform;
  state: ConnectionState;
  detail?: string;
  lastCheckedAt: number;
}

// ─── Session metadata surfaced from the `system/init` event ───────────────
export interface SessionInfo {
  sessionId: string;
  cwd: string;
  model: string;
  permissionMode: string;
  plugins: Array<{ name: string; path: string }>;
  slashCommands: string[];
  skills: string[];
  agents: string[];
  tools: string[];
}

// ─── Structured questions (delivered via our MCP tool, not AskUserQuestion) ─
// Claude Code's built-in AskUserQuestion auto-errors in -p mode. We instead
// expose our own `mcp__ccweb__ask_user_question` tool via a custom MCP server
// and instruct Claude to use it. The schema is intentionally identical to the
// built-in so Claude's prompting habits transfer cleanly.
export interface AskQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: Array<{ label: string; description?: string }>;
}

export interface RateLimitInfo {
  status: string;
  resetsAt?: number;
  rateLimitType?: string;
  overageStatus?: string;
}

// ─── Client → Server (over WebSocket) ─────────────────────────────────────
// `enabledIntegrations` on `new_session` is optional: pre-Sprint-5 UI doesn't
// send it, and the server defaults to an empty list (no integrations).
// `set_toolset` retoggles mid-session — server stops the subprocess and
// respawns it on the same cwd with new flags, resuming the JSONL by id.
export type ClientMessage =
  | {
      type: "new_session";
      cwd: string;
      permissionMode: PermissionMode;
      title?: string;
      enabledIntegrations?: Platform[];
    }
  | { type: "open_session"; sessionId: string }
  | { type: "user_input"; text: string }
  | { type: "answer_question"; questionId: string; answers: string[] }
  | { type: "set_toolset"; enabledIntegrations: Platform[] }
  | { type: "interrupt" }
  | { type: "close_session" };

// ─── Server → Client (over WebSocket) ─────────────────────────────────────
// Structured questions arrive as `ask_question` events when Claude calls our
// custom MCP tool. The built-in AskUserQuestion is disallowed because the
// CLI auto-errors it in headless mode.
//
// `history_start` / `history_user_text` / `history_end` are emitted when a
// past session is being resumed — the server parses ~/.claude/projects/...
// JSONL and replays its events so the chat populates immediately. Live
// streaming events and history events are the same shape; the bracketing
// markers tell the client it's a replay (suppress notifications, show a
// loading banner, etc).
export type ServerMessage =
  | { type: "session_ready"; info: SessionInfo }
  | { type: "text_delta"; text: string }
  | { type: "text_end" }
  | { type: "thinking_delta"; text: string }
  | { type: "thinking_end" }
  | { type: "tool_use"; toolUseId: string; name: string; inputSummary: string }
  | { type: "tool_result"; toolUseId: string; isError: boolean; summary: string }
  | { type: "ask_question"; questionId: string; questions: AskQuestion[] }
  | { type: "rate_limit"; info: RateLimitInfo }
  | { type: "turn_complete"; costUsd: number; durationMs: number; numTurns: number }
  | { type: "history_start" }
  | { type: "history_user_text"; text: string }
  | { type: "history_end" }
  | { type: "error"; message: string }
  | { type: "subprocess_exited"; code: number | null };

// ─── REST responses (for session list / fs browse) ────────────────────────
export interface SessionListEntry {
  id: string;
  title: string;
  cwd: string;
  permissionMode: PermissionMode;
  createdAt: number;
  lastOpenedAt: number;
}

export interface FsEntry {
  name: string;
  type: "dir" | "file";
  size?: number;
}

export interface FsListResponse {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}
