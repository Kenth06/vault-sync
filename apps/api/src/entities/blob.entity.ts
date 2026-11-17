import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const blobs = sqliteTable(
  "blobs",
  {
    hash: text("hash").primaryKey(),
    size: integer("size").notNull(),
    refs: integer("refs").notNull().default(0),
    refSinceSeq: integer("ref_since_seq"),
    orphanedSeq: integer("orphaned_seq"),
    orphanedAt: integer("orphaned_at"),
  },
  (t) => [index("blobs_orphaned_at").on(t.orphanedAt)],
);
