# vault-sync

Backs up an Obsidian vault to the owner's Cloudflare account: a CLI daemon on the vault's PC pushes every change to a Worker, which stores bytes in R2 and the vault index in one SQLite Durable Object per vault.

Spec: "Vault Sync — Requisitos (Obsidian → Cloudflare)" (Claude Docs). Phases F0–F4; v1 is one-way push plus restore.

## Layout

- `packages/protocol` — Zod schemas and branded types shared by the Worker and the CLI. The API contract lives here.
- `apps/worker` — Hono app (`src/routes`), `VaultDO` (RPC, auth, rate limit), `VaultStore` (synchronous Drizzle queries), Drizzle schema and migrations (`drizzle/`).
- `apps/cli` — `vaultsync` daemon: scan, hash cache, watcher, push.
- `docs/` — cost budget and design decisions.

## Commands

- `pnpm lint` — oxlint, then ESLint for type-aware rules
- `pnpm typecheck`
- `pnpm test` — Worker tests run inside workerd with local DO and R2
- `pnpm --filter @vault-sync/worker cf-typegen` — after editing `wrangler.jsonc`
- `pnpm --filter @vault-sync/worker db:generate` — after editing `src/db/schema.ts`

All three of lint, typecheck and test must pass before a commit.

## Architecture rules

- Three primitives only: Worker, Durable Object (SQLite), R2. Adding D1, KV, Queues or Workflows needs a written reason in `docs/decisions.md`.
- Durable Object classes are declared in `wrangler.jsonc` under `exports`, never `migrations`.
- One DO request per API call: device methods take the token and verify it inside the same RPC.
- The Worker never writes to R2 before an authed DO call succeeds.
- Uploads stream to R2. Never buffer a body with `arrayBuffer()` or `text()`.
- `VaultStore` is synchronous (no `await`), so commits run inside `transactionSync`.
- RPC methods return `RpcResult<T>`; `routes/*` turn errors into HTTP via `unwrap` and the `STATUS` map.
- Commits are idempotent by `batchId`. Only idempotent methods go in the `retryable(...)` block.

## Code rules

- TypeScript strict (see `tsconfig.base.json`). No `any`, no `as`, no non-null `!`.
- Validate every external input with Zod at the edge; trust types inside.
- Branded types for ids: `Sha256`, `VaultId`, `DeviceId`, `Seq`, `VaultPath`, `BatchId`.
- Functions stay small: complexity ≤ 10, ≤ 4 params, ≤ 60 lines (enforced by oxlint).
- Comments explain a constraint the code cannot show. No inline comments, no TODO/FIXME, no comments that restate the code.
- Names over comments; early returns over nesting.

## Security

- Secrets via `wrangler secret put`; local values in `apps/worker/.dev.vars` (git-ignored).
- Tokens: 256-bit, only `SHA-256(token)` stored, compared in constant time.
- Paths are NFC-normalized and reject `..`, absolute paths and control characters.

## Repository

Private. Never push to a public remote.
