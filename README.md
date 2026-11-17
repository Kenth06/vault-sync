# vault-sync

Backs up an Obsidian vault to your own Cloudflare account. A daemon on the PC that holds the vault pushes every change to a Worker. The Worker stores the bytes in R2 (content-addressed by SHA-256) and the vault index in one SQLite Durable Object per vault.

v1 is a one-way push from the source PC plus restore. Multi-device sync is phase F3.

## Status

| Phase | Scope | State |
|---|---|---|
| F0 | Monorepo, shared protocol, Worker skeleton, enroll | done |
| F1 | plan → upload → commit, multipart, CLI daemon | Worker done, CLI in progress |
| F2 | Snapshots, GC, restore, log, revoke | — |
| F3 | Pull, hibernated WebSocket, conflicts | — |

## Setup

```sh
pnpm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # set ADMIN_SECRET
pnpm dev                                                   # wrangler dev on :8787
```

Deploy:

```sh
cd apps/worker
pnpm exec wrangler r2 bucket create vault-sync
pnpm exec wrangler secret put ADMIN_SECRET
pnpm deploy
```

Then set spend limits and alerts: see [docs/costs.md](docs/costs.md).

## Development

```sh
pnpm lint        # oxlint, then type-aware ESLint
pnpm typecheck
pnpm test        # Worker tests run in workerd with local DO + R2
```

Conventions and architecture rules: [AGENTS.md](AGENTS.md). Design records: [docs/decisions.md](docs/decisions.md).
