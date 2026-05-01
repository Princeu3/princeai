/**
 * Empirical probe of the claude -p stream-json bidirectional protocol.
 *
 * Run from the repo root:
 *   pnpm -C server exec tsx scripts/probe-stream-json.ts
 *
 * What it does:
 *  1. Spawns `claude -p --output-format stream-json --input-format stream-json
 *     --include-partial-messages --permission-mode bypassPermissions --verbose`
 *     in /tmp (a safe scratch cwd).
 *  2. Sends a user message via stdin in stream-json format.
 *  3. Prints every event that arrives on stdout, tagged with a category.
 *  4. When an AskUserQuestion tool_use arrives, sends a tool_result back.
 *  5. Exits cleanly when the `result` event arrives.
 *
 * This is NOT part of the server — it's a throwaway diagnostic.
 */

import { spawn } from "node:child_process";
import readline from "node:readline";

const CLAUDE_ARGS = [
  "-p",
  "--output-format",
  "stream-json",
  "--input-format",
  "stream-json",
  "--include-partial-messages",
  "--permission-mode",
  "bypassPermissions",
  "--disallowed-tools",
  "AskUserQuestion",
  "--append-system-prompt",
  "You are running in a chat UI that does not support structured multi-choice questions. When you need information from the user, ask them clearly in plain text and wait for their reply. Do not attempt to call AskUserQuestion.",
  "--verbose",
];

type Phase = "text_only" | "ask_question" | "multi_turn" | "done";

// Change PHASE to test different things.
// "text_only": send a simple prompt, verify streaming works.
// "ask_question": force an AskUserQuestion tool_use and respond to it via stdin.
const PHASE: Phase = (process.env.PROBE_PHASE as Phase) ?? "text_only";

const PROMPTS: Record<Exclude<Phase, "done">, string> = {
  text_only: "Reply with exactly three words: hello streaming world",
  ask_question:
    "I want to plan a weekend trip. Before suggesting anything, ask me two specific questions to understand what I want. Ask clearly and stop when done so I can reply.",
  multi_turn: "My name is Lucas. Reply with exactly: noted",
};

console.error(`\n=== probe phase: ${PHASE} ===\n`);

const child = spawn("claude", CLAUDE_ARGS, {
  cwd: "/tmp",
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

child.on("error", (err) => {
  console.error("spawn error:", err);
  process.exit(1);
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(`[stderr] ${chunk}`);
});

// Send the initial prompt immediately — in bidirectional stream-json mode,
// claude appears to wait on stdin before emitting its `system/init` event.
if (PHASE !== "done") {
  // Give the subprocess a tick to set up its readers before we write.
  setTimeout(() => writeUserText(PROMPTS[PHASE]), 100);
}

// Send the initial user prompt as a stream-json input message.
function writeUserText(text: string) {
  const payload = {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  };
  const line = JSON.stringify(payload) + "\n";
  console.error(`\n>>> sending user text (${line.length} bytes)\n`);
  child.stdin.write(line);
}

// Send a tool_result back to answer an AskUserQuestion.
function writeToolResult(toolUseId: string, answer: string) {
  const payload = {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: answer,
        },
      ],
    },
  };
  const line = JSON.stringify(payload) + "\n";
  console.error(`\n>>> sending tool_result for ${toolUseId}\n    ${line}`);
  child.stdin.write(line);
}

// Parse JSONL from stdout, line by line.
const rl = readline.createInterface({ input: child.stdout });
let turnCount = 0;

rl.on("line", (line) => {
  if (!line.trim()) return;
  let evt: any;
  try {
    evt = JSON.parse(line);
  } catch (e) {
    console.error(`[parse error] ${line.slice(0, 200)}`);
    return;
  }

  // Tag by type for easier scanning.
  const type = evt.type ?? "?";
  const subtype = evt.subtype ?? "";
  const tag = subtype ? `${type}/${subtype}` : type;

  // Compact summary of the most interesting fields.
  let summary = "";
  if (type === "system" && subtype === "init") {
    summary = ` session_id=${evt.session_id} model=${evt.model} mode=${evt.permissionMode}`;
  } else if (type === "assistant") {
    const content = evt.message?.content ?? [];
    summary =
      " " +
      content
        .map((c: any) => {
          if (c.type === "text") return `text(${JSON.stringify(c.text.slice(0, 60))})`;
          if (c.type === "thinking") return `thinking(${c.thinking?.slice(0, 40)}...)`;
          if (c.type === "tool_use") return `tool_use(${c.name} id=${c.id})`;
          return c.type;
        })
        .join(" ");
  } else if (type === "stream_event") {
    // partial_message events when --include-partial-messages is set
    const se = evt.event ?? {};
    summary = ` ${se.type}${se.delta ? " delta=" + JSON.stringify(se.delta).slice(0, 60) : ""}${se.content_block ? " block=" + JSON.stringify(se.content_block).slice(0, 60) : ""}`;
  } else if (type === "user") {
    const content = evt.message?.content ?? [];
    summary =
      " " +
      content
        .map((c: any) => {
          if (c.type === "tool_result")
            return `tool_result(id=${c.tool_use_id} err=${c.is_error ?? false} content=${JSON.stringify(String(c.content).slice(0, 80))})`;
          return c.type;
        })
        .join(" ");
  } else if (type === "result") {
    summary = ` subtype=${evt.subtype} cost=${evt.total_cost_usd} duration=${evt.duration_ms}ms turns=${evt.num_turns}`;
  } else if (type === "rate_limit_event") {
    summary = ` status=${evt.rate_limit_info?.status}`;
  }

  console.log(`[${tag}]${summary}`);

  // React to events.
  if (type === "system" && subtype === "init") {
    // init fires once the session is up; nothing to do here — we already
    // sent the first user message up-front.
    return;
  }

  // Handle AskUserQuestion tool_use — respond with a canned answer.
  if (type === "assistant") {
    const content = evt.message?.content ?? [];
    for (const c of content) {
      if (c.type === "tool_use" && c.name === "AskUserQuestion") {
        // Give Claude an answer so the turn continues.
        writeToolResult(c.id, "Blue");
      }
    }
  }

  // Stream events (partial message mode) may contain tool_use blocks too.
  if (type === "stream_event" && evt.event?.type === "content_block_start") {
    const block = evt.event.content_block;
    if (block?.type === "tool_use" && block.name === "AskUserQuestion") {
      writeToolResult(block.id, "Blue");
    }
  }

  if (type === "result") {
    turnCount++;
    if (PHASE === "multi_turn" && turnCount === 1) {
      // Send a follow-up that requires memory of the first turn.
      console.error(`\n=== turn 1 done, sending follow-up ===\n`);
      setTimeout(
        () => writeUserText("What is my name? Reply with exactly one word."),
        200
      );
      return;
    }
    console.error(`\n=== turn ${turnCount} complete, closing stdin ===\n`);
    child.stdin.end();
  }
});

child.on("exit", (code, signal) => {
  console.error(`\n=== child exited code=${code} signal=${signal} ===\n`);
  process.exit(code ?? 0);
});

// Safety: kill after 60s if nothing happens.
setTimeout(() => {
  console.error("\n=== timeout, killing child ===\n");
  child.kill("SIGTERM");
  process.exit(2);
}, 60000);
