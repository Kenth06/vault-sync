import path from "node:path";

import { normalizeVaultPath } from "@vault-sync/protocol";
import { watch } from "chokidar";

import type { SyncReport, VaultContext } from "../common/types.ts";
import { loadIgnore } from "../storage/ignore-file.ts";
import type { LocalState } from "../storage/local-state.ts";
import type { IgnoreFn } from "../utils/ignore.ts";
import { SyncLoop } from "./sync-loop.ts";
import { syncOnce } from "./sync.service.ts";

export interface WatchHooks {
  onSynced: (report: SyncReport) => void;
  onError: (error: unknown, retryInMs: number) => void;
}

function watcherFilter(root: string, isIgnored: IgnoreFn): (absPath: string) => boolean {
  return (absPath) => {
    const rel = path.relative(root, absPath);
    if (rel === "") return false;
    const normalized = normalizeVaultPath(rel);
    return !normalized.ok || isIgnored(normalized.path) || isIgnored(`${normalized.path}/`);
  };
}

export async function watchVault(
  ctx: VaultContext,
  state: LocalState,
  hooks: WatchHooks,
): Promise<() => Promise<void>> {
  const loop = new SyncLoop({
    sync: () => syncOnce(ctx, state),
    onSynced: hooks.onSynced,
    onError: (error, retryIn) => {
      state.setMeta("lastError", String(error));
      hooks.onError(error, retryIn);
    },
  });
  const ignored = watcherFilter(ctx.root, await loadIgnore(ctx.root));
  const watcher = watch(ctx.root, { ignoreInitial: true, ignored });
  watcher.on("all", () => {
    loop.schedule();
  });
  await loop.run();
  return async () => {
    loop.stop();
    await watcher.close();
  };
}
