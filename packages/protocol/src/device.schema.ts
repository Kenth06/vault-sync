import { z } from "zod";

import { DeviceId, Seq, VaultId } from "./ids.ts";
import { MAX_DEVICE_NAME_LENGTH } from "./limits.ts";

export const EnrollRequest = z.object({
  vaultId: VaultId,
  name: z.string().min(1).max(MAX_DEVICE_NAME_LENGTH),
});
export type EnrollRequest = z.infer<typeof EnrollRequest>;

export const EnrollResponse = z.object({
  deviceId: DeviceId,
  token: z.string(),
  cursor: Seq,
});
export type EnrollResponse = z.infer<typeof EnrollResponse>;

export const DeviceInfo = z.object({
  id: DeviceId,
  name: z.string(),
  cursor: Seq,
  lastSeen: z.number().int().nullable(),
  revoked: z.boolean(),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export const DeviceSummary = DeviceInfo.pick({ id: true, name: true, lastSeen: true });
export type DeviceSummary = z.infer<typeof DeviceSummary>;

export const VaultScope = z.object({ vaultId: VaultId });
export type VaultScope = z.infer<typeof VaultScope>;

export const DeviceParam = z.object({ deviceId: DeviceId });
