import path from "node:path";

import { normalizeVaultPath } from "@vault-sync/protocol";
import {
  ApiError,
  LiveConnection,
  REMOTE_CHANGE_DEBOUNCE_MS,
  SyncLoop,
  type IgnoreFn,
  type SyncReport,
} from "@vault-sync/sync-core";
import { watch } from "chokidar";

import { ApiClient } from "../clients/api.client.ts";
import type { VaultContext } from "../common/types.ts";
import { loadIgnore } from "../storage/ignore-file.ts";
import type { LocalState } from "../storage/local-state.ts";
import { syncOnce } from "./sync.service.ts";

export interface WatchHooks {
  onSynced: (report: SyncReport) => void;
  onError: (error: unknown, retryInMs: number) => void;
  onStatus: (message: string) => void;
}

const UNAUTHORIZED = 401;
const FORBIDDEN = 403;

function isAccessDenied(error: unknown): boolean {
  return error instanceof ApiError && (error.status === UNAUTHORIZED || error.status === FORBIDDEN);
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
  const client = new ApiClient(ctx.config.url, ctx.token);
  const target = { url: ctx.config.url, vaultId: ctx.config.vaultId, deviceId: ctx.config.deviceId, token: ctx.token };
  const live = new LiveConnection(target, {
    onRemoteChange: () => {
      loop.schedule(REMOTE_CHANGE_DEBOUNCE_MS);
    },
    onStatus: hooks.onStatus,
    stillAllowed: () =>
      client.status(ctx.config.vaultId).then(
        () => true,
        (error: unknown) => !isAccessDenied(error),
      ),
  });
  live.start();
  await loop.run();
  return async () => {
    live.stop();
    loop.stop();
    await watcher.close();
  };
}
