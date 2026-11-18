import ignore from "ignore";

import { LEGACY_PLUGIN_DIR, PLUGIN_DIR, STATE_DIR, TMP_SUFFIX } from "../constants.ts";

const DEFAULT_RULES = [
  `${STATE_DIR}/`,
  ".git/",
  ".trash/",
  ".DS_Store",
  "Thumbs.db",
  `*${TMP_SUFFIX}`,
  ".obsidian/*",
  "!.obsidian/app.json",
  "!.obsidian/appearance.json",
  "!.obsidian/hotkeys.json",
  "!.obsidian/core-plugins*.json",
  "!.obsidian/community-plugins.json",
  "!.obsidian/plugins/",
  "!.obsidian/snippets/",
  `${PLUGIN_DIR}/data.json`,
  `${PLUGIN_DIR}/state.json`,
  `${LEGACY_PLUGIN_DIR}/data.json`,
  `${LEGACY_PLUGIN_DIR}/state.json`,
];

export type IgnoreFn = (vaultPath: string) => boolean;

export function buildIgnore(extraRules: readonly string[] = []): IgnoreFn {
  const matcher = ignore().add([...DEFAULT_RULES, ...extraRules]);
  return (vaultPath) => matcher.ignores(vaultPath);
}
