#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { Command } from "commander";

import { registerDevices } from "./commands/devices.command.ts";
import { registerInit } from "./commands/init.command.ts";
import { registerLog } from "./commands/log.command.ts";
import { registerPush } from "./commands/push.command.ts";
import { registerRestore } from "./commands/restore.command.ts";
import { registerSnapshots } from "./commands/snapshots.command.ts";
import { registerStatus } from "./commands/status.command.ts";
import { registerWatch } from "./commands/watch.command.ts";

const program = new Command("vaultsync").description("Back up an Obsidian vault to Cloudflare");

registerInit(program);
registerPush(program);
registerWatch(program);
registerStatus(program);
registerLog(program);
registerRestore(program);
registerSnapshots(program);
registerDevices(program);

await program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
