import { z } from "zod";

import { ChangeBatch } from "./change.schema.ts";
import { BatchId, Seq, Sha256 } from "./ids.ts";
import { VaultPath } from "./path.ts";

export const PlanRequest = z.object({
  baseCursor: Seq,
  changes: ChangeBatch,
});
export type PlanRequest = z.infer<typeof PlanRequest>;

export const Conflict = z.object({
  path: VaultPath,
  serverSeq: Seq,
  serverHash: Sha256.nullable(),
});
export type Conflict = z.infer<typeof Conflict>;

export const PlanResponse = z.object({
  cursor: Seq,
  missing: z.array(Sha256),
  conflicts: z.array(Conflict),
});
export type PlanResponse = z.infer<typeof PlanResponse>;

export const CommitRequest = z.object({
  batchId: BatchId,
  baseCursor: Seq,
  changes: ChangeBatch,
});
export type CommitRequest = z.infer<typeof CommitRequest>;

export const CommitResponse = z.object({
  batchId: BatchId,
  seqFrom: Seq.nullable(),
  seqTo: Seq.nullable(),
  cursor: Seq,
  replayed: z.boolean(),
});
export type CommitResponse = z.infer<typeof CommitResponse>;

export const CommitConflicts = z.object({
  conflicts: z.array(Conflict).min(1),
});
export type CommitConflicts = z.infer<typeof CommitConflicts>;

export const MissingBlobs = z.object({
  missing: z.array(Sha256).min(1),
});
export type MissingBlobs = z.infer<typeof MissingBlobs>;
