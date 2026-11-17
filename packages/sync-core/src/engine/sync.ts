import { isStaleBase } from "../errors.ts";
import type { PushReport, SyncEnvironment, SyncReport } from "../types.ts";
import { pullOnce } from "./pull.ts";
import { pushOnce } from "./push.ts";

async function pushWithRebase(env: SyncEnvironment): Promise<{ push: PushReport; conflicts: string[] }> {
  try {
    return { push: await pushOnce(env), conflicts: [] };
  } catch (error) {
    if (!isStaleBase(error)) throw error;
    const pulled = await pullOnce(env);
    return { push: await pushOnce(env), conflicts: pulled.conflicts };
  }
}

export async function syncOnce(env: SyncEnvironment): Promise<SyncReport> {
  const pulled = await pullOnce(env);
  const { push, conflicts } = await pushWithRebase(env);
  return {
    pulled: pulled.applied,
    pushed: push.changes,
    batches: push.batches,
    conflicts: [...pulled.conflicts, ...conflicts],
    failed: pulled.failed,
    cursor: env.store.cursor(),
  };
}

export async function pullOnly(env: SyncEnvironment): Promise<SyncReport> {
  const pulled = await pullOnce(env);
  return {
    pulled: pulled.applied,
    pushed: 0,
    batches: 0,
    conflicts: pulled.conflicts,
    failed: pulled.failed,
    cursor: pulled.cursor,
  };
}
