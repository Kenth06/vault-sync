---
name: add-endpoint
description: Adds or changes an HTTP endpoint in the vault-sync Worker end to end (protocol schema, VaultStore, VaultDO RPC, Hono route, test). Use when the API surface or a Durable Object method changes.
---

Every endpoint crosses the same five layers. Change them in this order so types flow forward and nothing compiles against a stale shape.

1. **`packages/protocol/src/api.ts`** — request/response Zod schemas, exported as `const X` plus `type X = z.infer<typeof X>`. Use branded ids (`Sha256`, `VaultId`, `DeviceId`, `Seq`, `VaultPath`). New error cases go into `ErrorCode`, then into `STATUS` in `apps/worker/src/http.ts`.
2. **`apps/worker/src/store.ts`** — synchronous Drizzle queries only. No `await`, no R2, no `fetch`: everything here must be callable inside `transactionSync`.
3. **`apps/worker/src/vault-do.ts`** — a public method that takes `token` first and wraps its body in `this.authed(token, ...)`. Return `RpcResult<T>`; never throw for expected failures. Mark it in the `retryable(...)` block only if running it twice is harmless.
4. **`apps/worker/src/routes/*.ts`** — validate with `validate(target, Schema)`, call the stub once, return `c.json(unwrap(result))`. One DO call per request; a second call needs a reason (see the `do-cost-review` skill).
5. **`apps/worker/test/*.test.ts`** — cover the happy path, the auth failure and each new error code through `exports.default.fetch`.

Then run the `verify` skill.

Rules that keep this layering intact:
- The Worker never writes to R2 before `vault.authorize(token)` or another authed call has succeeded.
- Request bodies stream to R2; never `arrayBuffer()` or `text()` an upload.
- Validate external input with Zod at the edge; inside, trust the types.
