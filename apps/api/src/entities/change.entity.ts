import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const changes = sqliteTable(
  "changes",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    path: text("path").notNull(),
    op: text("op", { enum: ["put", "delete", "rename"] }).notNull(),
    hash: text("hash"),
    prevHash: text("prev_hash"),
    size: integer("size"),
    mtime: integer("mtime"),
    fromPath: text("from_path"),
    deviceId: text("device_id").notNull(),
    batchId: text("batch_id").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("changes_path").on(t.path), index("changes_from_path").on(t.fromPath)],
);

export type ChangeInsert = typeof changes.$inferInsert;
