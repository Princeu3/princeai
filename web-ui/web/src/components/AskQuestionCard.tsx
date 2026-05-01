import { useState } from "react";
import type { AskQuestion } from "@ccweb/shared";

interface Props {
  questionId: string;
  questions: AskQuestion[];
  answered: string[] | null;
  onSubmit: (answers: string[]) => void;
}

/**
 * Renders a structured question delivered via the ccweb MCP tool. Supports
 * single-select, multi-select, and an "Other" free-text escape hatch on
 * each question. Answers are collected across all questions in a single
 * card and submitted atomically when the user clicks Submit.
 */
export function AskQuestionCard({ questionId, questions, answered, onSubmit }: Props) {
  const isAnswered = answered !== null;

  // picks[i] holds the current answer(s) for questions[i]. For single-select
  // questions it's a 1-element array (or empty). For multi-select it can
  // grow. "Other" text is stored alongside labels; if a user types in Other
  // the string is the raw text they typed.
  const [picks, setPicks] = useState<string[][]>(() => questions.map(() => []));
  const [other, setOther] = useState<string[]>(() => questions.map(() => ""));

  const toggle = (qi: number, value: string, multi: boolean) => {
    setPicks((prev) => {
      const next = prev.map((arr) => arr.slice());
      const cur = next[qi] ?? [];
      if (!multi) {
        next[qi] = cur.includes(value) ? [] : [value];
      } else {
        next[qi] = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      }
      return next;
    });
  };

  const canSubmit =
    !isAnswered &&
    questions.every((_, qi) => {
      const p = picks[qi] ?? [];
      const o = (other[qi] ?? "").trim();
      return p.length > 0 || o.length > 0;
    });

  const submit = () => {
    if (!canSubmit) return;
    const finalAnswers: string[] = questions.map((_, qi) => {
      const labels = picks[qi] ?? [];
      const o = (other[qi] ?? "").trim();
      const all = o ? [...labels, o] : labels;
      return all.join(", ");
    });
    onSubmit(finalAnswers);
  };

  return (
    <div className="px-6 py-4">
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
        <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-amber-300">
          <span>Claude is asking you {questions.length > 1 ? `${questions.length} questions` : "a question"}</span>
          {isAnswered && <span className="ml-auto text-green-400">✓ answered</span>}
        </div>

        <div className="space-y-5">
          {questions.map((q, qi) => {
            const selected = picks[qi] ?? [];
            const otherVal = other[qi] ?? "";
            return (
              <div key={qi}>
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-300">
                    {q.header}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {q.multiSelect ? "pick any" : "pick one"}
                  </span>
                </div>
                <div className="mb-3 text-sm text-neutral-100">{q.question}</div>
                <div className="grid gap-2">
                  {q.options.map((opt) => {
                    const active = selected.includes(opt.label);
                    return (
                      <button
                        key={opt.label}
                        disabled={isAnswered}
                        onClick={() => toggle(qi, opt.label, q.multiSelect)}
                        className={`text-left rounded-lg border px-3 py-2 text-sm transition ${
                          active
                            ? "border-amber-400 bg-amber-500/15 text-amber-100"
                            : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:border-neutral-600"
                        } ${isAnswered ? "opacity-70 cursor-default" : "cursor-pointer"}`}
                      >
                        <div className="font-medium">{opt.label}</div>
                        {opt.description && (
                          <div className="mt-0.5 text-xs text-neutral-400">{opt.description}</div>
                        )}
                      </button>
                    );
                  })}
                  <input
                    type="text"
                    value={otherVal}
                    disabled={isAnswered}
                    onChange={(e) =>
                      setOther((prev) => {
                        const next = prev.slice();
                        next[qi] = e.target.value;
                        return next;
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submit();
                    }}
                    placeholder="Other… (type and press Enter)"
                    className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none disabled:opacity-70"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {isAnswered ? (
          <div className="mt-4 text-xs text-neutral-400">
            You answered: {answered.map((a, i) => `${i + 1}. ${a}`).join(" · ")}
          </div>
        ) : (
          <div className="mt-4 flex justify-end">
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-neutral-950 disabled:bg-neutral-800 disabled:text-neutral-500"
            >
              Submit
            </button>
          </div>
        )}
      </div>
      <div className="mt-1 px-1 text-[10px] font-mono text-neutral-600">q:{questionId.slice(0, 8)}</div>
    </div>
  );
}
