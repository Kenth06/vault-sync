import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const files = sqliteTable("files", {
  path: text("path").primaryKey(),
  hash: text("hash"),
  size: integer("size"),
  mtime: integer("mtime"),
  seq: integer("seq").notNull(),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
});

export type FileRow = typeof files.$inferSelect;
