import type { FileMeta } from "../types.ts";
import type { RemoteState } from "./remote-delta.ts";

export type PullAction =
  | { readonly kind: "adopt"; readonly path: string; readonly remote: RemoteState }
  | { readonly kind: "write"; readonly path: string; readonly remote: FileMeta }
  | { readonly kind: "delete"; readonly path: string }
  | { readonly kind: "conflict"; readonly path: string; readonly remote: FileMeta }
  | { readonly kind: "keep-local"; readonly path: string };

export interface PullInputs {
  readonly remote: ReadonlyMap<string, RemoteState>;
  readonly base: ReadonlyMap<string, FileMeta>;
  readonly local: ReadonlyMap<string, FileMeta>;
}

function hashAt(map: ReadonlyMap<string, FileMeta>, path: string): string | null {
  return map.get(path)?.hash ?? null;
}

function applyRemote(path: string, remote: RemoteState): PullAction {
  return remote === null ? { kind: "delete", path } : { kind: "write", path, remote };
}

function diverged(path: string, remote: RemoteState, localHash: string | null): PullAction {
  if (remote === null) return { kind: "keep-local", path };
  if (localHash === null) return { kind: "write", path, remote };
  return { kind: "conflict", path, remote };
}

function decide(path: string, remote: RemoteState, inputs: PullInputs): PullAction {
  const remoteHash = remote?.hash ?? null;
  const baseHash = hashAt(inputs.base, path);
  const localHash = hashAt(inputs.local, path);
  if (baseHash === remoteHash || localHash === remoteHash) return { kind: "adopt", path, remote };
  if (localHash === baseHash) return applyRemote(path, remote);
  return diverged(path, remote, localHash);
}

export function planPull(inputs: PullInputs): PullAction[] {
  return [...inputs.remote].map(([path, remote]) => decide(path, remote, inputs));
}
