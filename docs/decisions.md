# Decisions

Short records of choices that are not obvious from the code. Source files carry no comments, so the reasons live here. Newest first.

## 2026-11-17 — Blob existence check is a GET route

Hono answers `HEAD` with the matching `GET` handler and never reaches `.on("HEAD")`, so `/v1/blobs/:sha256` is registered as `GET` and returns an empty body with 200 or 404. Both methods work. The check runs as one DO call (`claimBlob`): auth first, then the R2 lookup from inside the DO.

## 2026-11-17 — Devices of one vault are trusted with its blobs

Blob keys are global and multipart uploads cannot be checksummed as a whole, so the API refuses to start or complete a multipart upload for a hash that already exists. That stops overwrites of stored bytes; a device can still upload wrong bytes under a new hash, which only affects its own vault's manifest. All devices belong to one owner.

## 2026-11-17 — Layered structure from the house standard, on Hono

Folders by layer with suffixes (`controllers/`, `services/`, `entities/`, `schemas/`, `middlewares/`, `utils/`), a typed `di.ts` with constructor injection, `{ data }` responses and `{ error, code: "ERR_*" }` errors. The parts of the standard tied to one project (Effect v4, Awilix, D1 CRUD base service) are left out; see the deviation table in `AGENTS.md`.

## 2026-11-17 — `oxlint-disable` on `retryable(...)`

`apps/api/src/durable-objects/vault.durable-object.ts` passes prototype methods to Cloudflare's `retryable()`, which tags them by reference and never calls them, so `typescript/unbound-method` is a false positive there.

## 2026-11-17 — Store is separate from the Durable Object

`VaultStore` holds every SQLite query and is fully synchronous, so a commit runs inside `transactionSync` with no `await` between related writes. `VaultDO` keeps only RPC, auth, rate limiting and R2 lookups.

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
