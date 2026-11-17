import { DeviceId } from "@vault-sync/protocol";
import type { Command } from "commander";

import { ApiClient } from "../clients/api.client.ts";
import { loadVault } from "../storage/vault-config.ts";
import { formatDate } from "../utils/format.ts";
import { askAdminSecret } from "./admin-secret.ts";

async function adminClient(dir: string) {
  const ctx = await loadVault(dir);
  return { ctx, client: new ApiClient(ctx.config.url, await askAdminSecret()) };
}

async function devices(dir: string): Promise<void> {
  const { ctx, client } = await adminClient(dir);
  for (const d of await client.devices(ctx.config.vaultId)) {
    const seen = d.lastSeen === null ? "never" : formatDate(d.lastSeen);
    const marks = [d.id === ctx.config.deviceId ? "this device" : "", d.revoked ? "revoked" : ""].filter(Boolean);
    console.log(`${d.id}  ${d.name.padEnd(24)}  last seen ${seen}  cursor ${d.cursor}  ${marks.join(", ")}`);
  }
}

async function revoke(deviceId: string, dir: string): Promise<void> {
  const { ctx, client } = await adminClient(dir);
  const id = DeviceId.parse(deviceId);
  await client.revokeDevice(ctx.config.vaultId, id);
  console.log(`Revoked ${id}. Its token stops working immediately.`);
}

export function registerDevices(program: Command): void {
  program
    .command("devices")
    .description("List enrolled devices (admin)")
    .argument("[dir]", "vault directory", ".")
    .action(devices);
  program
    .command("revoke")
    .description("Revoke a device's token (admin)")
    .argument("<deviceId>", "device id, as listed by devices")
    .argument("[dir]", "vault directory", ".")
    .action(revoke);
}
