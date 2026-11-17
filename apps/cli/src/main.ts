#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { VaultId } from "@vault-sync/protocol";
import { ApiClient } from "./client.ts";
import { loadVault, saveVault } from "./config.ts";
import { LocalState } from "./state.ts";
import { syncOnce } from "./sync.ts";
import { watchVault } from "./watch.ts";

async function adminSecret(): Promise<string> {
  const fromEnv = process.env.VAULTSYNC_ADMIN_SECRET;
  if (fromEnv) return fromEnv;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Admin secret: ");
  rl.close();
  return answer.trim();
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit] ?? "B"}`;
}

async function init(dir: string, opts: { url: string; vaultId: string; name: string }): Promise<void> {
  const root = path.resolve(dir);
  const vaultId = VaultId.parse(opts.vaultId);
  const enrolled = await ApiClient.enroll(opts.url, await adminSecret(), { vaultId, name: opts.name });
  await saveVault(root, { url: opts.url, vaultId, deviceId: enrolled.deviceId }, enrolled.token);
  console.log(`Enrolled ${opts.name} as ${enrolled.deviceId} for vault ${vaultId}. Token stored in the OS keychain.`);
}

async function push(dir: string): Promise<void> {
  const ctx = await loadVault(dir);
  const state = new LocalState(ctx.root);
  try {
    const report = await syncOnce(ctx, state);
    console.log(report.changes === 0 ? "Up to date." : `Pushed ${report.changes} changes in ${report.batches} batches. Cursor ${report.cursor}.`);
  } finally {
    state.close();
  }
}

async function watchCommand(dir: string): Promise<void> {
  const ctx = await loadVault(dir);
  const state = new LocalState(ctx.root);
  const stop = await watchVault(ctx, state, {
    onSynced: (r) => {
      if (r.changes > 0) console.log(`${new Date().toLocaleTimeString()} pushed ${r.changes} changes, cursor ${r.cursor}`);
    },
    onError: (error, retryIn) => {
      console.error(`sync failed: ${String(error)}. Retrying in ${Math.round(retryIn / 1000)} s.`);
    },
  });
  console.log(`Watching ${ctx.root}. Ctrl+C to stop.`);
  process.once("SIGINT", () => {
    void stop().then(() => {
      state.close();
      process.exit(0);
    });
  });
}

async function status(dir: string): Promise<void> {
  const ctx = await loadVault(dir);
  const state = new LocalState(ctx.root);
  try {
    const remote = await new ApiClient(ctx.config.url, ctx.token).status(ctx.config.vaultId);
    console.log(`vault         ${remote.vaultId}`);
    console.log(`remote cursor ${remote.cursor} (${remote.files} files, ${formatBytes(remote.bytes)})`);
    console.log(`local cursor  ${state.cursor()}`);
    console.log(`last sync     ${state.getMeta("lastSyncAt") ?? "never"}`);
    console.log(`last error    ${state.getMeta("lastError") || "none"}`);
  } finally {
    state.close();
  }
}

const program = new Command("vaultsync").description("Back up an Obsidian vault to Cloudflare");

program
  .command("init")
  .argument("[dir]", "vault directory", ".")
  .requiredOption("--url <url>", "Worker URL")
  .requiredOption("--vault-id <id>", "vault id (lowercase, digits, dashes)")
  .option("--name <name>", "device name", os.hostname())
  .action(init);
program.command("push").argument("[dir]", "vault directory", ".").description("Sync once and exit").action(push);
program.command("watch").argument("[dir]", "vault directory", ".").description("Sync continuously").action(watchCommand);
program.command("status").argument("[dir]", "vault directory", ".").action(status);

await program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
