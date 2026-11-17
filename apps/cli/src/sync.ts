import { randomUUID } from "node:crypto";
import { BatchId, Seq, type Change } from "@vault-sync/protocol";
import { ApiClient } from "./client.ts";
import type { VaultContext } from "./config.ts";
import { diffTrees, toBatches } from "./diff.ts";
import { loadIgnore } from "./ignore.ts";
import { scanVault, type LocalFile } from "./scan.ts";
import type { LocalState } from "./state.ts";
import { uploadMissing } from "./upload.ts";

export interface SyncReport {
  readonly changes: number;
  readonly batches: number;
  readonly cursor: number;
}

function indexByHash(files: ReadonlyMap<string, LocalFile>): Map<string, LocalFile> {
  return new Map([...files.values()].map((f) => [f.hash, f]));
}

async function pushBatch(client: ApiClient, ctx: VaultContext, state: LocalState, batch: { changes: Change[]; byHash: Map<string, LocalFile> }): Promise<number> {
  const { vaultId } = ctx.config;
  const baseCursor = Seq.parse(state.cursor());
  const plan = await client.plan(vaultId, { baseCursor, changes: batch.changes });
  await uploadMissing(client, plan.missing, batch.byHash);
  const result = await client.commit(vaultId, { batchId: BatchId.parse(randomUUID()), baseCursor, changes: batch.changes });
  state.applyCommitted(batch.changes, result.cursor);
  return result.cursor;
}

/** One full pass: scan, diff against the last synced manifest, push in batches. */
export async function syncOnce(ctx: VaultContext, state: LocalState): Promise<SyncReport> {
  const files = await scanVault(ctx.root, await loadIgnore(ctx.root), state);
  const changes = diffTrees(files, state.synced());
  const batches = toBatches(changes);
  const client = new ApiClient(ctx.config.url, ctx.token);
  const byHash = indexByHash(files);

  let cursor = state.cursor();
  for (const batch of batches) cursor = await pushBatch(client, ctx, state, { changes: batch, byHash });

  state.setMeta("lastSyncAt", new Date().toISOString());
  state.setMeta("lastError", "");
  return { changes: changes.length, batches: batches.length, cursor };
}
