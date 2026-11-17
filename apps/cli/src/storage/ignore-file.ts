import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildIgnore, type IgnoreFn } from "@vault-sync/sync-core";

import { IGNORE_FILE } from "../common/constants.ts";

export async function loadIgnore(root: string): Promise<IgnoreFn> {
  try {
    const text = await readFile(path.join(root, IGNORE_FILE), "utf8");
    return buildIgnore(text.split(/\r?\n/u));
  } catch {
    return buildIgnore();
  }
}
