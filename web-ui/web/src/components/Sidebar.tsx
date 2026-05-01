import { useEffect, useState } from "react";
import {
  deleteSession,
  fetchSessions,
  renameSession,
  useAppStore,
} from "../state.js";
import type { SessionListEntry } from "@ccweb/shared";

export function Sidebar({
  onNewSession,
  onOpenSession,
}: {
  onNewSession: () => void;
  onOpenSession: (s: SessionListEntry) => void;
}) {
  const sessions = useAppStore((s) => s.sessions);
  const setSessions = useAppStore((s) => s.setSessions);
  const activeInfo = useAppStore((s) => s.active.info);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");

  const refresh = async () => {
    try {
      const list = await fetchSessions();
      setSessions(list);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void refresh();
    const int = setInterval(refresh, 5000);
    return () => clearInterval(int);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this session from the list?")) return;
    await deleteSession(id);
    await refresh();
  };

  const commitRename = async (id: string) => {
    if (renameValue.trim().length > 0) {
      await renameSession(id, renameValue.trim());
    }
    setRenaming(null);
    await refresh();
  };

  return (
    <aside className="flex h-full w-72 flex-col border-r border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="font-semibold">Claude Code</div>
        <button
          onClick={onNewSession}
          className="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-neutral-950 hover:bg-amber-400"
        >
          + New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && (
          <div className="p-4 text-xs text-neutral-600">No sessions yet.</div>
        )}
        {sessions.map((s) => {
          const isActive = activeInfo?.sessionId === s.id;
          const isRenaming = renaming === s.id;
          return (
            <div
              key={s.id}
              className={`group border-b border-neutral-900 px-3 py-2 ${
                isActive ? "bg-neutral-900" : "hover:bg-neutral-900"
              }`}
            >
              {isRenaming ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void commitRename(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(s.id);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
                />
              ) : (
                <button
                  onClick={() => onOpenSession(s)}
                  className="block w-full text-left"
                >
                  <div className="truncate text-sm text-neutral-100">{s.title}</div>
                  <div className="truncate text-xs text-neutral-500">{s.cwd}</div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-600">
                    {s.permissionMode}
                  </div>
                </button>
              )}
              {!isRenaming && (
                <div className="mt-1 hidden gap-3 text-[11px] text-neutral-500 group-hover:flex">
                  <button
                    onClick={() => {
                      setRenaming(s.id);
                      setRenameValue(s.title);
                    }}
                    className="hover:text-neutral-300"
                  >
                    rename
                  </button>
                  <button
                    onClick={() => void handleDelete(s.id)}
                    className="hover:text-rose-400"
                  >
                    delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
