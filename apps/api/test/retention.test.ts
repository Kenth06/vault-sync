import { describe, expect, it } from "vitest";

import { snapshotsToKeep } from "../src/utils/retention.ts";

const DAY = 24 * 60 * 60 * 1000;
const start = Date.UTC(2026, 0, 1);

function daily(count: number): { seq: number; at: number }[] {
  return Array.from({ length: count }, (_, i) => ({ seq: i + 1, at: start + i * DAY }));
}

describe("snapshotsToKeep", () => {
  it("keeps the newest snapshot of each of the last N days", () => {
    const keep = snapshotsToKeep(daily(5), { daily: 3, monthly: 0 });
    expect([...keep].toSorted((a, b) => a - b)).toEqual([3, 4, 5]);
  });

  it("keeps one snapshot per month beyond the daily window", () => {
    const keep = snapshotsToKeep(daily(100), { daily: 2, monthly: 4 });
    expect([...keep].toSorted((a, b) => a - b)).toEqual([31, 59, 90, 99, 100]);
  });

  it("keeps only the newest snapshot within one day", () => {
    const sameDay = [
      { seq: 1, at: start },
      { seq: 2, at: start + 1000 },
      { seq: 3, at: start + 2000 },
    ];
    expect([...snapshotsToKeep(sameDay, { daily: 30, monthly: 12 })]).toEqual([3]);
  });

  it("always keeps the latest snapshot", () => {
    expect([...snapshotsToKeep(daily(3), { daily: 0, monthly: 0 })]).toEqual([3]);
  });
});
