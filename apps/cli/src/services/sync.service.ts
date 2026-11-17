import { CommitConflicts } from "@vault-sync/protocol";

import { ApiClient } from "../clients/api.client.ts";
import { ApiError } from "../common/errors.ts";
import type { SyncReport, VaultContext } from "../common/types.ts";
import type { LocalState } from "../storage/local-state.ts";
import { pullOnce } from "./pull.service.ts";
import { pushOnce, type PushReport } from "./push.service.ts";

function isStaleBase(error: unknown): boolean {
  return error instanceof ApiError && error.code === "ERR_CONFLICT" && CommitConflicts.safeParse(error.details).success;
}

async function pushWithRebase(
  client: ApiClient,
  ctx: VaultContext,
  state: LocalState,
): Promise<{ push: PushReport; conflicts: string[] }> {
  try {
    return { push: await pushOnce(client, ctx, state), conflicts: [] };
  } catch (error) {
    if (!isStaleBase(error)) throw error;
    const pulled = await pullOnce(client, ctx, state);
    return { push: await pushOnce(client, ctx, state), conflicts: pulled.conflicts };
  }
}

export async function syncOnce(ctx: VaultContext, state: LocalState): Promise<SyncReport> {
  const client = new ApiClient(ctx.config.url, ctx.token);
  const pulled = await pullOnce(client, ctx, state);
  const { push, conflicts } = await pushWithRebase(client, ctx, state);

  state.setMeta("lastSyncAt", new Date().toISOString());
  state.setMeta("lastError", "");
  return {
    pulled: pulled.applied,
    pushed: push.changes,
    batches: push.batches,
    conflicts: [...pulled.conflicts, ...conflicts],
    failed: pulled.failed,
    cursor: state.cursor(),
  };
}

export function pushOnly(ctx: VaultContext, state: LocalState): Promise<PushReport> {
  return pushOnce(new ApiClient(ctx.config.url, ctx.token), ctx, state);
}

export async function pullOnly(ctx: VaultContext, state: LocalState): Promise<SyncReport> {
  const pulled = await pullOnce(new ApiClient(ctx.config.url, ctx.token), ctx, state);
  return {
    pulled: pulled.applied,
    pushed: 0,
    batches: 0,
    conflicts: pulled.conflicts,
    failed: pulled.failed,
    cursor: pulled.cursor,
  };
}
