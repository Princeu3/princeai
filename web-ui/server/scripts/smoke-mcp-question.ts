/**
 * End-to-end smoke test of the MCP ask_user_question round-trip.
 *
 * Flow:
 *   1. Connect to the running ccweb server over WebSocket
 *   2. Start a new session in /tmp with bypassPermissions
 *   3. Send a prompt that should trigger mcp__ccweb__ask_user_question
 *   4. Wait for an `ask_question` ServerMessage
 *   5. Auto-answer it with the first option's label via `answer_question`
 *   6. Assert the turn completes successfully
 *
 * Requires the server to be running: `pnpm -C server dev`
 * Run:                               `pnpm -C server exec tsx scripts/smoke-mcp-question.ts`
 */

import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "@ccweb/shared";

const ws = new WebSocket("ws://127.0.0.1:4131/ws");

let sawQuestion = false;
let sawTurnComplete = false;
let streamedText = "";

ws.on("open", () => {
  console.error("[ws] open");
  const newSession: ClientMessage = {
    type: "new_session",
    cwd: "/tmp",
    permissionMode: "bypassPermissions",
    title: "mcp smoke",
  };
  ws.send(JSON.stringify(newSession));

  // Prompt crafted to strongly encourage Claude to call the ask tool.
  const userInput: ClientMessage = {
    type: "user_input",
    text:
      "I want to plan a weekend activity. Use the mcp__ccweb__ask_user_question tool to ask me ONE question with exactly these options (do not answer yourself): 'Hiking', 'Museum', 'Movie', 'Reading'. Header 'Activity'. After I answer, say 'you picked <X>' and stop.",
  };
  ws.send(JSON.stringify(userInput));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString()) as ServerMessage;

  if (msg.type === "text_delta") {
    streamedText += msg.text;
    process.stdout.write(msg.text);
    return;
  }
  if (msg.type === "session_ready") {
    console.error(`\n[session_ready] ${msg.info.sessionId}`);
    return;
  }
  if (msg.type === "tool_use") {
    console.error(`\n[tool_use] ${msg.name} – ${msg.inputSummary}`);
    return;
  }
  if (msg.type === "ask_question") {
    console.error(`\n[ask_question] id=${msg.questionId}`);
    console.error(`  questions: ${JSON.stringify(msg.questions, null, 2)}`);
    sawQuestion = true;
    // Auto-answer with the first option's label of each question.
    const answers = msg.questions.map((q) => q.options[0]?.label ?? "(no options)");
    console.error(`  auto-answering with: ${JSON.stringify(answers)}`);
    const reply: ClientMessage = {
      type: "answer_question",
      questionId: msg.questionId,
      answers,
    };
    ws.send(JSON.stringify(reply));
    return;
  }
  if (msg.type === "turn_complete") {
    console.error(`\n[turn_complete] cost=$${msg.costUsd} duration=${msg.durationMs}ms`);
    sawTurnComplete = true;
    ws.send(JSON.stringify({ type: "close_session" } as ClientMessage));
    ws.close();
    return;
  }
  if (msg.type === "error") {
    console.error(`[error] ${msg.message}`);
  }
  if (msg.type === "subprocess_exited") {
    console.error(`[subprocess_exited] code=${msg.code}`);
  }
});

ws.on("close", () => {
  console.error(`\n[ws] closed question=${sawQuestion} turnComplete=${sawTurnComplete}`);
  if (!sawQuestion) {
    console.error("FAIL: no ask_question event received");
    process.exit(1);
  }
  if (!sawTurnComplete) {
    console.error("FAIL: turn never completed");
    process.exit(1);
  }
  console.error("PASS");
  process.exit(0);
});

setTimeout(() => {
  console.error("\n[timeout]");
  process.exit(2);
}, 180000);
