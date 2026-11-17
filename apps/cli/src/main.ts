#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { Command } from "commander";

import { registerInit } from "./commands/init.command.ts";
import { registerPush } from "./commands/push.command.ts";
import { registerStatus } from "./commands/status.command.ts";
import { registerWatch } from "./commands/watch.command.ts";

const program = new Command("vaultsync").description("Back up an Obsidian vault to Cloudflare");

registerInit(program);
registerPush(program);
registerWatch(program);
registerStatus(program);

await program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
