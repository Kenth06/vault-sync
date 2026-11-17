import {
  BatchId,
  DeviceId,
  Seq,
  Sha256,
  VaultPath,
  type Change,
  type ChangeRow,
  type CommitRequest,
  type CommitResponse,
  type Conflict,
  type DeleteChange,
  type PlanRequest,
  type PlanResponse,
  type PutChange,
  type RenameChange,
  type TreeEntry,
} from "@vault-sync/protocol";
import { and, count, eq, gt, inArray, ne, sql, sum } from "drizzle-orm";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";

import { SQLITE_IN_CHUNK } from "../common/constants.ts";
import type * as schema from "../entities/index.ts";
import {
  batches,
  blobs,
  changes,
  devices,
  files,
  type BatchRow,
  type ChangeInsert,
  type DeviceRow,
  type FileRow,
} from "../entities/index.ts";

type Db = DrizzleSqliteDODatabase<typeof schema>;
type LogEntry = Omit<ChangeInsert, "deviceId" | "batchId" | "at">;

interface FileState {
  readonly path: string;
  readonly hash: string;
  readonly size: number;
  readonly mtime: number;
  readonly seq: number;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function hashesOf(list: readonly Change[]): Sha256[] {
  const set = new Set<Sha256>();
  for (const c of list) if (c.op !== "delete") set.add(c.hash);
  return [...set];
}

function toEntry(row: FileRow & { hash: string }): TreeEntry {
  return { path: row.path, hash: Sha256.parse(row.hash), size: row.size ?? 0, mtime: row.mtime ?? 0 };
}

export class VaultStore {
  private readonly db: Db;
  private readonly transactionSync: <T>(fn: () => T) => T;

  constructor(db: Db, transactionSync: <T>(fn: () => T) => T) {
    this.db = db;
    this.transactionSync = transactionSync;
  }

  insertDevice(row: { id: DeviceId; name: string; tokenHash: string; now: number }): void {
    this.db
      .insert(devices)
      .values({ id: row.id, name: row.name, tokenHash: row.tokenHash, cursor: this.cursor(), lastSeen: row.now })
      .run();
  }

  findDevice(id: DeviceId): DeviceRow | undefined {
    return this.db.select().from(devices).where(eq(devices.id, id)).get();
  }

  touchDevice(id: DeviceId, now: number): void {
    this.db.update(devices).set({ lastSeen: now }).where(eq(devices.id, id)).run();
  }

  revokeDevice(id: DeviceId): boolean {
    return this.db.update(devices).set({ revoked: true }).where(eq(devices.id, id)).returning().all().length > 0;
  }

  registerBlob(hash: Sha256, size: number, now: number): void {
    this.db.insert(blobs).values({ hash, size, refs: 0, orphanedAt: now }).onConflictDoNothing().run();
  }

  unknownHashes(hashes: readonly Sha256[]): Sha256[] {
    const known = new Set<string>();
    for (const part of chunk(hashes, SQLITE_IN_CHUNK)) {
      const rows = this.db.select({ hash: blobs.hash }).from(blobs).where(inArray(blobs.hash, part)).all();
      for (const r of rows) known.add(r.hash);
    }
    return hashes.filter((h) => !known.has(h));
  }

  plan(deviceId: DeviceId, req: PlanRequest): PlanResponse {
    const paths = new Set<string>();
    for (const c of req.changes) {
      paths.add(c.path);
      if (c.op === "rename") paths.add(c.fromPath);
    }
    return {
      cursor: Seq.parse(this.cursor()),
      missing: this.unknownHashes(hashesOf(req.changes)),
      conflicts: chunk([...paths], SQLITE_IN_CHUNK).flatMap((part) =>
        this.foreignChanges(deviceId, part, req.baseCursor),
      ),
    };
  }

  findBatch(batchId: BatchId): CommitResponse | null {
    const row = this.db.select().from(batches).where(eq(batches.batchId, batchId)).get();
    return row ? this.batchResult(row, true) : null;
  }

  commit(deviceId: DeviceId, req: CommitRequest, now: number): CommitResponse {
    return this.transactionSync(() => {
      const replay = this.findBatch(req.batchId);
      if (replay) return replay;

      const seqs: number[] = [];
      const record = (entry: LogEntry): number => {
        const { seq } = this.db
          .insert(changes)
          .values({ ...entry, deviceId, batchId: req.batchId, at: now })
          .returning({ seq: changes.seq })
          .get();
        seqs.push(seq);
        return seq;
      };

      for (const c of req.changes) this.apply(c, record, now);

      const row: BatchRow = { batchId: req.batchId, seqFrom: seqs.at(0) ?? null, seqTo: seqs.at(-1) ?? null, at: now };
      this.db.insert(batches).values(row).run();
      this.db.update(devices).set({ cursor: this.cursor() }).where(eq(devices.id, deviceId)).run();
      return this.batchResult(row, false);
    });
  }

  cursor(): number {
    const r = this.db
      .select({ max: sql<number | null>`max(${changes.seq})` })
      .from(changes)
      .get();
    return r?.max ?? 0;
  }

  listChanges(since: number, limit: number): ChangeRow[] {
    return this.db
      .select()
      .from(changes)
      .where(gt(changes.seq, since))
      .orderBy(changes.seq)
      .limit(limit)
      .all()
      .map((r) => ({
        seq: Seq.parse(r.seq),
        op: r.op,
        path: r.path,
        fromPath: r.fromPath,
        hash: r.hash === null ? null : Sha256.parse(r.hash),
        prevHash: r.prevHash === null ? null : Sha256.parse(r.prevHash),
        deviceId: DeviceId.parse(r.deviceId),
        at: r.at,
      }));
  }

  tree(): TreeEntry[] {
    return this.db
      .select()
      .from(files)
      .where(eq(files.deleted, false))
      .orderBy(files.path)
      .all()
      .flatMap((r) => (r.hash === null ? [] : [toEntry({ ...r, hash: r.hash })]));
  }

  getFile(path: string): TreeEntry | null {
    const r = this.liveFile(path);
    return r?.hash == null ? null : toEntry({ ...r, hash: r.hash });
  }

  totals(): { files: number; bytes: number } {
    const agg = this.db
      .select({ n: count(), bytes: sum(files.size) })
      .from(files)
      .where(eq(files.deleted, false))
      .get();
    return { files: agg?.n ?? 0, bytes: Number(agg?.bytes ?? 0) };
  }

  private foreignChanges(deviceId: DeviceId, paths: string[], baseCursor: number): Conflict[] {
    return this.db
      .select({ path: files.path, seq: files.seq, hash: files.hash })
      .from(files)
      .innerJoin(changes, eq(changes.seq, files.seq))
      .where(and(inArray(files.path, paths), gt(files.seq, baseCursor), ne(changes.deviceId, deviceId)))
      .all()
      .map((r) => ({
        path: VaultPath.parse(r.path),
        serverSeq: Seq.parse(r.seq),
        serverHash: r.hash === null ? null : Sha256.parse(r.hash),
      }));
  }

  private apply(c: Change, record: (entry: LogEntry) => number, now: number): void {
    switch (c.op) {
      case "put": {
        this.applyPut(c, record, now);
        break;
      }
      case "delete": {
        this.applyDelete(c, record, now);
        break;
      }
      case "rename": {
        this.applyRename(c, record, now);
        break;
      }
    }
  }

  private applyPut(c: PutChange, record: (entry: LogEntry) => number, now: number): void {
    const prev = this.liveFile(c.path);
    if (prev?.hash === c.hash) {
      this.db.update(files).set({ mtime: c.mtime }).where(eq(files.path, c.path)).run();
      return;
    }
    const seq = record({ path: c.path, op: "put", hash: c.hash, prevHash: prev?.hash ?? null });
    this.upsertFile({ path: c.path, hash: c.hash, size: c.size, mtime: c.mtime, seq });
    this.swapRef(c.hash, prev?.hash, now);
  }

  private applyDelete(c: DeleteChange, record: (entry: LogEntry) => number, now: number): void {
    const prev = this.liveFile(c.path);
    if (prev?.hash == null) return;
    const seq = record({ path: c.path, op: "delete", hash: null, prevHash: prev.hash });
    this.markDeleted(c.path, seq);
    this.dropRef(prev.hash, now);
  }

  private applyRename(c: RenameChange, record: (entry: LogEntry) => number, now: number): void {
    const from = this.liveFile(c.fromPath);
    const target = this.liveFile(c.path);
    const seq = record({
      path: c.path,
      op: "rename",
      hash: c.hash,
      prevHash: target?.hash ?? null,
      fromPath: c.fromPath,
    });
    if (from?.hash != null) {
      this.markDeleted(c.fromPath, seq);
      this.dropRef(from.hash, now);
    }
    this.upsertFile({ path: c.path, hash: c.hash, size: c.size, mtime: c.mtime, seq });
    this.swapRef(c.hash, target?.hash, now);
  }

  private liveFile(path: string): FileRow | undefined {
    const r = this.db.select().from(files).where(eq(files.path, path)).get();
    return r && !r.deleted ? r : undefined;
  }

  private upsertFile(state: FileState): void {
    const { hash, size, mtime, seq } = state;
    this.db
      .insert(files)
      .values({ ...state, deleted: false })
      .onConflictDoUpdate({ target: files.path, set: { hash, size, mtime, seq, deleted: false } })
      .run();
  }

  private markDeleted(path: string, seq: number): void {
    this.db.update(files).set({ hash: null, deleted: true, seq }).where(eq(files.path, path)).run();
  }

  private swapRef(added: string, removed: string | null | undefined, now: number): void {
    this.db
      .update(blobs)
      .set({ refs: sql`${blobs.refs} + 1`, orphanedAt: null })
      .where(eq(blobs.hash, added))
      .run();
    if (removed != null) this.dropRef(removed, now);
  }

  private dropRef(hash: string, now: number): void {
    this.db
      .update(blobs)
      .set({
        refs: sql`max(${blobs.refs} - 1, 0)`,
        orphanedAt: sql`case when ${blobs.refs} - 1 <= 0 then ${now} else ${blobs.orphanedAt} end`,
      })
      .where(eq(blobs.hash, hash))
      .run();
  }

  private batchResult(row: BatchRow, replayed: boolean): CommitResponse {
    return {
      batchId: BatchId.parse(row.batchId),
      seqFrom: row.seqFrom === null ? null : Seq.parse(row.seqFrom),
      seqTo: row.seqTo === null ? null : Seq.parse(row.seqTo),
      cursor: Seq.parse(this.cursor()),
      replayed,
    };
  }
}
