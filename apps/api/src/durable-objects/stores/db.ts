import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";

import type * as schema from "../../entities/index.ts";

export type Db = DrizzleSqliteDODatabase<typeof schema>;

export type TransactionSync = <T>(fn: () => T) => T;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
