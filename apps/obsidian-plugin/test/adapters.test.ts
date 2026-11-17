import { PlanRequest } from "@vault-sync/protocol";
import { buildIgnore, syncOnce, type SyncEnvironment } from "@vault-sync/sync-core";
import type { DataAdapter, DataWriteOptions, ListedFiles, Stat } from "obsidian";
import { describe, expect, it } from "vitest";

import { ObsidianFiles } from "../src/adapters/obsidian-files.ts";
import { ObsidianRemote, type HttpFn, type HttpRequest } from "../src/adapters/obsidian-remote.ts";
import { PluginStore } from "../src/adapters/plugin-store.ts";

type FakeAdapter = Pick<
  DataAdapter,
  "list" | "stat" | "readBinary" | "writeBinary" | "rename" | "remove" | "mkdir" | "exists"
>;

function memoryAdapter(initial: Record<string, string>): FakeAdapter & { text: (p: string) => string | undefined } {
  const files = new Map<string, { bytes: ArrayBuffer; mtime: number }>();
  const folders = new Set<string>();
  let clock = 1000;
  const put = (p: string, bytes: ArrayBuffer, mtime?: number) => {
    clock += 1;
    files.set(p, { bytes, mtime: mtime ?? clock });
  };
  for (const [p, t] of Object.entries(initial)) put(p, new TextEncoder().encode(t).buffer);
  const children = (folder: string): ListedFiles => {
    const prefix = folder === "" ? "" : `${folder}/`;
    const direct = (p: string) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/");
    const subfolders = new Set(
      [...files.keys()]
        .filter((p) => p.startsWith(prefix) && p.slice(prefix.length).includes("/"))
        .map((p) => prefix + (p.slice(prefix.length).split("/")[0] ?? "")),
    );
    return { files: [...files.keys()].filter(direct), folders: [...subfolders] };
  };
  return {
    list: (folder: string) => Promise.resolve(children(folder)),
    stat: (p: string): Promise<Stat | null> => {
      const f = files.get(p);
      return Promise.resolve(
        f === undefined ? null : { type: "file", size: f.bytes.byteLength, mtime: f.mtime, ctime: f.mtime },
      );
    },
    readBinary: (p: string) => Promise.resolve(files.get(p)?.bytes.slice(0) ?? new ArrayBuffer(0)),
    writeBinary: (p: string, data: ArrayBuffer, options?: DataWriteOptions) => {
      put(p, data, options?.mtime);
      return Promise.resolve();
    },
    rename: (from: string, to: string) => {
      const f = files.get(from);
      if (f) files.set(to, f);
      files.delete(from);
      return Promise.resolve();
    },
    remove: (p: string) => {
      files.delete(p);
      return Promise.resolve();
    },
    mkdir: (p: string) => {
      folders.add(p);
      return Promise.resolve();
    },
    exists: (p: string) => Promise.resolve(files.has(p) || folders.has(p)),
    text: (p: string) => {
      const f = files.get(p);
      return f === undefined ? undefined : new TextDecoder().decode(f.bytes);
    },
  };
}

function memoryFile() {
  let text: string | null = null;
  return {
    read: () => Promise.resolve(text),
    write: (next: string) => {
      text = next;
      return Promise.resolve();
    },
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  return { status, headers, text, arrayBuffer: new TextEncoder().encode(text).buffer };
}

const rateLimited: HttpFn = () =>
  Promise.resolve(json(429, { error: "slow", code: "ERR_RATE_LIMITED" }, { "retry-after": "7" }));

const notFound: HttpFn = () => Promise.resolve(json(404, { error: "no", code: "ERR_NOT_FOUND" }));

const BATCH = "00000000-0000-4000-8000-000000000000";

function plannedMissing(body: string | ArrayBuffer | undefined): string[] {
  const text = typeof body === "string" ? body : "";
  return PlanRequest.parse(JSON.parse(text)).changes.flatMap((c) => (c.op === "delete" ? [] : [c.hash]));
}

function fakeServer(uploads: string[]): HttpFn {
  return (req) => {
    if (req.url.includes("/changes")) return Promise.resolve(json(200, { data: [] }));
    if (req.url.endsWith("/plan")) {
      return Promise.resolve(json(200, { data: { cursor: 0, missing: plannedMissing(req.body), conflicts: [] } }));
    }
    if (req.method === "GET") return Promise.resolve(json(404, { error: "no", code: "ERR_NOT_FOUND" }));
    if (req.method === "PUT") {
      uploads.push(req.url);
      return Promise.resolve(json(201, { data: { stored: true, size: 5 } }));
    }
    return Promise.resolve(json(200, { data: { batchId: BATCH, seqFrom: 1, seqTo: 1, cursor: 1, replayed: false } }));
  };
}

describe("ObsidianRemote", () => {
  it("sends the bearer token and parses the data envelope", async () => {
    const seen: HttpRequest[] = [];
    const http: HttpFn = (req) => {
      seen.push(req);
      return Promise.resolve(json(200, { data: [] }));
    };
    const remote = new ObsidianRemote(http, { url: "https://w.example", vaultId: "v", token: "tok" });
    expect(await remote.changes(0, 10)).toEqual([]);
    expect(seen[0]).toMatchObject({ url: "https://w.example/v1/vaults/v/changes?since=0&limit=10", method: "GET" });
    expect(seen[0]?.headers.Authorization).toBe("Bearer tok");
  });

  it("turns error envelopes into ApiError with Retry-After", async () => {
    const remote = new ObsidianRemote(rateLimited, { url: "https://w.example", vaultId: "v", token: "t" });
    await expect(remote.changes(0, 1)).rejects.toMatchObject({
      status: 429,
      code: "ERR_RATE_LIMITED",
      retryAfterMs: 7000,
    });
  });

  it("reports a missing blob as absent instead of failing", async () => {
    const remote = new ObsidianRemote(notFound, { url: "https://w.example", vaultId: "v", token: "t" });
    expect(await remote.hasBlob("a".repeat(64))).toBe(false);
  });
});

describe("ObsidianFiles + PluginStore", () => {
  it("lists nested files and remembers what was synced across restarts", async () => {
    const adapter = memoryAdapter({ "a.md": "one", "Notas/b.md": "two" });
    const file = memoryFile();
    const store = new PluginStore(file);
    const files = new ObsidianFiles(adapter, store);
    expect((await files.list()).map((f) => f.path).toSorted()).toEqual(["Notas/b.md", "a.md"]);

    await store.applyPulled(new Map([["a.md", { hash: "h", size: 3, mtime: 1 }]]), 4);
    const reloaded = new PluginStore(file);
    await reloaded.load();
    expect(reloaded.cursor()).toBe(4);
    expect([...reloaded.synced().keys()]).toEqual(["a.md"]);
  });

  it("refuses downloaded bytes whose hash does not match", async () => {
    const files = new ObsidianFiles(memoryAdapter({}), new PluginStore(memoryFile()));
    const write = files.write("x.md", new TextEncoder().encode("bytes").buffer, {
      expectedHash: "0".repeat(64),
      mtime: 1,
      beforeReplace: () => Promise.resolve(),
    });
    await expect(write).rejects.toThrow(/do not match/u);
  });

  it("runs the sync engine end to end on top of the Obsidian adapters", async () => {
    const adapter = memoryAdapter({ "note.md": "hello" });
    const store = new PluginStore(memoryFile());
    const uploads: string[] = [];
    const env: SyncEnvironment = {
      files: new ObsidianFiles(adapter, store),
      remote: new ObsidianRemote(fakeServer(uploads), { url: "https://w.example", vaultId: "v", token: "t" }),
      store,
      isIgnored: buildIgnore(),
      device: "test",
      caseInsensitive: false,
      unsafePath: () => false,
    };
    const report = await syncOnce(env);
    expect(report).toMatchObject({ pushed: 1, cursor: 1 });
    expect(uploads).toHaveLength(1);
    expect([...store.synced().keys()]).toEqual(["note.md"]);
  });
});
