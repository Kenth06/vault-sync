import { DeviceId, VaultId } from "@vault-sync/protocol";
import { z } from "zod";

export const VaultConfig = z.object({
  url: z.url(),
  vaultId: VaultId,
  deviceId: DeviceId,
});
export type VaultConfig = z.infer<typeof VaultConfig>;

export interface VaultContext {
  readonly root: string;
  readonly config: VaultConfig;
  readonly token: string;
}

export interface FileMeta {
  readonly hash: string;
  readonly size: number;
  readonly mtime: number;
}

export interface LocalFile extends FileMeta {
  readonly path: string;
  readonly absPath: string;
}

export interface SyncReport {
  readonly pulled: number;
  readonly pushed: number;
  readonly batches: number;
  readonly conflicts: string[];
  readonly failed: string[];
  readonly cursor: number;
}
