import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, utimes } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { TreeEntry } from "@vault-sync/protocol";
import { ApiError, withRetry } from "@vault-sync/sync-core";

import type { ApiClient } from "../clients/api.client.ts";
import { TMP_SUFFIX, UPLOAD_CONCURRENCY } from "../common/constants.ts";
import { assertInside, lexicalTarget } from "./fs-safety.ts";

const NOT_FOUND = 404;
const MS_PER_SECOND = 1000;

export interface RestoreReport {
  readonly restored: TreeEntry[];
  readonly missing: string[];
}

function hashingStream(hash: ReturnType<typeof createHash>): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
}

export async function downloadVerified(
  client: Pick<ApiClient, "blobContent">,
  entry: TreeEntry,
  target: string,
  beforeReplace?: () => Promise<void>,
): Promise<void> {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}${TMP_SUFFIX}`);
  const hash = createHash("sha256");
  const body = await withRetry(() => client.blobContent(entry.hash));
  try {
    await pipeline(Readable.fromWeb(body), hashingStream(hash), createWriteStream(tmp, { flags: "wx" }));
    if (hash.digest("hex") !== entry.hash)
      throw new Error(`${entry.path}: downloaded bytes do not match ${entry.hash}`);
    await beforeReplace?.();
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
