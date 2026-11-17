import { Seq, type SnapshotInfo } from "@vault-sync/protocol";
import { desc, eq, inArray, max } from "drizzle-orm";

import { SQLITE_IN_CHUNK } from "../../common/constants.ts";
import { snapshots } from "../../entities/index.ts";
import { chunk, type Db } from "./db.ts";

export interface SnapshotRecord extends SnapshotInfo {
  readonly r2Key: string;
}

export class SnapshotStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  insert(record: SnapshotRecord): void {
    this.db.insert(snapshots).values(record).onConflictDoNothing().run();
  }

  list(): SnapshotInfo[] {
    return this.db
      .select()
      .from(snapshots)
      .orderBy(desc(snapshots.seq))
      .all()
      .map((r) => ({ seq: Seq.parse(r.seq), files: r.files, bytes: r.bytes, at: r.at }));
  }

  find(seq: number): SnapshotRecord | null {
    const row = this.db.select().from(snapshots).where(eq(snapshots.seq, seq)).get();
    return row ? { ...row, seq: Seq.parse(row.seq) } : null;
  }

  latestSeq(): number | null {
    return (
      this.db
        .select({ seq: max(snapshots.seq) })
        .from(snapshots)
        .get()?.seq ?? null
    );
  }

  keysFor(seqs: readonly number[]): string[] {
    return chunk(seqs, SQLITE_IN_CHUNK).flatMap((part) =>
      this.db
        .select({ key: snapshots.r2Key })
        .from(snapshots)
        .where(inArray(snapshots.seq, part))
        .all()
        .map((r) => r.key),
    );
  }

  remove(seqs: readonly number[]): void {
    for (const part of chunk(seqs, SQLITE_IN_CHUNK)) {
      this.db.delete(snapshots).where(inArray(snapshots.seq, part)).run();
    }
  }
}
