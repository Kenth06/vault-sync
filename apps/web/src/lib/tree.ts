import type { TreeEntry } from "@vault-sync/protocol";

export interface FolderNode {
  readonly kind: "folder";
  readonly name: string;
  readonly path: string;
  readonly children: TreeNode[];
}

interface FileNode {
  readonly kind: "file";
  readonly name: string;
  readonly path: string;
  readonly entry: TreeEntry;
}

export type TreeNode = FolderNode | FileNode;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function folderFor(root: FolderNode, segments: readonly string[]): FolderNode {
  let folder = root;
  for (const name of segments) {
    const path = folder.path === "" ? name : `${folder.path}/${name}`;
    const existing = folder.children.find((c): c is FolderNode => c.kind === "folder" && c.name === name);
    const next = existing ?? { kind: "folder", name, path, children: [] };
    if (existing === undefined) folder.children.push(next);
    folder = next;
  }
  return folder;
}

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === "folder" ? -1 : 1));
  for (const node of nodes) if (node.kind === "folder") sortNodes(node.children);
}

export function buildTree(files: readonly TreeEntry[]): TreeNode[] {
  const root: FolderNode = { kind: "folder", name: "", path: "", children: [] };
  for (const entry of files) {
    const segments = entry.path.split("/");
    const name = segments.pop() ?? entry.path;
    folderFor(root, segments).children.push({ kind: "file", name, path: entry.path, entry });
  }
  sortNodes(root.children);
  return root.children;
}

export function ancestorsOf(vaultPath: string): string[] {
  const segments = vaultPath.split("/").slice(0, -1);
  return segments.map((_, i) => segments.slice(0, i + 1).join("/"));
}

export function displayName(vaultPath: string): string {
  const name = vaultPath.slice(vaultPath.lastIndexOf("/") + 1);
  return name.replace(/.(?:md|canvas)$/u, "");
}

export function filterFiles(files: readonly TreeEntry[], query: string): TreeEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return [...files];
  return files.filter((f) => f.path.toLocaleLowerCase().includes(needle));
}
