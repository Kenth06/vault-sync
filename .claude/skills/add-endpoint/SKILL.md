---
name: add-endpoint
description: Adds or changes an HTTP endpoint in the vault-sync API end to end (protocol schema, store, Durable Object RPC, service, controller, client, test). Use when the API surface or a Durable Object method changes.
---

Change the layers in this order so types flow forward and nothing compiles against a stale shape.

1. **Contract** — `packages/protocol/src/<domain>.schema.ts`. Export `const X` plus `type X = z.infer<typeof X>`. Use branded ids. A new error case reuses an existing `ERR_*` code unless clients must branch on it; a new code goes in `envelope.schema.ts` and in `STATUS` in `apps/api/src/common/errors.ts`.
2. **Entity** (only for new tables or columns) — `apps/api/src/entities/<table>.entity.ts`, export from `index.ts`, then `pnpm --filter @vault-sync/api db:generate`.
3. **Store** — `apps/api/src/durable-objects/vault.store.ts`. Synchronous Drizzle only: no `await`, no R2, no `fetch`.
4. **Durable Object** — `vault.durable-object.ts`. A public method that takes `token` first and wraps its body in `this.authed(token, ...)`. Return `RpcResult<T>` with `ok`/`fail`; never throw for expected failures. Add it to `retryable(...)` only if running it twice is harmless.
5. **Service** — `apps/api/src/services/<domain>.service.ts`, extending `BaseService`. Call the stub once and `this.unwrap(...)` the result. R2 work lives here.
6. **Controller** — `apps/api/src/controllers/<domain>.controller.ts`. `validate(target, schema)`, call `c.var.container.<service>`, return `c.json({ data })`. API-only param/header schemas go in `apps/api/src/schemas/`.
7. **Client** — `apps/cli/src/clients/api.client.ts`, parsing the response with `parseData(Schema, body)`.
8. **Tests** — `apps/api/test/<topic>.test.ts`: happy path, auth failure, each error code, through `exports.default.fetch` with `readData`/`readErrorCode`.

Then run the `verify` skill.

Invariants:

- No R2 write before an authed Durable Object call has succeeded.
- One DO request per API call; a second one needs a reason (see `do-cost-review`).
- Request bodies stream to R2; never `arrayBuffer()` or `text()` an upload.
- Zero comments: if something needs explaining, rename it, split it, or record the decision in `docs/decisions.md`.
