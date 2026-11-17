import { z } from "zod";

export const Sha256 = z
  .string()
  .regex(/^[\da-f]{64}$/u, "expected lowercase hex sha256")
  .brand<"Sha256">();
export type Sha256 = z.infer<typeof Sha256>;

export const VaultId = z
  .string()
  .regex(/^[\da-z][\da-z-]{1,62}$/u, "vault id: 2-63 chars, lowercase letters, digits and dashes")
  .brand<"VaultId">();
export type VaultId = z.infer<typeof VaultId>;

export const DeviceId = z
  .string()
  .regex(/^dev_[\da-f]{16}$/u, "invalid device id")
  .brand<"DeviceId">();
export type DeviceId = z.infer<typeof DeviceId>;

export const Seq = z.number().int().nonnegative().brand<"Seq">();
export type Seq = z.infer<typeof Seq>;

export const BatchId = z.uuid().brand<"BatchId">();
export type BatchId = z.infer<typeof BatchId>;

export function blobKey(vaultId: VaultId, hash: Sha256): string {
  return `vaults/${vaultId}/blobs/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
}

export function snapshotKey(vaultId: VaultId, seq: Seq): string {
  return `vaults/${vaultId}/snapshots/${seq}.json.gz`;
}

export const TOKEN_PREFIX = "vs1";

export interface ParsedToken {
  readonly vaultId: VaultId;
  readonly deviceId: DeviceId;
}

const SECRET = /^[\w-]{43}$/u;

export function parseToken(token: string): ParsedToken | null {
  const [prefix, vault, device, secret, ...rest] = token.split(".");
  if (prefix !== TOKEN_PREFIX || rest.length > 0 || !SECRET.test(secret ?? "")) return null;
  const vaultId = VaultId.safeParse(vault);
  const deviceId = DeviceId.safeParse(device);
  return vaultId.success && deviceId.success ? { vaultId: vaultId.data, deviceId: deviceId.data } : null;
}
