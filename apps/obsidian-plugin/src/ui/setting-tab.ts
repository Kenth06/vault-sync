import { PluginSettingTab, Setting, type App } from "obsidian";

import type { Settings } from "../settings.ts";
import { ConnectModal } from "./connect-modal.ts";

export interface SettingsHost {
  readonly syncSettings: Settings;
  saveSettings(): Promise<void>;
  connectDevice(adminSecret: string): Promise<void>;
  disconnectDevice(): Promise<void>;
  statusText(): string;
}

export class VaultSyncSettingTab extends PluginSettingTab {
  private readonly host: SettingsHost;

  constructor(app: App, plugin: ConstructorParameters<typeof PluginSettingTab>[1], host: SettingsHost) {
    super(app, plugin);
    this.host = host;
  }

  override display(): void {
    this.containerEl.empty();
    const settings = this.host.syncSettings;
    this.textSetting("Worker URL", "https://vault-sync.<you>.workers.dev", settings.url, (v) => {
      settings.url = v;
    });
    this.textSetting("Vault id", "my-vault", settings.vaultId, (v) => {
      settings.vaultId = v;
    });
    this.textSetting("Device name", "Shown in conflict copies and device lists", settings.deviceName, (v) => {
      settings.deviceName = v;
    });
    new Setting(this.containerEl)
      .setName("Live updates")
      .setDesc("Receive other devices' changes immediately over a WebSocket.")
      .addToggle((toggle) =>
        toggle.setValue(settings.liveUpdates).onChange(async (value) => {
          settings.liveUpdates = value;
          await this.host.saveSettings();
        }),
      );
    this.connectionSetting();
  }

  private textSetting(name: string, placeholder: string, value: string, apply: (value: string) => void): void {
    new Setting(this.containerEl).setName(name).addText((text) =>
      text
        .setPlaceholder(placeholder)
        .setValue(value)
        .onChange(async (next) => {
          apply(next.trim());
          await this.host.saveSettings();
        }),
    );
  }

  private connectionSetting(): void {
    const settings = this.host.syncSettings;
    const setting = new Setting(this.containerEl).setName("Device").setDesc(this.host.statusText());
    if (settings.deviceId === null) {
      setting.addButton((button) =>
        button
          .setButtonText("Connect…")
          .setCta()
          .onClick(() => {
            new ConnectModal(this.app, async (secret) => {
              await this.host.connectDevice(secret);
              this.display();
            }).open();
          }),
      );
      return;
    }
    setting.addButton((button) =>
      button.setButtonText("Disconnect").onClick(async () => {
        await this.host.disconnectDevice();
        this.display();
      }),
    );
  }
}
