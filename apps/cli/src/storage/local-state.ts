import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Change } from "@vault-sync/protocol";
import { z } from "zod";

import { STATE_DIR } from "../common/constants.ts";
import type { FileMeta } from "../common/types.ts";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS hash_cache (path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime INTEGER NOT NULL, hash TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS synced (path TEXT PRIMARY KEY, hash TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const SyncedRow = z.object({ path: z.string(), hash: z.string(), size: z.number(), mtime: z.number() });
const HashRow = z.object({ hash: z.string() });
const MetaRow = z.object({ value: z.string() });

export class LocalState {
  private readonly db: DatabaseSync;

  constructor(root: string) {
    this.db = new DatabaseSync(path.join(root, STATE_DIR, "state.db"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  cachedHash(vaultPath: string, size: number, mtime: number): string | null {
    const row = this.db
      .prepare("SELECT hash FROM hash_cache WHERE path = ? AND size = ? AND mtime = ?")
      .get(vaultPath, size, mtime);
    return row === undefined ? null : HashRow.parse(row).hash;
  }

  saveHash(vaultPath: string, meta: FileMeta): void {
    this.db
      .prepare("INSERT OR REPLACE INTO hash_cache (path, size, mtime, hash) VALUES (?, ?, ?, ?)")
      .run(vaultPath, meta.size, meta.mtime, meta.hash);
  }

  synced(): Map<string, FileMeta> {
    const rows = SyncedRow.array().parse(this.db.prepare("SELECT path, hash, size, mtime FROM synced").all());
    return new Map(rows.map((r) => [r.path, { hash: r.hash, size: r.size, mtime: r.mtime }]));
  }

  applyCommitted(changes: readonly Change[], cursor: number): void {
    const put = this.db.prepare("INSERT OR REPLACE INTO synced (path, hash, size, mtime) VALUES (?, ?, ?, ?)");
    const del = this.db.prepare("DELETE FROM synced WHERE path = ?");
    this.db.exec("BEGIN");
    try {
      for (const c of changes) {
        if (c.op === "delete") del.run(c.path);
        if (c.op === "rename") del.run(c.fromPath);
        if (c.op !== "delete") put.run(c.path, c.hash, c.size, c.mtime);
      }
      this.setMeta("cursor", String(cursor));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  cursor(): number {
    return Number(this.getMeta("cursor") ?? 0);
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return row === undefined ? null : MetaRow.parse(row).value;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
