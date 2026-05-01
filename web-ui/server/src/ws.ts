/**
 * WebSocket message routing. One WebSocket = one active session.
 *
 * Client sends ClientMessage; server maps them onto SessionManager actions
 * and pipes SessionEvents back as ServerMessage.
 */

import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type {
  ClientMessage,
  ServerMessage,
  RateLimitInfo,
} from "@ccweb/shared";
import type { DecodedEvent } from "./sessions/proto.js";
import type { SessionEvent } from "./sessions/session.js";
import { randomUUID } from "node:crypto";
import { sessionManager } from "./sessions/manager.js";
import { metadataStore } from "./store/metadata.js";
import { loadSessionHistory } from "./store/history.js";
import { pendingQuestions } from "./questions.js";

// Map from localSessionId → the WebSocket currently bound to that session.
// Populated when a client sends `new_session` or `open_session`.
// Used by the internal question route to push `ask_question` events.
const sessionSockets = new Map<string, WebSocket>();

export function activeWsForSession(localSessionId: string): WebSocket | undefined {
  return sessionSockets.get(localSessionId);
}

export async function registerWebSocket(app: FastifyInstance) {
  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    let localSessionId: string | null = null;
    let unsubscribe: (() => void) | null = null;

    const send = (msg: ServerMessage) => {
      try {
        socket.send(JSON.stringify(msg));
      } catch {
        // socket closed — ignore
      }
    };

    const handleSessionEvent = (evt: SessionEvent) => {
      if (evt.kind === "decoded") {
        const server = decodedToServer(evt.event);
        if (server) send(server);
      } else if (evt.kind === "stderr") {
        app.log.debug({ stderr: evt.text.slice(0, 500) }, "claude stderr");
      } else if (evt.kind === "exit") {
        send({ type: "subprocess_exited", code: evt.code });
      } else if (evt.kind === "error") {
        send({ type: "error", message: evt.message });
      }
    };

    socket.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch {
        send({ type: "error", message: "invalid JSON on client message" });
        return;
      }
      void (async () => {
        try {
          await handleClientMessage(msg);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          app.log.error({ err }, "ws handler threw");
          send({ type: "error", message: `server error: ${message}` });
        }
      })();
    });

    async function handleClientMessage(msg: ClientMessage) {

      if (msg.type === "new_session") {
        if (localSessionId) {
          send({ type: "error", message: "already has an active session" });
          return;
        }
        app.log.info(
          {
            cwd: msg.cwd,
            mode: msg.permissionMode,
            integrations: msg.enabledIntegrations ?? [],
          },
          "spawning new session",
        );
        const session = sessionManager.create({
          cwd: msg.cwd,
          permissionMode: msg.permissionMode,
          enabledIntegrations: msg.enabledIntegrations,
          // extraMcpServers comes from Sprint 3's registry; empty until then.
        });
        localSessionId = session.id;
        sessionSockets.set(localSessionId, socket);
        unsubscribe = session.subscribe((evt) => {
          handleSessionEvent(evt);
          // After init fires we can persist metadata with Claude's real sid.
          if (evt.kind === "decoded" && evt.event.kind === "session_ready") {
            metadataStore.upsert({
              id: evt.event.info.sessionId,
              title: msg.title ?? "Untitled session",
              cwd: msg.cwd,
              permissionMode: msg.permissionMode,
            });
          }
        });
        return;
      }

      if (msg.type === "open_session") {
        if (localSessionId) {
          send({ type: "error", message: "already has an active session" });
          return;
        }
        const meta = metadataStore.get(msg.sessionId);
        if (!meta) {
          send({ type: "error", message: `session not found: ${msg.sessionId}` });
          return;
        }

        // Allocate the local session id up front so history replay and the
        // later spawn share the same id — this matters because the MCP
        // worker routes tool calls back using CCWEB_SESSION_ID, and we bind
        // sessionSockets before the subprocess exists.
        localSessionId = randomUUID();
        sessionSockets.set(localSessionId, socket);

        // Replay persisted history before spawning claude so the user sees
        // their past conversation within ~50ms of the click instead of after
        // the 2-3s subprocess boot.
        send({ type: "history_start" });
        try {
          const events = await loadSessionHistory(meta.cwd, meta.id);
          for (const e of events) {
            const server = decodedToServer(e);
            if (server) send(server);
          }
        } catch (err) {
          app.log.warn(
            { err, sessionId: meta.id, cwd: meta.cwd },
            "history replay skipped (file missing or parse error)",
          );
        }
        send({ type: "history_end" });

        const session = sessionManager.create({
          cwd: meta.cwd,
          permissionMode: meta.permissionMode,
          resumeSessionId: meta.id,
          localId: localSessionId,
        });
        unsubscribe = session.subscribe(handleSessionEvent);
        metadataStore.touch(meta.id);
        return;
      }

      if (msg.type === "answer_question") {
        const ok = pendingQuestions.answer(msg.questionId, msg.answers);
        if (!ok) {
          send({
            type: "error",
            message: `no pending question with id ${msg.questionId}`,
          });
        }
        return;
      }

      if (!localSessionId) {
        send({ type: "error", message: "no active session" });
        return;
      }

      const session = sessionManager.get(localSessionId);
      if (!session) {
        send({ type: "error", message: "session lost" });
        return;
      }

      if (msg.type === "user_input") {
        session.sendUserText(msg.text);
        return;
      }
      if (msg.type === "interrupt") {
        session.interrupt();
        return;
      }
      if (msg.type === "set_toolset") {
        // Mid-session retoggle: stop the current subprocess, then respawn
        // on the same cwd with new flags, resuming the JSONL by id so the
        // user keeps their conversation. The browser sees a fresh
        // `session_ready` once init re-fires.
        const claudeSessionId = session.getClaudeSessionId();
        if (!claudeSessionId) {
          send({
            type: "error",
            message: "session not ready yet — wait for init before changing toolset",
          });
          return;
        }
        const { cwd, permissionMode } = session;
        app.log.info(
          { cwd, integrations: msg.enabledIntegrations },
          "restarting session with new toolset",
        );
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        sessionManager.remove(localSessionId);
        const next = sessionManager.create({
          cwd,
          permissionMode,
          resumeSessionId: claudeSessionId,
          localId: localSessionId,
          enabledIntegrations: msg.enabledIntegrations,
          // extraMcpServers comes from Sprint 3's registry.
        });
        unsubscribe = next.subscribe(handleSessionEvent);
        return;
      }
      if (msg.type === "close_session") {
        sessionManager.remove(localSessionId);
        localSessionId = null;
        return;
      }
    }

    socket.on("close", () => {
      if (unsubscribe) unsubscribe();
      if (localSessionId) {
        sessionSockets.delete(localSessionId);
        pendingQuestions.rejectForSession(localSessionId, "websocket closed");
        sessionManager.remove(localSessionId);
        localSessionId = null;
      }
    });
  });
}

function decodedToServer(event: DecodedEvent): ServerMessage | null {
  switch (event.kind) {
    case "session_ready":
      return { type: "session_ready", info: event.info };
    case "text_delta":
      return { type: "text_delta", text: event.text };
    case "text_end":
      return { type: "text_end" };
    case "thinking_delta":
      return { type: "thinking_delta", text: event.text };
    case "thinking_end":
      return { type: "thinking_end" };
    case "tool_use":
      return {
        type: "tool_use",
        toolUseId: event.toolUseId,
        name: event.name,
        inputSummary: event.inputSummary,
      };
    case "tool_result":
      return {
        type: "tool_result",
        toolUseId: event.toolUseId,
        isError: event.isError,
        summary: event.summary,
      };
    case "rate_limit": {
      const info: RateLimitInfo = {
        status: event.info.status ?? "unknown",
        resetsAt: event.info.resetsAt,
        rateLimitType: event.info.rateLimitType,
        overageStatus: event.info.overageStatus,
      };
      return { type: "rate_limit", info };
    }
    case "turn_complete":
      return {
        type: "turn_complete",
        costUsd: event.costUsd,
        durationMs: event.durationMs,
        numTurns: event.numTurns,
      };
    case "history_user_text":
      return { type: "history_user_text", text: event.text };
    case "error":
      return { type: "error", message: event.message };
    default:
      return null;
  }
}
