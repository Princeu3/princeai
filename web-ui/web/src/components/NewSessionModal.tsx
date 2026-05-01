import { useEffect, useState } from "react";
import type { PermissionMode } from "@ccweb/shared";
import { DirBrowser } from "./DirBrowser.js";
import { requestNotificationPermission } from "../notifications.js";

export function NewSessionModal({
  onCancel,
  onStart,
}: {
  onCancel: () => void;
  onStart: (opts: { cwd: string; permissionMode: PermissionMode; title: string }) => void;
}) {
  const [cwd, setCwd] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [mode, setMode] = useState<PermissionMode>("acceptEdits");

  // Ask for notification permission when the user first interacts.
  useEffect(() => {
    void requestNotificationPermission();
  }, []);

  // Load the home directory on mount.
  useEffect(() => {
    if (!cwd) {
      fetch("/api/fs/home")
        .then((r) => r.json())
        .then((d: { home: string }) => setCwd(d.home))
        .catch(() => {});
    }
  }, [cwd]);

  const canStart = cwd.length > 0;

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl rounded-xl border border-neutral-800 bg-neutral-950 p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-semibold">New session</h2>

        <div className="mb-4">
          <label className="mb-1 block text-xs uppercase tracking-wider text-neutral-400">
            Working directory
          </label>
          <DirBrowser value={cwd} onChange={setCwd} />
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-xs uppercase tracking-wider text-neutral-400">
            Permission mode
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["acceptEdits", "plan", "bypassPermissions"] as PermissionMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded border px-3 py-2 text-sm ${
                  mode === m
                    ? "border-amber-500 bg-amber-500/10 text-amber-300"
                    : "border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            {mode === "acceptEdits" && "Safe default: Claude may read/write files, prompts for shell commands."}
            {mode === "plan" && "Plan mode: Claude only plans, no file writes or commands."}
            {mode === "bypassPermissions" && "Fully autonomous: no safety prompts. Use carefully."}
          </p>
        </div>

        <div className="mb-6">
          <label className="mb-1 block text-xs uppercase tracking-wider text-neutral-400">
            Title (optional)
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Session title"
            className="w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-600 focus:outline-none"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              canStart && onStart({ cwd, permissionMode: mode, title: title || "Untitled" })
            }
            disabled={!canStart}
            className="rounded bg-amber-500 px-4 py-2 text-sm font-medium text-neutral-950 disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
