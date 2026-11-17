import { buildIgnore, type IgnoreFn, type LiveTarget, type SyncEnvironment } from "@vault-sync/sync-core";
import { Platform, type App } from "obsidian";

import { ObsidianFiles } from "./adapters/obsidian-files.ts";
import { ObsidianRemote } from "./adapters/obsidian-remote.ts";
import { PluginStore, type TextFile } from "./adapters/plugin-store.ts";
import { obsidianHttp } from "./obsidian-http.ts";
import { windowsUnsafe } from "./platform.ts";
import type { ConnectedSettings } from "./settings.ts";

const IGNORE_FILE = ".vaultsyncignore";

export interface Wired {
  readonly env: SyncEnvironment;
  readonly store: PluginStore;
  readonly remote: ObsidianRemote;
  readonly live: LiveTarget;
}

function textFile(app: App, path: string): TextFile {
  return {
    read: async () => ((await app.vault.adapter.exists(path)) ? app.vault.adapter.read(path) : null),
    write: (text) => app.vault.adapter.write(path, text),
  };
}

async function ignoreRules(app: App, pluginDir: string): Promise<IgnoreFn> {
  const own = [`${pluginDir}/data.json`, `${pluginDir}/state.json`];
  const custom = (await app.vault.adapter.exists(IGNORE_FILE)) ? await app.vault.adapter.read(IGNORE_FILE) : "";
  return buildIgnore([...own, ...custom.split(/\r?\n/u)]);
}

export async function wire(
  app: App,
  pluginDir: string,
  conn: ConnectedSettings & { token: string; device: string },
): Promise<Wired> {
  const store = new PluginStore(textFile(app, `${pluginDir}/state.json`));
  await store.load();
  const remote = new ObsidianRemote(obsidianHttp, { url: conn.url, vaultId: conn.vaultId, token: conn.token });
  const env: SyncEnvironment = {
    files: new ObsidianFiles(app.vault.adapter, store),
    remote,
    store,
    isIgnored: await ignoreRules(app, pluginDir),
    device: conn.device,
    caseInsensitive: Platform.isWin || Platform.isMacOS || Platform.isIosApp,
    unsafePath: Platform.isWin ? windowsUnsafe : () => false,
  };
  const live: LiveTarget = { url: conn.url, vaultId: conn.vaultId, deviceId: conn.deviceId, token: conn.token };
  return { env, store, remote, live };
}
