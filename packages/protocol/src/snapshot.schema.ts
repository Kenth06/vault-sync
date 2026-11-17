import { z } from "zod";

import { Seq, VaultId } from "./ids.ts";
import { TreeEntry } from "./vault.schema.ts";

export const SnapshotInfo = z.object({
  seq: Seq,
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  at: z.number().int(),
});
export type SnapshotInfo = z.infer<typeof SnapshotInfo>;

export const SnapshotManifest = z.object({
  vaultId: VaultId,
  seq: Seq,
  createdAt: z.number().int(),
  files: z.array(TreeEntry),
});
export type SnapshotManifest = z.infer<typeof SnapshotManifest>;

export const SnapshotParam = z.object({
  seq: z.coerce.number().int().nonnegative(),
});
