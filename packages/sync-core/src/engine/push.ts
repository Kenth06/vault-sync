import {
  BatchId,
  MULTIPART_PART_BYTES,
  SINGLE_PUT_MAX_BYTES,
  Seq,
  type Change,
  type UploadedPart,
} from "@vault-sync/protocol";

import { UPLOAD_CONCURRENCY } from "../constants.ts";
import { withRetry } from "../errors.ts";
import { diffTrees, toBatches } from "../plan/diff.ts";
import type { ByteRange, LocalFile, PushReport, SyncEnvironment } from "../types.ts";
import { scanAll } from "./scan.ts";

interface PartRange extends ByteRange {
  readonly number: number;
}

function partRanges(size: number): PartRange[] {
  return Array.from({ length: Math.ceil(size / MULTIPART_PART_BYTES) }, (_, i) => ({
    number: i + 1,
    start: i * MULTIPART_PART_BYTES,
    end: Math.min((i + 1) * MULTIPART_PART_BYTES, size) - 1,
  }));
}

async function uploadMultipart(env: SyncEnvironment, file: LocalFile): Promise<void> {
  const uploadId = await withRetry(() => env.remote.createUpload(file.hash));
  const parts: UploadedPart[] = [];
  for (const range of partRanges(file.size)) {
    const send = async () =>
      env.remote.uploadPart(file.hash, {
        uploadId,
        number: range.number,
        content: await env.files.read(file.path, range),
        size: range.end - range.start + 1,
      });
    parts.push(await withRetry(send));
  }
  await withRetry(() => env.remote.completeUpload(file.hash, uploadId, { size: file.size, parts }));
}

async function uploadOne(env: SyncEnvironment, file: LocalFile): Promise<void> {
  if (await withRetry(() => env.remote.hasBlob(file.hash))) return;
  if (file.size > SINGLE_PUT_MAX_BYTES) {
    await uploadMultipart(env, file);
    return;
  }
  await withRetry(async () => env.remote.putBlob(file.hash, await env.files.read(file.path), file.size));
}

async function uploadMissing(
  env: SyncEnvironment,
  missing: readonly string[],
  byHash: ReadonlyMap<string, LocalFile>,
): Promise<void> {
  const queue = missing.flatMap((hash) => {
    const file = byHash.get(hash);
    return file ? [file] : [];
  });
  const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
    for (let file = queue.shift(); file; file = queue.shift()) await uploadOne(env, file);
  });
  await Promise.all(workers);
}

async function pushBatch(
  env: SyncEnvironment,
  changes: Change[],
  byHash: ReadonlyMap<string, LocalFile>,
): Promise<void> {
  const baseCursor = env.store.cursor();
  const base = Seq.parse(baseCursor);
  const plan = await withRetry(() => env.remote.plan({ baseCursor: base, changes }));
  await uploadMissing(env, plan.missing, byHash);
  const batchId = BatchId.parse(crypto.randomUUID());
  const result = await withRetry(() => env.remote.commit({ batchId, baseCursor: base, changes }));
  const contiguous = result.seqFrom === baseCursor + 1 && result.seqTo !== null;
  await env.store.applyCommitted(changes, contiguous ? (result.seqTo ?? baseCursor) : baseCursor);
}

export async function pushOnce(env: SyncEnvironment): Promise<PushReport> {
  const files = await scanAll(env);
  const changes = diffTrees(files, env.store.synced());
  const batches = toBatches(changes);
  const byHash = new Map([...files.values()].map((f) => [f.hash, f]));
  for (const batch of batches) await pushBatch(env, batch, byHash);
  return { changes: changes.length, batches: batches.length };
}
