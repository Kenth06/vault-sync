import { readFile } from "node:fs/promises";
import path from "node:path";

import { IGNORE_FILE } from "../common/constants.ts";
import { buildIgnore, type IgnoreFn } from "../utils/ignore.ts";

export async function loadIgnore(root: string): Promise<IgnoreFn> {
  try {
    const text = await readFile(path.join(root, IGNORE_FILE), "utf8");
    return buildIgnore(text.split(/\r?\n/u));
  } catch {
    return buildIgnore();
  }
}
