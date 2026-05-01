import { useState } from "react";

export function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-6 py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs uppercase tracking-wider text-neutral-500 hover:text-neutral-300"
      >
        {open ? "▾" : "▸"} thinking {streaming && "…"}
      </button>
      {open && (
        <pre className="mt-2 whitespace-pre-wrap rounded border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-400">
          {text}
        </pre>
      )}
    </div>
  );
}
