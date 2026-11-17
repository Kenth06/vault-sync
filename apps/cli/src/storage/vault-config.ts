import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Entry } from "@napi-rs/keyring";

import { KEYRING_SERVICE, STATE_DIR } from "../common/constants.ts";
import { VaultConfig, type VaultContext } from "../common/types.ts";

function configFile(root: string): string {
  return path.join(root, STATE_DIR, "config.json");
}

function keyringEntry(config: VaultConfig): Entry {
  return new Entry(KEYRING_SERVICE, `${config.vaultId}/${config.deviceId}`);
}

function readToken(config: VaultConfig): string {
  const token = keyringEntry(config).getPassword();
  if (token === null) {
    throw new Error(`No token in the OS keychain for ${config.vaultId}. Run "vaultsync init" again.`);
  }
  return token;
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
  return { root: absolute, config, token: readToken(config) };
}
