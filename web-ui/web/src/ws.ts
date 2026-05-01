/**
 * WebSocket client. Singleton per page — we only have one active session at
 * a time so one connection is enough.
 *
 * Usage:
 *   ws.connect()
 *   ws.send({ type: "new_session", cwd, permissionMode })
 *   ws.send({ type: "user_input", text })
 *
 * Incoming ServerMessages are fed into the zustand store via
 * ingestServerMessage. Connection state is tracked in store.active.wsStatus.
 */

import type { ClientMessage, ServerMessage } from "@ccweb/shared";
import { useAppStore } from "./state.js";

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

export function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  useAppStore.getState().setWsStatus("connecting");
  socket = new WebSocket(wsUrl());

  socket.addEventListener("open", () => {
    useAppStore.getState().setWsStatus("open");
  });

  socket.addEventListener("message", (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    useAppStore.getState().ingestServerMessage(msg);
  });

  socket.addEventListener("close", () => {
    useAppStore.getState().setWsStatus("closed");
    socket = null;
    // Auto-reconnect after a short delay.
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect(), 1000);
  });

  socket.addEventListener("error", () => {
    // 'error' is always followed by 'close' — no action needed here.
  });
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.close();
  socket = null;
}

export function send(msg: ClientMessage): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    useAppStore.getState().ingestServerMessage({
      type: "error",
      message: "not connected",
    });
    return;
  }
  socket.send(JSON.stringify(msg));
}
