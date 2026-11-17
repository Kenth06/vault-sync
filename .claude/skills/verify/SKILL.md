---
name: verify
description: Runs the vault-sync quality gate (oxlint, type-aware ESLint, typecheck, tests). Use before committing, after any code change, or when asked whether the repo is green.
allowed-tools: Bash(pnpm lint *) Bash(pnpm typecheck *) Bash(pnpm test *) Bash(pnpm --filter *)
---

Run from the repo root, in order, and stop at the first failure:

1. `pnpm lint` — oxlint first, then ESLint for the type-aware rules only.
2. `pnpm typecheck`
3. `pnpm test` — the Worker suite runs inside workerd with local DO and R2.

If `apps/worker/wrangler.jsonc` changed, run `pnpm --filter @vault-sync/worker cf-typegen` before step 2.
If `apps/worker/src/db/schema.ts` changed, run `pnpm --filter @vault-sync/worker db:generate` and commit the new file under `drizzle/`.

Report the failing command and its first error. Fix the cause; never weaken a lint rule or skip a test to get green.
