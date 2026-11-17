import { describe, expect, it } from "vitest";

import { pullOnce } from "../src/engine/pull.ts";
import { syncOnce } from "../src/engine/sync.ts";
import { device, FakeServer } from "./fakes.ts";

const DEVICE_A = "dev_aaaaaaaaaaaaaaaa";
const DEVICE_B = "dev_bbbbbbbbbbbbbbbb";

describe("sync engine", () => {
  it("copies a vault to a second device", async () => {
    const server = new FakeServer();
    const a = device(server, DEVICE_A);
    const b = device(server, DEVICE_B);
    a.files.put("Notas/plan.md", "base");
    a.files.put("img.bin", "binary");

    await syncOnce(a.env);
    const report = await syncOnce(b.env);

    expect(report.pulled).toBe(2);
    expect(b.files.text("Notas/plan.md")).toBe("base");
    expect(b.store.cursor()).toBe(a.store.cursor());
  });

  it("keeps both versions when two devices edit the same note offline", async () => {
    const server = new FakeServer();
    const a = device(server, DEVICE_A);
    const b = device(server, DEVICE_B);
    a.files.put("plan.md", "base");
    await syncOnce(a.env);
    await syncOnce(b.env);

    a.files.put("plan.md", "edit from A");
    b.files.put("plan.md", "edit from B");
    await syncOnce(a.env);
    const reportB = await syncOnce(b.env);
    await syncOnce(a.env);

    expect(reportB.conflicts).toEqual(["plan.md"]);
    for (const d of [a, b]) {
      expect(d.files.text("plan.md")).toBe("edit from A");
      expect(d.files.text(`plan (conflicto ${DEVICE_B} 2026-11-17 0905).md`)).toBe("edit from B");
    }
  });

  it("propagates renames without re-uploading and deletes on the other side", async () => {
    const server = new FakeServer();
    const a = device(server, DEVICE_A);
    const b = device(server, DEVICE_B);
    a.files.put("old.md", "content");
    a.files.put("gone.md", "bye");
    await syncOnce(a.env);
    await syncOnce(b.env);

    await b.files.rename("old.md", "new.md");
    await b.files.remove("gone.md");
    await syncOnce(b.env);
    await syncOnce(a.env);

    expect([...a.files.entries.keys()].toSorted()).toEqual(["new.md"]);
    expect(server.blobs.size).toBe(2);
  });

  it("keeps a local save that lands while a download is in flight", async () => {
    const server = new FakeServer();
    const a = device(server, DEVICE_A);
    const b = device(server, DEVICE_B);
    a.files.put("n.md", "v1");
    await syncOnce(a.env);
    await syncOnce(b.env);
    a.files.put("n.md", "v2");
    await syncOnce(a.env);

    b.files.onWrite = (path) => {
      b.files.put(path, "typed meanwhile");
      b.files.onWrite = null;
    };
    await pullOnce(b.env);

    expect(b.files.text("n.md")).toBe("v2");
    expect(b.files.text(`n (conflicto ${DEVICE_B} 2026-11-17 0905).md`)).toBe("typed meanwhile");
  });

  it("applies a case-only rename on case-insensitive filesystems without losing the file", async () => {
    const server = new FakeServer();
    const a = device(server, DEVICE_A);
    const b = device(server, DEVICE_B, { caseInsensitive: true });
    a.files.put("Note.md", "same");
    await syncOnce(a.env);
    await syncOnce(b.env);

    await a.files.rename("Note.md", "note.md");
    await syncOnce(a.env);
    await pullOnce(b.env);

    expect([...b.files.entries.keys()]).toEqual(["note.md"]);
  });

  it("never pulls ignored paths or the plugin's own data", async () => {
    const server = new FakeServer();
    const a = device(server, DEVICE_A, { isIgnored: () => false });
    const b = device(server, DEVICE_B);
    a.files.put(".obsidian/plugins/vault-sync/data.json", '{"token":"secret"}');
    a.files.put(".obsidian/workspace.json", "{}");
    a.files.put("note.md", "hi");
    await syncOnce(a.env);
    await syncOnce(b.env);

    expect([...b.files.entries.keys()]).toEqual(["note.md"]);
  });
});
