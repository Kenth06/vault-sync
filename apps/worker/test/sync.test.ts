import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { blobKey, ChangeRow, CommitResponse, PlanResponse, Sha256, StatusResponse, TreeEntry } from "@vault-sync/protocol";
import { call, enroll, json, putBlob, putChange, sha256 } from "./helpers.js";

const batch = () => crypto.randomUUID();

describe("enroll", () => {
  it("requires the admin secret", async () => {
    const res = await json("/v1/devices/enroll", { vaultId: "v-enroll", name: "pc" }, "wrong");
    expect(res.status).toBe(401);
  });

  it("returns a token once", async () => {
    const { token, deviceId, cursor } = await enroll("v-enroll");
    expect(token.startsWith(`vs1.v-enroll.${deviceId}.`)).toBe(true);
    expect(cursor).toBe(0);
  });
});

describe("auth", () => {
  it("rejects missing and forged tokens", async () => {
    expect((await call("/v1/vaults/v-auth/status")).status).toBe(401);
    const forged = `vs1.v-auth.dev_0123456789abcdef.${"A".repeat(43)}`;
    expect((await call("/v1/vaults/v-auth/status", { token: forged })).status).toBe(401);
  });

  it("forbids using a token on another vault", async () => {
    const { token } = await enroll("v-auth-a");
    expect((await call("/v1/vaults/v-auth-b/status", { token })).status).toBe(403);
  });

  it("does not write to R2 for an unauthenticated upload", async () => {
    const content = "secret note";
    const hash = await sha256(content);
    const forged = `vs1.v-auth.dev_0123456789abcdef.${"A".repeat(43)}`;
    expect((await putBlob(hash, content, forged)).status).toBe(401);
    expect(await env.BUCKET.head(blobKey(Sha256.parse(hash)))).toBeNull();
  });
});

describe("push: plan → upload → commit", () => {
  it("syncs a note end to end", async () => {
    const vault = "v-push";
    const { token } = await enroll(vault);
    const change = await putChange("Notas/Café.md", "# hola");

    const plan = PlanResponse.parse(await (await json(`/v1/vaults/${vault}/plan`, { baseCursor: 0, changes: [change] }, token)).json());
    expect(plan.missing).toEqual([change.hash]);

    expect((await putBlob(change.hash, "# hola", token)).status).toBe(201);

    const commitRes = await json(`/v1/vaults/${vault}/commit`, { batchId: batch(), baseCursor: 0, changes: [change] }, token);
    const commit = CommitResponse.parse(await commitRes.json());
    expect(commit).toMatchObject({ seqFrom: 1, seqTo: 1, cursor: 1, replayed: false });

    const tree = TreeEntry.array().parse(await (await call(`/v1/vaults/${vault}/tree`, { token })).json());
    expect(tree.map((e) => e.path)).toEqual(["Notas/Café.md"]);

    const raw = await call(`/v1/vaults/${vault}/raw/${encodeURIComponent("Notas/Café.md")}`, { token });
    expect(await raw.text()).toBe("# hola");

    const status = StatusResponse.parse(await (await call(`/v1/vaults/${vault}/status`, { token })).json());
    expect(status).toMatchObject({ cursor: 1, files: 1, deviceCursor: 1 });
  });

  it("refuses to commit before the blob is uploaded", async () => {
    const vault = "v-missing";
    const { token } = await enroll(vault);
    const change = await putChange("a.md", "never uploaded");
    const res = await json(`/v1/vaults/${vault}/commit`, { batchId: batch(), baseCursor: 0, changes: [change] }, token);
    expect(res.status).toBe(409);
  });

  it("is idempotent per batchId", async () => {
    const vault = "v-idem";
    const { token } = await enroll(vault);
    const change = await putChange("a.md", "one");
    await putBlob(await sha256("one"), "one", token);
    const body = { batchId: batch(), baseCursor: 0, changes: [change] };

    const first = CommitResponse.parse(await (await json(`/v1/vaults/${vault}/commit`, body, token)).json());
    const second = CommitResponse.parse(await (await json(`/v1/vaults/${vault}/commit`, body, token)).json());
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
    expect(await again.json()).toMatchObject({ stored: false });
  });

  it("applies renames and deletes, and keeps state across eviction", async () => {
    const vault = "v-rename";
    const { token } = await enroll(vault);
    const a = await putChange("old.md", "content");
    await putBlob(await sha256("content"), "content", token);
    await json(`/v1/vaults/${vault}/commit`, { batchId: batch(), baseCursor: 0, changes: [a] }, token);

    const rename = { ...a, op: "rename", path: "new.md", fromPath: "old.md" };
    const del = { op: "delete", path: "new.md" };
    await json(`/v1/vaults/${vault}/commit`, { batchId: batch(), baseCursor: 1, changes: [rename] }, token);

    await evictDurableObject(env.VAULT.getByName(vault));

    let tree = TreeEntry.array().parse(await (await call(`/v1/vaults/${vault}/tree`, { token })).json());
    expect(tree.map((e) => e.path)).toEqual(["new.md"]);

    await json(`/v1/vaults/${vault}/commit`, { batchId: batch(), baseCursor: 2, changes: [del] }, token);
    tree = TreeEntry.array().parse(await (await call(`/v1/vaults/${vault}/tree`, { token })).json());
    expect(tree).toEqual([]);

    const log = ChangeRow.array().parse(await (await call(`/v1/vaults/${vault}/changes?since=0`, { token })).json());
    expect(log.map((c) => c.op)).toEqual(["put", "rename", "delete"]);
  });
});
