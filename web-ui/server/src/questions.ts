/**
 * Pending-question registry. A question from the MCP worker is registered
 * here with a unique ID; its promise resolves when the WebSocket delivers an
 * `answer_question` ClientMessage for that ID. A timeout keeps zombie
 * questions from blocking the MCP worker forever.
 */

import { randomUUID } from "node:crypto";
import type { AskQuestion } from "@ccweb/shared";

export interface PendingQuestion {
  id: string;
  localSessionId: string;
  questions: AskQuestion[];
  createdAt: number;
  resolve: (answers: string[]) => void;
  reject: (err: Error) => void;
}

const QUESTION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — user has time to step away

class PendingQuestionRegistry {
  private pending = new Map<string, PendingQuestion>();

  /**
   * Create a new pending question and return a promise that resolves with
   * the user's answers.
   */
  create(localSessionId: string, questions: AskQuestion[]): { id: string; promise: Promise<string[]> } {
    const id = randomUUID();
    let resolveFn!: (answers: string[]) => void;
    let rejectFn!: (err: Error) => void;
    const promise = new Promise<string[]>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const entry: PendingQuestion = {
      id,
      localSessionId,
      questions,
      createdAt: Date.now(),
      resolve: resolveFn,
      reject: rejectFn,
    };
    this.pending.set(id, entry);

    // Safety: reject after timeout so the MCP worker doesn't block forever.
    const timer = setTimeout(() => {
      if (this.pending.has(id)) {
        this.pending.delete(id);
        entry.reject(new Error("question timed out after 30 minutes"));
      }
    }, QUESTION_TIMEOUT_MS);
    timer.unref();

    return { id, promise };
  }

  answer(id: string, answers: string[]): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    entry.resolve(answers);
    return true;
  }

  /** Called when a WebSocket disconnects — reject any pending questions for it. */
  rejectForSession(localSessionId: string, reason: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.localSessionId === localSessionId) {
        this.pending.delete(id);
        entry.reject(new Error(reason));
      }
    }
  }

  /** Lookup for the WS handler to know which session a question belongs to. */
  get(id: string): PendingQuestion | undefined {
    return this.pending.get(id);
  }
}

export const pendingQuestions = new PendingQuestionRegistry();
