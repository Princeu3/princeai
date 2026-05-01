# PrinceAI Web UI — Task Plan

> **Note on file location**: Plan lives at `/Users/prince/PrinceAI/task-plans.md` (this file). A copy is also at `~/.claude/plans/lets-go-with-the-breezy-ladybug.md` — keep this file canonical; sync back if needed.

## Context

**Why this is being built.** You currently drive Claude Code through the terminal. You want a localhost browser UI on top of Claude Code that (a) preserves every feature you have today (skills, MCP servers, hooks, plan mode, plugins, JSONL session resume), and (b) adds a one-screen control panel for enabling/disabling the integrations you actually use day-to-day, with the freedom to **add new integrations over time** (Tavily, Notion, etc.). Initial scope: **Reddit, Twitter, LinkedIn, GitHub, YouTube, Web Search (Exa + Tavily), Gmail, Context7**.

**Integration architecture — MCP-first.** The core mechanism is **local MCP servers**, not Claude.ai connectors and not AgentReach CLIs. You already have `mcporter` running locally (currently registered: `beads`, `linkedin`, `arxiv`) — that's the runtime/registry. We extend it. Local MCPs exist for everything you care about:

| Integration | Local MCP package | Auth |
|---|---|---|
| Context7 | `@upstash/context7-mcp` (npx) | none (free tier) or API key |
| Tavily | `tavily-mcp` from `tavily-ai/tavily-mcp` | `TAVILY_API_KEY` |
| Exa | `exa-labs/exa-mcp-server` | `EXA_API_KEY` (or hosted at `https://mcp.exa.ai/mcp`) |
| Reddit | `karanb192/reddit-mcp-buddy` (npm, 632★, zero-config, MCP Registry) | optional Reddit OAuth bumps rate-limit tier |
| LinkedIn | already in your mcporter registry (Patchright/Chromium scraper, persistent profile) | browser session |
| Gmail | `navbuildz/gmail-mcp-server` (multi-account, active) | OAuth (browser, one-time) |
| GitHub | use `gh` CLI via Bash *or* GitHub MCP if preferred | `gh auth login` |
| YouTube | no clean local MCP — fall back to `yt-dlp` via Bash | cookies via `agent-reach configure youtube-cookies` |
| Twitter/X | no clean local MCP — fall back to `bird` (AgentReach) via Bash | `agent-reach configure twitter-cookies --from-browser chrome` |

**AgentReach is the fallback layer for Twitter + YouTube only** — those have no good MCP. Twitter MCPs all need paid X API access; for YouTube, `yt-dlp` is the gold standard with transcript handling that no MCP matches. Everything else moves to MCP.

> **Why not AgentReach for Reddit?** `rdt-cli` is not actually installed on this machine — `agent-reach doctor` reports Reddit as "available" but its real Reddit support is `curl reddit.com/.json` (the AgentReach skill itself notes: *"Server IPs may get 403. Search via Exa instead, or configure a proxy."*). `reddit-mcp-buddy` has 632 stars, ships in the MCP Registry, runs zero-config from your local IP (no 403 issue), and gives Claude structured tools (`search_posts`, `get_subreddit`, `analyze_user`) instead of raw JSON to parse.

**Extensibility goal.** Adding a new integration (e.g. Notion, Linear, Slack) should be a one-row addition to a JSON registry file: package name, env vars / args, status-check command. The Connections panel renders it automatically. No new code per integration.

**Why fork instead of build from scratch.** [`lucasprim/claude-code-web-ui`](https://github.com/lucasprim/claude-code-web-ui) is a near-perfect base: ~1500 LOC pnpm monorepo (Fastify + WebSocket + React + Vite + Tailwind + zustand), localhost-only, no auth, **delegates session storage to Claude Code's own JSONL files**, replays history in <100ms, includes a custom MCP worker pattern we'll reuse for our integration tools, and uses the exact `claude -p --output-format stream-json --input-format stream-json` pattern that's the canonical way to embed Claude Code today. Building from scratch would mean re-deriving its wire protocol, history replay, and MCP-bridge tricks for no gain.

**Intended outcome.** A single command (`pnpm dev`) launches a browser tab at `http://127.0.0.1:4131` where you can: pick a working directory, toggle which integrations are active for that session, chat with Claude Code with full streaming, switch between sessions, and manage integration credentials from a Connections page. New MCP integrations can be added by editing a JSON registry — no UI/server code changes needed.

**Architecture (from upstream, unchanged).**
```
Browser (React)  ──WebSocket──▶  Fastify (127.0.0.1:4131)  ──stdin/stdout (stream-json)──▶  claude -p
                                          │
                                          ├── better-sqlite3: titles + last-opened index
                                          ├── reads ~/.claude/projects/<encoded-cwd>/<id>.jsonl  (history replay)
                                          └── stdio MCP worker spawned per session  (ask_user_question + our new tools)
```

## Critical files to touch (for the new value-add)

| File | Why we touch it |
|---|---|
| `shared/src/types.ts` | Add `Platform`, `ConnectionStatus`, `IntegrationToggles`, extend `ClientMessage` with `set_toolset`, extend `new_session` with `enabledIntegrations` |
| `server/src/sessions/session.ts` (`buildArgs`) | Inject per-session `--allowed-tools` / `--disallowed-tools` and merge user-selected MCP servers into the existing `--mcp-config` JSON |
| `server/src/routes/integrations.ts` *(new)* | REST: `GET /api/integrations/status` (combines `mcporter list` + `agent-reach doctor` + per-tool checks), `POST /api/integrations/:id/connect`, `POST /api/integrations/:id/disconnect` |
| `server/integrations.json` *(new)* | **The registry — the extensibility point.** JSON list of integration descriptors (kind: `mcp` \| `cli`, package, env vars, status check, setup hint). Adding Notion/Slack/Linear later = one row here. |
| `server/src/integrations/registry.ts` *(new)* | Loads `integrations.json`, exposes typed lookup. Knows how to `mcporter config add`, run status checks, parse credentials. |
| `server/src/integrations/mcpAuth.ts` *(new)* | Per-MCP auth handlers: API-key form, OAuth-redirect catcher (`/api/oauth/callback/:id`), credential-file inspector. |
| `web/src/components/ConnectionsPanel.tsx` *(new)* | Card grid driven by `integrations.json`; status dots, Connect/Disconnect, "+ Add MCP" button to register new ones from the UI |
| `web/src/components/AddIntegrationModal.tsx` *(new)* | Form to add a custom MCP server (npx package, args, env vars) → appends to `integrations.json` and runs `mcporter config add` |
| `web/src/components/NewSessionModal.tsx` | Add a checklist of integrations to enable for the new session; default = all connected ones |
| `web/src/state.ts` | New zustand slice: `integrations: Record<string, ConnectionStatus>`, polling action, per-session toolset selection |
| `web/src/App.tsx` | Add a Connections tab next to the Sidebar |
| `package.json` (root) | Rename to `princeai-web` for clarity; preserve upstream attribution in `README.md` (MIT license — keep notice) |

## Existing utilities to reuse (do not rewrite)

- **`server/src/sessions/session.ts:buildArgs()`** — already constructs the `--mcp-config` JSON; we just merge our extra servers in.
- **`server/src/sessions/proto.ts:StreamJsonDecoder`** — handles every event shape we need; do not touch.
- **`server/src/store/history.ts:loadSessionHistory`** — JSONL replay; reuse for resume.
- **`server/src/mcp/worker.ts`** pattern — already proves the "stdio MCP server forwards back to main server over HTTP with a shared `CCWEB_INTERNAL_TOKEN`" pattern. If we ever want to surface custom UI cards beyond `ask_user_question`, we extend this same worker.
- **`mcporter`** (`/opt/homebrew/lib/node_modules/mcporter`) — already running with `beads`/`linkedin`/`arxiv`. Reads `~/.claude.json`. Use `mcporter list` for status, `mcporter config add <id> <package-or-url>` to register new servers. **This is our MCP runtime.** Don't reimplement.
- **`agent-reach doctor`** — prints CLI-channel status (Twitter/YouTube/Reddit fallbacks) with `✅ / [X]` markers; parse server-side.
- **AgentReach CLIs already on PATH** (`bird`, `gh`, `yt-dlp`, `rdt-cli`, Jina Reader via curl) — invoked through the existing **Bash** tool. No new wiring needed.

## Wire protocol (delta from upstream)

Upstream `ClientMessage` + `ServerMessage` stays. We add:

```ts
// shared/src/types.ts (additions)
export type Platform =
  | "reddit" | "twitter" | "linkedin" | "github"
  | "youtube" | "exa" | "gmail" | "context7";

export type ConnectionState = "connected" | "missing" | "expired" | "unsupported";

export interface PlatformStatus {
  platform: Platform;
  state: ConnectionState;
  detail?: string;          // e.g. "logged in as Ok-Common-2190"
  lastCheckedAt: number;
}

// extend new_session with enabled integrations:
//   { type: "new_session"; cwd: ...; permissionMode: ...; enabledIntegrations: Platform[] }
```

Server uses `enabledIntegrations` to compute (a) which Bash invocations Claude is *allowed* to use (informational, set in system prompt), (b) which MCP servers to spawn, and (c) `--allowed-tools` / `--disallowed-tools` flags. Disabled integrations have their CLIs blocked at the prompt level (system prompt note: "do not call `bird`/`gh`/etc."), since the Bash tool itself can't be selectively disabled per-binary.

## Per-integration descriptor (the registry that drives the panel)

This is the contents of `server/integrations.json`. **Adding a new integration = appending one row.**

| ID | Kind | Package / binary | Status check | Setup | Notes |
|---|---|---|---|---|---|
| `github` | `cli` | `gh` (already installed) | `gh auth status` | `gh auth login` (interactive — pty modal or "run this in terminal" instructions) | macOS Keychain |
| `reddit` | `mcp` | `reddit-mcp-buddy` (npm) | `mcporter list \| grep reddit` | `mcporter config add reddit reddit-mcp-buddy` (zero-config; optional Reddit OAuth bumps rate limit) | 632★, MCP Registry |
| `linkedin` | `mcp` | already registered in mcporter | `mcporter list \| grep linkedin` | already done; surface "Re-authenticate" if profile expires | Patchright Chromium, persistent profile |
| `exa` | `mcp` | `exa-mcp-server` (npm) | `mcporter list \| grep exa` | `mcporter config add exa exa-mcp-server` + env `EXA_API_KEY` | official |
| `tavily` | `mcp` | `tavily-mcp` (npm) | `mcporter list \| grep tavily` | `mcporter config add tavily tavily-mcp` + env `TAVILY_API_KEY` | official, complements Exa |
| `context7` | `mcp` | `@upstash/context7-mcp` (npm) | `mcporter list \| grep context7` | `mcporter config add context7 @upstash/context7-mcp` (free tier; optional API key for higher limits) | official |
| `gmail` | `mcp` | `navbuildz/gmail-mcp-server` (npm) | `mcporter list \| grep gmail` + `~/.gmail-mcp/credentials.json` exists | `mcporter config add gmail @navbuildz/gmail-mcp-server` then run OAuth helper (one-time browser flow) | multi-account, active |
| `twitter` | `cli` | `bird` (AgentReach, already installed + logged in) | `bird whoami` or parse `agent-reach doctor` | `agent-reach configure twitter-cookies --from-browser chrome` | no good Twitter MCP exists |
| `youtube` | `cli` | `yt-dlp` (AgentReach) | dry-run a known short video | `agent-reach configure youtube-cookies --from-browser chrome` | gold standard for YT |

> **Caveat — `agent-reach doctor` parsing.** Output is bilingual (Chinese + English) with status markers `✅` and `[X]`. We grep-parse it for Twitter / YouTube only; everything else uses `mcporter list` or per-tool checks (`gh auth status` etc.).

> **Caveat — Gmail OAuth.** The Gmail MCP needs a one-time OAuth flow (browser redirect → save token to local credentials file). Sprint 4 ships an `/api/oauth/callback/gmail` route that catches the redirect and stores the token in `~/.gmail-mcp/credentials.json`. After that, the MCP runs locally with no further interaction.

> **Note on extensibility.** New MCPs are added via the **+ Add MCP** button in the Connections panel (`AddIntegrationModal.tsx`) which appends to `integrations.json` and runs `mcporter config add`. Want Notion? Slack? Linear? Just paste `@notionhq/notion-mcp-server` (or whatever) and it appears as a card. No code changes.

---

## Sprint plan (Agile structure: Epic → Feature → Story → Sprint → Phase)

**Epic:** PrinceAI — localhost browser UI for Claude Code with one-click integration management.

**Velocity assumption.** Each sprint is sized to ~½–1 day of focused work. Six sprints total, ship value end-to-end at the end of Sprint 1 (you have a working chat UI you can use day-to-day), then layer integrations on top.

---

### Sprint 0 — Foundation (verified environment + pinned upstream)

**Verified environment** (recorded 2026-04-30):

| Tool | Version | Path | Notes |
|---|---|---|---|
| node | v25.9.0 | `/opt/homebrew/bin/node` | well above the ≥18 required |
| pnpm | 10.33.0 | `/opt/homebrew/bin/pnpm` | installed via `npm i -g pnpm@10.33.0`; matches upstream `packageManager` exactly |
| claude | 2.1.126 | `/Users/prince/.local/bin/claude` | Claude Code CLI |
| mcporter | 0.9.0 | `/opt/homebrew/lib/node_modules/mcporter` | reads `~/.claude.json`, currently has `beads` / `linkedin` / `arxiv` |
| gh | logged in | `Princeu3` (keyring) | needed for clones over HTTPS |
| git | 2.53.0 | system | needed for vendoring |

**Pinned upstream:** `lucasprim/claude-code-web-ui` @ `aa09556879bf7d1d1b4359f4492199b3ba070d7d` (HEAD of `main` as of 2026-04-30).
**Upstream license:** MIT (per upstream README; no SPDX `LICENSE` file in repo, so we copy the MIT notice ourselves into `web-ui/UPSTREAM.md` for clean attribution).

**Story 0.1 — "Pin upstream and write attribution."**
- **Phase 0.1.1 ✅** `task-plans.md` lives at `/Users/prince/PrinceAI/task-plans.md` (synced from plan file).
- **Phase 0.1.2 ✅** Upstream SHA pinned above. Re-fetch on any future upstream-pull: `gh api repos/lucasprim/claude-code-web-ui/commits/main --jq '.sha'`.
- **Phase 0.1.3** Attribution block to write into `web-ui/UPSTREAM.md` after Sprint 1.1.1: includes upstream URL, pinned SHA, MIT notice (Lucas Prim), summary of our changes ("vendored fork; modifications listed in CHANGELOG.md").

**Exit (Sprint 0):** ✅ — env verified, upstream pinned, attribution drafted (committed to disk in Sprint 1.1.1 alongside the vendored code).

---

### Sprint 1 — Get the upstream UI running locally, unmodified

**Story 1.1 — "I can chat with Claude Code in a browser tab."**

- **Phase 1.1.1 — Vendor upstream (preserve our control over future updates).**
  - Approach: clone upstream into a temp dir, copy contents (minus `.git`) to `/Users/prince/PrinceAI/web-ui/`, commit into our outer git repo. This avoids nested `.git` confusion and lets us track our diffs clearly.
  - Concrete commands:
    ```bash
    UPSTREAM_SHA=aa09556879bf7d1d1b4359f4492199b3ba070d7d
    TMP=$(mktemp -d)
    git clone --quiet --depth 1 https://github.com/lucasprim/claude-code-web-ui "$TMP/cc-web-ui"
    git -C "$TMP/cc-web-ui" fetch --depth 1 origin "$UPSTREAM_SHA"
    git -C "$TMP/cc-web-ui" checkout "$UPSTREAM_SHA"
    mkdir -p /Users/prince/PrinceAI/web-ui
    rsync -a --exclude='.git' "$TMP/cc-web-ui/" /Users/prince/PrinceAI/web-ui/
    rm -rf "$TMP"
    ```
  - Then write `web-ui/UPSTREAM.md` with the attribution block (see Phase 0.1.3).

- **Phase 1.1.2 — Install deps.**
  - `pnpm -C /Users/prince/PrinceAI/web-ui install` → installs Fastify, ws, better-sqlite3, React, Vite, Tailwind, zustand, @anthropic-ai SDK pieces (whatever's in upstream `pnpm-lock.yaml`).
  - Acceptance: install completes, no `EBADENGINE` warnings (node 25 satisfies the upstream `engines` if any), `pnpm -r typecheck` returns clean.

- **Phase 1.1.3 — Build + boot + smoke.**
  - Build: `pnpm -C /Users/prince/PrinceAI/web-ui build` (root `build` script does `pnpm -r build`).
  - Boot in background: `pnpm -C /Users/prince/PrinceAI/web-ui/server start` → server binds `127.0.0.1:4131`.
  - Smoke (curl-level, before the browser): `curl -sf http://127.0.0.1:4131/api/sessions` should return `{"sessions": []}` or similar JSON. WebSocket reachability: `curl -sI -H "Upgrade: websocket" -H "Connection: Upgrade" -H "Sec-WebSocket-Key: x" -H "Sec-WebSocket-Version: 13" http://127.0.0.1:4131/ws` returns `101 Switching Protocols`.
  - Browser smoke (manual, by you): open `http://127.0.0.1:4131`, click + New, pick `/Users/prince/PrinceAI` as cwd, send "list files in current dir and summarize", confirm streaming text + tool-use cards render. Close tab, reopen, click the session in the sidebar → history replay <100ms.

- **Phase 1.1.4 — Dev mode hot reload.**
  - Two terminals:
    ```bash
    pnpm -C /Users/prince/PrinceAI/web-ui dev:server    # tsx watch on :4131
    pnpm -C /Users/prince/PrinceAI/web-ui dev:web       # Vite HMR on :5173 with /api + /ws proxy to 4131
    ```
  - Acceptance: edit a string in `web/src/App.tsx`, save, see HMR update in browser without losing WS connection.

**Story 1.2 — "It feels like mine."**

- **Phase 1.2.1 — Rebrand (cosmetic, zero logic changes).**
  - Edit `package.json` (root): `"name": "princeai-web"`.
  - Edit `server/package.json`: `"name": "@princeai/server"` (or similar — keep workspace-internal references intact: upstream uses `@ccweb/shared`, so leave `shared/package.json` `name` alone unless we update both sides).
  - Edit `web/package.json`: `"name": "@princeai/web"` (same caveat — only rename if we also update import sites).
  - **Decision: only rename the ROOT `package.json` `name` field for now.** Sub-packages stay as-is to avoid TS rename churn. We can rename in a later sprint when we're touching those packages anyway.
  - Edit `web/index.html`: `<title>PrinceAI</title>`.

- **Phase 1.2.2 — Git init + first commit.**
  - At `/Users/prince/PrinceAI/`: `git init -b main`.
  - `.gitignore` at repo root (additive — covers vendored web-ui's `node_modules`, `dist`, `data/*.sqlite`, plus our top-level cruft):
    ```gitignore
    node_modules/
    .DS_Store
    web-ui/data/
    web-ui/**/dist/
    web-ui/**/.turbo/
    *.log
    .env
    .env.local
    ```
  - `git add -A && git commit` with message:
    ```
    Vendor lucasprim/claude-code-web-ui @ aa0955687

    MIT-licensed upstream by Lucas Prim. Attribution in web-ui/UPSTREAM.md.
    Local rebrand: root package.json name → princeai-web; window title → PrinceAI.
    No logic changes.
    ```

**Exit (Sprint 1):** A localhost chat UI usable day-to-day, with branding done and version-controlled. Everything below is additive.

**Verification (end of Sprint 1):**
1. `cd /Users/prince/PrinceAI/web-ui && pnpm install && pnpm build && pnpm -C server start` → server up on :4131.
2. Browser: new session in `~/PrinceAI`, ask "ls and summarize" → Bash tool runs, output streams.
3. Close tab, reopen, click session → history replays in <100ms.
4. `git log --oneline` in `/Users/prince/PrinceAI/` shows one clean vendoring commit with attribution.

---

### Sprint 2 — Wire protocol extensions (no UI yet)

**Story 2.1 — "The server understands per-session integration toggles."**
- **Phase 2.1.1** Edit `shared/src/types.ts`: add `Platform`, `ConnectionState`, `PlatformStatus`, extend `new_session` with `enabledIntegrations: Platform[]`, add `set_toolset` ClientMessage (mid-session change → triggers a session restart on the same `cwd` with new flags).
- **Phase 2.1.2** Edit `server/src/sessions/session.ts:buildArgs()`: accept `enabledIntegrations` and `extraMcpServers`, splice into `--mcp-config`, append to `--disallowed-tools` / `--allowed-tools` as appropriate, append a system-prompt note listing only the active CLIs.
- **Phase 2.1.3** Pass-through in `server/src/ws.ts`: read `msg.enabledIntegrations` on `new_session`, hand to `sessionManager.create`.
- **Phase 2.1.4** Unit-style smoke script: extend `server/scripts/smoke-session.ts` to assert `--mcp-config` includes a stub server when one is passed in.

**Exit:** Backend honors per-session integration toggles, but UI doesn't expose them yet.

**Verification:** Add a temporary `enabledIntegrations` array to the existing `NewSessionModal` payload manually; observe the spawned `claude` process args via `ps -ef | grep claude`.

---

### Sprint 3 — Connections panel (status only, no setup yet)

**Story 3.1 — "I can see at a glance which integrations are live."**
- **Phase 3.1.1** Create `server/integrations.json` seeded with the 9 entries from the descriptor table above. JSON schema: `{ id, kind: "mcp"|"cli", label, package?, args?, env?, statusCheck: { type: "mcporterList"|"shellExitZero"|"agentReachDoctor", target: string }, setupHint: string }`.
- **Phase 3.1.2** New file `server/src/integrations/registry.ts`: load `integrations.json`, expose `listIntegrations()`, `getIntegration(id)`. Validate with zod (already a transitive dep via Fastify).
- **Phase 3.1.3** New file `server/src/integrations/checker.ts`: per-`statusCheck.type` runner. `mcporterList` runs `mcporter list --json` once and reuses across queries. `agentReachDoctor` runs once per refresh and parses bilingual output (only used for Twitter/YouTube). `shellExitZero` runs `gh auth status` etc.
- **Phase 3.1.4** New REST route `server/src/routes/integrations.ts` → `GET /api/integrations/status` (60s cache, parallelised).
- **Phase 3.1.5** Front-end: `web/src/components/ConnectionsPanel.tsx` — card grid driven by the API response (no hardcoded list — fully data-driven), status dot (green/yellow/red/grey), last-checked timestamp, Refresh button. Wire into `App.tsx` as a tab next to Sidebar.
- **Phase 3.1.6** zustand slice in `web/src/state.ts` for `integrations`; poll every 60s when panel is visible.

**Exit:** A working dashboard listing all 9 seeded integrations with live status. Adding a 10th is purely a JSON edit + restart.

**Verification:** Append a fake `notion` row to `integrations.json`, restart server → it appears in the panel as red (not configured). Remove it → disappears.

---

### Sprint 4 — Connect / disconnect flows

**Story 4.1 — "I can connect a zero-config MCP with one click."** *(Reddit, Context7 free tier, LinkedIn re-auth)*
- **Phase 4.1.1** Endpoint `POST /api/integrations/:id/connect` for `kind=mcp` no-auth integrations → shells `mcporter config add <id> <package>` per the registry, returns new status.
- **Phase 4.1.2** UI Connect button on each MCP card: spinner → success toast → status dot turns green.

**Story 4.2 — "I can connect an API-key MCP."** *(Exa, Tavily, optionally Context7 paid tier)*
- **Phase 4.2.1** Modal with a single password-style input for the API key. On submit, server runs `mcporter config add <id> <package> --env KEY=VALUE` (or writes to mcporter's config) and re-checks status.
- **Phase 4.2.2** Store the env var name from `integrations.json`; UI shows a link to where to get the key (Exa dashboard, Tavily dashboard).

**Story 4.3 — "I can connect Gmail (one-time OAuth)."**
- **Phase 4.3.1** Add `POST /api/integrations/gmail/connect` → starts the gmail-mcp-server's OAuth helper, returns the Google auth URL.
- **Phase 4.3.2** Add `GET /api/oauth/callback/gmail` → catches the redirect, exchanges code for token, writes to `~/.gmail-mcp/credentials.json`.
- **Phase 4.3.3** UI: clicking Connect opens the auth URL in a new tab, shows "waiting for redirect…" until the callback fires.

**Story 4.4 — "I can connect AgentReach CLI integrations (Twitter, YouTube)."**
- **Phase 4.4.1** Endpoint `POST /api/integrations/:id/connect-from-browser?browser=chrome` → runs `agent-reach configure --from-browser chrome` for Twitter/YouTube cookies.
- **Phase 4.4.2** GitHub: pop up a "run this in your terminal" instructions modal with `gh auth login` (cheap MVP; embedded xterm pty deferred to Sprint 7).

**Story 4.5 — "I can add a new MCP I just discovered, from the UI."**
- **Phase 4.5.1** `POST /api/integrations` accepting `{ id, label, package, env?: Record<string,string> }` → appends to `integrations.json`, runs `mcporter config add`, returns new descriptor + status.
- **Phase 4.5.2** UI: `AddIntegrationModal.tsx` with form fields (id slug, friendly label, npm/pypi package, optional env var inputs).

**Story 4.6 — "I can disconnect anything."**
- **Phase 4.6.1** `POST /api/integrations/:id/disconnect` → for MCP: `mcporter config remove <id>`. For CLI: removes the relevant cookie file / runs `gh auth logout`. Updates status.

**Exit:** Every integration in `integrations.json` has working connect + disconnect paths. UI can register brand-new MCPs without code changes.

**Verification:** From the UI: (a) connect Reddit (no-auth) → green within 5s; (b) add a new MCP via the form (e.g. `@notionhq/notion-mcp-server` with API key) → it appears in the panel; (c) disconnect Twitter → red; (d) start a chat session, ask "search reddit r/golang for X" → tool calls show `mcp__reddit__search_posts` instead of `bird` or `curl`.

---

### Sprint 5 — Per-session toolset selection

**Story 5.1 — "When I start a chat I pick the integrations I want for that session only."**
- **Phase 5.1.1** Extend `NewSessionModal.tsx` with a checklist of the 8 platforms. Greys out disconnected ones with a tooltip "Connect first". Default = all connected.
- **Phase 5.1.2** Wire selection into `new_session` payload (`enabledIntegrations`). Server already understands this from Sprint 2.
- **Phase 5.1.3** Show the active toolset as chips in the chat header; clicking a chip removes it (sends `set_toolset` → server restarts the subprocess on the same cwd with new flags).

**Story 5.2 — "I have sensible defaults so I don't pick every time."**
- **Phase 5.2.1** Persist last-used toolset per `cwd` in the SQLite metadata store (extend the existing `metadataStore` schema with one nullable JSON column).

**Exit:** New sessions launch with a curated toolset; mid-session toggle works via subprocess restart.

**Verification:** Start a session with only `github` enabled. Ask Claude to "search reddit for X". Confirm it refuses or uses Web Search instead, per the system-prompt nudge.

---

### Sprint 6 — Polish & ship-readiness

**Story 6.1 — "It survives daily use."**
- **Phase 6.1.1** Health check route `GET /api/health` (Claude binary present, AgentReach present, MCP worker spawnable).
- **Phase 6.1.2** Error toasts in UI for spawn failures, expired cookies mid-session, rate-limit events (already in `RateLimitInfo` upstream).
- **Phase 6.1.3** Dev script: `pnpm dev:all` boots server + web concurrently with one command.
- **Phase 6.1.4** README / `task-plans.md` update — usage doc, screenshots, attribution.

**Exit:** You can ditch the terminal as your primary Claude Code surface.

---

## End-to-end verification (after Sprint 6)

1. **Cold start**: `cd /Users/prince/PrinceAI/web-ui && pnpm install && pnpm build && pnpm start` → loads at `http://127.0.0.1:4131`.
2. **Connections panel**: shows 6 of 8 platforms green (matches `agent-reach doctor`); Gmail/Context7 show "Managed by Claude.ai".
3. **Chat session**: New session in `~/PrinceAI`, enabled = `[github, exa, twitter]`. Ask "find a recent tweet about Anthropic and open the discussed GitHub repo." Watch tool calls (`bird search`, `gh repo view`) stream in.
4. **Resume**: close tab, reopen, click that session in sidebar → history replays in <100ms, then live chat continues.
5. **Disconnect mid-day**: delete twitter cookies via UI → red dot appears within 60s.
6. **Reconnect**: click Connect → run `--from-browser chrome` → green within 60s.
7. **Skill / MCP unaffected**: confirm `claude-mem`, hooks, and `~/.claude/skills/agent-reach` skill still load (we never touched `~/.claude/`).

## Out of scope (intentionally)

- Authentication / multi-user — staying localhost-only, single user.
- Remote access (Tailscale / Cloudflare Tunnel) — possible later, blocked on the cookie-locality issue.
- Mobile UI — works on desktop browsers; mobile responsiveness is a Sprint 7 if desired.
- Cron / scheduled prompts (liuhuanxi has it; we don't need it for the integration-toggle problem).
- Replacing the Bash tool with sandboxed per-tool execution. We rely on the system-prompt + `--disallowed-tools` to gate behavior, which is good enough for single-user localhost.

## Open questions (please confirm before Sprint 1 kicks off)

1. **Repo layout**: clone into `/Users/prince/PrinceAI/web-ui/` (sub-folder, recommended) vs. moving `Idea.txt` + `CLAUDE.md` into a `docs/` folder and using the repo root for the cloned project? *Default: sub-folder.*
2. **First-cut integration scope**: ship Sprint 3 (status panel) for all 9 from day one (it's data-driven, marginal cost) but only land Connect flows for `github`, `reddit`, `exa`, `context7` in Sprint 4 first, then `tavily`/`gmail`/`linkedin`/`twitter`/`youtube` iteratively? *Default: all 9 in Sprint 4.*
3. **GitHub auth UX**: "run this in your terminal" modal (cheap, ~30 min) vs embedded xterm.js pty (correct but +1 sprint). *Default: instructions modal; embedded pty as Sprint 7 if you miss it.*
4. **Reddit MCP rate-limit tier**: zero-config gives 10 req/min, optional Reddit OAuth bumps to 60 or 100. *Default: ship zero-config; add an "Authenticate" button on the Reddit card later if you hit the limit.*
5. **Web Search redundancy**: shipping both Exa and Tavily means Claude has two web-search MCPs available. *Default: keep both — they have different strengths (Exa for code/semantic, Tavily for general web + extract/crawl); per-session toggle lets you pick.*
