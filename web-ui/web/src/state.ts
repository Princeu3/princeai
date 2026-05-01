import { create } from "zustand";
import type {
  SessionListEntry,
  SessionInfo,
  ServerMessage,
  PermissionMode,
  AskQuestion,
} from "@ccweb/shared";

// ─── Chat data model ───────────────────────────────────────────────────────
// We collapse raw ServerMessage events into a linear list of renderable
// items. The UI only needs to iterate this list.

export type ChatItem =
  | { kind: "assistant_text"; id: string; text: string; streaming: boolean }
  | { kind: "thinking"; id: string; text: string; streaming: boolean }
  | { kind: "user_text"; id: string; text: string }
  | { kind: "tool_use"; id: string; toolUseId: string; name: string; summary: string }
  | { kind: "tool_result"; id: string; toolUseId: string; isError: boolean; summary: string }
  | {
      kind: "ask_question";
      id: string;
      questionId: string;
      questions: AskQuestion[];
      // Populated once the user answers; keeps the card visible with the answer shown.
      answered: string[] | null;
    }
  | { kind: "turn_complete"; id: string; costUsd: number; durationMs: number }
  | { kind: "error"; id: string; message: string }
  | { kind: "exit"; id: string; code: number | null };

export type WsStatus = "idle" | "connecting" | "open" | "closed";

interface AppState {
  // session list from the server (sidebar)
  sessions: SessionListEntry[];
  loadingSessions: boolean;

  // active session (one at a time)
  active: {
    info: SessionInfo | null;
    items: ChatItem[];
    busy: boolean; // true while Claude is working on a turn
    wsStatus: WsStatus;
    // ID of the currently-open (unanswered) question, if any. While set,
    // the send button is disabled and the AskQuestionCard shows its buttons.
    pendingQuestionId: string | null;
    // True while the server is replaying a resumed session's JSONL history.
    // Input is disabled and notifications are suppressed.
    loadingHistory: boolean;
    // Seeded from the sidebar row on click so the chat header can render
    // the session's cwd/title/mode immediately, before session_ready fires
    // from the actual claude subprocess (which takes 2-3s to boot).
    pendingSession: SessionListEntry | null;
  };

  // methods
  setSessions: (s: SessionListEntry[]) => void;
  setLoadingSessions: (v: boolean) => void;
  resetActive: (pendingSession?: SessionListEntry | null) => void;
  setWsStatus: (s: WsStatus) => void;
  pushUserMessage: (text: string) => void;
  markQuestionAnswered: (questionId: string, answers: string[]) => void;
  ingestServerMessage: (msg: ServerMessage) => void;
}

const randomId = () =>
  (crypto as { randomUUID?: () => string }).randomUUID?.() ??
  Math.random().toString(36).slice(2);

export const useAppStore = create<AppState>((set) => ({
  sessions: [],
  loadingSessions: false,
  active: {
    info: null,
    items: [],
    busy: false,
    wsStatus: "idle",
    pendingQuestionId: null,
    loadingHistory: false,
    pendingSession: null,
  },

  setSessions: (sessions) => set({ sessions }),
  setLoadingSessions: (loadingSessions) => set({ loadingSessions }),

  resetActive: (pendingSession = null) =>
    set((s) => ({
      // Preserve wsStatus — the websocket connection is independent of the
      // chat/session we're viewing. Clearing it would lie to the UI and
      // disable the send button until the next reconnect.
      active: {
        info: null,
        items: [],
        busy: false,
        wsStatus: s.active.wsStatus,
        pendingQuestionId: null,
        loadingHistory: false,
        pendingSession,
      },
    })),

  setWsStatus: (wsStatus) =>
    set((s) => ({ active: { ...s.active, wsStatus } })),

  pushUserMessage: (text) =>
    set((s) => ({
      active: {
        ...s.active,
        busy: true,
        items: [
          ...s.active.items,
          { kind: "user_text", id: randomId(), text },
        ],
      },
    })),

  markQuestionAnswered: (questionId, answers) =>
    set((s) => {
      const items = s.active.items.map((it) =>
        it.kind === "ask_question" && it.questionId === questionId
          ? { ...it, answered: answers }
          : it,
      );
      return {
        active: {
          ...s.active,
          items,
          pendingQuestionId:
            s.active.pendingQuestionId === questionId ? null : s.active.pendingQuestionId,
        },
      };
    }),

  ingestServerMessage: (msg) =>
    set((s) => {
      const items = [...s.active.items];
      let info = s.active.info;
      let busy = s.active.busy;
      let pendingQuestionId = s.active.pendingQuestionId;
      let loadingHistory = s.active.loadingHistory;
      let pendingSession = s.active.pendingSession;

      const lastOfKind = (k: ChatItem["kind"]) => {
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          if (it && it.kind === k) return { idx: i, item: it };
        }
        return null;
      };

      switch (msg.type) {
        case "session_ready":
          info = msg.info;
          // Live session info has landed — drop the optimistic sidebar row.
          pendingSession = null;
          break;

        case "history_start":
          loadingHistory = true;
          break;

        case "history_end":
          loadingHistory = false;
          break;

        case "history_user_text":
          items.push({ kind: "user_text", id: randomId(), text: msg.text });
          break;

        case "text_delta": {
          const last = lastOfKind("assistant_text");
          if (last && last.item.kind === "assistant_text" && last.item.streaming) {
            items[last.idx] = {
              ...last.item,
              text: last.item.text + msg.text,
            };
          } else {
            items.push({
              kind: "assistant_text",
              id: randomId(),
              text: msg.text,
              streaming: true,
            });
          }
          break;
        }
        case "text_end": {
          const last = lastOfKind("assistant_text");
          if (last && last.item.kind === "assistant_text") {
            items[last.idx] = { ...last.item, streaming: false };
          }
          break;
        }

        case "thinking_delta": {
          const last = lastOfKind("thinking");
          if (last && last.item.kind === "thinking" && last.item.streaming) {
            items[last.idx] = {
              ...last.item,
              text: last.item.text + msg.text,
            };
          } else {
            items.push({
              kind: "thinking",
              id: randomId(),
              text: msg.text,
              streaming: true,
            });
          }
          break;
        }
        case "thinking_end": {
          const last = lastOfKind("thinking");
          if (last && last.item.kind === "thinking") {
            items[last.idx] = { ...last.item, streaming: false };
          }
          break;
        }

        case "tool_use":
          items.push({
            kind: "tool_use",
            id: randomId(),
            toolUseId: msg.toolUseId,
            name: msg.name,
            summary: msg.inputSummary,
          });
          break;

        case "tool_result":
          items.push({
            kind: "tool_result",
            id: randomId(),
            toolUseId: msg.toolUseId,
            isError: msg.isError,
            summary: msg.summary,
          });
          break;

        case "ask_question":
          items.push({
            kind: "ask_question",
            id: randomId(),
            questionId: msg.questionId,
            questions: msg.questions,
            answered: null,
          });
          pendingQuestionId = msg.questionId;
          break;

        case "turn_complete":
          busy = false;
          items.push({
            kind: "turn_complete",
            id: randomId(),
            costUsd: msg.costUsd,
            durationMs: msg.durationMs,
          });
          break;

        case "error":
          items.push({
            kind: "error",
            id: randomId(),
            message: msg.message,
          });
          break;

        case "subprocess_exited":
          busy = false;
          items.push({
            kind: "exit",
            id: randomId(),
            code: msg.code,
          });
          break;

        case "rate_limit":
          // Ignore for now — could surface in a status bar later.
          break;
      }

      return {
        active: {
          ...s.active,
          items,
          info,
          busy,
          pendingQuestionId,
          loadingHistory,
          pendingSession,
        },
      };
    }),
}));

// ─── REST helpers ──────────────────────────────────────────────────────────

export async function fetchSessions(): Promise<SessionListEntry[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error(`sessions list failed: ${res.status}`);
  const data = (await res.json()) as { sessions: SessionListEntry[] };
  return data.sessions;
}

export interface DirListing {
  path: string;
  parent: string | null;
  entries: Array<{ name: string; type: "dir" | "file"; size?: number }>;
}

export async function fetchFsList(path?: string): Promise<DirListing> {
  const q = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await fetch(`/api/fs/list${q}`);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `fs list failed: ${res.status}`);
  }
  return res.json();
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete session failed: ${res.status}`);
}

export async function renameSession(id: string, title: string): Promise<void> {
  const res = await fetch(`/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`rename session failed: ${res.status}`);
}

// Types shared with fetchFsList response.
export type { PermissionMode };
