import { normalizeVaultPath } from "@vault-sync/protocol";
import type { ByteRange, Bytes, FileMeta, FileStat, LocalFiles, WriteOptions } from "@vault-sync/sync-core";
import type { DataAdapter } from "obsidian";

import { sha256Hex, toArrayBuffer } from "./bytes.ts";
import type { PluginStore } from "./plugin-store.ts";

type VaultAdapter = Pick<
  DataAdapter,
  "list" | "stat" | "readBinary" | "writeBinary" | "rename" | "remove" | "mkdir" | "exists"
>;

function parentOf(vaultPath: string): string {
  const slash = vaultPath.lastIndexOf("/");
  return slash === -1 ? "" : vaultPath.slice(0, slash);
}

export class ObsidianFiles implements LocalFiles {
  private readonly adapter: VaultAdapter;
  private readonly store: PluginStore;

  constructor(adapter: VaultAdapter, store: PluginStore) {
    this.adapter = adapter;
    this.store = store;
  }

  async list(): Promise<FileStat[]> {
    const files: FileStat[] = [];
    const pending = [""];
    for (let folder = pending.pop(); folder !== undefined; folder = pending.pop()) {
      const listed = await this.adapter.list(folder);
      pending.push(...listed.folders);
      for (const file of listed.files) {
        const stat = await this.stat(file);
        if (stat) files.push(stat);
      }
    }
    return files;
  }

  async stat(vaultPath: string): Promise<FileStat | null> {
    const normalized = normalizeVaultPath(vaultPath);
    if (!normalized.ok) return null;
    const info = await this.adapter.stat(normalized.path);
    return info?.type === "file" ? { path: normalized.path, size: info.size, mtime: Math.trunc(info.mtime) } : null;
  }

  async hash(file: FileStat): Promise<FileMeta | null> {
    const cached = this.store.cachedHash(file);
    if (cached !== null) return { hash: cached, size: file.size, mtime: file.mtime };
    const bytes = await this.adapter.readBinary(file.path);
    const after = await this.stat(file.path);
    if (after === null || after.size !== file.size || after.mtime !== file.mtime) return null;
    const meta = { hash: await sha256Hex(bytes), size: file.size, mtime: file.mtime };
    this.store.saveHash(file.path, meta);
    return meta;
  }

  async read(vaultPath: string, range?: ByteRange): Promise<Bytes> {
    const bytes = await this.adapter.readBinary(vaultPath);
    return range === undefined ? bytes : bytes.slice(range.start, range.end + 1);
  }

  async write(vaultPath: string, content: Bytes, options: WriteOptions): Promise<void> {
    const bytes = await toArrayBuffer(content);
    if ((await sha256Hex(bytes)) !== options.expectedHash)
      throw new Error(`${vaultPath}: downloaded bytes do not match`);
    await options.beforeReplace();
    await this.ensureParent(vaultPath);
    await this.adapter.writeBinary(vaultPath, bytes, { mtime: options.mtime });
  }

  async copy(from: string, to: string, mtime: number): Promise<void> {
    const bytes = await this.adapter.readBinary(from);
    await this.ensureParent(to);
    await this.adapter.writeBinary(to, bytes, { mtime });
  }

  async rename(from: string, to: string): Promise<void> {
    await this.ensureParent(to);
    await this.adapter.rename(from, to);
  }

  async remove(vaultPath: string): Promise<void> {
    if (await this.adapter.exists(vaultPath)) await this.adapter.remove(vaultPath);
  }

  private async ensureParent(vaultPath: string): Promise<void> {
    const parent = parentOf(vaultPath);
    if (parent !== "" && !(await this.adapter.exists(parent))) await this.adapter.mkdir(parent);
  }
}
