/**
 * Smoke test for Session + StreamJsonDecoder against the real `claude -p`.
 *
 * Runs one turn, prints every SessionEvent, exits on turn_complete.
 *
 *   pnpm -C server exec tsx scripts/smoke-session.ts
 */

import { Session } from "../src/sessions/session.js";

const session = new Session({
  cwd: "/tmp",
  permissionMode: "bypassPermissions",
});

let sawTurnComplete = false;

session.subscribe((evt) => {
  if (evt.kind === "decoded") {
    const e = evt.event;
    if (e.kind === "text_delta") {
      process.stdout.write(e.text);
    } else if (e.kind === "text_end") {
      process.stdout.write("\n");
    } else if (e.kind === "session_ready") {
      console.error(
        `\n[session_ready] id=${e.info.sessionId} model=${e.info.model} mode=${e.info.permissionMode}`
      );
      console.error(`[session_ready] plugins=${e.info.plugins.length} skills=${e.info.skills.length}`);
    } else if (e.kind === "thinking_delta") {
      // swallow thinking for the smoke test
    } else if (e.kind === "thinking_end") {
      // ditto
    } else if (e.kind === "tool_use") {
      console.error(`\n[tool_use] ${e.name} – ${e.inputSummary}`);
    } else if (e.kind === "tool_result") {
      console.error(`\n[tool_result] err=${e.isError} ${e.summary}`);
    } else if (e.kind === "turn_complete") {
      console.error(`\n[turn_complete] cost=$${e.costUsd} duration=${e.durationMs}ms`);
      sawTurnComplete = true;
      session.stop();
    } else if (e.kind === "error") {
      console.error(`\n[error] ${e.message}`);
    }
  } else if (evt.kind === "stderr") {
    process.stderr.write(`[stderr] ${evt.text}`);
  } else if (evt.kind === "exit") {
    console.error(`\n[exit] code=${evt.code} signal=${evt.signal}`);
    process.exit(sawTurnComplete ? 0 : 1);
  } else if (evt.kind === "error") {
    console.error(`\n[error] ${evt.message}`);
  }
});

session.start({});
setTimeout(() => {
  session.sendUserText("Reply with exactly: session layer works");
}, 200);

setTimeout(() => {
  console.error("\n[timeout]");
  session.stop();
  process.exit(2);
}, 60000);
