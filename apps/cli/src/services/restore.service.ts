import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, realpath, rename, rm, utimes } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { normalizeVaultPath, type TreeEntry } from "@vault-sync/protocol";

import { withRetry, type ApiClient } from "../clients/api.client.ts";
import { TMP_SUFFIX, UPLOAD_CONCURRENCY } from "../common/constants.ts";
import { ApiError } from "../common/errors.ts";

const NOT_FOUND = 404;
const MS_PER_SECOND = 1000;

export interface RestoreReport {
  readonly restored: TreeEntry[];
  readonly missing: string[];
}

function lexicalTarget(root: string, vaultPath: string): string {
  const normalized = normalizeVaultPath(vaultPath);
  if (!normalized.ok) throw new Error(`refusing unsafe path from server: ${vaultPath}`);
  return path.resolve(root, normalized.path);
}

async function assertInside(root: string, dir: string): Promise<void> {
  const [realRoot, realDir] = await Promise.all([realpath(root), realpath(dir)]);
  if (realDir !== realRoot && !realDir.startsWith(realRoot + path.sep)) {
    throw new Error(`refusing to write through a link outside the vault: ${dir}`);
  }
}

function hashingStream(hash: ReturnType<typeof createHash>): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
}

export async function downloadVerified(client: ApiClient, entry: TreeEntry, target: string): Promise<void> {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}${TMP_SUFFIX}`);
  const hash = createHash("sha256");
  const body = await withRetry(() => client.blobContent(entry.hash));
  try {
    await pipeline(Readable.fromWeb(body), hashingStream(hash), createWriteStream(tmp, { flags: "wx" }));
    if (hash.digest("hex") !== entry.hash)
      throw new Error(`${entry.path}: downloaded bytes do not match ${entry.hash}`);
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  const seconds = entry.mtime / MS_PER_SECOND;
  await utimes(target, seconds, seconds);
}

async function restoreOne(client: ApiClient, root: string, entry: TreeEntry): Promise<boolean> {
  const target = lexicalTarget(root, entry.path);
  await mkdir(path.dirname(target), { recursive: true });
  await assertInside(root, path.dirname(target));
  try {
    await downloadVerified(client, entry, target);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === NOT_FOUND) return false;
    throw error;
  }
}

export async function restoreFiles(
  client: ApiClient,
  root: string,
  files: readonly TreeEntry[],
): Promise<RestoreReport> {
  const queue = [...files];
  const restored: TreeEntry[] = [];
  const missing: string[] = [];
  const failures: unknown[] = [];
  const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
    for (let entry = queue.shift(); entry && failures.length === 0; entry = queue.shift()) {
      try {
        if (await restoreOne(client, root, entry)) restored.push(entry);
        else missing.push(entry.path);
      } catch (error) {
        failures.push(error);
      }
    }
  });
  await Promise.all(workers);
  if (failures.length > 0) throw failures[0];
  return { restored, missing: missing.toSorted() };
}
