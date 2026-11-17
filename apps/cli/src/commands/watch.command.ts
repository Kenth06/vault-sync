import type { Command } from "commander";

import { watchVault } from "../services/watch.service.ts";
import { LocalState } from "../storage/local-state.ts";
import { loadVault } from "../storage/vault-config.ts";

async function watchCommand(dir: string): Promise<void> {
  const ctx = await loadVault(dir);
  const state = new LocalState(ctx.root);
  const stop = await watchVault(ctx, state, {
    onSynced: (report) => {
      if (report.changes === 0) return;
      console.log(`${new Date().toLocaleTimeString()} pushed ${report.changes} changes, cursor ${report.cursor}`);
    },
    onError: (error, retryIn) => {
      console.error(`sync failed: ${String(error)}. Retrying in ${Math.round(retryIn / 1000)} s.`);
    },
  });
  console.log(`Watching ${ctx.root}. Ctrl+C to stop.`);
  const shutdown = () => {
    void stop().then(() => {
      state.close();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

export function registerWatch(program: Command): void {
  program
    .command("watch")
    .description("Sync continuously")
    .argument("[dir]", "vault directory", ".")
    .action(watchCommand);
}
