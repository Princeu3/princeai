export function ToolIndicator({
  name,
  summary,
  isError,
}: {
  name: string;
  summary: string;
  isError?: boolean;
}) {
  return (
    <div className="px-6 py-1">
      <div className="font-mono text-xs text-neutral-500">
        <span className={isError ? "text-rose-400" : "text-neutral-400"}>{isError ? "✗" : "⚙"}</span>{" "}
        <span className="text-neutral-400">{name}</span>
        {summary && <span className="text-neutral-600"> {truncate(summary, 120)}</span>}
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
