import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const blobs = sqliteTable("blobs", {
  hash: text("hash").primaryKey(),
  size: integer("size").notNull(),
  refs: integer("refs").notNull().default(0),
  orphanedAt: integer("orphaned_at"),
});
