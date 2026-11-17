import type { Command } from "commander";

import { ApiClient } from "../clients/api.client.ts";
import { LocalState } from "../storage/local-state.ts";
import { loadVault } from "../storage/vault-config.ts";
import { formatBytes } from "../utils/format.ts";

async function status(dir: string): Promise<void> {
  const ctx = await loadVault(dir);
  const state = new LocalState(ctx.root);
  try {
    const remote = await new ApiClient(ctx.config.url, ctx.token).status(ctx.config.vaultId);
    console.log(`vault         ${remote.vaultId}`);
    console.log(`remote cursor ${remote.cursor} (${remote.files} files, ${formatBytes(remote.bytes)})`);
    console.log(`local cursor  ${state.cursor()}`);
    console.log(`last sync     ${state.getMeta("lastSyncAt") ?? "never"}`);
    const lastError = state.getMeta("lastError");
    console.log(`last error    ${lastError === null || lastError === "" ? "none" : lastError}`);
  } finally {
    state.close();
  }
}

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Compare local and remote state")
    .argument("[dir]", "vault directory", ".")
    .action(status);
}
