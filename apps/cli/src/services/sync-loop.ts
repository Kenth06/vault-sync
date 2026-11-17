import { WATCH_DEBOUNCE_MS, WATCH_MAX_BACKOFF_MS } from "../common/constants.ts";
import type { SyncReport } from "../common/types.ts";

export interface SyncLoopOptions {
  readonly sync: () => Promise<SyncReport>;
  readonly onSynced: (report: SyncReport) => void;
  readonly onError: (error: unknown, retryInMs: number) => void;
  readonly now?: () => number;
}

export class SyncLoop {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private dirty = false;
  private failures = 0;
  private notBefore = 0;
  private readonly options: SyncLoopOptions;
  private readonly now: () => number;

  constructor(options: SyncLoopOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  schedule(ms = WATCH_DEBOUNCE_MS): void {
    const delay = Math.max(ms, this.notBefore - this.now());
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  async run(): Promise<void> {
    if (this.running) {
      this.dirty = true;
      return;
    }
    this.running = true;
    this.dirty = false;
    try {
      this.options.onSynced(await this.options.sync());
      this.failures = 0;
      this.notBefore = 0;
    } catch (error) {
      this.backOff(error);
    } finally {
      this.running = false;
      if (this.hasPendingChanges()) this.schedule();
    }
  }

  private hasPendingChanges(): boolean {
    return this.dirty;
  }

  private backOff(error: unknown): void {
    this.failures += 1;
    const retryIn = Math.min(WATCH_DEBOUNCE_MS * 2 ** this.failures, WATCH_MAX_BACKOFF_MS);
    this.notBefore = this.now() + retryIn;
    this.options.onError(error, retryIn);
    this.schedule(retryIn);
  }
}
