@AGENTS.md

## Claude Code

- A `PostToolUse` hook runs oxlint on every file you edit. Exit 2 means the file has lint errors: fix them before moving on.
- Skills in `.claude/skills`:
  - `verify` — the full gate, before declaring work done
  - `add-endpoint` — the five-layer change for any API or DO method
  - `do-cost-review` — billing impact of DO, route or CLI changes
  - `durable-objects`, `workers-best-practices`, `wrangler` — Cloudflare references (prefer the docs over memory for any API detail)
- Subagent `reviewer` — run it on the diff before committing a feature.
- Cloudflare APIs changed a lot in 2026 (`exports`, `retryable()`, `@cloudflare/vitest-plugin`, spend limits). Check the Cloudflare docs before relying on what you remember.
