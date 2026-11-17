import {
  blobKey,
  Seq,
  snapshotKey,
  type SnapshotInfo,
  type SnapshotManifest,
  type VaultId,
} from "@vault-sync/protocol";

import {
  GC_BATCH,
  GC_DRAIN_DELAY_MS,
  RETAIN_DAILY_SNAPSHOTS,
  RETAIN_MONTHLY_SNAPSHOTS,
  SNAPSHOT_INTERVAL_MS,
} from "../common/constants.ts";
import { gzipJson } from "../utils/gzip.ts";
import { snapshotsToKeep } from "../utils/retention.ts";
import type { BlobStore } from "./stores/blob.store.ts";
import type { ManifestStore } from "./stores/manifest.store.ts";
import type { SnapshotStore } from "./stores/snapshot.store.ts";

export interface MaintenanceDependencies {
  readonly vaultId: VaultId;
  readonly bucket: R2Bucket;
  readonly manifest: ManifestStore;
  readonly blobs: BlobStore;
  readonly snapshots: SnapshotStore;
  readonly gcGraceMs: number;
  readonly exclusive: <T>(work: () => Promise<T>) => Promise<T>;
}

export interface MaintenanceReport {
  readonly snapshot: SnapshotInfo | null;
  readonly prunedSnapshots: number;
  readonly collectedBlobs: number;
  readonly nextRunAt: number | null;
}

export class VaultMaintenance {
  private readonly deps: MaintenanceDependencies;

  constructor(deps: MaintenanceDependencies) {
    this.deps = deps;
  }

  async run(now: number): Promise<MaintenanceReport> {
    const snapshot = await this.snapshotIfChanged(now);
    const prunedSnapshots = await this.pruneSnapshots();
    const collectedBlobs = await this.collectGarbage(now);
    return { snapshot, prunedSnapshots, collectedBlobs, nextRunAt: this.nextRunAt(now, collectedBlobs) };
  }

  snapshotIfChanged(now: number): Promise<SnapshotInfo | null> {
    const { manifest, snapshots } = this.deps;
    const seq = manifest.cursor();
    if (seq === 0 || seq === snapshots.latestSeq()) return Promise.resolve(null);
    return this.writeSnapshot(Seq.parse(seq), now);
  }

  private async writeSnapshot(seq: Seq, now: number): Promise<SnapshotInfo> {
    const { vaultId, bucket, manifest, snapshots } = this.deps;
    const files = manifest.tree();
    const body: SnapshotManifest = { vaultId, seq, createdAt: now, files };
    const r2Key = snapshotKey(vaultId, seq);
    await bucket.put(r2Key, await gzipJson(body), {
      httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
    });
    const info: SnapshotInfo = { seq, files: files.length, bytes: files.reduce((sum, f) => sum + f.size, 0), at: now };
    snapshots.insert({ ...info, r2Key });
    return info;
  }

  private async pruneSnapshots(): Promise<number> {
    const { bucket, snapshots } = this.deps;
    const all = snapshots.list();
    const keep = snapshotsToKeep(all, { daily: RETAIN_DAILY_SNAPSHOTS, monthly: RETAIN_MONTHLY_SNAPSHOTS });
    const drop = all.filter((s) => !keep.has(s.seq)).map((s) => s.seq);
    if (drop.length === 0) return 0;
    await bucket.delete(snapshots.keysFor(drop));
    snapshots.remove(drop);
    return drop.length;
  }

  private collectGarbage(now: number): Promise<number> {
    const { vaultId, bucket, blobs, gcGraceMs, exclusive } = this.deps;
    return exclusive(async () => {
      const removed = blobs.forgetOrphans(blobs.collectable(now - gcGraceMs, GC_BATCH));
      if (removed.length > 0) await bucket.delete(removed.map((h) => blobKey(vaultId, h)));
      return removed.length;
    });
  }

  private nextRunAt(now: number, collected: number): number | null {
    const { manifest, snapshots, blobs, gcGraceMs } = this.deps;
    if (collected === GC_BATCH) return now + GC_DRAIN_DELAY_MS;
    const candidates: number[] = [];
    if (manifest.cursor() !== (snapshots.latestSeq() ?? 0)) candidates.push(now + SNAPSHOT_INTERVAL_MS);
    const orphan = blobs.oldestUnprotectedOrphan();
    if (orphan !== null) candidates.push(Math.max(orphan + gcGraceMs, now + SNAPSHOT_INTERVAL_MS));
    return candidates.length === 0 ? null : Math.min(...candidates);
  }
}
