import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Entry } from "@napi-rs/keyring";
import { DeviceId, VaultId } from "@vault-sync/protocol";
import { z } from "zod";

export const STATE_DIR = ".vaultsync";
const KEYRING_SERVICE = "vault-sync";

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

function configFile(root: string): string {
  return path.join(root, STATE_DIR, "config.json");
}

function keyringEntry(config: VaultConfig): Entry {
  return new Entry(KEYRING_SERVICE, `${config.vaultId}/${config.deviceId}`);
}

export async function saveVault(root: string, config: VaultConfig, token: string): Promise<void> {
  await mkdir(path.join(root, STATE_DIR), { recursive: true });
  await writeFile(configFile(root), `${JSON.stringify(config, null, 2)}\n`);
  keyringEntry(config).setPassword(token);
}

export async function loadVault(root: string): Promise<VaultContext> {
  const absolute = path.resolve(root);
  let raw: string;
  try {
    raw = await readFile(configFile(absolute), "utf8");
  } catch {
    throw new Error(`${absolute} is not a vaultsync vault. Run "vaultsync init" first.`);
  }
  const config = VaultConfig.parse(JSON.parse(raw));
  const token = keyringEntry(config).getPassword();
  if (token === null || token === undefined) {
    throw new Error(`No token in the OS keychain for ${config.vaultId}. Run "vaultsync init" again.`);
  }
  return { root: absolute, config, token };
}
