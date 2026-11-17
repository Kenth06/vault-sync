import path from "node:path";
import { watch } from "chokidar";
import { normalizeVaultPath } from "@vault-sync/protocol";
import type { VaultContext } from "./config.ts";
import { loadIgnore, type IgnoreFn } from "./ignore.ts";
import type { LocalState } from "./state.ts";
import { syncOnce, type SyncReport } from "./sync.ts";

const DEBOUNCE_MS = 2000;
const MAX_BACKOFF_MS = 5 * 60_000;

export interface WatchHooks {
  onSynced: (report: SyncReport) => void;
  onError: (error: unknown, retryInMs: number) => void;
}

/**
 * One sync at a time. Events during a sync mark the vault dirty and trigger
 * exactly one follow-up pass; failures back off exponentially.
 */
class SyncLoop {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private dirty = false;
  private failures = 0;
  private readonly ctx: VaultContext;
  private readonly state: LocalState;
  private readonly hooks: WatchHooks;

  constructor(ctx: VaultContext, state: LocalState, hooks: WatchHooks) {
    this.ctx = ctx;
    this.state = state;
    this.hooks = hooks;
  }

  schedule(ms = DEBOUNCE_MS): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), ms);
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  async run(): Promise<void> {
    if (this.running) {
      this.dirty = true;
      return;
    }
    this.running = true;
    this.dirty = false;
    try {
      this.hooks.onSynced(await syncOnce(this.ctx, this.state));
      this.failures = 0;
    } catch (error) {
      this.onFailure(error);
    } finally {
      this.running = false;
      if (this.changedDuringRun()) this.schedule();
    }
  }

  private changedDuringRun(): boolean {
    return this.dirty;
  }

  private onFailure(error: unknown): void {
    this.failures += 1;
    const retryIn = Math.min(DEBOUNCE_MS * 2 ** this.failures, MAX_BACKOFF_MS);
    this.state.setMeta("lastError", String(error));
    this.hooks.onError(error, retryIn);
    this.schedule(retryIn);
  }
}

function watcherFilter(root: string, isIgnored: IgnoreFn): (absPath: string) => boolean {
  return (absPath) => {
    const rel = path.relative(root, absPath);
    if (rel === "") return false;
    const normalized = normalizeVaultPath(rel);
    return !normalized.ok || isIgnored(normalized.path) || isIgnored(`${normalized.path}/`);
  };
}

export async function watchVault(ctx: VaultContext, state: LocalState, hooks: WatchHooks): Promise<() => Promise<void>> {
  const loop = new SyncLoop(ctx, state, hooks);
  const watcher = watch(ctx.root, { ignoreInitial: true, ignored: watcherFilter(ctx.root, await loadIgnore(ctx.root)) });
  watcher.on("all", () => {
    loop.schedule();
  });
  await loop.run();
  return async () => {
    loop.stop();
    await watcher.close();
  };
}
