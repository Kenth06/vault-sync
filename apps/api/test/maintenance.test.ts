import { blobKey, SnapshotInfo, TreeResponse, VaultId, type PutChange } from "@vault-sync/protocol";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { call, enroll, json, putBlob, putChange, readData } from "./helpers.ts";

async function put(vault: string, token: string, path: string, content: string): Promise<PutChange> {
  const change = await putChange(path, content);
  await putBlob(change.hash, content, token);
  const res = await json(
    `/v1/vaults/${vault}/commit`,
    { batchId: crypto.randomUUID(), baseCursor: 0, changes: [change] },
    token,
  );
  if (res.status !== 200) throw new Error(`commit failed: ${res.status}`);
  return change;
}

const stored = async (vault: string, change: PutChange) =>
  (await env.BUCKET.head(blobKey(VaultId.parse(vault), change.hash))) !== null;

const DAY = 24 * 60 * 60 * 1000;

describe("snapshots", () => {
  it("creates a snapshot on demand and serves its tree", async () => {
    const vault = "v-snap";
    const { token } = await enroll(vault);
    await put(vault, token, "a.md", "alpha");

    const created = await json(`/v1/vaults/${vault}/snapshots`, {}, token);
    expect(created.status).toBe(201);
    expect(await readData(created, SnapshotInfo)).toMatchObject({ seq: 1, files: 1, bytes: 5 });

    const again = await json(`/v1/vaults/${vault}/snapshots`, {}, token);
    expect(again.status).toBe(200);

    const list = await readData(await call(`/v1/vaults/${vault}/snapshots`, { token }), SnapshotInfo.array());
    expect(list.map((s) => s.seq)).toEqual([1]);

    const tree = await readData(await call(`/v1/vaults/${vault}/snapshots/1`, { token }), TreeResponse);
    expect(tree.files.map((f) => f.path)).toEqual(["a.md"]);
  });

  it("schedules the daily snapshot after a commit and writes it in the alarm", async () => {
    const vault = "v-alarm";
    const { token } = await enroll(vault);
    await put(vault, token, "a.md", "alpha");

    const stub = env.VAULT.getByName(vault);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const list = await readData(await call(`/v1/vaults/${vault}/snapshots`, { token }), SnapshotInfo.array());
    expect(list.map((s) => s.seq)).toEqual([1]);
  });
});

describe("garbage collection", () => {
  it("deletes orphaned blobs no retained snapshot needs, after the grace period", async () => {
    const vault = "v-gc";
    const { token } = await enroll(vault);
    const first = await put(vault, token, "a.md", "version one");
    const second = await put(vault, token, "a.md", "version two");

    expect(await runDurableObjectAlarm(env.VAULT.getByName(vault))).toBe(true);

    expect(await stored(vault, first)).toBe(false);
    expect(await stored(vault, second)).toBe(true);
  });

  it("prunes same-day snapshots, so their old blobs become collectable", async () => {
    const vault = "v-gc-sameday";
    const { token } = await enroll(vault);
    const first = await put(vault, token, "a.md", "short lived");
    await json(`/v1/vaults/${vault}/snapshots`, {}, token);
    await put(vault, token, "a.md", "newer");

    expect(await runDurableObjectAlarm(env.VAULT.getByName(vault))).toBe(true);

    expect(await stored(vault, first)).toBe(false);
    expect((await call(`/v1/vaults/${vault}/snapshots/1`, { token })).status).toBe(404);
  });

  it("keeps an orphaned blob while a retained snapshot still references it", async () => {
    const vault = "v-gc-keep";
    const { token } = await enroll(vault);
    const first = await put(vault, token, "a.md", "kept by snapshot");
    await json(`/v1/vaults/${vault}/snapshots`, {}, token);
    const stub = env.VAULT.getByName(vault);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE snapshots SET at = at - ? WHERE seq = 1", DAY);
    });
    await put(vault, token, "a.md", "newer");

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    expect(await stored(vault, first)).toBe(true);
    const snapshot = await readData(await call(`/v1/vaults/${vault}/snapshots/1`, { token }), TreeResponse);
    expect(snapshot.files.map((f) => f.hash)).toEqual([first.hash]);

    const alarm = await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
    expect(alarm).toBeNull();
  });
});

describe("rate limit", () => {
  it("answers 429 with Retry-After once a device exceeds its budget", async () => {
    const vault = "v-rate";
    const { token } = await enroll(vault);
    const responses = await Promise.all(
      Array.from({ length: 601 }, () => call(`/v1/vaults/${vault}/status`, { token })),
    );
    const limited = responses.filter((r) => r.status === 429);
    expect(limited).toHaveLength(1);
    expect(Number(limited[0]?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
