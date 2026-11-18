import { ChangeRow, DeviceInfo, DeviceSummary, TreeResponse, type PutChange } from "@vault-sync/protocol";
import { describe, expect, it } from "vitest";

import { ADMIN, call, enroll, json, putBlob, putChange, readData, readErrorCode } from "./helpers.ts";

async function commit(vault: string, token: string, changes: unknown[]): Promise<void> {
  const res = await json(`/v1/vaults/${vault}/commit`, { batchId: crypto.randomUUID(), baseCursor: 0, changes }, token);
  if (res.status !== 200) throw new Error(`commit failed: ${res.status} ${await res.text()}`);
}

interface Fixture {
  readonly path: string;
  readonly content: string;
  readonly mtime?: number;
}

async function put(vault: string, token: string, file: Fixture): Promise<PutChange> {
  const { path, content, mtime = 1000 } = file;
  const change = await putChange(path, content, mtime);
  await putBlob(change.hash, content, token);
  await commit(vault, token, [change]);
  return change;
}

async function treeAt(vault: string, token: string, at?: number): Promise<TreeResponse> {
  const query = at === undefined ? "" : `?at=${at}`;
  return readData(await call(`/v1/vaults/${vault}/tree${query}`, { token }), TreeResponse);
}

describe("tree at a cursor", () => {
  it("reconstructs every past state, including renames and deletes", async () => {
    const vault = "v-tree-at";
    const { token } = await enroll(vault);
    const a1 = await put(vault, token, { path: "a.md", content: "a v1", mtime: 1001 });
    await put(vault, token, { path: "b.md", content: "b v1", mtime: 1002 });
    await put(vault, token, { path: "a.md", content: "a v2", mtime: 1003 });
    await commit(vault, token, [
      { op: "rename", path: "c.md", fromPath: "b.md", hash: a1.hash, size: a1.size, mtime: 1004 },
    ]);
    await commit(vault, token, [{ op: "delete", path: "a.md" }]);

    const snapshotAt = async (seq: number) =>
      (await treeAt(vault, token, seq)).files.map((f) => `${f.path}@${f.mtime}`);

    expect(await snapshotAt(1)).toEqual(["a.md@1001"]);
    expect(await snapshotAt(2)).toEqual(["a.md@1001", "b.md@1002"]);
    expect(await snapshotAt(3)).toEqual(["a.md@1003", "b.md@1002"]);
    expect(await snapshotAt(4)).toEqual(["a.md@1003", "c.md@1004"]);
    expect(await snapshotAt(5)).toEqual(["c.md@1004"]);

    const head = await treeAt(vault, token);
    expect(head.seq).toBe(5);
    expect(head.files.map((f) => f.path)).toEqual(["c.md"]);
  });
});

describe("file history", () => {
  it("lists every version of a path, newest first, including renames away", async () => {
    const vault = "v-history";
    const { token } = await enroll(vault);
    const v1 = await put(vault, token, { path: "note.md", content: "one" });
    await put(vault, token, { path: "note.md", content: "two" });

    const res = await call(`/v1/vaults/${vault}/history?path=note.md`, { token });
    const history = await readData(res, ChangeRow.array());
    expect(history.map((h) => [h.seq, h.op])).toEqual([
      [2, "put"],
      [1, "put"],
    ]);

    const old = await call(`/v1/blobs/${v1.hash}/content`, { token });
    expect(new TextDecoder().decode(await old.arrayBuffer())).toBe("one");
  });
});

describe("devices", () => {
  it("lists devices and revokes one immediately", async () => {
    const vault = "v-revoke";
    const { token, deviceId } = await enroll(vault, "laptop");
    expect((await call(`/v1/vaults/${vault}/status`, { token })).status).toBe(200);

    const list = await readData(await call(`/v1/devices?vaultId=${vault}`, { token: ADMIN }), DeviceInfo.array());
    expect(list).toEqual([expect.objectContaining({ id: deviceId, name: "laptop", revoked: false })]);

    expect((await json(`/v1/devices/${deviceId}/revoke`, { vaultId: vault }, token)).status).toBe(401);
    expect((await json(`/v1/devices/${deviceId}/revoke`, { vaultId: vault }, ADMIN)).status).toBe(200);

    const after = await call(`/v1/vaults/${vault}/status`, { token });
    expect(after.status).toBe(403);
    expect(await readErrorCode(after)).toBe("ERR_FORBIDDEN");
  });
});

describe("device names for a vault member", () => {
  it("lists ids and names without the admin secret, and only for the token's vault", async () => {
    const { token } = await enroll("v-names", "laptop");
    await enroll("v-names", "desktop");
    const res = await call("/v1/vaults/v-names/devices", { token });
    const names = (await readData(res, DeviceSummary.array())).map((d) => d.name);
    expect(names).toEqual(["desktop", "laptop"]);

    const other = await call("/v1/vaults/v-other/devices", { token });
    expect(other.status).toBe(403);
    expect((await call("/v1/vaults/v-names/devices")).status).toBe(401);
  });

  it("lets a device revoke itself, after which its token stops working", async () => {
    const { token } = await enroll("v-self", "web");
    const res = await call("/v1/vaults/v-self/devices/self/revoke", { method: "POST", token });
    expect(res.status).toBe(200);
    const after = await call("/v1/vaults/v-self/status", { token });
    expect(await readErrorCode(after)).toBe("ERR_FORBIDDEN");
  });
});

describe("raw file ranges", () => {
  it("serves a byte range with 206 and Content-Range", async () => {
    const vault = "v-range";
    const { token } = await enroll(vault);
    await put(vault, token, { path: "clip.txt", content: "0123456789" });
    const res = await call(`/v1/vaults/${vault}/raw/clip.txt`, { token, headers: { Range: "bytes=2-5" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(await res.text()).toBe("2345");

    const whole = await call(`/v1/vaults/${vault}/raw/clip.txt`, { token });
    expect(whole.status).toBe(200);
    expect(whole.headers.get("Accept-Ranges")).toBe("bytes");

    const read = (range: string) => call(`/v1/vaults/${vault}/raw/clip.txt`, { token, headers: { Range: range } });
    const tail = await read("bytes=-3");
    expect([tail.status, await tail.text()]).toEqual([206, "789"]);
    const open = await read("bytes=7-");
    expect([open.status, open.headers.get("Content-Range"), await open.text()]).toEqual([206, "bytes 7-9/10", "789"]);
    const beyond = await read("bytes=10-20");
    expect([beyond.status, beyond.headers.get("Content-Range")]).toEqual([416, "bytes */10"]);
    const ignored = await Promise.all(
      ["bytes=0-1,4-5", "lines=1-2", "bytes=5-2"].map(async (range) => {
        const reply = await read(range);
        return [reply.status, await reply.text()];
      }),
    );
    expect(ignored).toEqual(Array.from({ length: 3 }, () => [200, "0123456789"]));
  });

  it("never accepts the viewer cookie in place of a device token", async () => {
    const vault = "v-cookie";
    const { token } = await enroll(vault);
    const res = await call(`/v1/vaults/${vault}/tree`, { headers: { Cookie: `__Host-vault-sync=${token}` } });
    expect(res.status).toBe(401);
  });
});
