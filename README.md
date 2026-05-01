# PrinceAI

> **A localhost browser UI for Claude Code with toggleable MCP integrations.**
> Chat with Claude Code in any tab, pick which integrations are active per session, manage credentials from a single panel — all running on `127.0.0.1`, no cloud, no auth.

![status](https://img.shields.io/badge/status-Sprint%201%20of%206%20complete-amber)
![license](https://img.shields.io/badge/license-MIT-blue)
![upstream](https://img.shields.io/badge/upstream-lucasprim%2Fclaude--code--web--ui-lightgrey)

---

## What this is

A wrapper that:

1. **Embeds Claude Code in the browser** by spawning the local `claude -p` binary with `--output-format stream-json` and bridging it over WebSocket to a React UI.
2. **Adds a Connections panel** (in progress) so you can toggle individual MCP servers on/off per session — Context7, Tavily, Exa, Reddit, Gmail, LinkedIn, GitHub, etc.
3. **Reuses Claude Code's own session storage** (`~/.claude/projects/<encoded-cwd>/<id>.jsonl`) so resume "just works" with full history replay in <100ms.
4. **Doesn't replace anything you have.** Your `~/.claude/settings.json`, plugins (claude-mem, etc.), skills, hooks, and MCP config all flow through unchanged — same model, same cost, same auth, same everything.

Built on [`lucasprim/claude-code-web-ui`](https://github.com/lucasprim/claude-code-web-ui) (MIT) — extended with an integration-management layer.

## Why

Terminal Claude Code is fast but:
- Hard to manage multiple parallel sessions
- No good UI for picking which of 20 MCP servers Claude should see for a given task
- Can't easily run on phone/tablet
- Hard to share a session view with someone over screen

This solves the first two; the next two come for free once you set it up behind Tailscale or similar.

## Status (honest)

**Sprint 1 of 6 complete** — vendoring + chat UI works end-to-end. Sprints 2–6 build the integration management layer. See [`task-plans.md`](./task-plans.md) for the full roadmap (Epic → Sprint → Story → Phase, agile structure).

What works today:

- ✅ Chat with Claude Code in browser, full streaming, tool-use cards rendered inline
- ✅ Multi-session sidebar, persistence (delegated to Claude Code's own JSONL), `<100ms` history replay on resume
- ✅ Per-session permission mode picker (`acceptEdits` / `plan` / `bypassPermissions`)
- ✅ Directory browser for picking working directory
- ✅ Cost + duration tracking per turn
- ✅ Custom MCP for `ask_user_question` (since Claude Code's built-in `AskUserQuestion` is disabled in headless mode)
- ✅ Reuses your existing Claude Code config (model, plugins, skills, hooks, MCP servers)
- ⚠️ MCP tool permissions: known issue (no UI prompt yet — see "Known issues" below)

What's coming:

- Sprint 2: Wire-protocol extensions for per-session integration toggles
- Sprint 3: Connections panel — see all your MCP + AgentReach integrations at a glance
- Sprint 4: Connect/disconnect flows for each integration (Context7, Tavily, Exa, Reddit, Gmail, LinkedIn, GitHub, YouTube, Twitter)
- Sprint 5: Per-session toolset selection (drives `--allowed-tools` whitelisting)
- Sprint 6: Polish — health check, error toasts, single `pnpm dev:all` script

## Quick start

**Prerequisites:**

| Tool | Version | Why |
|---|---|---|
| Node | ≥18 | runtime |
| pnpm | 10.33.0 | matches `packageManager` field; install via `npm i -g pnpm@10.33.0` |
| Claude Code CLI | latest | the actual agent — `claude --version` should print something |

```bash
git clone https://github.com/Princeu3/princeai.git
cd princeai/web-ui
pnpm install
pnpm build
pnpm -C server start
```

Open `http://127.0.0.1:4131`, click **+ New**, pick a directory, click **Start**, chat.

**Dev mode (hot reload):**

```bash
# terminal 1
pnpm -C web-ui/server dev    # tsx watch on :4131

# terminal 2
pnpm -C web-ui/web dev       # Vite HMR on :5173 (proxies /api + /ws to 4131)
```

## Architecture

```
Browser (React)  ──WebSocket──▶  Fastify (127.0.0.1:4131)  ──stdin/stdout──▶  claude -p
                                          │                  (stream-json)
                                          ├── better-sqlite3: titles + last-opened index
                                          ├── reads ~/.claude/projects/<encoded-cwd>/<id>.jsonl
                                          └── stdio MCP worker spawned per session
                                              (ask_user_question + future integration tools)
```

- **One `claude -p` subprocess per active browser tab.** Close tab → subprocess exits.
- **Session storage delegated to Claude Code's own JSONL files.** We never write conversation history ourselves — only a small SQLite index for titles + timestamps.
- **MCP servers configured per-session** via `--mcp-config` JSON passed at spawn. Future: drive this from a UI checklist.

Full design and roadmap: [`task-plans.md`](./task-plans.md).

## Known issues

- **MCP tool permission gate has no UI prompt yet.** In `acceptEdits` mode, MCP tool calls (e.g. Context7) hit a permission gate with no "Allow" button. Workarounds: use `bypassPermissions` mode for now, or wait for Sprint 5 which will whitelist tools via `--allowed-tools` based on which integrations you toggle on. (FAI-2 in `task-plans.md`)
- **Slow first-token if you use `claude-mem` plugin.** The plugin's SessionStart hooks run synchronously in `-p` mode — adds 30–60s to first response. Upgrade `claude-mem` to ≥12.4.7 (perf rework). (FAI-1 in `task-plans.md`)
- **Browser test automation note.** `agent-browser click @ref` doesn't dispatch through React's synthetic event system in the version tested. Use `agent-browser eval` for native `.click()` instead. (FAI-4)

## Acknowledgments

- **[lucasprim/claude-code-web-ui](https://github.com/lucasprim/claude-code-web-ui)** — the upstream this is built on. Vendored at SHA `aa0955687`. MIT licensed. See [`web-ui/UPSTREAM.md`](./web-ui/UPSTREAM.md) for full attribution and the modifications we've made.
- **[Anthropic Claude Code](https://docs.claude.com/en/docs/claude-code)** — the agent runtime.
- **[mcporter](https://www.npmjs.com/package/mcporter)** — local MCP server registry/runtime.
- **[AgentReach](https://github.com/Panniantong/Agent-Reach)** — used as the fallback CLI layer for Twitter/YouTube where good MCPs don't exist.
- **[claude-mem](https://github.com/thedotmack/claude-mem)** — the memory plugin used during development.

## Contributing

Early stage — feedback and bug reports very welcome via Issues. Code contributions: please open an Issue first to discuss scope before sending a PR; the architecture is laid out in `task-plans.md` and we're trying to keep it focused.

If you find an upstream-relevant fix (e.g. the `shared/package.json` build-script fix we logged in `web-ui/UPSTREAM.md`), please also send it to `lucasprim/claude-code-web-ui` so the broader community benefits.

## License

MIT — see [`LICENSE`](./LICENSE). The vendored `web-ui/` upstream is also MIT, see [`web-ui/UPSTREAM.md`](./web-ui/UPSTREAM.md).
