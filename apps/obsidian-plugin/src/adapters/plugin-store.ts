import type { Change } from "@vault-sync/protocol";
import type { FileMeta, FileStat, SyncStore } from "@vault-sync/sync-core";
import { z } from "zod";

const Meta = z.object({ hash: z.string(), size: z.number(), mtime: z.number() });

const Persisted = z.object({
  cursor: z.number().int().nonnegative().default(0),
  synced: z.record(z.string(), Meta).default({}),
  hashes: z.record(z.string(), Meta).default({}),
  lastSyncAt: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null),
});
type Persisted = z.infer<typeof Persisted>;

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unknown error";
}

export interface TextFile {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

export class PluginStore implements SyncStore {
  private data: Persisted = Persisted.parse({});
  private readonly file: TextFile;

  constructor(file: TextFile) {
    this.file = file;
  }

  async load(): Promise<void> {
    const text = await this.file.read();
    if (text === null) return;
    const parsed = Persisted.safeParse(JSON.parse(text));
    if (parsed.success) this.data = parsed.data;
  }

  cursor(): number {
    return this.data.cursor;
  }

  synced(): Map<string, FileMeta> {
    return new Map(Object.entries(this.data.synced));
  }

  cachedHash(file: FileStat): string | null {
    const meta = this.data.hashes[file.path];
    return meta !== undefined && meta.size === file.size && meta.mtime === file.mtime ? meta.hash : null;
  }

  saveHash(vaultPath: string, meta: FileMeta): void {
    this.data.hashes[vaultPath] = meta;
  }

  async applyCommitted(changes: readonly Change[], cursor: number): Promise<void> {
    for (const c of changes) {
      if (c.op === "delete") this.forget(c.path);
      if (c.op === "rename") this.forget(c.fromPath);
      if (c.op !== "delete") this.data.synced[c.path] = { hash: c.hash, size: c.size, mtime: c.mtime };
    }
    this.data.cursor = cursor;
    await this.save();
  }

  async applyPulled(updates: ReadonlyMap<string, FileMeta | null>, cursor: number): Promise<void> {
    for (const [vaultPath, meta] of updates) {
      if (meta === null) this.forget(vaultPath);
      else this.data.synced[vaultPath] = meta;
    }
    this.data.cursor = Math.max(cursor, this.data.cursor);
    await this.save();
  }

  async recordResult(error: unknown): Promise<void> {
    this.data.lastSyncAt = new Date().toISOString();
    this.data.lastError = error === null ? null : describeError(error);
    await this.save();
  }

  status(): { cursor: number; files: number; lastSyncAt: string | null; lastError: string | null } {
    return {
      cursor: this.data.cursor,
      files: Object.keys(this.data.synced).length,
      lastSyncAt: this.data.lastSyncAt,
      lastError: this.data.lastError,
    };
  }

  private forget(vaultPath: string): void {
    this.data.synced = Object.fromEntries(Object.entries(this.data.synced).filter(([p]) => p !== vaultPath));
  }

  private save(): Promise<void> {
    return this.file.write(JSON.stringify(this.data));
  }
}
