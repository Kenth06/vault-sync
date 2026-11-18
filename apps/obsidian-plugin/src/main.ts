import { VaultId } from "@vault-sync/protocol";
import { ApiError, type SyncReport } from "@vault-sync/sync-core";
import { Notice, Platform, Plugin, type TAbstractFile } from "obsidian";

import { ObsidianRemote } from "./adapters/obsidian-remote.ts";
import { obsidianHttp } from "./obsidian-http.ts";
import { connected, secretId, Settings } from "./settings.ts";
import { SyncController } from "./sync-controller.ts";
import { VaultSyncSettingTab, type SettingsHost } from "./ui/setting-tab.ts";
import { wire, type Wired } from "./wiring.ts";

const FALLBACK_INTERVAL_MS = 5 * 60_000;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;

function notify(message: string): Notice {
  return new Notice(message);
}

function describe(report: SyncReport): string {
  if (report.pulled === 0 && report.pushed === 0) return `synced · cursor ${report.cursor}`;
  return `synced · ↓${report.pulled} ↑${report.pushed} · cursor ${report.cursor}`;
}

export default class VaultSyncPlugin extends Plugin implements SettingsHost {
  syncSettings: Settings = Settings.parse({});
  private controller: SyncController | null = null;
  private wired: Wired | null = null;
  private statusEl: HTMLElement | null = null;

  override async onload(): Promise<void> {
    this.syncSettings = Settings.parse((await this.loadData()) ?? {});
    this.statusEl = this.addStatusBarItem();
    this.addSettingTab(new VaultSyncSettingTab(this.app, this, this));
    this.addCommand({ id: "sync-now", name: "Sync now", callback: () => void this.controller?.syncNow() });
    this.registerVaultEvents();
    this.registerInterval(window.setInterval(() => this.controller?.touch(), FALLBACK_INTERVAL_MS));
    this.app.workspace.onLayoutReady(() => void this.restart());
  }

  override onunload(): void {
    this.controller?.stop();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.syncSettings);
  }

  statusText(): string {
    if (this.syncSettings.deviceId === null) return "Not connected.";
    const status = this.wired?.store.status();
    const last = status?.lastSyncAt ?? "never";
    const error = status?.lastError ?? null;
    return `Connected as ${this.syncSettings.deviceId}. Last sync: ${last}.${error === null ? "" : ` Last error: ${error}`}`;
  }

  async connectDevice(adminSecret: string): Promise<void> {
    const vaultId = VaultId.safeParse(this.syncSettings.vaultId);
    if (this.syncSettings.url === "" || !vaultId.success) {
      notify("Set the Worker URL and a valid vault id first.");
      return;
    }
    try {
      const enrolled = await ObsidianRemote.enroll(
        obsidianHttp,
        { url: this.syncSettings.url, adminSecret },
        {
          vaultId: vaultId.data,
          name: this.deviceLabel(),
        },
      );
      this.app.secretStorage.setSecret(secretId(vaultId.data), enrolled.token);
      this.syncSettings.deviceId = enrolled.deviceId;
      await this.saveSettings();
      notify("Device connected. Syncing…");
      await this.restart();
    } catch (error) {
      notify(`Could not connect: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnectDevice(): Promise<void> {
    this.controller?.stop();
    this.controller = null;
    this.app.secretStorage.setSecret(secretId(this.syncSettings.vaultId), "");
    this.syncSettings.deviceId = null;
    await this.saveSettings();
    this.setStatus("not connected");
  }

  private async restart(): Promise<void> {
    this.controller?.stop();
    this.controller = null;
    const conn = connected(this.syncSettings);
    const token = conn === null ? null : this.app.secretStorage.getSecret(secretId(conn.vaultId));
    if (conn === null || token === null || token === "") {
      this.setStatus("not connected");
      return;
    }
    this.wired = await wire(this.app, this.pluginDir(), { ...conn, token, device: this.deviceLabel() });
    this.controller = new SyncController({
      env: this.wired.env,
      store: this.wired.store,
      live: this.syncSettings.liveUpdates ? this.wired.live : null,
      hooks: {
        onStatus: (text) => {
          this.setStatus(text);
        },
        onReport: (report) => {
          this.onReport(report);
        },
        stillAllowed: () => this.stillAllowed(),
      },
    });
    this.controller.start();
  }

  private onReport(report: SyncReport): void {
    this.setStatus(describe(report));
    for (const path of report.conflicts)
      notify(`Conflict on ${path}: your version was saved as a "(conflict …)" copy.`);
  }

  private async stillAllowed(): Promise<boolean> {
    try {
      await this.wired?.remote.status();
      return true;
    } catch (error) {
      return !(error instanceof ApiError && (error.status === UNAUTHORIZED || error.status === FORBIDDEN));
    }
  }

  private registerVaultEvents(): void {
    const touch = (file: TAbstractFile) => {
      if (!file.path.startsWith(this.pluginDir())) this.controller?.touch();
    };
    this.registerEvent(this.app.vault.on("create", touch));
    this.registerEvent(this.app.vault.on("modify", touch));
    this.registerEvent(this.app.vault.on("delete", touch));
    this.registerEvent(this.app.vault.on("rename", touch));
  }

  private pluginDir(): string {
    return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
  }

  private deviceLabel(): string {
    if (this.syncSettings.deviceName !== "") return this.syncSettings.deviceName;
    return Platform.isMobile ? "obsidian-mobile" : "obsidian-desktop";
  }

  private setStatus(text: string): void {
    this.statusEl?.setText(`Vault Sync: ${text}`);
  }
}
