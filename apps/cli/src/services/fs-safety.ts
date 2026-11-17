import { realpath } from "node:fs/promises";
import path from "node:path";

import { normalizeVaultPath } from "@vault-sync/protocol";

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/iu;
const WINDOWS_FORBIDDEN = /[<>:"|?*]/u;

export function unsafeOnThisPlatform(vaultPath: string): boolean {
  if (process.platform !== "win32") return false;
  return vaultPath.split("/").some((segment) => {
    const trailing = segment.endsWith(".") || segment.endsWith(" ");
    return trailing || WINDOWS_FORBIDDEN.test(segment) || WINDOWS_RESERVED.test(segment);
  });
}

export function lexicalTarget(root: string, vaultPath: string): string {
  const normalized = normalizeVaultPath(vaultPath);
  if (!normalized.ok) throw new Error(`refusing unsafe path: ${vaultPath}`);
  return path.resolve(root, normalized.path);
}

export async function assertInside(root: string, dir: string): Promise<void> {
  const [realRoot, realDir] = await Promise.all([realpath(root), realpath(dir)]);
  if (realDir !== realRoot && !realDir.startsWith(realRoot + path.sep)) {
    throw new Error(`refusing to write through a link outside the vault: ${dir}`);
  }
}
