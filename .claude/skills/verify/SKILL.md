---
name: verify
description: Runs the vault-sync quality gate (format, type-aware oxlint, zero comments, typecheck, tests, unused code). Use before committing, after any code change, or when asked whether the repo is green.
allowed-tools: Bash(pnpm verify) Bash(pnpm knip) Bash(pnpm format) Bash(pnpm --filter *)
---

From the repo root:

1. If `apps/api/wrangler.jsonc` changed: `pnpm --filter @vault-sync/api cf-typegen`.
2. If `apps/api/src/entities/` changed: `pnpm --filter @vault-sync/api db:generate`, and commit the new files under `drizzle/migrations/`.
3. `pnpm format` to apply formatting.
4. `pnpm verify` runs, in order: format check, oxlint with type information, the zero-comment check, typecheck through Turborepo, tests through Turborepo.
5. `pnpm knip` checks for unused files, exports and dependencies.

Check each command's exit code, not only its last lines: a pipe through `tail` hides failures.

Report the first failing command and its first error. Fix the cause; never weaken a lint rule, add a comment, or skip a test to get green.
