import { CompleteUploadRequest, SINGLE_PUT_MAX_BYTES } from "@vault-sync/protocol";
import { Hono } from "hono";

import { AppError } from "../common/errors.ts";
import type { DeviceEnv } from "../common/types/context.ts";
import { validate } from "../common/validation.ts";
import { requireDevice } from "../middlewares/auth.middleware.ts";
import { blobParamSchema, contentLengthSchema, partParamSchema, uploadParamSchema } from "../schemas/blob.schema.ts";

function streamedBody(body: ReadableStream | null, size: number): ReadableStream {
  if (body === null) throw new AppError("ERR_BAD_REQUEST", "request body is required");
  if (size > SINGLE_PUT_MAX_BYTES) throw new AppError("ERR_PAYLOAD_TOO_LARGE", "use multipart above 90 MB");
  return body;
}

export const blobController = new Hono<DeviceEnv>()
  .use("*", requireDevice)

  .get("/:sha256", validate("param", blobParamSchema), async (c) => {
    const exists = await c.var.container.blobService.exists(c.var.auth, c.req.valid("param").sha256);
    return c.body(null, exists ? 200 : 404);
  })

  .get("/:sha256/content", validate("param", blobParamSchema), async (c) => {
    const { sha256 } = c.req.valid("param");
    const blob = await c.var.container.blobService.content(c.var.auth, sha256);
    return new Response(blob.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(blob.size),
        ETag: `"${sha256}"`,
      },
    });
  })

  .put("/:sha256", validate("param", blobParamSchema), validate("header", contentLengthSchema), async (c) => {
    const size = c.req.valid("header")["content-length"];
    const data = await c.var.container.blobService.store(c.var.auth, {
      hash: c.req.valid("param").sha256,
      body: streamedBody(c.req.raw.body, size),
      size,
    });
    return c.json({ data }, data.stored ? 201 : 200);
  })

  .post("/:sha256/uploads", validate("param", blobParamSchema), async (c) => {
    const uploadId = await c.var.container.blobService.createUpload(c.var.auth, c.req.valid("param").sha256);
    return c.json({ data: { uploadId } }, 201);
  })

  .put(
    "/:sha256/uploads/:uploadId/:part",
    validate("param", partParamSchema),
    validate("header", contentLengthSchema),
    async (c) => {
      const { sha256, uploadId, part } = c.req.valid("param");
      const size = c.req.valid("header")["content-length"];
      const data = await c.var.container.blobService.uploadPart(c.var.auth, {
        hash: sha256,
        uploadId,
        part,
        size,
        body: streamedBody(c.req.raw.body, size),
      });
      return c.json({ data });
    },
  )

  .post(
    "/:sha256/uploads/:uploadId/complete",
    validate("param", uploadParamSchema),
    validate("json", CompleteUploadRequest),
    async (c) => {
      const { sha256, uploadId } = c.req.valid("param");
      const data = await c.var.container.blobService.completeUpload(c.var.auth, {
        hash: sha256,
        uploadId,
        ...c.req.valid("json"),
      });
      return c.json({ data }, 201);
    },
  );
