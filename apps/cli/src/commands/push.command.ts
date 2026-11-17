import type { Command } from "commander";

import { syncOnce } from "../services/sync.service.ts";
import { LocalState } from "../storage/local-state.ts";
import { loadVault } from "../storage/vault-config.ts";

async function push(dir: string): Promise<void> {
  const ctx = await loadVault(dir);
  const state = new LocalState(ctx.root);
  try {
    const report = await syncOnce(ctx, state);
    console.log(
      report.changes === 0
        ? "Up to date."
        : `Pushed ${report.changes} changes in ${report.batches} batches. Cursor ${report.cursor}.`,
    );
  } finally {
    state.close();
  }
}

export function registerPush(program: Command): void {
  program.command("push").description("Sync once and exit").argument("[dir]", "vault directory", ".").action(push);
}
