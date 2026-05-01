import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AssistantMessage({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className="markdown-body px-6 py-3">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      {streaming && <span className="inline-block h-4 w-1.5 animate-pulse bg-amber-300 align-middle" />}
    </div>
  );
}

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="px-6 py-3">
      <div className="inline-block max-w-[80%] rounded-2xl bg-sky-900/40 px-4 py-2 text-sky-100">
        {text}
      </div>
    </div>
  );
}
