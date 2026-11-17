import { Modal, Setting, type App } from "obsidian";

export class ConnectModal extends Modal {
  private secret = "";
  private readonly onSubmit: (adminSecret: string) => Promise<void>;

  constructor(app: App, onSubmit: (adminSecret: string) => Promise<void>) {
    super(app);
    this.onSubmit = onSubmit;
  }

  override onOpen(): void {
    this.setTitle("Connect this device");
    this.contentEl.createEl("p", {
      text: "The admin secret enrolls this device once. It is not stored; the device keeps its own token in Obsidian's secret storage.",
    });
    new Setting(this.contentEl).setName("Admin secret").addText((text) => {
      text.inputEl.type = "password";
      text.onChange((value) => {
        this.secret = value.trim();
      });
    });
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText("Connect")
        .setCta()
        .onClick(() => {
          void this.submit();
        }),
    );
  }

  private async submit(): Promise<void> {
    await this.onSubmit(this.secret);
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
