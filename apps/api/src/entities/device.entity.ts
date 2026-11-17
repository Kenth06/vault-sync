import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  cursor: integer("cursor").notNull().default(0),
  lastSeen: integer("last_seen"),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
});

export type DeviceRow = typeof devices.$inferSelect;
