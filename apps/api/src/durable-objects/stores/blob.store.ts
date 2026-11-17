import { Sha256 } from "@vault-sync/protocol";
import { and, asc, eq, inArray, isNotNull, lte, min, sql } from "drizzle-orm";

import { SQLITE_IN_CHUNK } from "../../common/constants.ts";
import { blobs, snapshots } from "../../entities/index.ts";
import { chunk, type Db } from "./db.ts";

export interface RefChange {
  readonly seq: number;
  readonly now: number;
}

export class BlobStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  register(hash: Sha256, size: number, now: number): void {
    this.db.insert(blobs).values({ hash, size, refs: 0, orphanedAt: now }).onConflictDoNothing().run();
  }

  unknown(hashes: readonly Sha256[]): Sha256[] {
    const known = new Set<string>();
    for (const part of chunk(hashes, SQLITE_IN_CHUNK)) {
      const rows = this.db.select({ hash: blobs.hash }).from(blobs).where(inArray(blobs.hash, part)).all();
      for (const r of rows) known.add(r.hash);
    }
    return hashes.filter((h) => !known.has(h));
  }

  addRef(hash: string, at: RefChange): void {
    this.db
      .update(blobs)
      .set({
        refs: sql`${blobs.refs} + 1`,
        refSinceSeq: sql`coalesce(${blobs.refSinceSeq}, ${at.seq})`,
        orphanedAt: null,
        orphanedSeq: null,
      })
      .where(eq(blobs.hash, hash))
      .run();
  }

  dropRef(hash: string, at: RefChange): void {
    const becomesOrphan = sql`${blobs.refs} - 1 <= 0`;
    this.db
      .update(blobs)
      .set({
        refs: sql`max(${blobs.refs} - 1, 0)`,
        orphanedAt: sql`case when ${becomesOrphan} then ${at.now} else ${blobs.orphanedAt} end`,
        orphanedSeq: sql`case when ${becomesOrphan} then ${at.seq} else ${blobs.orphanedSeq} end`,
      })
      .where(eq(blobs.hash, hash))
      .run();
  }

  collectable(cutoff: number, limit: number): Sha256[] {
    return this.db
      .select({ hash: blobs.hash })
      .from(blobs)
      .where(and(unprotectedOrphan(), lte(blobs.orphanedAt, cutoff)))
      .orderBy(asc(blobs.orphanedAt))
      .limit(limit)
      .all()
      .map((r) => Sha256.parse(r.hash));
  }

  forgetOrphans(hashes: readonly Sha256[]): Sha256[] {
    const removed: Sha256[] = [];
    for (const part of chunk(hashes, SQLITE_IN_CHUNK)) {
      const rows = this.db
        .delete(blobs)
        .where(and(inArray(blobs.hash, part), eq(blobs.refs, 0)))
        .returning({ hash: blobs.hash })
        .all();
      for (const r of rows) removed.push(Sha256.parse(r.hash));
    }
    return removed;
  }

  oldestUnprotectedOrphan(): number | null {
    const row = this.db
      .select({ at: min(blobs.orphanedAt) })
      .from(blobs)
      .where(unprotectedOrphan())
      .get();
    return row?.at ?? null;
  }
}

function unprotectedOrphan() {
  const inRetainedSnapshot = sql`exists (
    select 1 from ${snapshots}
    where ${snapshots.seq} >= ${blobs.refSinceSeq}
      and ${snapshots.seq} < coalesce(${blobs.orphanedSeq}, ${snapshots.seq} + 1)
  )`;
  return and(
    eq(blobs.refs, 0),
    isNotNull(blobs.orphanedAt),
    sql`(${blobs.refSinceSeq} is null or not ${inRetainedSnapshot})`,
  );
}
