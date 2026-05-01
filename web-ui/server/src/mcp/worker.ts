/**
 * Stdio MCP worker. One instance per Claude session, spawned by Claude Code
 * itself via `--mcp-config`. Exposes a single tool, `ask_user_question`,
 * that forwards calls to the main ccweb server over HTTP.
 *
 * Environment (passed in by the parent ccweb process):
 *   CCWEB_SESSION_ID   — the local session id the main server uses for routing
 *   CCWEB_INTERNAL_URL — base URL of the main server, e.g. http://127.0.0.1:4131
 *   CCWEB_INTERNAL_TOKEN — shared secret so only our worker can hit /internal
 *
 * The worker is intentionally minimal: it has no state, no subprocess
 * management, and no UI. Claude starts it, sends JSON-RPC over stdin,
 * receives responses over stdout. On `tools/call` for `ask_user_question`,
 * it POSTs the questions to the main server and waits for the HTTP response
 * carrying the user's answers.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SESSION_ID = process.env.CCWEB_SESSION_ID;
const INTERNAL_URL = process.env.CCWEB_INTERNAL_URL;
const INTERNAL_TOKEN = process.env.CCWEB_INTERNAL_TOKEN;

if (!SESSION_ID || !INTERNAL_URL || !INTERNAL_TOKEN) {
  // Print to stderr so Claude Code surfaces it as a server error.
  console.error(
    "ccweb mcp worker: missing CCWEB_SESSION_ID / CCWEB_INTERNAL_URL / CCWEB_INTERNAL_TOKEN env",
  );
  process.exit(1);
}

const ASK_USER_QUESTION_SCHEMA = {
  type: "object" as const,
  properties: {
    questions: {
      type: "array",
      description:
        "List of questions to ask. Each renders as its own card with multiple-choice buttons in the web UI.",
      items: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The full question text shown to the user.",
          },
          header: {
            type: "string",
            description: "A very short label (max 12 chars) shown as a chip above the question.",
          },
          multiSelect: {
            type: "boolean",
            description: "True if the user may pick more than one option.",
          },
          options: {
            type: "array",
            description: "2-4 option cards the user picks from.",
            items: {
              type: "object",
              properties: {
                label: {
                  type: "string",
                  description: "Short option label (1-5 words).",
                },
                description: {
                  type: "string",
                  description: "Optional longer explanation of what choosing this option means.",
                },
              },
              required: ["label"],
            },
          },
        },
        required: ["question", "header", "multiSelect", "options"],
      },
    },
  },
  required: ["questions"],
};

const server = new Server(
  {
    name: "ccweb",
    version: "0.0.1",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ask_user_question",
      description:
        "Ask the user one or more multiple-choice questions via the web UI and wait for their reply. Use this whenever you need clarification or structured input from the user — it is the equivalent of the built-in AskUserQuestion tool for this environment. The user can type free-form text via the 'Other' option on any question.",
      inputSchema: ASK_USER_QUESTION_SCHEMA,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "ask_user_question") {
    throw new Error(`unknown tool: ${req.params.name}`);
  }

  const body = JSON.stringify({
    sessionId: SESSION_ID,
    args: req.params.arguments,
  });

  let res: Response;
  try {
    res = await fetch(`${INTERNAL_URL}/internal/question`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ccweb-token": INTERNAL_TOKEN!,
      },
      body,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `ccweb question forward failed: ${message}` }],
      isError: true,
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      content: [{ type: "text", text: `ccweb question failed: ${res.status} ${text}` }],
      isError: true,
    };
  }

  const data = (await res.json().catch(() => ({}))) as { answers?: string[] };
  const answers = Array.isArray(data.answers) ? data.answers : [];

  // Return the answers as a human-readable text blob so Claude can parse
  // them naturally. A structured payload would also work but plain text is
  // what the model reads best.
  const lines = answers.length === 0 ? ["(no answer)"] : answers.map((a, i) => `${i + 1}. ${a}`);
  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
