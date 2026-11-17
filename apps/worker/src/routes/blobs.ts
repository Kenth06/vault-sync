import { Hono } from "hono";
import { blobKey, CompleteUploadRequest, SINGLE_PUT_MAX_BYTES, Sha256 } from "@vault-sync/protocol";
import { z } from "zod";
import { deviceAuth, type AppEnv } from "../auth.js";
import { AppError, unwrap } from "../http.js";
import { validate } from "../validate.js";

const HashParam = z.object({ sha256: Sha256 });
const PartParam = HashParam.extend({
  uploadId: z.string().min(1),
  part: z.coerce.number().int().min(1).max(10_000),
});

function contentLength(header: string | undefined): number {
  const n = Number(header);
  if (header === undefined || !Number.isSafeInteger(n) || n < 0) {
    throw new AppError("bad_request", "Content-Length is required");
  }
  return n;
}

function requireBody(body: ReadableStream | null): ReadableStream {
  if (body === null) throw new AppError("bad_request", "request body is required");
  return body;
}

/**
 * Blob bytes stream straight from the request into R2; the Worker never
 * buffers them (128 MB memory limit). Every write is preceded by a token check.
 */
export const blobs = new Hono<AppEnv>()
  .use("*", deviceAuth)

  // Exists? A hit is registered in this vault, so a later commit needs no R2 lookup.
  .on("HEAD", "/:sha256", validate("param", HashParam), async (c) => {
    const { vault, token } = c.var.auth;
    const { sha256 } = c.req.valid("param");
    const head = await c.env.BUCKET.head(blobKey(sha256));
    if (head) {
      unwrap(await vault.registerBlob(token, sha256, head.size));
      return c.body(null, 200);
    }
    unwrap(await vault.authorize(token));
    return c.body(null, 404);
  })

  .put("/:sha256", validate("param", HashParam), async (c) => {
    const { vault, token } = c.var.auth;
    const { sha256 } = c.req.valid("param");
    const size = contentLength(c.req.header("Content-Length"));
    if (size > SINGLE_PUT_MAX_BYTES) throw new AppError("payload_too_large", "use multipart above 90 MB");

    unwrap(await vault.authorize(token));
    const key = blobKey(sha256);
    const existing = await c.env.BUCKET.head(key);
    if (existing) {
      unwrap(await vault.registerBlob(token, sha256, existing.size));
      return c.json({ stored: false, size: existing.size });
    }

    let object: R2Object;
    try {
      // R2 verifies the checksum server side and rejects the write on mismatch.
      object = await c.env.BUCKET.put(key, requireBody(c.req.raw.body), {
        sha256,
        customMetadata: { size: String(size) },
      });
    } catch (err) {
      throw new AppError("checksum_mismatch", "body does not match its sha256", String(err));
    }
    unwrap(await vault.registerBlob(token, sha256, object.size));
    return c.json({ stored: true, size: object.size }, 201);
  })

  .post("/:sha256/uploads", validate("param", HashParam), async (c) => {
    const { vault, token } = c.var.auth;
    unwrap(await vault.authorize(token));
    const upload = await c.env.BUCKET.createMultipartUpload(blobKey(c.req.valid("param").sha256));
    return c.json({ uploadId: upload.uploadId }, 201);
  })

  .put("/:sha256/uploads/:uploadId/:part", validate("param", PartParam), async (c) => {
    const { vault, token } = c.var.auth;
    const { sha256, uploadId, part } = c.req.valid("param");
    const size = contentLength(c.req.header("Content-Length"));
    if (size > SINGLE_PUT_MAX_BYTES) throw new AppError("payload_too_large", "part too large");

    unwrap(await vault.authorize(token));
    const upload = c.env.BUCKET.resumeMultipartUpload(blobKey(sha256), uploadId);
    const uploaded = await upload.uploadPart(part, requireBody(c.req.raw.body));
    return c.json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
  })

  .post(
    "/:sha256/uploads/:uploadId/complete",
    validate("param", HashParam.extend({ uploadId: z.string().min(1) })),
    validate("json", CompleteUploadRequest),
    async (c) => {
      const { vault, token } = c.var.auth;
      const { sha256, uploadId } = c.req.valid("param");
      const { size, parts } = c.req.valid("json");

      unwrap(await vault.authorize(token));
      const upload = c.env.BUCKET.resumeMultipartUpload(blobKey(sha256), uploadId);
      const object = await upload.complete(parts);
      if (object.size !== size) {
        await c.env.BUCKET.delete(object.key);
        throw new AppError("checksum_mismatch", `expected ${size} bytes, got ${object.size}`);
      }
      // R2 cannot checksum a multipart object as a whole; the size check plus the
      // client-side hash are the guard here. See docs/decisions.md.
      unwrap(await vault.registerBlob(token, sha256, object.size));
      return c.json({ stored: true, size: object.size }, 201);
    },
  );
