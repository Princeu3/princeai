# CLAUDE.md

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## Operating principles

**1. Think before coding.** State assumptions. If ambiguous, present alternatives — don't pick silently. Push back when a simpler approach exists. Stop and name what's unclear instead of guessing.

**2. Simplicity first.** Minimum code that solves the problem. No speculative features, no abstractions for single-use code, no error handling for impossible scenarios. If 200 lines could be 50, rewrite.

**3. Surgical changes.** Touch only what the request requires. Match existing style. Don't refactor adjacent code or remove pre-existing dead code unasked. Every changed line should trace to the request.

**4. Trust the context.** Don't defend against problems the human didn't ask you to solve. Internal code and frameworks have guarantees — only validate at true system boundaries (user input, external APIs).

**5. Verify before declaring done.** Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step work, state a brief plan with a verify step per item. Run typecheck / tests / lint / manual UI checks before declaring done; ask if commands aren't documented below.

**6. Learn from corrections.** When the user corrects an approach, rule, or assumption, propose the exact short imperative to add to the **Project conventions** section below — so the same mistake doesn't recur next session. Make the rule generalizable, not narrowly tied to the current task.

## Tooling

- **Context7 MCP** — for any library / SDK / framework / CLI lookup, prefer `mcp__claude_ai_Context7__*` over training-data recall.
- **claude-mem** — search prior session work via `mcp__plugin_claude-mem_mcp-search__smart_search` before re-deriving.
- **beads (`bd`)** — installed globally; suggest `bd init` only if this becomes a long-horizon multi-task project.

## Project conventions

<!-- Add real build/test/lint commands and observed rules here as Claude learns them.
Examples:
- Always use `bun`, not `npm`
- Test: `bun run test`
- Typecheck: `bun run typecheck`
- Prefer `type` over `interface`; never use `enum`
- Use named exports for utilities
-->

