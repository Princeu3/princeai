import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../state.js";
import { send } from "../ws.js";
import { AssistantMessage, UserMessage } from "./Message.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolIndicator } from "./ToolIndicator.js";
import { AskQuestionCard } from "./AskQuestionCard.js";
import { fireNotification } from "../notifications.js";

export function ChatView() {
  const items = useAppStore((s) => s.active.items);
  const info = useAppStore((s) => s.active.info);
  const busy = useAppStore((s) => s.active.busy);
  const wsStatus = useAppStore((s) => s.active.wsStatus);
  const pendingQuestionId = useAppStore((s) => s.active.pendingQuestionId);
  const loadingHistory = useAppStore((s) => s.active.loadingHistory);
  const pendingSession = useAppStore((s) => s.active.pendingSession);
  const pushUserMessage = useAppStore((s) => s.pushUserMessage);
  const markQuestionAnswered = useAppStore((s) => s.markQuestionAnswered);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // What to show in the header: prefer live session_ready info, fall back
  // to the optimistic sidebar row we were clicked with.
  const headerCwd = info?.cwd ?? pendingSession?.cwd ?? null;
  const headerModel = info?.model ?? null;
  const headerMode = info?.permissionMode ?? pendingSession?.permissionMode ?? null;
  const headerTitle = pendingSession?.title ?? "Chat";

  // Auto-scroll on new items.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, items[items.length - 1]]);

  // Fire a browser notification when a turn completes and the tab is hidden.
  // Suppressed during history replay — those events are re-renders of past
  // state, not fresh activity.
  useEffect(() => {
    if (loadingHistory) return;
    const last = items[items.length - 1];
    if (!last) return;
    if (last.kind === "ask_question") {
      const q = last.questions[0]?.question ?? "Claude needs your input";
      fireNotification("Claude has a question", q);
    } else if (last.kind === "turn_complete") {
      fireNotification("Claude is waiting", "Your turn.");
    } else if (last.kind === "error") {
      fireNotification("Claude error", last.message);
    } else if (last.kind === "exit") {
      fireNotification("Claude exited", `exit code ${last.code ?? "unknown"}`);
    }
  }, [items, loadingHistory]);

  const canSend =
    wsStatus === "open" &&
    !busy &&
    !pendingQuestionId &&
    !loadingHistory &&
    draft.trim().length > 0;

  const handleSend = () => {
    if (!canSend) return;
    const text = draft.trim();
    pushUserMessage(text);
    send({ type: "user_input", text });
    setDraft("");
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="font-semibold truncate max-w-[240px]">{headerTitle}</div>
          {(headerCwd || headerModel || headerMode) && (
            <div className="text-xs text-neutral-400 truncate">
              {headerCwd && <span>{headerCwd}</span>}
              {headerCwd && headerModel && <span className="mx-2 text-neutral-700">•</span>}
              {headerModel && <span>{headerModel}</span>}
              {headerMode && <span className="mx-2 text-neutral-700">•</span>}
              {headerMode && <span>{headerMode}</span>}
            </div>
          )}
        </div>
        <div className="text-xs text-neutral-500">
          {wsStatus === "open" ? "● connected" : wsStatus === "connecting" ? "● connecting" : "● offline"}
          {loadingHistory && <span className="ml-3 text-amber-300">loading history…</span>}
          {!loadingHistory && busy && <span className="ml-3 text-amber-300">streaming…</span>}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {items.length === 0 && (
          <div className="flex h-full items-center justify-center text-neutral-500">
            Start a new session from the sidebar to begin.
          </div>
        )}
        {items.map((item) => {
          switch (item.kind) {
            case "user_text":
              return <UserMessage key={item.id} text={item.text} />;
            case "assistant_text":
              return (
                <AssistantMessage key={item.id} text={item.text} streaming={item.streaming} />
              );
            case "thinking":
              return <ThinkingBlock key={item.id} text={item.text} streaming={item.streaming} />;
            case "tool_use":
              return <ToolIndicator key={item.id} name={item.name} summary={item.summary} />;
            case "tool_result":
              return (
                <ToolIndicator
                  key={item.id}
                  name={`→ ${item.toolUseId.slice(-6)}`}
                  summary={item.summary}
                  isError={item.isError}
                />
              );
            case "ask_question":
              return (
                <AskQuestionCard
                  key={item.id}
                  questionId={item.questionId}
                  questions={item.questions}
                  answered={item.answered}
                  onSubmit={(answers) => {
                    markQuestionAnswered(item.questionId, answers);
                    send({
                      type: "answer_question",
                      questionId: item.questionId,
                      answers,
                    });
                  }}
                />
              );
            case "turn_complete":
              return (
                <div key={item.id} className="px-6 py-2 text-xs text-neutral-600">
                  ─ turn complete · ${item.costUsd.toFixed(4)} · {Math.round(item.durationMs)}ms
                </div>
              );
            case "error":
              return (
                <div key={item.id} className="px-6 py-2 text-xs text-rose-400">
                  error: {item.message}
                </div>
              );
            case "exit":
              return (
                <div key={item.id} className="px-6 py-2 text-xs text-neutral-500">
                  claude exited (code {item.code ?? "?"})
                </div>
              );
            default:
              return null;
          }
        })}
      </div>

      <div className="border-t border-neutral-800 p-4">
        <div className="relative flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKey}
            placeholder={
              loadingHistory
                ? "Loading session history…"
                : pendingQuestionId
                  ? "Answer the question above first…"
                  : "Message Claude… (⌘+Enter to send)"
            }
            rows={3}
            className="flex-1 resize-none rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
            disabled={wsStatus !== "open" || loadingHistory}
          />
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="self-end rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-neutral-950 disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
