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
