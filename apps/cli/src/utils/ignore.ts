import ignore from "ignore";

import { STATE_DIR } from "../common/constants.ts";

const DEFAULT_RULES = [
  `${STATE_DIR}/`,
  ".git/",
  ".trash/",
  ".DS_Store",
  "Thumbs.db",
  ".obsidian/*",
  "!.obsidian/app.json",
  "!.obsidian/appearance.json",
  "!.obsidian/hotkeys.json",
  "!.obsidian/core-plugins*.json",
  "!.obsidian/community-plugins.json",
  "!.obsidian/plugins/",
  "!.obsidian/snippets/",
];

export type IgnoreFn = (vaultPath: string) => boolean;

export function buildIgnore(extraRules: readonly string[] = []): IgnoreFn {
  const matcher = ignore().add([...DEFAULT_RULES, ...extraRules]);
  return (vaultPath) => matcher.ignores(vaultPath);
}
