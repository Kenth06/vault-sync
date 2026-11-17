import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { VaultId, type DeviceId, type TreeResponse } from "@vault-sync/protocol";
import type { Command } from "commander";

import { ApiClient } from "../clients/api.client.ts";
import { STATE_DIR, TMP_SUFFIX } from "../common/constants.ts";
import { restoreFiles } from "../services/restore.service.ts";
import { LocalState } from "../storage/local-state.ts";
import { saveVault } from "../storage/vault-config.ts";
import { askAdminSecret } from "./admin-secret.ts";

interface RestoreOptions {
  readonly url: string;
  readonly vaultId: string;
  readonly name: string;
  readonly at?: string;
  readonly snapshot?: string;
  readonly force?: boolean;
}

function cursorOption(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${flag} expects a cursor number`);
  return parsed;
}

async function assertEmpty(root: string): Promise<void> {
  const entries = await readdir(root).catch(() => []);
  if (entries.some((name) => name !== STATE_DIR && !name.endsWith(TMP_SUFFIX))) {
    throw new Error(`${root} is not empty. Restore into an empty directory or pass --force.`);
  }
}

function fetchTree(client: ApiClient, vaultId: VaultId, options: RestoreOptions): Promise<TreeResponse> {
  const snapshot = cursorOption(options.snapshot, "--snapshot");
  if (snapshot !== undefined) return client.snapshotTree(vaultId, snapshot);
  return client.tree(vaultId, cursorOption(options.at, "--at"));
}

interface Enrollment {
  readonly vaultId: VaultId;
  readonly url: string;
  readonly deviceId: DeviceId;
  readonly token: string;
  readonly admin: ApiClient;
}

async function enrollRestoreDevice(options: RestoreOptions): Promise<Enrollment> {
  const vaultId = VaultId.parse(options.vaultId);
  const adminSecret = await askAdminSecret();
  const enrolled = await ApiClient.enroll(options.url, adminSecret, { vaultId, name: options.name });
  const admin = new ApiClient(options.url, adminSecret);
  return { vaultId, url: options.url, deviceId: enrolled.deviceId, token: enrolled.token, admin };
}

async function restoreInto(root: string, device: Enrollment, options: RestoreOptions): Promise<void> {
  const client = new ApiClient(device.url, device.token);
  const tree = await fetchTree(client, device.vaultId, options);
  const head = await client.status(device.vaultId);
  const report = await restoreFiles(client, root, tree.files);

  await saveVault(root, { url: device.url, vaultId: device.vaultId, deviceId: device.deviceId }, device.token);
  const state = new LocalState(root);
  state.replaceSynced(report.restored, tree.seq);
  state.close();

  console.log(`Restored ${report.restored.length} of ${tree.files.length} files at cursor ${tree.seq} into ${root}.`);
  if (tree.seq < head.cursor) {
    console.warn(
      `The vault is at cursor ${head.cursor}. Pushing from this directory sends your edits on top of the current vault; it does not roll the vault back.`,
    );
  }
  if (report.missing.length > 0) {
    const list = report.missing.map((p) => `  ${p}`).join("\n");
    console.error(`Missing in R2 (collected by GC or never uploaded):\n${list}`);
    process.exitCode = 1;
  }
}

async function restore(dir: string, options: RestoreOptions): Promise<void> {
  if (options.at !== undefined && options.snapshot !== undefined) throw new Error("use --at or --snapshot, not both");
  const root = path.resolve(dir);
  if (options.force !== true) await assertEmpty(root);

  const device = await enrollRestoreDevice(options);
  try {
    await restoreInto(root, device, options);
  } catch (error) {
    await device.admin.revokeDevice(device.vaultId, device.deviceId).catch(() => null);
    throw error;
  }
}

export function registerRestore(program: Command): void {
  program
    .command("restore")
    .description("Rebuild a vault from the server at a cursor or snapshot")
    .argument("<dir>", "target directory (empty)")
    .requiredOption("--url <url>", "Worker URL")
    .requiredOption("--vault-id <id>", "vault id")
    .option("--at <seq>", "cursor to restore (default: latest)")
    .option("--snapshot <seq>", "restore from a stored snapshot")
    .option("--name <name>", "name for the device this enrolls", `${os.hostname()}-restore`)
    .option("--force", "restore into a non-empty directory")
    .action(restore);
}
