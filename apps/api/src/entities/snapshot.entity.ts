import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const snapshots = sqliteTable("snapshots", {
  seq: integer("seq").primaryKey(),
  r2Key: text("r2_key").notNull(),
  files: integer("files").notNull(),
  bytes: integer("bytes").notNull(),
  at: integer("at").notNull(),
});
