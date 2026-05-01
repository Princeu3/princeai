/**
 * End-to-end smoke of the session resume (history replay) path.
 *
 *   1. Open a WebSocket
 *   2. Send `open_session` for a known past session
 *   3. Expect `history_start`, then a stream of history events, then `history_end`
 *   4. Expect `session_ready` soon after (live subprocess boots in parallel)
 *   5. Send a follow-up `user_input` to verify the live path still works
 *   6. Expect `turn_complete`
 *
 *   pnpm -C server exec tsx scripts/smoke-ws-resume.ts
 *
 * Requires the server to be running (`pnpm -C server dev`).
 */

import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "@ccweb/shared";

const TARGET_SESSION = process.argv[2];
if (!TARGET_SESSION) {
  console.error("usage: smoke-ws-resume.ts <sessionId>");
  process.exit(2);
}

const ws = new WebSocket("ws://127.0.0.1:4131/ws");

let sawHistoryStart = false;
let sawHistoryEnd = false;
let historyEventCount = 0;
let sawSessionReady = false;
let sawLiveTurnComplete = false;
let liveInputSent = false;

ws.on("open", () => {
  console.error("[ws] open");
  const msg: ClientMessage = { type: "open_session", sessionId: TARGET_SESSION };
  ws.send(JSON.stringify(msg));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString()) as ServerMessage;

  if (msg.type === "history_start") {
    sawHistoryStart = true;
    console.error("[history_start]");
    return;
  }
  if (msg.type === "history_end") {
    sawHistoryEnd = true;
    console.error(`[history_end] (${historyEventCount} history events in between)`);
    // Send the follow-up immediately — claude waits on stdin before
    // emitting its init event, so we must NOT wait for session_ready.
    if (!liveInputSent) {
      liveInputSent = true;
      const send: ClientMessage = {
        type: "user_input",
        text: "Reply with exactly three words: resume works fine",
      };
      ws.send(JSON.stringify(send));
    }
    return;
  }
  if (msg.type === "history_user_text") {
    historyEventCount++;
    console.error(`  [h] user: ${msg.text.slice(0, 60)}`);
    return;
  }
  if (msg.type === "text_delta") {
    historyEventCount++;
    process.stderr.write(".");
    return;
  }
  if (msg.type === "text_end") {
    process.stderr.write("|");
    return;
  }
  if (msg.type === "tool_use") {
    historyEventCount++;
    console.error(`\n  [h] tool: ${msg.name}`);
    return;
  }
  if (msg.type === "session_ready") {
    sawSessionReady = true;
    console.error(`\n[session_ready] claude_sid=${msg.info.sessionId}`);
    return;
  }
  if (msg.type === "turn_complete") {
    if (liveInputSent) {
      sawLiveTurnComplete = true;
      console.error(`\n[live turn_complete] cost=$${msg.costUsd} duration=${msg.durationMs}ms`);
      ws.send(JSON.stringify({ type: "close_session" } as ClientMessage));
      ws.close();
    }
    return;
  }
  if (msg.type === "error") {
    console.error(`\n[error] ${msg.message}`);
    process.exit(1);
  }
});

ws.on("close", () => {
  console.error(
    `\n[ws] closed history_start=${sawHistoryStart} history_end=${sawHistoryEnd} events=${historyEventCount} session_ready=${sawSessionReady} live_turn=${sawLiveTurnComplete}`,
  );
  if (!sawHistoryStart || !sawHistoryEnd) {
    console.error("FAIL: missing history markers");
    process.exit(1);
  }
  if (historyEventCount === 0) {
    console.error("FAIL: no history events replayed");
    process.exit(1);
  }
  if (!sawSessionReady || !sawLiveTurnComplete) {
    console.error("FAIL: live session did not finish a turn");
    process.exit(1);
  }
  console.error("PASS");
  process.exit(0);
});

setTimeout(() => {
  console.error("\n[timeout]");
  process.exit(2);
}, 120000);
