import { BlobStored, CreateUploadResponse, SINGLE_PUT_MAX_BYTES, UploadedPart } from "@vault-sync/protocol";
import { describe, expect, it } from "vitest";

import { call, enroll, json, putBlob, readData, readErrorCode, sha256 } from "./helpers.ts";

async function uploadPart(hash: string, uploadId: string, content: string, token: string): Promise<UploadedPart> {
  const bytes = new TextEncoder().encode(content);
  const res = await call(`/v1/blobs/${hash}/uploads/${uploadId}/1`, {
    method: "PUT",
    body: bytes,
    headers: { "Content-Length": String(bytes.byteLength) },
    token,
  });
  return readData(res, UploadedPart);
}

describe("HEAD /v1/blobs/:sha256", () => {
  it("answers 404 for unknown bytes and 200 once uploaded", async () => {
    const { token } = await enroll("v-head");
    const hash = await sha256("head me");
    expect((await call(`/v1/blobs/${hash}`, { method: "HEAD", token })).status).toBe(404);
    await putBlob(hash, "head me", token);
    expect((await call(`/v1/blobs/${hash}`, { method: "HEAD", token })).status).toBe(200);
  });

  it("rejects a forged token before touching storage", async () => {
    const forged = `vs1.v-head.dev_0123456789abcdef.${"A".repeat(43)}`;
    const res = await call(`/v1/blobs/${await sha256("x")}`, { method: "HEAD", token: forged });
    expect(res.status).toBe(401);
  });
});

describe("PUT /v1/blobs/:sha256 limits", () => {
  it("requires Content-Length", async () => {
    const { token } = await enroll("v-length");
    const res = await call(`/v1/blobs/${await sha256("x")}`, { method: "PUT", token });
    expect(res.status).toBe(400);
    expect(await readErrorCode(res)).toBe("ERR_BAD_REQUEST");
  });

  it("sends large files to multipart", async () => {
    const { token } = await enroll("v-large");
    const res = await call(`/v1/blobs/${await sha256("x")}`, {
      method: "PUT",
      body: "x",
      headers: { "Content-Length": String(SINGLE_PUT_MAX_BYTES + 1) },
      token,
    });
    expect(res.status).toBe(413);
    expect(await readErrorCode(res)).toBe("ERR_PAYLOAD_TOO_LARGE");
  });
});

describe("multipart upload", () => {
  it("creates, uploads a part, completes, and refuses to restart a stored blob", async () => {
    const { token } = await enroll("v-multi");
    const hash = await sha256("multipart body");

    const { uploadId } = await readData(
      await call(`/v1/blobs/${hash}/uploads`, { method: "POST", token }),
      CreateUploadResponse,
    );
    const part = await uploadPart(hash, uploadId, "multipart body", token);
    const done = await json(`/v1/blobs/${hash}/uploads/${uploadId}/complete`, { size: 14, parts: [part] }, token);
    expect(await readData(done, BlobStored)).toEqual({ stored: true, size: 14 });

    const again = await call(`/v1/blobs/${hash}/uploads`, { method: "POST", token });
    expect(again.status).toBe(409);
  });

  it("rejects a completion whose size does not match", async () => {
    const { token } = await enroll("v-multi-size");
    const hash = await sha256("short");
    const { uploadId } = await readData(
      await call(`/v1/blobs/${hash}/uploads`, { method: "POST", token }),
      CreateUploadResponse,
    );
    const part = await uploadPart(hash, uploadId, "short", token);
    const res = await json(`/v1/blobs/${hash}/uploads/${uploadId}/complete`, { size: 999, parts: [part] }, token);
    expect(res.status).toBe(400);
    expect((await call(`/v1/blobs/${hash}`, { method: "HEAD", token })).status).toBe(404);
  });
});
