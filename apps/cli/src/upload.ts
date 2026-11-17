import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { MULTIPART_PART_BYTES, SINGLE_PUT_MAX_BYTES, type UploadedPart } from "@vault-sync/protocol";
import { withRetry, type ApiClient } from "./client.ts";
import type { LocalFile } from "./scan.ts";

const CONCURRENCY = 4;

function fileStream(absPath: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(absPath, range));
}

function partRanges(size: number): { number: number; start: number; end: number }[] {
  return Array.from({ length: Math.ceil(size / MULTIPART_PART_BYTES) }, (_, i) => ({
    number: i + 1,
    start: i * MULTIPART_PART_BYTES,
    end: Math.min((i + 1) * MULTIPART_PART_BYTES, size) - 1,
  }));
}

async function uploadMultipart(client: ApiClient, file: LocalFile): Promise<void> {
  const uploadId = await withRetry(() => client.createUpload(file.hash));
  const parts: UploadedPart[] = [];
  for (const { number, start, end } of partRanges(file.size)) {
    const upload = () =>
      client.uploadPart(file.hash, { uploadId, number, stream: fileStream(file.absPath, { start, end }), size: end - start + 1 });
    parts.push(await withRetry(upload));
  }
  await withRetry(() => client.completeUpload(file.hash, uploadId, { size: file.size, parts }));
}

async function uploadOne(client: ApiClient, file: LocalFile): Promise<void> {
  if (await withRetry(() => client.hasBlob(file.hash))) return;
  if (file.size > SINGLE_PUT_MAX_BYTES) {
    await uploadMultipart(client, file);
    return;
  }
  await withRetry(() => client.putBlob(file.hash, fileStream(file.absPath), file.size));
}

/** Uploads each missing hash once, `CONCURRENCY` at a time. */
export async function uploadMissing(
  client: ApiClient,
  missing: readonly string[],
  byHash: ReadonlyMap<string, LocalFile>,
): Promise<void> {
  const queue = missing.flatMap((hash) => {
    const file = byHash.get(hash);
    return file ? [file] : [];
  });
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let file = queue.shift(); file; file = queue.shift()) await uploadOne(client, file);
  });
  await Promise.all(workers);
}
