import { z } from "zod";

import { DeviceId, Seq } from "./ids.ts";

export const WS_PROTOCOL = "vaultsync.v1";
export const WS_PING = "ping";
export const WS_PONG = "pong";

export const ChangedEvent = z.object({
  type: z.literal("changed"),
  cursor: Seq,
  deviceId: DeviceId,
});
export type ChangedEvent = z.infer<typeof ChangedEvent>;

export const VaultEvent = z.discriminatedUnion("type", [ChangedEvent]);
export type VaultEvent = z.infer<typeof VaultEvent>;

export function tokenFromProtocols(header: string | null | undefined): string | null {
  const offered = (header ?? "").split(",").map((p) => p.trim());
  if (!offered.includes(WS_PROTOCOL)) return null;
  return offered.find((p) => p !== WS_PROTOCOL && p !== "") ?? null;
}
