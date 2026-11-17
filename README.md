# vault-sync

Backs up an Obsidian vault to your own Cloudflare account. A daemon on the PC that holds the vault pushes every change to a Worker. The Worker stores the bytes in R2 (content-addressed by SHA-256) and the vault index in one SQLite Durable Object per vault.

v1 is a one-way push from the source PC plus restore. Multi-device sync is phase F3.

## Status

| Phase | Scope                                           | State |
| ----- | ----------------------------------------------- | ----- |
| F0    | Monorepo, shared protocol, API skeleton, enroll | done  |
| F1    | plan → upload → commit, multipart, CLI daemon   | done  |
| F2    | Snapshots, GC, restore, log, revoke             | done  |
| F3    | Pull, hibernated WebSocket, conflicts           | next  |

## Setup

```sh
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # set ADMIN_SECRET
pnpm dev                                           # wrangler dev on :8787
```

Use the CLI against it:

```sh
cd apps/cli
node src/main.ts init <vault-dir> --url http://127.0.0.1:8787 --vault-id my-vault
node src/main.ts watch <vault-dir>
```

| Command                                     | What it does                                                      |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `init <dir> --url --vault-id`               | Enroll this device and link a vault (admin secret)                |
| `push [dir]` / `watch [dir]`                | Sync once / continuously                                          |
| `status [dir]`                              | Local vs remote cursor, last sync, last error                     |
| `log <path> [dir]`                          | Versions of a file; `--version <seq> [--out <file>]` recovers one |
| `snapshots [dir]`                           | List snapshots; `--create` takes one now                          |
| `restore <dir> --url --vault-id [--at <seq> | --snapshot <seq>]`                                                | Rebuild a vault into an empty directory, original mtimes included |
| `devices [dir]` / `revoke <deviceId> [dir]` | List devices / revoke one immediately (admin secret)              |

`VAULTSYNC_ADMIN_SECRET` skips the admin secret prompt.

Deploy:

```sh
cd apps/api
pnpm exec wrangler r2 bucket create vault-sync
pnpm exec wrangler secret put ADMIN_SECRET
pnpm deploy
```

Then set spend limits and alerts: see [docs/costs.md](docs/costs.md).

## Development

```sh
pnpm format   # oxfmt
pnpm verify   # format check, type-aware oxlint, zero comments, types, tests
pnpm knip     # unused code
```

Structure, conventions and the deviations from the house standard: [AGENTS.md](AGENTS.md). Design records: [docs/decisions.md](docs/decisions.md).
