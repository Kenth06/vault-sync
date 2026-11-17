import type { ChangeRow } from "@vault-sync/protocol";

import { CHANGES_PAGE, MAX_CONFLICT_COPIES } from "../constants.ts";
import { isNotFound, withRetry } from "../errors.ts";
import { conflictName } from "../plan/conflict-name.ts";
import { planPull, type PullAction } from "../plan/pull-plan.ts";
import { remoteDelta, type RemoteState } from "../plan/remote-delta.ts";
import type { FileMeta, FileStat, LocalFile, PullReport, SyncEnvironment } from "../types.ts";
import { keepPath, scanPaths } from "./scan.ts";

interface Apply {
  readonly env: SyncEnvironment;
  readonly local: ReadonlyMap<string, LocalFile>;
  readonly reusable: ReadonlyMap<string, LocalFile>;
}

async function fetchSince(env: SyncEnvironment, since: number): Promise<ChangeRow[]> {
  const rows: ChangeRow[] = [];
  for (let cursor = since; ;) {
    const page = await withRetry(() => env.remote.changes(cursor, CHANGES_PAGE));
    rows.push(...page);
    const last = page.at(-1);
    if (last === undefined || page.length < CHANGES_PAGE) return rows;
    cursor = last.seq;
  }
}

function sameStat(a: FileStat | null, b: FileStat | null | undefined): boolean {
  if (a === null || b === null || b === undefined) return a === null && (b === null || b === undefined);
  return a.size === b.size && a.mtime === b.mtime;
}

async function moveAside(apply: Apply, vaultPath: string): Promise<void> {
  const { env } = apply;
  if ((await env.files.stat(vaultPath)) === null) return;
  const now = env.now?.() ?? new Date();
  for (let attempt = 1; attempt <= MAX_CONFLICT_COPIES; attempt += 1) {
    const copy = conflictName(vaultPath, env.device, now, attempt);
    if ((await env.files.stat(copy)) === null) {
      await env.files.rename(vaultPath, copy);
      return;
    }
  }
  throw new Error(`no free conflict name for ${vaultPath}`);
}

async function materialize(apply: Apply, vaultPath: string, remote: FileMeta): Promise<void> {
  const { env } = apply;
  const expected = await env.files.stat(vaultPath);
  const guard = async () => {
    if (!sameStat(await env.files.stat(vaultPath), expected)) await moveAside(apply, vaultPath);
  };
  const local = apply.reusable.get(remote.hash);
  if (local && local.path !== vaultPath) {
    await guard();
    await env.files.copy(local.path, vaultPath, remote.mtime);
    return;
  }
  const content = await withRetry(() => env.remote.blobContent(remote.hash));
  await env.files.write(vaultPath, content, { expectedHash: remote.hash, mtime: remote.mtime, beforeReplace: guard });
}

async function execute(apply: Apply, action: PullAction): Promise<RemoteState> {
  if (action.kind === "adopt") return action.remote;
  if (action.kind === "keep-local") return null;
  const { env } = apply;
  const untouched = sameStat(await env.files.stat(action.path), apply.local.get(action.path));
  if (action.kind === "delete") {
    if (untouched) await env.files.remove(action.path);
    return null;
  }
  if (action.kind === "conflict" || !untouched) await moveAside(apply, action.path);
  await materialize(apply, action.path, action.remote);
  return action.remote;
}

function fold(vaultPath: string): string {
  return vaultPath.normalize("NFC").toLowerCase();
}

function caseOnlyRenames(
  env: SyncEnvironment,
  actions: PullAction[],
  remote: ReadonlyMap<string, RemoteState>,
): Map<string, string> {
  if (!env.caseInsensitive) return new Map();
  const live = new Map([...remote].filter(([, state]) => state !== null).map(([p]) => [fold(p), p]));
  const renames = new Map<string, string>();
  for (const action of actions) {
    const target = live.get(fold(action.path));
    if (action.kind === "delete" && target !== undefined && target !== action.path) renames.set(action.path, target);
  }
  return renames;
}

function deletesLast(a: PullAction, b: PullAction): number {
  return (a.kind === "delete" ? 1 : 0) - (b.kind === "delete" ? 1 : 0);
}

async function applyOne(apply: Apply, action: PullAction, caseTarget: string | undefined): Promise<RemoteState> {
  if (caseTarget === undefined) return execute(apply, action);
  if ((await apply.env.files.stat(action.path)) !== null) await apply.env.files.rename(action.path, caseTarget);
  return null;
}

interface Outcome {
  readonly updates: Map<string, RemoteState>;
  readonly failed: string[];
  readonly retryLater: boolean;
}

async function applyAll(apply: Apply, actions: PullAction[], renames: Map<string, string>): Promise<Outcome> {
  const updates = new Map<string, RemoteState>();
  const failed: string[] = [];
  let retryLater = false;
  for (const action of actions) {
    try {
      updates.set(action.path, await applyOne(apply, action, renames.get(action.path)));
    } catch (error) {
      failed.push(action.path);
      if (!isNotFound(error)) retryLater = true;
    }
  }
  return { updates, failed, retryLater };
}

export async function pullOnce(env: SyncEnvironment): Promise<PullReport> {
  const since = env.store.cursor();
  const rows = await fetchSince(env, since);
  const cursor = rows.at(-1)?.seq ?? since;
  const keep = keepPath(env);
  const remote = new Map([...remoteDelta(rows)].filter(([p]) => keep(p)));
  if (remote.size === 0) {
    await env.store.applyPulled(new Map(), cursor);
    return { applied: 0, conflicts: [], failed: [], cursor };
  }

  const base = env.store.synced();
  const local = await scanPaths(env, remote.keys());
  const actions = planPull({ remote, base, local }).toSorted(deletesLast);
  const reusable = new Map(
    [...local.values()].filter((f) => base.get(f.path)?.hash === f.hash).map((f) => [f.hash, f]),
  );
  const outcome = await applyAll({ env, local, reusable }, actions, caseOnlyRenames(env, actions, remote));
  const next = outcome.retryLater ? since : cursor;
  await env.store.applyPulled(outcome.updates, next);
  return {
    applied: actions.filter((a) => a.kind !== "adopt" && !outcome.failed.includes(a.path)).length,
    conflicts: actions.filter((a) => a.kind === "conflict").map((a) => a.path),
    failed: outcome.failed,
    cursor: next,
  };
}
