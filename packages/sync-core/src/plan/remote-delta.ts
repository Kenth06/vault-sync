import type { ChangeRow } from "@vault-sync/protocol";

import type { FileMeta } from "../types.ts";

export type RemoteState = FileMeta | null;

export function remoteDelta(rows: readonly ChangeRow[]): Map<string, RemoteState> {
  const delta = new Map<string, RemoteState>();
  for (const row of rows) {
    if (row.op === "rename" && row.fromPath !== null) delta.set(row.fromPath, null);
    if (row.op === "delete" || row.hash === null) {
      delta.set(row.path, null);
      continue;
    }
    delta.set(row.path, { hash: row.hash, size: row.size ?? 0, mtime: row.mtime ?? row.at });
  }
  return delta;
}
