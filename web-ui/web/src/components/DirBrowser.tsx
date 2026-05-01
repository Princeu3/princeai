import { useEffect, useState } from "react";
import { fetchFsList, type DirListing } from "../state.js";

export function DirBrowser({
  value,
  onChange,
}: {
  value: string;
  onChange: (path: string) => void;
}) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    fetchFsList(value || undefined)
      .then((data) => {
        if (alive) setListing(data);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [value]);

  if (error) {
    return (
      <div className="rounded border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-300">
        {error}
      </div>
    );
  }
  if (!listing) return <div className="p-3 text-sm text-neutral-500">Loading…</div>;

  const dirEntries = listing.entries.filter((e) => e.type === "dir");

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-neutral-400">
        <span className="font-mono">{listing.path}</span>
      </div>
      <div className="max-h-72 overflow-y-auto rounded border border-neutral-800 bg-neutral-900">
        {listing.parent && (
          <button
            onClick={() => onChange(listing.parent!)}
            className="block w-full px-3 py-1.5 text-left text-sm text-neutral-400 hover:bg-neutral-800"
          >
            📁 ..
          </button>
        )}
        {dirEntries.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-neutral-600">(empty)</div>
        )}
        {dirEntries.map((e) => (
          <button
            key={e.name}
            onClick={() => onChange(`${listing.path === "/" ? "" : listing.path}/${e.name}`)}
            className="block w-full px-3 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800"
          >
            📁 {e.name}
          </button>
        ))}
      </div>
    </div>
  );
}
