import {
  LiveConnection,
  REMOTE_CHANGE_DEBOUNCE_MS,
  SyncLoop,
  syncOnce,
  type LiveTarget,
  type SyncEnvironment,
  type SyncReport,
} from "@vault-sync/sync-core";

import type { PluginStore } from "./adapters/plugin-store.ts";

interface ControllerHooks {
  readonly onStatus: (text: string) => void;
  readonly onReport: (report: SyncReport) => void;
  readonly stillAllowed: () => Promise<boolean>;
}

export interface ControllerDeps {
  readonly env: SyncEnvironment;
  readonly store: PluginStore;
  readonly live: LiveTarget | null;
  readonly hooks: ControllerHooks;
}

export class SyncController {
  private readonly loop: SyncLoop;
  private readonly live: LiveConnection | null;

  constructor(deps: ControllerDeps) {
    const { env, store, hooks } = deps;
    this.loop = new SyncLoop({
      sync: async () => {
        hooks.onStatus("syncing…");
        const report = await syncOnce(env);
        await store.recordResult(null);
        return report;
      },
      onSynced: hooks.onReport,
      onError: (error, retryIn) => {
        void store.recordResult(error);
        hooks.onStatus(`sync failed, retrying in ${Math.round(retryIn / 1000)} s`);
      },
    });
    this.live =
      deps.live === null
        ? null
        : new LiveConnection(deps.live, {
            onRemoteChange: () => {
              this.loop.schedule(REMOTE_CHANGE_DEBOUNCE_MS);
            },
            onStatus: hooks.onStatus,
            stillAllowed: hooks.stillAllowed,
          });
  }

  start(): void {
    this.live?.start();
    void this.loop.run();
  }

  touch(): void {
    this.loop.schedule();
  }

  syncNow(): Promise<void> {
    return this.loop.run();
  }

  stop(): void {
    this.live?.stop();
    this.loop.stop();
  }
}
