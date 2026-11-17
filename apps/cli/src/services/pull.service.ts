import { access, copyFile, mkdir, rename, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { TreeEntry, type ChangeRow } from "@vault-sync/protocol";

import type { ApiClient } from "../clients/api.client.ts";
import { STATE_DIR, TMP_SUFFIX } from "../common/constants.ts";
import { ApiError } from "../common/errors.ts";
import type { FileMeta, LocalFile, VaultContext } from "../common/types.ts";
import { loadIgnore } from "../storage/ignore-file.ts";
import type { LocalState } from "../storage/local-state.ts";
import { conflictName } from "../utils/conflict-name.ts";
import type { IgnoreFn } from "../utils/ignore.ts";
import { planPull, type PullAction } from "../utils/pull-plan.ts";
import { remoteDelta, type RemoteState } from "../utils/remote-delta.ts";
import { assertInside, foldPath, lexicalTarget, snapshot, unchangedSince, unsafeOnThisPlatform } from "./fs-safety.ts";
import { downloadVerified } from "./restore.service.ts";
import { scanPaths } from "./scan.service.ts";

const PAGE = 500;
const MS_PER_SECOND = 1000;
const NOT_FOUND = 404;
const MAX_COPY_ATTEMPTS = 100;

export type PullClient = Pick<ApiClient, "changes" | "blobContent">;

export interface PullReport {
  readonly applied: number;
  readonly conflicts: string[];
  readonly failed: string[];
  readonly cursor: number;
}

interface ApplyContext {
  readonly client: PullClient;
  readonly root: string;
  readonly local: ReadonlyMap<string, LocalFile>;
  readonly reusable: ReadonlyMap<string, LocalFile>;
}

async function fetchSince(client: PullClient, ctx: VaultContext, since: number): Promise<ChangeRow[]> {
  const rows: ChangeRow[] = [];
  for (let cursor = since; ;) {
    const page = await client.changes(ctx.config.vaultId, cursor, PAGE);
    rows.push(...page);
    const last = page.at(-1);
    if (last === undefined || page.length < PAGE) return rows;
    cursor = last.seq;
  }
}

function pullable(isIgnored: IgnoreFn): (vaultPath: string) => boolean {
  return (vaultPath) =>
    !vaultPath.startsWith(`${STATE_DIR}/`) &&
    !vaultPath.endsWith(TMP_SUFFIX) &&
    !isIgnored(vaultPath) &&
    !unsafeOnThisPlatform(vaultPath);
}

function exists(absPath: string): Promise<boolean> {
  return access(absPath).then(
    () => true,
    () => false,
  );
}

async function moveAside(apply: ApplyContext, vaultPath: string): Promise<string | null> {
  const source = path.join(apply.root, vaultPath);
  if (!(await exists(source))) return null;
  const now = new Date();
  for (let attempt = 1; attempt <= MAX_COPY_ATTEMPTS; attempt += 1) {
    const copy = conflictName(vaultPath, os.hostname(), now, attempt);
    if (!(await exists(path.join(apply.root, copy)))) {
      await rename(source, path.join(apply.root, copy));
      return copy;
    }
  }
  throw new Error(`no free conflict name for ${vaultPath}`);
}

async function materialize(apply: ApplyContext, vaultPath: string, remote: FileMeta): Promise<void> {
  const target = lexicalTarget(apply.root, vaultPath);
  await mkdir(path.dirname(target), { recursive: true });
  await assertInside(apply.root, path.dirname(target));
  const expected = await snapshot(target);
  const guard = async () => {
    if (!(await unchangedSince(target, expected))) await moveAside(apply, vaultPath);
  };
  const local = apply.reusable.get(remote.hash);
  if (local && local.path !== vaultPath) {
    await guard();
    await copyFile(local.absPath, target);
    await utimes(target, remote.mtime / MS_PER_SECOND, remote.mtime / MS_PER_SECOND);
    return;
  }
  await downloadVerified(apply.client, TreeEntry.parse({ path: vaultPath, ...remote }), target, guard);
}

async function execute(apply: ApplyContext, action: PullAction): Promise<RemoteState> {
  if (action.kind === "adopt") return action.remote;
  if (action.kind === "keep-local") return null;
  const absPath = path.join(apply.root, action.path);
  const untouched = await unchangedSince(absPath, apply.local.get(action.path));
  if (action.kind === "delete") {
    if (untouched) await rm(absPath, { force: true });
    return null;
  }
  if (action.kind === "conflict" || !untouched) await moveAside(apply, action.path);
  await materialize(apply, action.path, action.remote);
  return action.remote;
}

function caseOnlyRenames(actions: PullAction[], remote: ReadonlyMap<string, RemoteState>): Map<string, string> {
  const live = new Map([...remote].filter(([, state]) => state !== null).map(([p]) => [foldPath(p), p]));
  const renames = new Map<string, string>();
  for (const action of actions) {
    const target = live.get(foldPath(action.path));
    if (action.kind === "delete" && target !== undefined && target !== action.path) renames.set(action.path, target);
  }
  return renames;
}

function deletesLast(a: PullAction, b: PullAction): number {
  return (a.kind === "delete" ? 1 : 0) - (b.kind === "delete" ? 1 : 0);
}

interface Outcome {
  readonly updates: Map<string, RemoteState>;
  readonly failed: string[];
  readonly retryLater: boolean;
}

async function applyOne(apply: ApplyContext, action: PullAction, caseTarget: string | undefined): Promise<RemoteState> {
  if (caseTarget === undefined) return execute(apply, action);
  if (!(await exists(path.join(apply.root, action.path)))) return null;
  await rename(path.join(apply.root, action.path), path.join(apply.root, caseTarget));
  return null;
}

async function applyAll(apply: ApplyContext, actions: PullAction[], renames: Map<string, string>): Promise<Outcome> {
  const updates = new Map<string, RemoteState>();
  const failed: string[] = [];
  let retryLater = false;
  for (const action of actions) {
    try {
      updates.set(action.path, await applyOne(apply, action, renames.get(action.path)));
    } catch (error) {
      failed.push(action.path);
      if (!(error instanceof ApiError && error.status === NOT_FOUND)) retryLater = true;
    }
  }
  return { updates, failed, retryLater };
}

export async function pullOnce(client: PullClient, ctx: VaultContext, state: LocalState): Promise<PullReport> {
  const since = state.cursor();
  const rows = await fetchSince(client, ctx, since);
  const cursor = rows.at(-1)?.seq ?? since;
  const keep = pullable(await loadIgnore(ctx.root));
  const remote = new Map([...remoteDelta(rows)].filter(([p]) => keep(p)));
  if (remote.size === 0) {
    state.applyPulled(new Map(), cursor);
    return { applied: 0, conflicts: [], failed: [], cursor };
  }

  const base = state.synced();
  const local = await scanPaths(ctx.root, remote.keys(), state);
  const actions = planPull({ remote, base, local }).toSorted(deletesLast);
  const reusable = new Map(
    [...local.values()].filter((f) => base.get(f.path)?.hash === f.hash).map((f) => [f.hash, f]),
  );
  const apply = { client, root: ctx.root, local, reusable };
  const outcome = await applyAll(apply, actions, caseOnlyRenames(actions, remote));
  const next = outcome.retryLater ? since : cursor;
  state.applyPulled(outcome.updates, next);
  return {
    applied: actions.filter((a) => a.kind !== "adopt" && !outcome.failed.includes(a.path)).length,
    conflicts: actions.filter((a) => a.kind === "conflict").map((a) => a.path),
    failed: outcome.failed,
    cursor: next,
  };
}
