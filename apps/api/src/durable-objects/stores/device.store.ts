import { DeviceId, Seq, type DeviceInfo } from "@vault-sync/protocol";
import { eq } from "drizzle-orm";

import { devices, type DeviceRow } from "../../entities/index.ts";
import type { Db } from "./db.ts";

export interface NewDevice {
  readonly id: DeviceId;
  readonly name: string;
  readonly tokenHash: string;
  readonly cursor: number;
  readonly now: number;
}

export class DeviceStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  insert(device: NewDevice): void {
    this.db
      .insert(devices)
      .values({
        id: device.id,
        name: device.name,
        tokenHash: device.tokenHash,
        cursor: device.cursor,
        lastSeen: device.now,
      })
      .run();
  }

  find(id: DeviceId): DeviceRow | undefined {
    return this.db.select().from(devices).where(eq(devices.id, id)).get();
  }

  list(): DeviceInfo[] {
    return this.db
      .select()
      .from(devices)
      .orderBy(devices.name)
      .all()
      .map((row) => ({
        id: DeviceId.parse(row.id),
        name: row.name,
        cursor: Seq.parse(row.cursor),
        lastSeen: row.lastSeen,
        revoked: row.revoked,
      }));
  }

  touch(id: DeviceId, now: number): void {
    this.db.update(devices).set({ lastSeen: now }).where(eq(devices.id, id)).run();
  }

  setCursor(id: DeviceId, cursor: number): void {
    this.db.update(devices).set({ cursor }).where(eq(devices.id, id)).run();
  }

  revoke(id: DeviceId): boolean {
    return this.db.update(devices).set({ revoked: true }).where(eq(devices.id, id)).returning().all().length > 0;
  }
}
