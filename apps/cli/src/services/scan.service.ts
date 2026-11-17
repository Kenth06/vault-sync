import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { normalizeVaultPath } from "@vault-sync/protocol";

import { MAX_HASH_ATTEMPTS } from "../common/constants.ts";
import type { FileMeta, LocalFile } from "../common/types.ts";
import type { LocalState } from "../storage/local-state.ts";
import type { IgnoreFn } from "../utils/ignore.ts";

async function sha256File(absPath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(absPath), hash);
  return hash.digest("hex");
}

async function stableHash(absPath: string): Promise<FileMeta | null> {
  for (let attempt = 0; attempt < MAX_HASH_ATTEMPTS; attempt += 1) {
    const before = await stat(absPath);
    const hash = await sha256File(absPath);
    const after = await stat(absPath);
    if (before.size === after.size && before.mtimeMs === after.mtimeMs) {
      return { hash, size: after.size, mtime: Math.trunc(after.mtimeMs) };
    }
  }
  return null;
}

async function hashWithCache(state: LocalState, vaultPath: string, absPath: string): Promise<FileMeta | null> {
  const info = await stat(absPath);
  const mtime = Math.trunc(info.mtimeMs);
  const cached = state.cachedHash(vaultPath, info.size, mtime);
  if (cached !== null) return { hash: cached, size: info.size, mtime };
  const meta = await stableHash(absPath);
  if (meta) state.saveHash(vaultPath, meta);
  return meta;
}

async function listVaultPaths(root: string, isIgnored: IgnoreFn): Promise<Map<string, string>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const paths = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absPath = path.join(entry.parentPath, entry.name);
    const normalized = normalizeVaultPath(path.relative(root, absPath));
    if (normalized.ok && !isIgnored(normalized.path)) paths.set(normalized.path, absPath);
  }
  return paths;
}

export async function scanVault(root: string, isIgnored: IgnoreFn, state: LocalState): Promise<Map<string, LocalFile>> {
  const files = new Map<string, LocalFile>();
  for (const [vaultPath, absPath] of await listVaultPaths(root, isIgnored)) {
    const meta = await hashWithCache(state, vaultPath, absPath).catch(() => null);
    if (meta) files.set(vaultPath, { ...meta, path: vaultPath, absPath });
  }
  return files;
}
