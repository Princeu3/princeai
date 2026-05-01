/**
 * Smoke test for loadSessionHistory. Prints the decoded events for a given
 * session, compact one line per event.
 *
 *   pnpm -C server exec tsx scripts/smoke-history.ts <cwd> <sessionId>
 *
 * Both args are required — pass a cwd where you've previously run claude and
 * one of the resulting session UUIDs from ~/.claude/projects/<encoded>/*.jsonl.
 */

import { loadSessionHistory, sessionHistoryPath } from "../src/store/history.js";

const cwd = process.argv[2];
const sessionId = process.argv[3];
if (!cwd || !sessionId) {
  console.error("usage: smoke-history.ts <cwd> <sessionId>");
  process.exit(2);
}

const path = await sessionHistoryPath(cwd, sessionId);
console.error(`[smoke-history] path: ${path}`);

const events = await loadSessionHistory(cwd, sessionId);
console.error(`[smoke-history] ${events.length} events decoded\n`);

const counts: Record<string, number> = {};
for (const e of events) {
  counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  let summary = "";
  switch (e.kind) {
    case "history_user_text":
      summary = e.text.slice(0, 80).replace(/\n/g, " ⏎ ");
      break;
    case "text_delta":
      summary = e.text.slice(0, 80).replace(/\n/g, " ⏎ ");
      break;
    case "thinking_delta":
      summary = `(${e.text.length} chars)`;
      break;
    case "tool_use":
      summary = `${e.name} ${e.inputSummary}`;
      break;
    case "tool_result":
      summary = `err=${e.isError} ${e.summary.slice(0, 60)}`;
      break;
    case "turn_complete":
      summary = `$${e.costUsd} ${e.durationMs}ms`;
      break;
  }
  console.log(`  ${e.kind.padEnd(18)} ${summary}`);
}

console.error(`\n[smoke-history] counts:`, counts);
