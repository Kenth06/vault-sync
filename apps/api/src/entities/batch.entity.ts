import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const batches = sqliteTable("batches", {
  batchId: text("batch_id").primaryKey(),
  seqFrom: integer("seq_from"),
  seqTo: integer("seq_to"),
  at: integer("at").notNull(),
});

export type BatchRow = typeof batches.$inferSelect;
