import path from "node:path";
import { watch } from "chokidar";
import { normalizeVaultPath } from "@vault-sync/protocol";
import type { VaultContext } from "./config.ts";
import { loadIgnore } from "./ignore.ts";
import type { LocalState } from "./state.ts";
import { syncOnce, type SyncReport } from "./sync.ts";

const DEBOUNCE_MS = 2000;
const MAX_BACKOFF_MS = 5 * 60_000;

interface WatchHooks {
  onSynced: (report: SyncReport) => void;
  onError: (error: unknown, retryInMs: number) => void;
}

/**
 * Runs one sync at a time. Events that arrive mid-sync mark the vault dirty
 * and trigger exactly one follow-up pass; failures back off exponentially.
 */
export async function watchVault(ctx: VaultContext, state: LocalState, hooks: WatchHooks): Promise<() => Promise<void>> {
  const isIgnored = await loadIgnore(ctx.root);
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let dirty = false;
  let failures = 0;

  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), ms);
  };

  const run = async () => {
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    dirty = false;
    try {
      hooks.onSynced(await syncOnce(ctx, state));
      failures = 0;
    } catch (error) {
      failures += 1;
      const retryIn = Math.min(DEBOUNCE_MS * 2 ** failures, MAX_BACKOFF_MS);
      state.setMeta("lastError", String(error));
      hooks.onError(error, retryIn);
      schedule(retryIn);
    } finally {
      running = false;
      if (dirty) schedule(DEBOUNCE_MS);
    }
  };

  const watcher = watch(ctx.root, {
    ignoreInitial: true,
    ignored: (absPath) => {
      const rel = path.relative(ctx.root, absPath);
      if (rel === "") return false;
      const normalized = normalizeVaultPath(rel);
      return !normalized.ok || isIgnored(normalized.path) || isIgnored(`${normalized.path}/`);
    },
  });
  watcher.on("all", () => {
    schedule(DEBOUNCE_MS);
  });

  await run();
  return async () => {
    clearTimeout(timer);
    await watcher.close();
  };
}
