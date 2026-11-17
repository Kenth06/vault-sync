import { TreeEntry } from "@vault-sync/protocol";
import { describe, expect, it } from "vitest";

import { ancestorsOf, buildTree, displayName, filterFiles, type TreeNode } from "../src/lib/tree.ts";

function entry(path: string): TreeEntry {
  return TreeEntry.parse({ path, hash: "0".repeat(64), size: 1, mtime: 1 });
}

function names(nodes: readonly TreeNode[]): string[] {
  return nodes.map((n) => (n.kind === "folder" ? `${n.name}/` : n.name));
}

describe("buildTree", () => {
  it("nests folders, lists folders first and sorts numbers naturally", () => {
    const tree = buildTree(["b.md", "Notes/10.md", "Notes/2.md", "a.md", "Archive/x.md"].map(entry));
    expect(names(tree)).toEqual(["Archive/", "Notes/", "a.md", "b.md"]);
    expect(tree[1]).toMatchObject({ kind: "folder", children: [{ name: "2.md" }, { name: "10.md" }] });
  });
});

describe("path helpers", () => {
  it("lists ancestors, names and filters", () => {
    expect(ancestorsOf("a/b/c.md")).toEqual(["a", "a/b"]);
    expect(displayName("a/Plan.md")).toBe("Plan");
    expect(displayName("a/photo.png")).toBe("photo.png");
    expect(filterFiles(["Ideas/Plan.md", "Inbox.md"].map(entry), "plan").map((f) => f.path)).toEqual(["Ideas/Plan.md"]);
  });
});
