import { randomUUID } from "node:crypto";

import { BatchId, Seq, type Change } from "@vault-sync/protocol";

import { ApiClient } from "../clients/api.client.ts";
import type { LocalFile, SyncReport, VaultContext } from "../common/types.ts";
import { loadIgnore } from "../storage/ignore-file.ts";
import type { LocalState } from "../storage/local-state.ts";
import { diffTrees, toBatches } from "../utils/diff.ts";
import { scanVault } from "./scan.service.ts";
import { uploadMissing } from "./upload.service.ts";

interface BatchContext {
  readonly client: ApiClient;
  readonly ctx: VaultContext;
  readonly state: LocalState;
  readonly byHash: ReadonlyMap<string, LocalFile>;
}

function indexByHash(files: ReadonlyMap<string, LocalFile>): Map<string, LocalFile> {
  return new Map([...files.values()].map((f) => [f.hash, f]));
}

async function pushBatch(batch: BatchContext, changes: Change[]): Promise<number> {
  const { client, ctx, state, byHash } = batch;
  const { vaultId } = ctx.config;
  const baseCursor = Seq.parse(state.cursor());
  const plan = await client.plan(vaultId, { baseCursor, changes });
  await uploadMissing(client, plan.missing, byHash);
  const result = await client.commit(vaultId, { batchId: BatchId.parse(randomUUID()), baseCursor, changes });
  state.applyCommitted(changes, result.cursor);
  return result.cursor;
}

export async function syncOnce(ctx: VaultContext, state: LocalState): Promise<SyncReport> {
  const files = await scanVault(ctx.root, await loadIgnore(ctx.root), state);
  const changes = diffTrees(files, state.synced());
  const batches = toBatches(changes);
  const context: BatchContext = {
    client: new ApiClient(ctx.config.url, ctx.token),
    ctx,
    state,
    byHash: indexByHash(files),
  };

  let cursor = state.cursor();
  for (const batch of batches) cursor = await pushBatch(context, batch);

  state.setMeta("lastSyncAt", new Date().toISOString());
  state.setMeta("lastError", "");
  return { changes: changes.length, batches: batches.length, cursor };
}
