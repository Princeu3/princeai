/**
 * Internal endpoint hit by the MCP worker subprocess. Accepts a question
 * payload, registers it in the pending-question registry, broadcasts an
 * `ask_question` event to the session's WebSocket, and blocks the HTTP
 * response until the user answers (or timeout).
 *
 * Protected by a shared token (not open to browsers).
 */

import type { FastifyInstance } from "fastify";
import type { AskQuestion } from "@ccweb/shared";
import { pendingQuestions } from "../questions.js";
import { activeWsForSession } from "../ws.js";

export function internalToken(): string {
  return process.env.CCWEB_INTERNAL_TOKEN ?? defaultToken;
}

// Generated once per server boot, so each Claude subprocess run sees the
// same token via env. Regenerated on restart.
const defaultToken = (() => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
})();
process.env.CCWEB_INTERNAL_TOKEN = internalToken();

interface InternalQuestionBody {
  sessionId: string;
  args: {
    questions: AskQuestion[];
  };
}

export async function registerInternalRoutes(app: FastifyInstance) {
  app.post<{ Body: InternalQuestionBody }>("/internal/question", async (req, reply) => {
    const token = req.headers["x-ccweb-token"];
    if (token !== internalToken()) {
      return reply.status(403).send({ error: "bad token" });
    }

    const body = req.body;
    const localSessionId = body?.sessionId;
    const questions = body?.args?.questions;
    if (!localSessionId || !Array.isArray(questions) || questions.length === 0) {
      return reply.status(400).send({ error: "missing sessionId or questions" });
    }

    const ws = activeWsForSession(localSessionId);
    if (!ws) {
      return reply.status(404).send({ error: "no active websocket for session" });
    }

    const { id, promise } = pendingQuestions.create(localSessionId, questions);

    try {
      ws.send(
        JSON.stringify({
          type: "ask_question",
          questionId: id,
          questions,
        }),
      );
    } catch (err) {
      pendingQuestions.answer(id, []); // release the promise
      return reply
        .status(500)
        .send({ error: `failed to deliver question to websocket: ${String(err)}` });
    }

    try {
      const answers = await promise;
      return { answers };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(504).send({ error: message });
    }
  });
}
