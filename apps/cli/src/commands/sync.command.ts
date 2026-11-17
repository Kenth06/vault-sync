import type { Command } from "commander";

import type { SyncReport, VaultContext } from "../common/types.ts";
import { pullOnly, pushOnly, syncOnce } from "../services/sync.service.ts";
import { LocalState } from "../storage/local-state.ts";
import { loadVault } from "../storage/vault-config.ts";

export function describeReport(report: SyncReport): string {
  if (report.pulled === 0 && report.pushed === 0) return `Up to date at cursor ${report.cursor}.`;
  const parts = [
    report.pulled > 0 ? `pulled ${report.pulled}` : "",
    report.pushed > 0 ? `pushed ${report.pushed}` : "",
  ].filter(Boolean);
  return `${parts.join(", ")} change(s). Cursor ${report.cursor}.`;
}

export function printConflicts(report: SyncReport): void {
  for (const path of report.failed) console.error(`Could not pull ${path}; it will be retried on the next sync.`);
  for (const path of report.conflicts) {
    console.warn(`Conflict on ${path}: kept the server version, saved yours as a "(conflicto ...)" copy next to it.`);
  }
}

async function withVault(dir: string, run: (ctx: VaultContext, state: LocalState) => Promise<void>): Promise<void> {
  const ctx = await loadVault(dir);
  const state = new LocalState(ctx.root);
  try {
    await run(ctx, state);
  } finally {
    state.close();
  }
}

export function registerSync(program: Command): void {
  program
    .command("sync")
    .description("Pull remote changes, then push local ones")
    .argument("[dir]", "vault directory", ".")
    .action((dir: string) =>
      withVault(dir, async (ctx, state) => {
        const report = await syncOnce(ctx, state);
        console.log(describeReport(report));
        printConflicts(report);
      }),
    );
  program
    .command("push")
    .description("Push local changes only")
    .argument("[dir]", "vault directory", ".")
    .action((dir: string) =>
      withVault(dir, async (ctx, state) => {
        const report = await pushOnly(ctx, state);
        console.log(report.changes === 0 ? "Nothing to push." : `Pushed ${report.changes} change(s).`);
      }),
    );
  program
    .command("pull")
    .description("Pull remote changes only")
    .argument("[dir]", "vault directory", ".")
    .action((dir: string) =>
      withVault(dir, async (ctx, state) => {
        const report = await pullOnly(ctx, state);
        console.log(describeReport(report));
        printConflicts(report);
      }),
    );
}
