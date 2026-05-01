/**
 * Unit-style smoke test for buildClaudeArgs(). No subprocess; just asserts
 * that the per-session toolset toggles produce the expected --mcp-config
 * splicing and --allowed-tools whitelist.
 *
 *   pnpm -C server exec tsx scripts/smoke-buildargs.ts
 */

import { strict as assert } from "node:assert";
import { buildClaudeArgs } from "../src/sessions/session.js";

function getFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

// 1. Baseline — no integrations, no extra MCPs. Should match pre-Sprint-2
//    behavior: ccweb is the only MCP server, no --allowed-tools flag.
{
  const args = buildClaudeArgs({
    permissionMode: "acceptEdits",
    enabledIntegrations: [],
    extraMcpServers: {},
  });
  const mcp = JSON.parse(getFlag(args, "--mcp-config") ?? "{}");
  assert.deepEqual(Object.keys(mcp.mcpServers).sort(), ["ccweb"]);
  assert.equal(
    hasFlag(args, "--allowed-tools"),
    false,
    "baseline must not emit --allowed-tools",
  );
  assert.equal(
    hasFlag(args, "--resume"),
    false,
    "baseline must not emit --resume",
  );
  console.log("✅ baseline: ccweb only, no --allowed-tools");
}

// 2. With one extra MCP server spliced in — confirm both ccweb and the
//    extra appear in --mcp-config, and --allowed-tools includes the
//    wildcard for the extra.
{
  const args = buildClaudeArgs({
    permissionMode: "acceptEdits",
    enabledIntegrations: ["reddit"],
    extraMcpServers: {
      reddit: { type: "stdio", command: "npx", args: ["--yes", "reddit-mcp-buddy"] },
    },
  });
  const mcp = JSON.parse(getFlag(args, "--mcp-config") ?? "{}");
  assert.deepEqual(Object.keys(mcp.mcpServers).sort(), ["ccweb", "reddit"]);
  assert.equal(mcp.mcpServers.reddit.command, "npx");
  const allowed = getFlag(args, "--allowed-tools");
  assert.equal(allowed, "mcp__reddit__*");
  console.log("✅ one extra MCP: spliced + allow-listed");
}

// 3. With multiple extras — comma-separated allow list.
{
  const args = buildClaudeArgs({
    permissionMode: "bypassPermissions",
    enabledIntegrations: ["reddit", "exa", "context7"],
    extraMcpServers: {
      reddit: { type: "stdio", command: "npx", args: ["--yes", "reddit-mcp-buddy"] },
      exa: { type: "stdio", command: "npx", args: ["--yes", "exa-mcp-server"] },
      context7: { type: "stdio", command: "npx", args: ["--yes", "@upstash/context7-mcp"] },
    },
  });
  const allowed = getFlag(args, "--allowed-tools") ?? "";
  const parts = allowed.split(",").sort();
  assert.deepEqual(parts, ["mcp__context7__*", "mcp__exa__*", "mcp__reddit__*"]);
  console.log("✅ multiple extras: comma-separated allow list");
}

// 4. enabledIntegrations without a matching MCP server (CLI-backed, e.g.
//    github via `gh`). Should NOT appear in --allowed-tools (which is
//    MCP-only) but the system prompt should mention it.
{
  const args = buildClaudeArgs({
    permissionMode: "acceptEdits",
    enabledIntegrations: ["github", "twitter"],
    extraMcpServers: {},
  });
  assert.equal(hasFlag(args, "--allowed-tools"), false);
  const prompt = getFlag(args, "--append-system-prompt") ?? "";
  assert.ok(
    prompt.includes("github") && prompt.includes("twitter"),
    "system prompt should list CLI-backed integrations",
  );
  console.log("✅ CLI-only integrations: no --allowed-tools, present in prompt");
}

// 5. Resume id — confirm flag pass-through still works alongside toggles.
{
  const args = buildClaudeArgs({
    permissionMode: "plan",
    resumeSessionId: "abc-123",
    enabledIntegrations: ["reddit"],
    extraMcpServers: {
      reddit: { type: "stdio", command: "npx", args: [] },
    },
  });
  assert.equal(getFlag(args, "--resume"), "abc-123");
  assert.equal(getFlag(args, "--permission-mode"), "plan");
  assert.equal(getFlag(args, "--allowed-tools"), "mcp__reddit__*");
  console.log("✅ resume + toggles compose");
}

console.log("\nall buildClaudeArgs assertions passed");
