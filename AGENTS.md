# vault-sync

Backs up an Obsidian vault to the owner's Cloudflare account: a CLI daemon on the vault's PC pushes every change to a Worker, which stores bytes in R2 and the vault index in one SQLite Durable Object per vault.

Spec: "Vault Sync — Requisitos (Obsidian → Cloudflare)" (Claude Docs). Phases F0–F4; v1 is one-way push plus restore.

## Layout

```txt
apps/
  api/                         Cloudflare Worker (Hono)
    src/
      index.ts                 app, global error handler, DO export
      router.ts                mounts controllers under /v1
      di.ts                    createContainer(env): typed services, constructor injection
      common/                  errors.ts, validation.ts, constants.ts, types/
      controllers/             <domain>.controller.ts — HTTP only: validate, call service, respond
      services/                <domain>.service.ts — business rules, R2, DO calls; base.service.ts
      middlewares/             <purpose>.middleware.ts — auth, container
      schemas/                 <domain>.schema.ts — API-only Zod (params, headers)
      entities/                <table>.entity.ts — Drizzle tables for the Durable Object's SQLite
      durable-objects/         vault.durable-object.ts (RPC, auth, alarm), vault.maintenance.ts (snapshots, retention, GC)
        stores/                synchronous Drizzle access: manifest, blob, device, snapshot
      utils/                   pure helpers: crypto, gzip, rate limiter, retention, rpc result
    drizzle/migrations/        generated SQL, bundled into the DO
    test/                      Vitest in workerd: <topic>.test.ts, helpers.ts
  cli/                         vaultsync daemon (Node ≥ 24, runs TS directly)
    src/
      main.ts                  registers commands
      commands/                <name>.command.ts — parse args, call services, print
      services/                scan, upload, sync, sync-loop, watch, restore
      clients/                 api.client.ts — typed HTTP client with retry
      storage/                 local SQLite state, vault config + OS keychain, ignore file
      common/                  constants, types, errors
      utils/                   pure: diff, ignore rules, formatting
packages/
  protocol/                    Zod contracts shared by api and cli: <domain>.schema.ts, ids, path, limits
  typescript-config/           base.json
docs/                          costs.md, decisions.md
scripts/                       check-comments.mjs
```

Dependency direction: `controllers|commands → services → (durable-objects | clients | storage) → entities|utils`. `utils/` and `packages/protocol` import nothing app-specific.

## Commands

- `pnpm verify` — format check, lint, types, tests (run before every commit)
- `pnpm lint` — oxlint with type information, then the zero-comment check
- `pnpm format` — oxfmt
- `pnpm check-types` / `pnpm test` — through Turborepo
- `pnpm knip` — unused files, exports and dependencies
- `pnpm --filter @vault-sync/api cf-typegen` — after editing `wrangler.jsonc`
- `pnpm --filter @vault-sync/api db:generate` — after editing `src/entities/`

## API contract

- Success: `{ "data": ... }`. Errors: `{ "error": "<message>", "code": "ERR_*", "details"?: ... }`.
- Codes live in `packages/protocol/src/envelope.schema.ts`; HTTP status mapping in `apps/api/src/common/errors.ts`.
- Throw `AppError(code, message, details?)` anywhere; `index.ts` turns it into the response. Unknown errors log JSON and return `ERR_INTERNAL` without a stack.

## Architecture rules

- Three primitives only: Worker, Durable Object (SQLite), R2. Adding D1, KV, Queues or Workflows needs a written reason in `docs/decisions.md`.
- Durable Object classes are declared in `wrangler.jsonc` under `exports`, never `migrations`.
- One DO request per API call: device methods take the token and verify it inside the same RPC.
- The Worker never writes to R2 before an authed DO call succeeds.
- Uploads stream to R2. Never buffer a body with `arrayBuffer()` or `text()`.
- Stores in `durable-objects/stores/` are synchronous (no `await`), so commits run inside `transactionSync`.
- R2 keys are scoped per vault (`blobKey(vaultId, hash)`, `snapshotKey(vaultId, seq)`); GC relies on it.
- Alarms are scheduled only when work exists, at most once a day (see `docs/decisions.md`).
- DO methods return `RpcResult<T>`; `BaseService.unwrap` turns failures into `AppError`.
- Commits are idempotent by `batchId`. Only idempotent methods go in the `retryable(...)` block.

## Code rules

- TypeScript strict (`packages/typescript-config/base.json`). No `any`, no `as`, no non-null `!`.
- Validate every external input with Zod at the edge; trust types inside.
- Branded ids: `Sha256`, `VaultId`, `DeviceId`, `Seq`, `VaultPath`, `BatchId`.
- Files kebab-case with a layer suffix; one class or one cohesive set of functions per file.
- Functions stay small: complexity ≤ 10, ≤ 4 params (use an options object), ≤ 60 lines.
- Zero comments in source. Names, types and small functions carry the meaning; design reasons go in `docs/decisions.md`. Only `oxlint-disable` directives are allowed, and each needs a reason in `docs/decisions.md`.
- Formatting by oxfmt: 2 spaces, double quotes, semicolons, 120 columns.

## Security

- Secrets via `wrangler secret put`; local values in `apps/api/.dev.vars` (git-ignored).
- Tokens: 256-bit, only `SHA-256(token)` stored, compared in constant time.
- Paths are NFC-normalized and reject `..`, absolute paths and control characters.

## Deviations from the house stack standard

| Standard                                     | Here                                              | Why                                                                              |
| -------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Effect v4 (`Layer`, `TaggedError`, `Schema`) | Hono + Zod + plain `di.ts`                        | Owner's choice for this project; Zod schemas are shared with the CLI.            |
| Awilix container                             | `createContainer(env)` returning typed services   | No proxy/string resolution; the compiler checks every dependency.                |
| D1 + `BaseService` CRUD                      | Durable Object SQLite + synchronous stores        | One strongly consistent database per vault, atomic commits without network hops. |
| `new_sqlite_classes` migrations              | `exports` in `wrangler.jsonc`                     | Cloudflare's current declarative mechanism (2026-06-30).                         |
| No CLI pattern                               | `apps/cli` with commands/services/clients/storage | Same layering as the API, adapted to a process instead of a request.             |

## Repository

Private. Never push to a public remote.
