# Claude Code Web UI

A local browser interface for the `claude` CLI. Run Claude Code from any tab, get streaming markdown, see your full session history when you resume a past conversation, and receive a browser notification when Claude needs you — all driving the **real** `claude` binary you already have installed (your plugins, slash commands, hooks, settings, everything).

Everything runs on `127.0.0.1`. One browser tab = one `claude -p` subprocess spawned in a directory you pick. Close the tab, subprocess exits. Reopen the session later, and the full history loads back into the chat.

![screenshot placeholder](/docs/screenshot.png)

## Features

- **Streaming chat** — character-by-character markdown rendering with code highlighting
- **Multi-session sidebar** — past sessions stored in the same place Claude Code already uses (`~/.claude/projects/…`), with a small SQLite index for titles and timestamps
- **Instant session resume** — clicking a past session reads its persisted history from disk and replays it into the chat within ~50ms, before Claude even spawns
- **Structured questions** — `mcp__ccweb__ask_user_question` is exposed as a custom MCP tool that renders clickable option cards in the browser (Claude Code's built-in `AskUserQuestion` doesn't work in `-p` mode; this replaces it)
- **Browser notifications** — when the tab is backgrounded and Claude needs your input, you get a desktop notification
- **Per-session permission mode** — `acceptEdits` / `plan` / `bypassPermissions`, pick at session start
- **Directory browser** — pick the working directory with a tree view rooted at `$HOME`
- **Localhost-only** — binds to 127.0.0.1, no auth, no accounts

## Prerequisites

| | Version | Notes |
|---|---|---|
| Node.js | 18+ | `node -v` |
| pnpm | 10+ | `npm i -g pnpm` if you don't have it |
| `claude` | latest | Must be on your `PATH`. The UI spawns your local binary — it does **not** bundle its own. `which claude` |

## Quick start

```sh
git clone <this-repo> claude-code-web
cd claude-code-web
pnpm install
pnpm -C web build
pnpm -C server start
```

Open http://127.0.0.1:4131 in your browser. Click **+ New**, pick a directory, click **Start**, and start chatting.

That's it. No config files to edit, no environment variables to set.

## Dev mode (hot reload)

Two terminals. Vite serves the frontend on 5173 and proxies `/api` + `/ws` to Fastify on 4131.

```sh
pnpm -C server dev   # terminal 1 — tsx watch, Fastify on :4131
pnpm -C web dev      # terminal 2 — Vite on :5173 with HMR
```

Open http://127.0.0.1:5173.

## Optional environment variables

All optional. Override before starting the server.

| Variable | Default | Purpose |
|---|---|---|
| `CCWEB_HOST` | `127.0.0.1` | Interface to bind to. Keep as localhost. |
| `CCWEB_PORT` | `4131` | Server port. |
| `CCWEB_CLAUDE_BIN` | `claude` | Absolute path to the `claude` binary if it's not on `PATH`. |
| `CCWEB_DATA_DIR` | `<repo>/data` | Where `metadata.sqlite` lives. |
| `LOG_LEVEL` | `info` | pino log level (`trace`, `debug`, `info`, `warn`, `error`). |

## How it works

```
┌────────────┐  WebSocket   ┌─────────────────┐  stdin/stdout   ┌────────────────┐
│  browser   │ ◄──────────► │  Fastify        │ ◄─────────────► │  claude -p     │
│  React UI  │    HTTP      │  (127.0.0.1)    │  stream-json    │  (your local   │
└────────────┘              └────────┬────────┘                 │   binary)      │
                                     │                          └────────┬───────┘
                                     │                                   │
                           better-sqlite3                         ~/.claude/
                           metadata.sqlite                        projects/
                           (titles, ts)                           <cwd>/<id>.jsonl
```

- The server spawns **one `claude -p` subprocess per active browser tab** with bidirectional `--output-format stream-json --input-format stream-json --include-partial-messages`. Every event (text deltas, tool uses, tool results, rate limits) streams over the WebSocket as typed messages.
- Session persistence is **delegated to Claude Code's own JSONL files** in `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. We never write conversation history ourselves. Our SQLite is only an index of titles and timestamps.
- **Resuming** a session spawns `claude -p --resume <id>` **and** reads the JSONL directly to replay the chat history into the browser before Claude finishes booting. You see the full conversation in <100ms.
- **Structured questions** go through a custom stdio MCP server (`server/src/mcp/worker.ts`) Claude spawns per session. When Claude calls `mcp__ccweb__ask_user_question`, the worker forwards the payload over HTTP to the main server, which broadcasts to the WebSocket and blocks until the user clicks an answer.
- **AskUserQuestion (the built-in)** is disabled at spawn via `--disallowed-tools` because Claude's CLI synchronously auto-errors it in `-p` mode and there's no race window to intercept. The system prompt nudges Claude to use the MCP tool instead.

## Project layout

```
.
├── shared/              # TypeScript types shared client ↔ server
│   └── src/types.ts     # ClientMessage / ServerMessage / SessionInfo wire protocol
├── server/
│   └── src/
│       ├── index.ts           # Fastify boot
│       ├── config.ts          # env-overridable config
│       ├── ws.ts              # WebSocket route, message dispatch
│       ├── questions.ts       # pending-question registry (promise + timeout)
│       ├── sessions/
│       │   ├── manager.ts     # map of active subprocess sessions
│       │   ├── session.ts     # spawn/kill one claude subprocess
│       │   └── proto.ts       # stream-json encoder + decoder
│       ├── store/
│       │   ├── metadata.ts    # SQLite: titles, last-opened
│       │   └── history.ts     # read + parse Claude Code's own JSONL
│       ├── mcp/worker.ts      # stdio MCP server for ask_user_question
│       ├── fs/browse.ts       # safe directory browser under $HOME
│       └── routes/            # REST endpoints (fs, sessions, internal)
├── web/
│   └── src/
│       ├── App.tsx            # layout: sidebar + chat
│       ├── state.ts           # zustand store
│       ├── ws.ts              # WebSocket client with reconnect
│       ├── notifications.ts   # browser Notification API wrapper
│       └── components/        # Sidebar, ChatView, AskQuestionCard, etc.
└── data/                      # runtime SQLite (gitignored)
```

## Smoke tests

The server is fully headless-testable. With the server running (`pnpm -C server dev`):

```sh
# 1. Probe the stream-json protocol directly against the real claude binary
pnpm -C server exec tsx scripts/probe-stream-json.ts

# 2. Internal Session class round-trip (spawns claude, streams a reply)
pnpm -C server exec tsx scripts/smoke-session.ts

# 3. End-to-end WebSocket round-trip
pnpm -C server exec tsx scripts/smoke-ws.ts

# 4. MCP ask_user_question round-trip (triggers the tool, auto-answers it)
pnpm -C server exec tsx scripts/smoke-mcp-question.ts

# 5. Session resume with history replay (needs an existing session id)
pnpm -C server exec tsx scripts/smoke-ws-resume.ts <session-uuid>

# 6. History decoder only (reads a past session's JSONL and prints events)
pnpm -C server exec tsx scripts/smoke-history.ts <cwd> <session-uuid>
```

## Troubleshooting

**"claude: command not found" when starting a session.** The server couldn't find the `claude` binary. Check `which claude` from the same shell you started the server in. If it's a login-shell-only alias, set `CCWEB_CLAUDE_BIN=/absolute/path/to/claude`.

**Port 4131 is already in use.** `CCWEB_PORT=4200 pnpm -C server start`.

**Nothing streams after clicking Start.** Open DevTools → Network → filter to "WS" → check the `/ws` connection is open. If it closes immediately, the server probably crashed — check its terminal for a stack trace.

**"Offline" indicator in the header.** Same as above — the WebSocket disconnected. Tab auto-reconnects every second; if it never recovers, the server is down.

**History doesn't replay when I click a past session.** The server looks for `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. If the session was created in a different cwd than what's stored in the metadata SQLite, the lookup misses. Delete the row and start a new session.

## License

MIT
