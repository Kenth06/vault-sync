import type { Command } from "commander";

import { ApiClient } from "../clients/api.client.ts";
import { loadVault } from "../storage/vault-config.ts";
import { formatBytes, formatDate } from "../utils/format.ts";

async function snapshots(dir: string, options: { create?: boolean }): Promise<void> {
  const ctx = await loadVault(dir);
  const client = new ApiClient(ctx.config.url, ctx.token);
  if (options.create === true) {
    const created = await client.createSnapshot(ctx.config.vaultId);
    console.log(created === null ? "Nothing changed since the last snapshot." : `Created snapshot ${created.seq}.`);
  }
  const list = await client.snapshots(ctx.config.vaultId);
  if (list.length === 0) console.log("No snapshots yet.");
  for (const s of list) {
    console.log(
      `${String(s.seq).padStart(6)}  ${formatDate(s.at)}  ${String(s.files).padStart(7)} files  ${formatBytes(s.bytes)}`,
    );
  }
}

export function registerSnapshots(program: Command): void {
  program
    .command("snapshots")
    .description("List snapshots, or create one with --create")
    .argument("[dir]", "vault directory", ".")
    .option("--create", "snapshot the current state now")
    .action(snapshots);
}
