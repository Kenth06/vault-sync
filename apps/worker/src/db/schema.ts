import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Current state of every path ever seen. `hash` is NULL once deleted. */
export const files = sqliteTable("files", {
  path: text("path").primaryKey(),
  hash: text("hash"),
  size: integer("size"),
  mtime: integer("mtime"),
  /** Last change that touched this path. */
  seq: integer("seq").notNull(),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
});

/** Append-only change log. `seq` is the vault cursor. */
export const changes = sqliteTable(
  "changes",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    path: text("path").notNull(),
    op: text("op", { enum: ["put", "delete", "rename"] }).notNull(),
    hash: text("hash"),
    prevHash: text("prev_hash"),
    fromPath: text("from_path"),
    deviceId: text("device_id").notNull(),
    batchId: text("batch_id").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("changes_path").on(t.path)],
);

/** Blobs this vault knows are in R2, with how many live paths point at them. */
export const blobs = sqliteTable("blobs", {
  hash: text("hash").primaryKey(),
  size: integer("size").notNull(),
  refs: integer("refs").notNull().default(0),
  orphanedAt: integer("orphaned_at"),
});

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  cursor: integer("cursor").notNull().default(0),
  lastSeen: integer("last_seen"),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
});

/** Commit idempotency: a replayed batchId returns the stored result. */
export const batches = sqliteTable("batches", {
  batchId: text("batch_id").primaryKey(),
  seqFrom: integer("seq_from"),
  seqTo: integer("seq_to"),
  at: integer("at").notNull(),
});

export const snapshots = sqliteTable("snapshots", {
  seq: integer("seq").primaryKey(),
  r2Key: text("r2_key").notNull(),
  files: integer("files").notNull(),
  bytes: integer("bytes").notNull(),
  at: integer("at").notNull(),
});
