import { z } from "zod";

import { DeviceId, Seq, Sha256, VaultId } from "./ids.ts";
import { DEFAULT_PAGE_SIZE, MAX_HISTORY_ENTRIES, MAX_PAGE_SIZE } from "./limits.ts";
import { VaultPath } from "./path.ts";

export const ChangesQuery = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ChangesQuery = z.infer<typeof ChangesQuery>;

export const ChangeRow = z.object({
  seq: Seq,
  op: z.enum(["put", "delete", "rename"]),
  path: z.string(),
  fromPath: z.string().nullable(),
  hash: Sha256.nullable(),
  prevHash: Sha256.nullable(),
  size: z.number().int().nonnegative().nullable(),
  mtime: z.number().int().nonnegative().nullable(),
  deviceId: DeviceId,
  at: z.number().int(),
});
export type ChangeRow = z.infer<typeof ChangeRow>;

export const TreeEntry = z.object({
  path: z.string(),
  hash: Sha256,
  size: z.number().int().nonnegative(),
  mtime: z.number().int().nonnegative(),
});
export type TreeEntry = z.infer<typeof TreeEntry>;

export const TreeQuery = z.object({
  at: z.coerce.number().int().nonnegative().optional(),
});
export type TreeQuery = z.infer<typeof TreeQuery>;

export const TreeResponse = z.object({
  seq: Seq,
  files: z.array(TreeEntry),
});
export type TreeResponse = z.infer<typeof TreeResponse>;

export const HistoryQuery = z.object({
  path: VaultPath,
  limit: z.coerce.number().int().min(1).max(MAX_HISTORY_ENTRIES).default(MAX_HISTORY_ENTRIES),
});
export type HistoryQuery = z.infer<typeof HistoryQuery>;

export const VaultStatus = z.object({
  vaultId: VaultId,
  cursor: Seq,
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  deviceCursor: Seq,
});
export type VaultStatus = z.infer<typeof VaultStatus>;
