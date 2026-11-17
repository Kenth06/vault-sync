import { ChangedEvent, CommitConflicts, ErrorBody, WS_PROTOCOL, type PutChange } from "@vault-sync/protocol";
import { describe, expect, it } from "vitest";

import { ADMIN, call, enroll, json, putBlob, putChange } from "./helpers.ts";

function commit(vault: string, token: string, changes: unknown[]): Promise<Response> {
  return json(`/v1/vaults/${vault}/commit`, { batchId: crypto.randomUUID(), baseCursor: 0, changes }, token);
}

async function uploaded(token: string, path: string, content: string): Promise<PutChange> {
  const change = await putChange(path, content);
  await putBlob(change.hash, content, token);
  return change;
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.addEventListener(
      "message",
      (event) => {
        resolve(typeof event.data === "string" ? event.data : "");
      },
      { once: true },
    );
  });
}

function upgrade(vault: string, token: string): Promise<Response> {
  return call(`/v1/vaults/${vault}/ws`, {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": `${WS_PROTOCOL}, ${token}` },
  });
}

async function connect(vault: string, token: string): Promise<WebSocket> {
  const res = await upgrade(vault, token);
  const ws = res.webSocket;
  if (res.status !== 101 || ws === null) throw new Error(`upgrade failed: ${res.status}`);
  ws.accept();
  return ws;
}

describe("optimistic concurrency", () => {
  it("rejects a change whose base no longer matches, and applies nothing from the batch", async () => {
    const vault = "v-conflict";
    const a = await enroll(vault, "laptop");
    const b = await enroll(vault, "desktop");

    const fromA = await uploaded(a.token, "note.md", "from laptop");
    expect((await commit(vault, a.token, [{ ...fromA, baseHash: null }])).status).toBe(200);

    const fromB = await uploaded(b.token, "note.md", "from desktop");
    const other = await uploaded(b.token, "other.md", "unrelated");
    const res = await commit(vault, b.token, [
      { ...other, baseHash: null },
      { ...fromB, baseHash: null },
    ]);
    expect(res.status).toBe(409);

    const body = ErrorBody.parse(await res.json());
    expect(CommitConflicts.parse(body.details).conflicts).toEqual([
      expect.objectContaining({ path: "note.md", serverHash: fromA.hash }),
    ]);

    const tree = await call(`/v1/vaults/${vault}/tree`, { token: a.token });
    expect(JSON.stringify(await tree.json())).not.toContain("other.md");

    const retried = await commit(vault, b.token, [{ ...fromB, baseHash: fromA.hash }]);
    expect(retried.status).toBe(200);
  });

  it("rejects a rename onto a path that exists when the client expected it absent", async () => {
    const vault = "v-rename-onto";
    const { token } = await enroll(vault);
    const a = await uploaded(token, "a.md", "aaa");
    const b = await uploaded(token, "b.md", "bbb");
    await commit(vault, token, [
      { ...a, baseHash: null },
      { ...b, baseHash: null },
    ]);
    const res = await commit(vault, token, [
      { op: "rename", path: "b.md", fromPath: "a.md", hash: a.hash, size: a.size, mtime: a.mtime, baseHash: null },
    ]);
    expect(res.status).toBe(409);
  });

  it("refuses a batch that touches the same path twice", async () => {
    const vault = "v-dup";
    const { token } = await enroll(vault);
    const one = await uploaded(token, "a.md", "one");
    const two = await uploaded(token, "a.md", "two");
    const res = await commit(vault, token, [one, two]);
    expect(res.status).toBe(400);
  });

  it("returns the stored result when a committed batch is replayed after its base went stale", async () => {
    const vault = "v-replay";
    const a = await enroll(vault, "a");
    const b = await enroll(vault, "b");
    const first = await uploaded(a.token, "n.md", "first");
    const body = { batchId: crypto.randomUUID(), baseCursor: 0, changes: [{ ...first, baseHash: null }] };
    expect((await json(`/v1/vaults/${vault}/commit`, body, a.token)).status).toBe(200);
    const later = await uploaded(b.token, "n.md", "later");
    expect((await commit(vault, b.token, [{ ...later, baseHash: first.hash }])).status).toBe(200);
    expect((await json(`/v1/vaults/${vault}/commit`, body, a.token)).status).toBe(200);
  });

  it("keeps accepting changes without a base, for older clients", async () => {
    const vault = "v-no-base";
    const { token } = await enroll(vault);
    const first = await uploaded(token, "a.md", "one");
    const second = await uploaded(token, "a.md", "two");
    expect((await commit(vault, token, [first])).status).toBe(200);
    expect((await commit(vault, token, [second])).status).toBe(200);
  });
});

describe("live notifications", () => {
  it("tells connected devices about commits", async () => {
    const vault = "v-ws";
    const a = await enroll(vault, "laptop");
    const b = await enroll(vault, "desktop");

    const ws = await connect(vault, b.token);
    const message = nextMessage(ws);

    const change = await uploaded(a.token, "note.md", "hello");
    await commit(vault, a.token, [change]);

    expect(ChangedEvent.parse(JSON.parse(await message))).toEqual({
      type: "changed",
      cursor: 1,
      deviceId: a.deviceId,
    });
    ws.close();
  });

  it("answers a rate-limited upgrade with 429 and Retry-After", async () => {
    const vault = "v-ws-rate";
    const { token } = await enroll(vault);
    await Promise.all(Array.from({ length: 600 }, () => call(`/v1/vaults/${vault}/status`, { token })));
    const res = await upgrade(vault, token);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("refuses an unauthenticated upgrade and closes a revoked device's socket", async () => {
    const vault = "v-ws-revoke";
    const forged = `vs1.${vault}.dev_0123456789abcdef.${"A".repeat(43)}`;
    expect((await upgrade(vault, forged)).status).toBe(401);

    const device = await enroll(vault);
    const ws = await connect(vault, device.token);
    const closed = new Promise<number>((resolve) => {
      ws.addEventListener("close", (event) => {
        resolve(event.code);
      });
    });
    await json(`/v1/devices/${device.deviceId}/revoke`, { vaultId: vault }, ADMIN);
    expect(await closed).toBe(4001);
  });
});
