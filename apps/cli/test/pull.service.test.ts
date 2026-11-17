import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ChangeRow, DeviceId, VaultId } from "@vault-sync/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { STATE_DIR } from "../src/common/constants.ts";
import { ApiError } from "../src/common/errors.ts";
import type { VaultContext } from "../src/common/types.ts";
import { pullOnce, type PullClient } from "../src/services/pull.service.ts";
import { LocalState } from "../src/storage/local-state.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

interface Fixture {
  readonly root: string;
  readonly ctx: VaultContext;
  readonly state: LocalState;
}

let fixture: Fixture;

beforeEach(async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vaultsync-pull-"));
  await mkdir(path.join(root, STATE_DIR));
  const ctx: VaultContext = {
    root,
    token: "t",
    config: {
      url: "http://localhost",
      vaultId: VaultId.parse("v-test"),
      deviceId: DeviceId.parse("dev_aaaaaaaaaaaaaaaa"),
    },
  };
  fixture = { root, ctx, state: new LocalState(root) };
});

afterEach(async () => {
  fixture.state.close();
  await rm(fixture.root, { recursive: true, force: true });
});

function put(seq: number, file: string, content: string, deviceId = "dev_bbbbbbbbbbbbbbbb"): ChangeRow {
  return ChangeRow.parse({
    seq,
    op: "put",
    path: file,
    fromPath: null,
    hash: sha(content),
    prevHash: null,
    size: Buffer.byteLength(content),
    mtime: 1_700_000_000_000,
    deviceId,
    at: 1_700_000_000_000,
  });
}

function rename(seq: number, from: string, to: string, content: string): ChangeRow {
  return ChangeRow.parse({ ...put(seq, to, content), op: "rename", fromPath: from });
}

function fakeClient(rows: ChangeRow[], contents: string[], beforeServe?: () => Promise<void>): PullClient {
  const byHash = new Map(contents.map((c) => [sha(c), c]));
  let served = false;
  return {
    changes: () => {
      const page = served ? [] : rows;
      served = true;
      return Promise.resolve(page);
    },
    blobContent: async (hash: string) => {
      await beforeServe?.();
      const content = byHash.get(hash);
      if (content === undefined) throw new ApiError({ status: 404, code: "ERR_NOT_FOUND", message: "gone" });
      return new Blob([content]).stream();
    },
  };
}

async function writeLocal(file: string, content: string, synced: boolean): Promise<void> {
  const abs = path.join(fixture.root, file);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
  if (!synced) return;
  const info = await stat(abs);
  fixture.state.applyPulled(
    new Map([[file, { hash: sha(content), size: info.size, mtime: Math.trunc(info.mtimeMs) }]]),
    0,
  );
}

const read = (file: string) => readFile(path.join(fixture.root, file), "utf8");
const files = async () =>
  (await readdir(fixture.root, { recursive: true })).filter((f) => !f.startsWith(STATE_DIR)).toSorted();

describe("pullOnce", () => {
  it("writes a remote edit over a file deleted locally instead of failing", async () => {
    await writeLocal("a.md", "base", true);
    await rm(path.join(fixture.root, "a.md"));
    const report = await pullOnce(
      fakeClient([put(1, "a.md", "remote edit")], ["remote edit"]),
      fixture.ctx,
      fixture.state,
    );
    expect(await read("a.md")).toBe("remote edit");
    expect(report).toMatchObject({ failed: [], cursor: 1 });
  });

  it("keeps a local save that lands while the pull is running", async () => {
    await writeLocal("a.md", "base", true);
    const client = fakeClient([put(1, "a.md", "remote")], ["remote"], async () => {
      await writeFile(path.join(fixture.root, "a.md"), "typed during pull");
    });
    await pullOnce(client, fixture.ctx, fixture.state);
    const copies = (await files()).filter((f) => f.includes("conflicto"));
    expect(await read("a.md")).toBe("remote");
    expect(await Promise.all(copies.map(read))).toEqual(["typed during pull"]);
  });

  it("never writes paths the local ignore rules exclude", async () => {
    const rows = [put(1, ".obsidian/workspace.json", "{}"), put(2, "note.md", "hi")];
    const report = await pullOnce(fakeClient(rows, ["{}", "hi"]), fixture.ctx, fixture.state);
    expect(await files()).toEqual(["note.md"]);
    expect(report.cursor).toBe(2);
    expect([...fixture.state.synced().keys()]).toEqual(["note.md"]);
  });

  it("skips a blob the server no longer has and still applies the rest", async () => {
    const rows = [put(1, "gone.md", "collected"), put(2, "ok.md", "fine")];
    const report = await pullOnce(fakeClient(rows, ["fine"]), fixture.ctx, fixture.state);
    expect(report).toMatchObject({ failed: ["gone.md"], cursor: 2 });
    expect(await read("ok.md")).toBe("fine");
  });

  it("gives each conflict copy its own name", async () => {
    await writeLocal("a.md", "base", true);
    await writeFile(path.join(fixture.root, "a.md"), "mine one");
    await pullOnce(fakeClient([put(1, "a.md", "theirs one")], ["theirs one"]), fixture.ctx, fixture.state);
    await writeFile(path.join(fixture.root, "a.md"), "mine two");
    await pullOnce(fakeClient([put(2, "a.md", "theirs two")], ["theirs two"]), fixture.ctx, fixture.state);
    const copies = (await files()).filter((f) => f.includes("conflicto"));
    expect(copies).toHaveLength(2);
    expect(new Set(await Promise.all(copies.map(read)))).toEqual(new Set(["mine one", "mine two"]));
  });

  it("adopts this device's own change without touching a newer local edit", async () => {
    await writeLocal("a.md", "pushed", true);
    await writeFile(path.join(fixture.root, "a.md"), "edited again");
    const own = put(1, "a.md", "pushed", fixture.ctx.config.deviceId);
    await pullOnce(fakeClient([own], ["pushed"]), fixture.ctx, fixture.state);
    expect(await read("a.md")).toBe("edited again");
    expect((await files()).some((f) => f.includes("conflicto"))).toBe(false);
  });

  it("applies a case-only rename without losing the file", async () => {
    await writeLocal("Note.md", "same bytes", true);
    await pullOnce(
      fakeClient([rename(1, "Note.md", "note.md", "same bytes")], ["same bytes"]),
      fixture.ctx,
      fixture.state,
    );
    expect(await files()).toEqual(["note.md"]);
    expect(await read("note.md")).toBe("same bytes");
  });
});
