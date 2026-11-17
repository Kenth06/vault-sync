import { DeviceId, VaultId } from "@vault-sync/protocol";
import { z } from "zod";

export const Settings = z.object({
  url: z.string().default(""),
  vaultId: z.string().default(""),
  deviceName: z.string().default(""),
  deviceId: DeviceId.nullable().default(null),
  liveUpdates: z.boolean().default(true),
});
export type Settings = z.infer<typeof Settings>;

export interface ConnectedSettings {
  readonly url: string;
  readonly vaultId: VaultId;
  readonly deviceId: DeviceId;
}

export function connected(settings: Settings): ConnectedSettings | null {
  const vaultId = VaultId.safeParse(settings.vaultId);
  if (settings.url === "" || !vaultId.success || settings.deviceId === null) return null;
  return { url: settings.url, vaultId: vaultId.data, deviceId: settings.deviceId };
}

export function secretId(vaultId: string): string {
  return `vault-sync-${vaultId}`;
}
