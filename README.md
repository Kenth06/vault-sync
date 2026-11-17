# vault-sync

Backs up an Obsidian vault to your own Cloudflare account and lets you read it from any browser.

The PC that holds the vault pushes every change to a Worker. The Worker keeps the bytes in R2 (content-addressed by SHA-256) and the vault index, with the full history of every file, in one SQLite Durable Object per vault. Other devices can pull and edit the same vault; concurrent edits to one note keep both versions.

```txt
 Obsidian vault ── CLI daemon or plugin ──▶ API Worker (/v1) ──▶ Durable Object (index, history)
                                                │            └─▶ R2 (file bytes, snapshots)
 Browser ── viewer Worker (/api, cookie) ───────┘ service binding
```

## Status

| Phase | Scope                                           | State |
| ----- | ----------------------------------------------- | ----- |
| F0    | Monorepo, shared protocol, API skeleton, enroll | done  |
| F1    | plan → upload → commit, multipart, CLI daemon   | done  |
| F2    | Snapshots, GC, restore, log, revoke             | done  |
| F3    | Pull, hibernated WebSocket, conflicts           | done  |
| —     | Obsidian plugin on a shared sync engine         | done  |
| —     | Read-only web viewer                            | done  |

## Pieces

| Path                   | What it is                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/api`             | The API Worker: Hono, one SQLite Durable Object per vault, R2. Everything else talks to it.       |
| `apps/cli`             | `vaultsync`, a Node daemon that watches the vault folder and syncs it.                            |
| `apps/obsidian-plugin` | The same sync inside Obsidian, for devices where a daemon is awkward (a laptop, a second PC).     |
| `apps/web`             | A read-only viewer: notes, history, snapshots, live updates. Its own Worker, proxying to the API. |
| `packages/sync-core`   | The sync engine shared by the CLI and the plugin.                                                 |
| `packages/protocol`    | Zod schemas for every request and response, shared by all of the above.                           |

## 1. Deploy to your Cloudflare account

Needs a Workers Paid plan (see [docs/costs.md](docs/costs.md)) and `pnpm install` at the repo root.

```sh
cd apps/api
pnpm exec wrangler r2 bucket create vault-sync
pnpm exec wrangler secret put ADMIN_SECRET     # a long random string; keep it in your password manager
pnpm deploy                                    # → https://vault-sync.<your-subdomain>.workers.dev
cd ../web
pnpm deploy                                    # → https://vault-sync-web.<your-subdomain>.workers.dev
```

Deploy the API before the viewer: the viewer reaches it through a service binding. The admin secret is only used to enroll devices; each device then gets its own token.

Set spend limits and alerts once per account: [docs/costs.md](docs/costs.md).

## 2. Back up a vault from one PC

With the CLI (runs in the background, no Obsidian needed):

```sh
cd apps/cli
node src/main.ts init "<vault-dir>" --url https://vault-sync.<your-subdomain>.workers.dev --vault-id notes
node src/main.ts watch "<vault-dir>"
```

`init` asks for the admin secret once and stores the device token in the OS keychain. `watch` pushes every save within a few seconds and pulls changes from other devices live.

Or with the Obsidian plugin:

```sh
pnpm --filter @vault-sync/obsidian-plugin build
```

Copy `apps/obsidian-plugin/dist/main.js` and `manifest.json` into `<vault>/.obsidian/plugins/vault-sync/`, enable **Vault Sync** under Settings → Community plugins, enter the Worker URL and the vault id, and press **Connect…**. Requires Obsidian 1.11.4 or later. The token lives in Obsidian's secret storage; the plugin's `data.json` and `state.json` are never synced.

Under `.obsidian/` only settings (`app.json`, `appearance.json`, `hotkeys.json`, core and community plugin lists), `plugins/` and `snippets/` are synced; workspace layout and caches are not. `.git/` and `.trash/` are skipped too. Add your own gitignore-style rules to `.vaultsyncignore` at the vault root.

## 3. Read the vault in a browser

Open the viewer URL, enter the vault id and the admin secret. You get:

- the file tree with search, and notes rendered as in Obsidian (wikilinks, embedded images, frontmatter, task lists, tables);
- **History** on every file: each saved version, which device saved it, and the content of any old version;
- **Snapshots**: the whole vault as it was each day, browsable file by file, plus **Take snapshot**;
- live updates: a note edited on the PC refreshes in the open tab.

The viewer cannot change the vault. It enrolls a device called "Web viewer" whose token stays in an HttpOnly cookie, and its Worker only forwards read routes and snapshot creation. **Sign out of this browser** (the ⋯ menu) revokes that device.

## 4. Add another device

Run `init` with the CLI or **Connect…** in the plugin on the other device, with the same URL and vault id. It downloads the vault, then both stay in sync. If the same note is edited on both while one is offline, the server version keeps the original name and the other is saved next to it as `<name> (conflicto <device> <date>).md`.

## 5. Recover files

| Situation                     | Command                                                                   |
| ----------------------------- | ------------------------------------------------------------------------- |
| An older version of one note  | `log "<path>" --version <seq> --out <file>`, or **History** in the viewer |
| The whole vault at a snapshot | `restore <empty-dir> --url <api-url> --vault-id <id> --snapshot <seq>`    |
| The whole vault at any change | `restore <empty-dir> --url <api-url> --vault-id <id> --at <seq>`          |

`restore` writes into an empty directory and keeps the original modification times. The server keeps the last 30 daily snapshots and one per month for 12 months; file contents that no snapshot or recent history entry needs are deleted after a week.

## CLI reference

Run from `apps/cli` as `node src/main.ts <command>`. `[dir]` defaults to the current directory.

| Command                                      | What it does                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `init <dir> --url <api-url> --vault-id <id>` | Enroll this device and link a vault (asks for the admin secret)             |
| `watch [dir]`                                | Sync continuously; live updates from other devices                          |
| `sync [dir]`                                 | Pull remote changes, then push local ones, once                             |
| `push [dir]` / `pull [dir]`                  | One direction only                                                          |
| `status [dir]`                               | Local and remote cursor, last sync, last error                              |
| `log <path> [dir]`                           | Versions of a file; `--version <seq> [--out <file>]` recovers one           |
| `snapshots [dir]`                            | List snapshots; `--create` takes one now                                    |
| `restore <dir> --url --vault-id`             | Rebuild a vault into an empty directory; `--at <seq>` or `--snapshot <seq>` |
| `devices [dir]`                              | List the vault's devices (asks for the admin secret)                        |
| `revoke <deviceId> [dir]`                    | Revoke a device immediately (asks for the admin secret)                     |

`VAULTSYNC_ADMIN_SECRET` skips the admin secret prompt.

## Security

- Device tokens are 256-bit, stored only as SHA-256 on the server, and revocable one by one; a revoked device is disconnected at once.
- The admin secret only enrolls, lists and revokes devices. Nothing stores it.
- Paths are normalized and checked on both sides; nothing outside the vault folder is read or written.
- The viewer serves vault files with a sandbox CSP and `nosniff`, sanitizes rendered Markdown, and keeps its token out of reach of page scripts.

Details and the reasons behind them: [docs/decisions.md](docs/decisions.md).

## Local development

```sh
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # set ADMIN_SECRET
pnpm --filter @vault-sync/api dev                  # API on :8787
pnpm --filter @vault-sync/web build
pnpm --filter @vault-sync/web exec wrangler dev --port 8788   # viewer on :8788
```

Point the CLI or the plugin at `http://127.0.0.1:8787`.

```sh
pnpm format   # oxfmt
pnpm verify   # format check, type-aware oxlint, zero comments, types, tests
pnpm knip     # unused code
```

Structure, conventions and the deviations from the house standard: [AGENTS.md](AGENTS.md). Costs: [docs/costs.md](docs/costs.md).
