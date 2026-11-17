import {
  BlobStored,
  blobKey,
  ChangeRow,
  CommitResponse,
  PlanResponse,
  Sha256,
  TreeEntry,
  VaultStatus,
} from "@vault-sync/protocol";
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { ADMIN, call, enroll, json, putBlob, putChange, readData, readErrorCode, sha256 } from "./helpers.ts";

const batch = () => crypto.randomUUID();
const forged = `vs1.v-auth.dev_0123456789abcdef.${"A".repeat(43)}`;

describe("enroll", () => {
  it("requires the admin secret", async () => {
    const res = await json("/v1/devices/enroll", { vaultId: "v-enroll", name: "pc" }, "wrong");
    expect(res.status).toBe(401);
    expect(await readErrorCode(res)).toBe("ERR_UNAUTHORIZED");
  });

  it("returns a token once", async () => {
    const { token, deviceId, cursor } = await enroll("v-enroll");
    expect(token.startsWith(`vs1.v-enroll.${deviceId}.`)).toBe(true);
    expect(cursor).toBe(0);
  });

  it("rejects an invalid body with details", async () => {
    const res = await json("/v1/devices/enroll", { vaultId: "BAD ID" }, ADMIN);
    expect(res.status).toBe(400);
    expect(await readErrorCode(res)).toBe("ERR_BAD_REQUEST");
  });
});

describe("auth", () => {
  it("rejects missing and forged tokens", async () => {
    expect((await call("/v1/vaults/v-auth/status")).status).toBe(401);
    expect((await call("/v1/vaults/v-auth/status", { token: forged })).status).toBe(401);
  });

  it("forbids using a token on another vault", async () => {
    const { token } = await enroll("v-auth-a");
    const res = await call("/v1/vaults/v-auth-b/status", { token });
    expect(res.status).toBe(403);
    expect(await readErrorCode(res)).toBe("ERR_FORBIDDEN");
  });

  it("does not write to R2 for an unauthenticated upload", async () => {
    const hash = await sha256("secret note");
    expect((await putBlob(hash, "secret note", forged)).status).toBe(401);
    expect(await env.BUCKET.head(blobKey(Sha256.parse(hash)))).toBeNull();
  });
});

describe("push: plan, upload, commit", () => {
  it("syncs a note end to end", async () => {
    const vault = "v-push";
    const { token } = await enroll(vault);
    const change = await putChange("Notas/Café.md", "# hola");

    const planRes = await json(`/v1/vaults/${vault}/plan`, { baseCursor: 0, changes: [change] }, token);
    expect((await readData(planRes, PlanResponse)).missing).toEqual([change.hash]);

    expect((await putBlob(change.hash, "# hola", token)).status).toBe(201);

    const commitRes = await json(
      `/v1/vaults/${vault}/commit`,
      { batchId: batch(), baseCursor: 0, changes: [change] },
      token,
    );
    expect(await readData(commitRes, CommitResponse)).toMatchObject({
      seqFrom: 1,
      seqTo: 1,
      cursor: 1,
      replayed: false,
    });

    const tree = await readData(await call(`/v1/vaults/${vault}/tree`, { token }), TreeEntry.array());
    expect(tree.map((e) => e.path)).toEqual(["Notas/Café.md"]);

    const raw = await call(`/v1/vaults/${vault}/raw/${encodeURIComponent("Notas/Café.md")}`, { token });
    expect(new TextDecoder().decode(await raw.arrayBuffer())).toBe("# hola");

    const status = await readData(await call(`/v1/vaults/${vault}/status`, { token }), VaultStatus);
    expect(status).toMatchObject({ cursor: 1, files: 1, deviceCursor: 1 });
  });

  it("refuses to commit before the blob is uploaded", async () => {
    const vault = "v-missing";
    const { token } = await enroll(vault);
    const change = await putChange("a.md", "never uploaded");
    const res = await json(`/v1/vaults/${vault}/commit`, { batchId: batch(), baseCursor: 0, changes: [change] }, token);
    expect(res.status).toBe(409);
    expect(await readErrorCode(res)).toBe("ERR_CONFLICT");
  });

  it("is idempotent per batchId", async () => {
    const vault = "v-idem";
    const { token } = await enroll(vault);
    const change = await putChange("a.md", "one");
    await putBlob(await sha256("one"), "one", token);
    const body = { batchId: batch(), baseCursor: 0, changes: [change] };

    const first = await readData(await json(`/v1/vaults/${vault}/commit`, body, token), CommitResponse);
    const second = await readData(await json(`/v1/vaults/${vault}/commit`, body, token), CommitResponse);
    expect(first.replayed).toBe(false);
    expect(second).toMatchObject({ replayed: true, seqFrom: first.seqFrom, seqTo: first.seqTo });
  });

  it("rejects a blob whose bytes do not match its hash", async () => {
    const { token } = await enroll("v-checksum");
    const res = await putBlob(await sha256("expected"), "tampered", token);
    expect(res.status).toBe(400);
  });

  it("dedupes: a second upload of the same bytes stores nothing", async () => {
    const { token } = await enroll("v-dedupe");
    const hash = await sha256("same");
    expect((await putBlob(hash, "same", token)).status).toBe(201);
    const again = await putBlob(hash, "same", token);
    expect(again.status).toBe(200);
    expect(await readData(again, BlobStored)).toMatchObject({ stored: false });
  });

  it("applies renames and deletes, and keeps state across eviction", async () => {
    const vault = "v-rename";
    const { token } = await enroll(vault);
    const original = await putChange("old.md", "content");
    await putBlob(await sha256("content"), "content", token);
    await json(`/v1/vaults/${vault}/commit`, { batchId: batch(), baseCursor: 0, changes: [original] }, token);

    const rename = { ...original, op: "rename", path: "new.md", fromPath: "old.md" };
    await json(`/v1/vaults/${vault}/commit`, { batchId: batch(), baseCursor: 1, changes: [rename] }, token);

    await evictDurableObject(env.VAULT.getByName(vault));

    let tree = await readData(await call(`/v1/vaults/${vault}/tree`, { token }), TreeEntry.array());
    expect(tree.map((e) => e.path)).toEqual(["new.md"]);

    const remove = { op: "delete", path: "new.md" };
    await json(`/v1/vaults/${vault}/commit`, { batchId: batch(), baseCursor: 2, changes: [remove] }, token);
    tree = await readData(await call(`/v1/vaults/${vault}/tree`, { token }), TreeEntry.array());
    expect(tree).toEqual([]);

    const log = await readData(await call(`/v1/vaults/${vault}/changes?since=0`, { token }), ChangeRow.array());
    expect(log.map((c) => c.op)).toEqual(["put", "rename", "delete"]);
  });
});
