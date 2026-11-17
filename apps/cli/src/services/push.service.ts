import { randomUUID } from "node:crypto";

import { BatchId, Seq, type Change } from "@vault-sync/protocol";

import type { ApiClient } from "../clients/api.client.ts";
import type { LocalFile, VaultContext } from "../common/types.ts";
import { loadIgnore } from "../storage/ignore-file.ts";
import type { LocalState } from "../storage/local-state.ts";
import { diffTrees, toBatches } from "../utils/diff.ts";
import { scanVault } from "./scan.service.ts";
import { uploadMissing } from "./upload.service.ts";

export interface PushReport {
  readonly changes: number;
  readonly batches: number;
}

interface BatchContext {
  readonly client: ApiClient;
  readonly ctx: VaultContext;
  readonly state: LocalState;
  readonly byHash: ReadonlyMap<string, LocalFile>;
}

function indexByHash(files: ReadonlyMap<string, LocalFile>): Map<string, LocalFile> {
  return new Map([...files.values()].map((f) => [f.hash, f]));
}

async function pushBatch(batch: BatchContext, changes: Change[]): Promise<void> {
  const { client, ctx, state, byHash } = batch;
  const { vaultId } = ctx.config;
  const baseCursor = state.cursor();
  const base = Seq.parse(baseCursor);
  const plan = await client.plan(vaultId, { baseCursor: base, changes });
  await uploadMissing(client, plan.missing, byHash);
  const result = await client.commit(vaultId, { batchId: BatchId.parse(randomUUID()), baseCursor: base, changes });
  const contiguous = result.seqFrom === baseCursor + 1 && result.seqTo !== null;
  state.applyCommitted(changes, contiguous ? (result.seqTo ?? baseCursor) : baseCursor);
}

export async function pushOnce(client: ApiClient, ctx: VaultContext, state: LocalState): Promise<PushReport> {
  const files = await scanVault(ctx.root, await loadIgnore(ctx.root), state);
  const changes = diffTrees(files, state.synced());
  const batches = toBatches(changes);
  const context: BatchContext = { client, ctx, state, byHash: indexByHash(files) };
  for (const batch of batches) await pushBatch(context, batch);
  return { changes: changes.length, batches: batches.length };
}
