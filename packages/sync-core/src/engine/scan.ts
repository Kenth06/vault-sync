import type { LocalFile, SyncEnvironment } from "../types.ts";

export function keepPath(env: SyncEnvironment): (vaultPath: string) => boolean {
  return (vaultPath) => !env.isIgnored(vaultPath) && !env.unsafePath(vaultPath);
}

async function hashed(env: SyncEnvironment, vaultPath: string): Promise<LocalFile | null> {
  const stat = await env.files.stat(vaultPath);
  if (stat === null) return null;
  const meta = await env.files.hash(stat).catch(() => null);
  return meta === null ? null : { ...meta, path: vaultPath };
}

export async function scanAll(env: SyncEnvironment): Promise<Map<string, LocalFile>> {
  const keep = keepPath(env);
  const files = new Map<string, LocalFile>();
  for (const stat of await env.files.list()) {
    if (!keep(stat.path)) continue;
    const meta = await env.files.hash(stat).catch(() => null);
    if (meta) files.set(stat.path, { ...meta, path: stat.path });
  }
  return files;
}

export async function scanPaths(env: SyncEnvironment, vaultPaths: Iterable<string>): Promise<Map<string, LocalFile>> {
  const files = new Map<string, LocalFile>();
  for (const vaultPath of vaultPaths) {
    const file = await hashed(env, vaultPath);
    if (file) files.set(vaultPath, file);
  }
  return files;
}
