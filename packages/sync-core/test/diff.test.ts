import { MAX_BATCH_CHANGES } from "@vault-sync/protocol";
import { describe, expect, it } from "vitest";

import { MAX_BATCH_BYTES } from "../src/constants.ts";
import { diffTrees, toBatches } from "../src/plan/diff.ts";
import { buildIgnore } from "../src/plan/ignore.ts";
import type { FileMeta } from "../src/types.ts";

const meta = (hash: string, size = 10): FileMeta => ({ hash: hash.repeat(64).slice(0, 64), size, mtime: 1 });

describe("diffTrees", () => {
  it("emits put for new and modified files", () => {
    const synced = new Map([["a.md", meta("a")]]);
    const local = new Map([
      ["a.md", meta("b")],
      ["c.md", meta("c")],
    ]);
    expect(diffTrees(local, synced).map((c) => [c.op, c.path])).toEqual([
      ["put", "a.md"],
      ["put", "c.md"],
    ]);
  });

  it("turns a vanished path plus a new path with the same hash into a rename", () => {
    const synced = new Map([["old/note.md", meta("a")]]);
    const local = new Map([["new/note.md", meta("a")]]);
    expect(diffTrees(local, synced)).toEqual([
      expect.objectContaining({ op: "rename", path: "new/note.md", fromPath: "old/note.md" }),
    ]);
  });

  it("deletes paths that vanished without a matching new file", () => {
    expect(diffTrees(new Map(), new Map([["gone.md", meta("a")]]))).toEqual([
      { op: "delete", path: "gone.md", baseHash: meta("a").hash },
    ]);
  });

  it("returns nothing when trees match", () => {
    const tree = new Map([["a.md", meta("a")]]);
    expect(diffTrees(tree, tree)).toEqual([]);
  });
});

describe("toBatches", () => {
  it("splits on change count", () => {
    const changes = diffTrees(
      new Map(Array.from({ length: MAX_BATCH_CHANGES + 1 }, (_, i) => [`n${i}.md`, meta(String(i % 10))])),
      new Map(),
    );
    expect(toBatches(changes).map((b) => b.length)).toEqual([MAX_BATCH_CHANGES, 1]);
  });

  it("splits on new bytes", () => {
    const big = MAX_BATCH_BYTES - 1;
    const changes = diffTrees(
      new Map([
        ["a.bin", meta("a", big)],
        ["b.bin", meta("b", 2)],
      ]),
      new Map(),
    );
    expect(toBatches(changes).map((b) => b.length)).toEqual([1, 1]);
  });
});

describe("ignore rules", () => {
  const isIgnored = buildIgnore(["Private/"]);

  it.each([".vaultsync/state.db", ".obsidian/workspace.json", ".obsidian/cache", ".trash/x.md", "Private/diary.md"])(
    "ignores %s",
    (p) => {
      expect(isIgnored(p)).toBe(true);
    },
  );

  it.each([".obsidian/app.json", ".obsidian/plugins/dataview/main.js", ".obsidian/snippets/a.css", "Notas/a.md"])(
    "keeps %s",
    (p) => {
      expect(isIgnored(p)).toBe(false);
    },
  );
});
