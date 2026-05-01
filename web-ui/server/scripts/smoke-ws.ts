/**
 * End-to-end smoke test over WebSocket. Requires the server to be running
 * (`pnpm -C server dev`).
 *
 *   pnpm -C server exec tsx scripts/smoke-ws.ts
 */

import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "@ccweb/shared";

const ws = new WebSocket("ws://127.0.0.1:4131/ws");
let sawReady = false;
let sawTurnComplete = false;
let streamed = "";

ws.on("open", () => {
  console.error("[ws] open");
  const newSession: ClientMessage = {
    type: "new_session",
    cwd: "/tmp",
    permissionMode: "bypassPermissions",
    title: "smoke",
  };
  ws.send(JSON.stringify(newSession));
  // Claude waits on stdin before emitting init, so send the first user
  // input right away — no need to wait for session_ready.
  const userInput: ClientMessage = {
    type: "user_input",
    text: "Reply with exactly: websocket end-to-end works",
  };
  ws.send(JSON.stringify(userInput));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString()) as ServerMessage;
  if (msg.type === "text_delta") {
    streamed += msg.text;
    process.stdout.write(msg.text);
    return;
  }
  if (msg.type === "session_ready") {
    sawReady = true;
    console.error(`\n[session_ready] claude_sid=${msg.info.sessionId}`);
    return;
  }
  if (msg.type === "turn_complete") {
    console.error(
      `\n[turn_complete] cost=$${msg.costUsd} duration=${msg.durationMs}ms`
    );
    sawTurnComplete = true;
    const close: ClientMessage = { type: "close_session" };
    ws.send(JSON.stringify(close));
    ws.close();
    return;
  }
  if (msg.type === "subprocess_exited") {
    console.error(`[subprocess_exited] code=${msg.code}`);
  }
  if (msg.type === "error") {
    console.error(`[error] ${msg.message}`);
  }
});

ws.on("close", () => {
  console.error(`\n[ws] closed ready=${sawReady} done=${sawTurnComplete}`);
  if (!sawReady || !sawTurnComplete) process.exit(1);
  if (!streamed.includes("websocket end-to-end works")) {
    console.error(`expected phrase not in stream: ${JSON.stringify(streamed)}`);
    process.exit(1);
  }
  process.exit(0);
});

setTimeout(() => {
  console.error("[timeout]");
  process.exit(2);
}, 60000);
