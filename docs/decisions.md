# Decisions

Short records of choices that are not obvious from the code. Newest first.

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
