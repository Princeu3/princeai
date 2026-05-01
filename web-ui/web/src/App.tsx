import { useEffect, useState } from "react";
import type { PermissionMode, SessionListEntry } from "@ccweb/shared";
import { Sidebar } from "./components/Sidebar.js";
import { ChatView } from "./components/ChatView.js";
import { NewSessionModal } from "./components/NewSessionModal.js";
import { connect, send } from "./ws.js";
import { useAppStore } from "./state.js";

export function App() {
  const [showModal, setShowModal] = useState(false);
  const resetActive = useAppStore((s) => s.resetActive);

  useEffect(() => {
    connect();
  }, []);

  const handleStart = (opts: { cwd: string; permissionMode: PermissionMode; title: string }) => {
    resetActive();
    // Server accepts new_session even before ws status flips to "open" in
    // the store (it'll have flipped by the time the user clicks Start).
    send({
      type: "new_session",
      cwd: opts.cwd,
      permissionMode: opts.permissionMode,
      title: opts.title,
    });
    setShowModal(false);
  };

  const handleOpen = (s: SessionListEntry) => {
    // Pass the sidebar row so the chat header flips to the target session
    // instantly — no waiting for the 2-3s claude subprocess boot.
    resetActive(s);
    send({ type: "open_session", sessionId: s.id });
  };

  return (
    <div className="flex h-screen w-screen bg-neutral-950 text-neutral-100">
      <Sidebar onNewSession={() => setShowModal(true)} onOpenSession={handleOpen} />
      <main className="flex-1">
        <ChatView />
      </main>
      {showModal && (
        <NewSessionModal onCancel={() => setShowModal(false)} onStart={handleStart} />
      )}
    </div>
  );
}
