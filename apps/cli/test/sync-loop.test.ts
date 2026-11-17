import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncReport } from "../src/common/types.ts";
import { SyncLoop } from "../src/services/sync-loop.ts";

const report: SyncReport = { pulled: 0, pushed: 0, batches: 0, conflicts: [], failed: [], cursor: 0 };

function ignoreReport(_report: SyncReport): void {}
function ignoreError(_error: unknown, _retryIn: number): void {}

describe("SyncLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the error backoff even when files keep changing", async () => {
    const sync = vi.fn<() => Promise<SyncReport>>().mockRejectedValue(new Error("down"));
    const loop = new SyncLoop({ sync, onSynced: ignoreReport, onError: ignoreError, now: () => Date.now() });

    await loop.run();
    expect(sync).toHaveBeenCalledTimes(1);

    loop.schedule();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(sync).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it("debounces events after a successful sync", async () => {
    const sync = vi.fn<() => Promise<SyncReport>>().mockResolvedValue(report);
    const loop = new SyncLoop({ sync, onSynced: ignoreReport, onError: ignoreError, now: () => Date.now() });

    loop.schedule();
    loop.schedule();
    loop.schedule();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it("resets the backoff after a success", async () => {
    const onError = vi.fn<(error: unknown, retryIn: number) => void>();
    const sync = vi
      .fn<() => Promise<SyncReport>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue(report);
    const loop = new SyncLoop({ sync, onSynced: ignoreReport, onError, now: () => Date.now() });

    await loop.run();
    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(8000);
    expect(onError.mock.calls.map(([, retryIn]) => retryIn)).toEqual([4000, 8000]);
    expect(sync).toHaveBeenCalledTimes(3);
    loop.stop();
  });
});
