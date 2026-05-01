# Upstream

This directory is a **vendored fork** of [`lucasprim/claude-code-web-ui`](https://github.com/lucasprim/claude-code-web-ui).

- **Pinned commit:** `aa09556879bf7d1d1b4359f4492199b3ba070d7d`
- **Pinned at:** 2026-04-30
- **Upstream license:** MIT (per upstream README)
- **Original author:** Lucas Prim

## Why a vendored fork

We extend the upstream with: a Connections panel (MCP + AgentReach + CLI registry), per-session integration toggles via `--allowed-tools` / `--mcp-config`, and a JSON-driven extensibility layer. See `/Users/prince/PrinceAI/task-plans.md` for the full plan.

## How to update upstream

```bash
UPSTREAM_SHA=$(gh api repos/lucasprim/claude-code-web-ui/commits/main --jq '.sha')
TMP=$(mktemp -d)
git clone --quiet https://github.com/lucasprim/claude-code-web-ui "$TMP/cc-web-ui"
git -C "$TMP/cc-web-ui" checkout "$UPSTREAM_SHA"
# Manual merge — use a 3-way diff against the previously pinned SHA.
diff -ru /Users/prince/PrinceAI/web-ui "$TMP/cc-web-ui" | less
# After resolving conflicts, update the pinned SHA above and commit.
```

## Attribution (MIT)

```
MIT License

Copyright (c) 2026 Lucas Prim

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Local modifications

See `git log -- web-ui/` from the repository root for the full list. Major change categories:

- **`shared/package.json`** — added `"build": "tsc"` script. Upstream omits this, which leaves `shared/dist/*.d.ts` un-emitted and breaks `web`'s `tsc --noEmit` (TS6305) because `web/tsconfig.json` declares a project-reference on `shared`. With the script, `pnpm -r build` produces declarations in topological order. Worth upstreaming.
- **`package.json` (root)** — `name` renamed from `claude-code-web-ui` to `princeai-web` (cosmetic).
- **`web/index.html`** — `<title>` changed from `Claude Code Web` to `PrinceAI` (cosmetic).
