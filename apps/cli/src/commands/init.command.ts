import os from "node:os";
import path from "node:path";

import { VaultId } from "@vault-sync/protocol";
import type { Command } from "commander";

import { ApiClient } from "../clients/api.client.ts";
import { saveVault } from "../storage/vault-config.ts";
import { askAdminSecret } from "./admin-secret.ts";

interface InitOptions {
  readonly url: string;
  readonly vaultId: string;
  readonly name: string;
}

async function init(dir: string, options: InitOptions): Promise<void> {
  const root = path.resolve(dir);
  const vaultId = VaultId.parse(options.vaultId);
  const enrolled = await ApiClient.enroll(options.url, await askAdminSecret(), { vaultId, name: options.name });
  await saveVault(root, { url: options.url, vaultId, deviceId: enrolled.deviceId }, enrolled.token);
  console.log(
    `Enrolled ${options.name} as ${enrolled.deviceId} for vault ${vaultId}. Token stored in the OS keychain.`,
  );
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Enroll this device and link a vault directory")
    .argument("[dir]", "vault directory", ".")
    .requiredOption("--url <url>", "Worker URL")
    .requiredOption("--vault-id <id>", "vault id (lowercase, digits, dashes)")
    .option("--name <name>", "device name", os.hostname())
    .action(init);
}
