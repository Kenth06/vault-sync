import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { MULTIPART_PART_BYTES, SINGLE_PUT_MAX_BYTES, type UploadedPart } from "@vault-sync/protocol";

import { withRetry, type ApiClient } from "../clients/api.client.ts";
import { UPLOAD_CONCURRENCY } from "../common/constants.ts";
import type { LocalFile } from "../common/types.ts";

interface PartRange {
  readonly number: number;
  readonly start: number;
  readonly end: number;
}

function fileStream(absPath: string, range?: PartRange): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(absPath, range && { start: range.start, end: range.end }));
}

function partRanges(size: number): PartRange[] {
  return Array.from({ length: Math.ceil(size / MULTIPART_PART_BYTES) }, (_, i) => ({
    number: i + 1,
    start: i * MULTIPART_PART_BYTES,
    end: Math.min((i + 1) * MULTIPART_PART_BYTES, size) - 1,
  }));
}

async function uploadMultipart(client: ApiClient, file: LocalFile): Promise<void> {
  const uploadId = await withRetry(() => client.createUpload(file.hash));
  const parts: UploadedPart[] = [];
  for (const range of partRanges(file.size)) {
    const send = () =>
      client.uploadPart(file.hash, {
        uploadId,
        number: range.number,
        stream: fileStream(file.absPath, range),
        size: range.end - range.start + 1,
      });
    parts.push(await withRetry(send));
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

export async function uploadMissing(
  client: ApiClient,
  missing: readonly string[],
  byHash: ReadonlyMap<string, LocalFile>,
): Promise<void> {
  const queue = missing.flatMap((hash) => {
    const file = byHash.get(hash);
    return file ? [file] : [];
  });
  const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
    for (let file = queue.shift(); file; file = queue.shift()) await uploadOne(client, file);
  });
  await Promise.all(workers);
}
