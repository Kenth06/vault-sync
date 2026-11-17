import { DeviceId, VaultId } from "@vault-sync/protocol";
import { z } from "zod";

export type { SyncReport } from "@vault-sync/sync-core";

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
