import {
  BatchId,
  DeviceId,
  Seq,
  Sha256,
  type TreeEntry,
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
} from "@vault-sync/protocol";
import { and, count, desc, eq, gt, inArray, ne, or, sql, sum } from "drizzle-orm";
import { z } from "zod";

import { SQLITE_IN_CHUNK } from "../../common/constants.ts";
import { batches, changes, files, type BatchRow, type ChangeInsert, type FileRow } from "../../entities/index.ts";
import type { BlobStore } from "./blob.store.ts";
import { chunk, type Db, type TransactionSync } from "./db.ts";
import type { DeviceStore } from "./device.store.ts";

type LogEntry = Omit<ChangeInsert, "deviceId" | "batchId" | "at">;
type Record = (entry: LogEntry) => number;

interface Context {
  readonly record: Record;
  readonly now: number;
}

const TreeAtRow = z.object({
  path: z.string(),
  hash: z.string(),
  size: z.number().nullable(),
  mtime: z.number().nullable(),
});

export function hashesOf(list: readonly Change[]): Sha256[] {
  const set = new Set<Sha256>();
  for (const c of list) if (c.op !== "delete") set.add(c.hash);
  return [...set];
}

function toEntry(row: { path: string; hash: string; size: number | null; mtime: number | null }): TreeEntry {
  return { path: row.path, hash: Sha256.parse(row.hash), size: row.size ?? 0, mtime: row.mtime ?? 0 };
}

function toChangeRow(r: typeof changes.$inferSelect): ChangeRow {
  return {
    seq: Seq.parse(r.seq),
    op: r.op,
    path: r.path,
    fromPath: r.fromPath,
    hash: r.hash === null ? null : Sha256.parse(r.hash),
    prevHash: r.prevHash === null ? null : Sha256.parse(r.prevHash),
    size: r.size,
    mtime: r.mtime,
    deviceId: DeviceId.parse(r.deviceId),
    at: r.at,
  };
}

export interface ManifestDependencies {
  readonly db: Db;
  readonly transactionSync: TransactionSync;
  readonly blobs: BlobStore;
  readonly devices: DeviceStore;
}

export class ManifestStore {
  private readonly db: Db;
  private readonly transactionSync: TransactionSync;
  private readonly blobs: BlobStore;
  private readonly devices: DeviceStore;

  constructor(deps: ManifestDependencies) {
    this.db = deps.db;
    this.transactionSync = deps.transactionSync;
    this.blobs = deps.blobs;
    this.devices = deps.devices;
  }

  cursor(): number {
    const r = this.db
      .select({ max: sql<number | null>`max(${changes.seq})` })
      .from(changes)
      .get();
    return r?.max ?? 0;
  }

  plan(deviceId: DeviceId, req: PlanRequest): PlanResponse {
    const paths = new Set<string>();
    for (const c of req.changes) {
      paths.add(c.path);
      if (c.op === "rename") paths.add(c.fromPath);
    }
    return {
      cursor: Seq.parse(this.cursor()),
      missing: this.blobs.unknown(hashesOf(req.changes)),
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
      const record: Record = (entry) => {
        const { seq } = this.db
          .insert(changes)
          .values({ ...entry, deviceId, batchId: req.batchId, at: now })
          .returning({ seq: changes.seq })
          .get();
        seqs.push(seq);
        return seq;
      };

      for (const c of req.changes) this.apply(c, { record, now });

      const row: BatchRow = { batchId: req.batchId, seqFrom: seqs.at(0) ?? null, seqTo: seqs.at(-1) ?? null, at: now };
      this.db.insert(batches).values(row).run();
      this.devices.setCursor(deviceId, this.cursor());
      return this.batchResult(row, false);
    });
  }

  listChanges(since: number, limit: number): ChangeRow[] {
    return this.db
      .select()
      .from(changes)
      .where(gt(changes.seq, since))
      .orderBy(changes.seq)
      .limit(limit)
      .all()
      .map(toChangeRow);
  }

  history(path: string, limit: number): ChangeRow[] {
    return this.db
      .select()
      .from(changes)
      .where(or(eq(changes.path, path), eq(changes.fromPath, path)))
      .orderBy(desc(changes.seq))
      .limit(limit)
      .all()
      .map(toChangeRow);
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

  treeAt(seq: number): TreeEntry[] {
    const rows = this.db.all(sql`
      with last as (
        select ${changes.path} as path, max(${changes.seq}) as seq
        from ${changes} where ${changes.seq} <= ${seq} group by ${changes.path}
      )
      select c.path as path, c.hash as hash, c.size as size, c.mtime as mtime
      from ${changes} c join last on c.path = last.path and c.seq = last.seq
      where c.op != 'delete'
        and not exists (
          select 1 from ${changes} r
          where r.op = 'rename' and r.from_path = c.path and r.seq > c.seq and r.seq <= ${seq}
        )
      order by c.path
    `);
    return TreeAtRow.array().parse(rows).map(toEntry);
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

  private apply(c: Change, ctx: Context): void {
    switch (c.op) {
      case "put": {
        this.applyPut(c, ctx);
        break;
      }
      case "delete": {
        this.applyDelete(c, ctx);
        break;
      }
      case "rename": {
        this.applyRename(c, ctx);
        break;
      }
    }
  }

  private applyPut(c: PutChange, ctx: Context): void {
    const prev = this.liveFile(c.path);
    if (prev?.hash === c.hash) {
      this.db.update(files).set({ mtime: c.mtime }).where(eq(files.path, c.path)).run();
      return;
    }
    const seq = ctx.record({
      path: c.path,
      op: "put",
      hash: c.hash,
      prevHash: prev?.hash ?? null,
      size: c.size,
      mtime: c.mtime,
    });
    this.upsertFile({ path: c.path, hash: c.hash, size: c.size, mtime: c.mtime, seq });
    this.blobs.addRef(c.hash, { seq, now: ctx.now });
    if (prev?.hash != null) this.blobs.dropRef(prev.hash, { seq, now: ctx.now });
  }

  private applyDelete(c: DeleteChange, ctx: Context): void {
    const prev = this.liveFile(c.path);
    if (prev?.hash == null) return;
    const seq = ctx.record({ path: c.path, op: "delete", hash: null, prevHash: prev.hash });
    this.markDeleted(c.path, seq);
    this.blobs.dropRef(prev.hash, { seq, now: ctx.now });
  }

  private applyRename(c: RenameChange, ctx: Context): void {
    const from = this.liveFile(c.fromPath);
    const target = this.liveFile(c.path);
    const seq = ctx.record({
      path: c.path,
      op: "rename",
      hash: c.hash,
      prevHash: target?.hash ?? null,
      fromPath: c.fromPath,
      size: c.size,
      mtime: c.mtime,
    });
    this.blobs.addRef(c.hash, { seq, now: ctx.now });
    if (from?.hash != null) {
      this.markDeleted(c.fromPath, seq);
      this.blobs.dropRef(from.hash, { seq, now: ctx.now });
    }
    this.upsertFile({ path: c.path, hash: c.hash, size: c.size, mtime: c.mtime, seq });
    if (target?.hash != null) this.blobs.dropRef(target.hash, { seq, now: ctx.now });
  }

  private liveFile(path: string): FileRow | undefined {
    const r = this.db.select().from(files).where(eq(files.path, path)).get();
    return r && !r.deleted ? r : undefined;
  }

  private upsertFile(state: { path: string; hash: string; size: number; mtime: number; seq: number }): void {
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
