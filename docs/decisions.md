# Decisions

Short records of choices that are not obvious from the code. Source files carry no comments, so the reasons live here. Newest first.

## 2026-11-17 — Optimistic concurrency with baseHash

Every change a client pushes carries `baseHash`: the hash this device last synced for that path (`null` when it believes the path is absent). The commit compares it with the server's current hash inside the same transaction and rejects the whole batch with `ERR_CONFLICT` and `{ conflicts }` if any differs, so a commit never overwrites a version its author has not seen. A rename also requires its source to still hold the moved bytes. Changes without `baseHash` (older clients) are accepted as before. A batch may touch each path only once, so the check against pre-batch state is unambiguous.

## 2026-11-17 — Pull, then push; conflicts become copies

`sync` pulls first, then pushes. Pull reads `/changes` from the local cursor, reduces it to the latest remote state per path, and compares remote, last-synced and on-disk hashes for each path. Untouched local files take the remote version. Files changed on both sides keep the server version at the original path and move the local version to `<name> (conflicto <host> <YYYY-MM-DD HHmm>).<ext>`, which the next push uploads as a new file. A file deleted remotely but edited locally is kept, and a file deleted locally but edited remotely is written back (an edit beats a delete). When a push is rejected for a stale base, the client pulls and retries once.

Pull never overwrites unseen local work: right before replacing or deleting a file it compares size and mtime with a snapshot taken before the download, and if the file changed it moves it to a conflict copy first. Conflict copies get a numeric suffix when the name is taken. Paths excluded by `.vaultsyncignore`, anything under `.vaultsync/`, temporary download files and names Windows cannot store are never written. On case-insensitive filesystems (Windows, macOS) a case-only rename is applied as a rename, not as write-then-delete. A remote change whose blob is gone is skipped and reported; any other failure leaves the cursor where it was so the next sync retries. Every version also stays in the server history.

Renames arriving from another device reuse the local bytes (copy, then delete) instead of downloading them again.

## 2026-11-17 — Cursor advances only over contiguous commits

After a push the client moves its cursor to the batch's last sequence only if the batch started right after the cursor. Otherwise another device committed in between and the next pull must fetch those changes; the client's own changes come back in that pull and are adopted without touching disk.

## 2026-11-17 — Live updates over a hibernatable WebSocket

`GET /v1/vaults/:id/ws` upgrades to a WebSocket accepted with the Durable Object hibernation API and tagged with the device id. The token travels as a second `Sec-WebSocket-Protocol` value next to `vaultsync.v1`, because the WebSocket API cannot set headers; the server echoes only `vaultsync.v1`. Each commit broadcasts `{ type: "changed", cursor, deviceId }`; `watch` ignores its own events and schedules a sync 500 ms after a remote one. Clients send `ping` every 30 s and the runtime answers `pong` without waking the object. Revoking a device closes its sockets with code 4001. A connection that fails before opening triggers one authenticated status request; if that says the device is unauthorized or revoked, the client stops reconnecting. A rate-limited upgrade answers 429 with `Retry-After`. Reconnects back off exponentially with jitter, and the client closes a socket that misses two pongs. On every (re)connect the client syncs once, to catch up on commits made while it was offline.

## 2026-11-17 — No invocation logs

`observability.logs.invocation_logs` is off. Invocation logs can record request headers, and the WebSocket upgrade carries the device token in `Sec-WebSocket-Protocol`. The structured `console.*` logs the code writes stay on and never include tokens.

## 2026-11-17 — Blob keys are scoped per vault (spec deviation)

The spec stored blobs under a global key so two vaults could share one PDF. Garbage collection makes that unsafe: each vault's Durable Object only knows its own references, so vault A's GC could delete bytes vault B still uses. Keys are now `vaults/<vaultId>/blobs/<ab>/<cd>/<hash>`. Cross-vault deduplication is lost, which matters little for one owner with one or two vaults; dedupe inside a vault (renames, copies, unchanged files) is unchanged. A global reference registry was the alternative and would add a second Durable Object to every commit.

## 2026-11-17 — Tree at any cursor comes from the change log

`GET /tree?at=<seq>` takes, for each path, its last change at or before `seq`, and drops paths that were deleted or renamed away by then. `changes` stores `size` and `mtime` so a restored file gets its original timestamps. Snapshots are not needed for this while the log is complete; they exist for retention and as the input to garbage collection. When log compaction arrives, `tree?at` will start from the newest snapshot at or before `seq`.

## 2026-11-17 — Garbage collection keeps anything a retained snapshot might need

Each blob records the cursor where it was first referenced (`ref_since_seq`) and where it last became unreferenced (`orphaned_seq`). A blob is deleted only when it has no references, its grace period (`GC_GRACE_MS`, 7 days) has passed, and no retained snapshot has a cursor inside that interval. The interval is never narrowed when a blob is re-referenced, so the rule can keep a blob longer than needed but never deletes one a snapshot still points at. The deletion runs inside `blockConcurrencyWhile`, and rows are removed only while `refs` is still 0, so a commit or upload cannot reuse a blob in the middle of its deletion. Point-in-time restore is therefore guaranteed for the grace period and for every retained snapshot; older cursors may report missing files. The F2 migration backfills `ref_since_seq` and `orphaned_seq` from the change log for blobs that existed before it.

## 2026-11-17 — Alarms only when there is work

A commit schedules the daily snapshot alarm if none is pending. The alarm writes a snapshot only if the cursor moved, prunes by retention (newest per day for 30 days, newest per month for 12 months), collects garbage in batches of 1000, and reschedules only while commits are unsnapshotted or unprotected orphans are still in their grace period, at most once a day (or after a minute when a GC batch was full). Orphans protected by a retained snapshot do not wake the vault: they can only become collectable when a newer snapshot prunes the old one, and that happens on a run that already exists. The alarm sets a 24-hour fallback before doing any work, so a run that keeps failing does not lose the schedule. An idle vault ends with no alarm.

## 2026-11-17 — Timestamp-only changes are not synced

The scanner hashes a file whose size or mtime changed and the diff compares hashes, so touching a file without changing its bytes sends nothing. Restored files get the mtime of their last content change.

## 2026-11-17 — Restore enrolls a new device

`vaultsync restore` works on a machine that has nothing but the Worker URL and the admin secret. It enrolls a device named `<host>-restore`, writes files to a temporary name, verifies each SHA-256 before renaming into place, and sets the original mtime. It refuses a non-empty directory without `--force`, refuses to write through a link that leaves the directory, stops at the first failed file, and revokes the device it enrolled if the restore fails. Downloads honor `Retry-After` when the rate limiter answers 429. Afterwards the directory is a linked vault whose synced manifest is the restored tree; restoring an older cursor prints a warning, because pushing from it applies edits on top of the current vault rather than rolling it back.

## 2026-11-17 — Blob existence check is a GET route

Hono answers `HEAD` with the matching `GET` handler and never reaches `.on("HEAD")`, so `/v1/blobs/:sha256` is registered as `GET` and returns an empty body with 200 or 404. Both methods work. The check runs as one DO call (`claimBlob`): auth first, then the R2 lookup from inside the DO.

## 2026-11-17 — Devices of one vault are trusted with its blobs

Blob keys are scoped per vault, and multipart uploads cannot be checksummed as a whole, so the API refuses to start or complete a multipart upload for a hash that already exists in the vault. That stops overwrites of stored bytes; a device can still upload wrong bytes under a new hash, which only affects that vault. All devices belong to one owner.

## 2026-11-17 — Layered structure from the house standard, on Hono

Folders by layer with suffixes (`controllers/`, `services/`, `entities/`, `schemas/`, `middlewares/`, `utils/`), a typed `di.ts` with constructor injection, `{ data }` responses and `{ error, code: "ERR_*" }` errors. The parts of the standard tied to one project (Effect v4, Awilix, D1 CRUD base service) are left out; see the deviation table in `AGENTS.md`.

## 2026-11-17 — `oxlint-disable` on `retryable(...)`

`apps/api/src/durable-objects/vault.durable-object.ts` passes prototype methods to Cloudflare's `retryable()`, which tags them by reference and never calls them, so `typescript/unbound-method` is a false positive there.

## 2026-11-17 — Store is separate from the Durable Object

The stores in `durable-objects/stores/` hold every SQLite query and are fully synchronous, so a commit runs inside `transactionSync` with no `await` between related writes. `VaultDO` keeps RPC, auth, rate limiting and R2 lookups; `VaultMaintenance` holds the alarm work.

## 2026-11-17 — Re-stat after hashing in the CLI

Obsidian saves often; a file can change while it is hashed. The scanner compares size and mtime before and after hashing and retries up to three times.

## 2026-11-17 — Rename detection on the client

A path that disappears and a new path with the same hash in one scan become a `rename`, so moving a folder of notes uploads nothing.

## 2026-11-17 — Token carries vault and device ids

`vs1.<vaultId>.<deviceId>.<secret>`. The Worker routes to the vault's DO from the token alone, with no global registry (no KV, no extra DO). Only `SHA-256(token)` is stored.

## 2026-11-17 — Auth inside each RPC

Each device-facing DO method takes the token and verifies it in the same call. A separate `authenticate()` RPC would double billable DO requests.

## 2026-11-17 — Multipart blobs are not checksummed as a whole

R2 verifies SHA-256 on single PUTs (≤ 90 MB) but cannot checksum a completed multipart object. For files above 90 MB the guards are the client-side hash and a size check on completion. Revisit if R2 adds whole-object checksums for multipart.

## 2026-11-17 — `exports` instead of `migrations`

Durable Object classes are declared with the declarative `exports` field (Cloudflare, 2026-06-30). The two mechanisms cannot be mixed in one Worker.

## 2026-11-17 — Three primitives

Worker + Durable Object (SQLite) + R2. D1 duplicates the DO's SQLite; KV, Queues and Workflows have no job in v1. See the spec for the full table.
