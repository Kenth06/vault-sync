import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { normalizeVaultPath } from "@vault-sync/protocol";

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/iu;
const WINDOWS_FORBIDDEN = /[<>:"|?*]/u;

const CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin";

export function foldPath(vaultPath: string): string {
  return CASE_INSENSITIVE_FS ? vaultPath.normalize("NFC").toLowerCase() : vaultPath;
}

export function unsafeOnThisPlatform(vaultPath: string): boolean {
  if (process.platform !== "win32") return false;
  return vaultPath.split("/").some((segment) => {
    const trailing = segment.endsWith(".") || segment.endsWith(" ");
    return trailing || WINDOWS_FORBIDDEN.test(segment) || WINDOWS_RESERVED.test(segment);
  });
}

export function lexicalTarget(root: string, vaultPath: string): string {
  const normalized = normalizeVaultPath(vaultPath);
  if (!normalized.ok) throw new Error(`refusing unsafe path from server: ${vaultPath}`);
  return path.resolve(root, normalized.path);
}

export async function assertInside(root: string, dir: string): Promise<void> {
  const [realRoot, realDir] = await Promise.all([realpath(root), realpath(dir)]);
  if (realDir !== realRoot && !realDir.startsWith(realRoot + path.sep)) {
    throw new Error(`refusing to write through a link outside the vault: ${dir}`);
  }
}

export interface FileSnapshot {
  readonly size: number;
  readonly mtime: number;
}

export async function snapshot(absPath: string): Promise<FileSnapshot | undefined> {
  const info = await stat(absPath).catch(() => null);
  return info === null ? undefined : { size: info.size, mtime: Math.trunc(info.mtimeMs) };
}

export async function unchangedSince(absPath: string, scanned: FileSnapshot | undefined): Promise<boolean> {
  const info = await stat(absPath).catch(() => null);
  if (info === null || scanned === undefined) return info === null && scanned === undefined;
  return info.size === scanned.size && Math.trunc(info.mtimeMs) === scanned.mtime;
}
