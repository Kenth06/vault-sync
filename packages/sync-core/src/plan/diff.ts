import { Change, MAX_BATCH_CHANGES } from "@vault-sync/protocol";

import { MAX_BATCH_BYTES } from "../constants.ts";
import type { FileMeta } from "../types.ts";

export function diffTrees(local: ReadonlyMap<string, FileMeta>, synced: ReadonlyMap<string, FileMeta>): Change[] {
  const removed = [...synced].filter(([p]) => !local.has(p));
  const changed = [...local].filter(([p, meta]) => synced.get(p)?.hash !== meta.hash);
  const added = new Map(changed.filter(([p]) => !synced.has(p)));

  const renames: Change[] = [];
  const deletes: Change[] = [];
  for (const [fromPath, old] of removed) {
    const target = [...added].find(([, meta]) => meta.hash === old.hash);
    if (target) {
      const [newPath, meta] = target;
      added.delete(newPath);
      renames.push(Change.parse({ op: "rename", path: newPath, fromPath, ...meta, baseHash: null }));
    } else {
      deletes.push(Change.parse({ op: "delete", path: fromPath, baseHash: old.hash }));
    }
  }

  const puts = changed
    .filter(([p]) => synced.has(p) || added.has(p))
    .map(([p, meta]) => Change.parse({ op: "put", path: p, ...meta, baseHash: synced.get(p)?.hash ?? null }));

  return [...renames, ...puts, ...deletes];
}

function newBytes(change: Change): number {
  return change.op === "put" ? change.size : 0;
}

export function toBatches(changes: readonly Change[]): Change[][] {
  const batches: Change[][] = [];
  let current: Change[] = [];
  let bytes = 0;
  for (const change of changes) {
    const size = newBytes(change);
    const full = current.length >= MAX_BATCH_CHANGES || (current.length > 0 && bytes + size > MAX_BATCH_BYTES);
    if (full) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(change);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
