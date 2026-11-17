import { Seq, Sha256, VaultPath, type Change, type Conflict } from "@vault-sync/protocol";

export interface LiveState {
  readonly hash: string;
  readonly seq: number;
}

export type LiveLookup = (path: string) => LiveState | undefined;

function conflict(path: string, live: LiveState | undefined, cursor: number): Conflict {
  return {
    path: VaultPath.parse(path),
    serverSeq: Seq.parse(live?.seq ?? cursor),
    serverHash: live === undefined ? null : Sha256.parse(live.hash),
  };
}

function staleBase(c: Change, lookup: LiveLookup, cursor: number): Conflict | null {
  if (c.baseHash === undefined) return null;
  const live = lookup(c.path);
  return (live?.hash ?? null) === c.baseHash ? null : conflict(c.path, live, cursor);
}

function staleSource(c: Change, lookup: LiveLookup, cursor: number): Conflict | null {
  if (c.op !== "rename" || c.baseHash === undefined) return null;
  const source = lookup(c.fromPath);
  return source?.hash === c.hash ? null : conflict(c.fromPath, source, cursor);
}

export function staleChanges(changes: readonly Change[], lookup: LiveLookup, cursor: number): Conflict[] {
  return changes.flatMap((c) =>
    [staleBase(c, lookup, cursor), staleSource(c, lookup, cursor)].filter((x) => x !== null),
  );
}
