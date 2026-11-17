import { z } from "zod";

import { Sha256 } from "./ids.ts";
import { MAX_BATCH_CHANGES } from "./limits.ts";
import { VaultPath } from "./path.ts";

const Mtime = z.number().int().nonnegative();
const Size = z.number().int().nonnegative();
const BaseHash = Sha256.nullable().optional();

export const PutChange = z.object({
  op: z.literal("put"),
  path: VaultPath,
  hash: Sha256,
  size: Size,
  mtime: Mtime,
  baseHash: BaseHash,
});
export type PutChange = z.infer<typeof PutChange>;

export const DeleteChange = z.object({
  op: z.literal("delete"),
  path: VaultPath,
  baseHash: BaseHash,
});
export type DeleteChange = z.infer<typeof DeleteChange>;

export const RenameChange = z.object({
  op: z.literal("rename"),
  path: VaultPath,
  fromPath: VaultPath,
  hash: Sha256,
  size: Size,
  mtime: Mtime,
  baseHash: BaseHash,
});
export type RenameChange = z.infer<typeof RenameChange>;

export const Change = z.discriminatedUnion("op", [PutChange, DeleteChange, RenameChange]);
export type Change = z.infer<typeof Change>;

function touchedPaths(change: Change): string[] {
  return change.op === "rename" ? [change.path, change.fromPath] : [change.path];
}

export const ChangeBatch = z
  .array(Change)
  .min(1)
  .max(MAX_BATCH_CHANGES)
  .refine((changes) => {
    const paths = changes.flatMap(touchedPaths);
    return new Set(paths).size === paths.length;
  }, "a batch may touch each path only once");
