import { readFile } from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import { STATE_DIR } from "./config.ts";

export const IGNORE_FILE = ".vaultsyncignore";

/** `.obsidian/` is synced selectively: settings, plugins and snippets yes; workspace state and caches no. */
export const DEFAULT_RULES = [
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

export async function loadIgnore(root: string): Promise<IgnoreFn> {
  try {
    const text = await readFile(path.join(root, IGNORE_FILE), "utf8");
    return buildIgnore(text.split(/\r?\n/u));
  } catch {
    return buildIgnore();
  }
}
