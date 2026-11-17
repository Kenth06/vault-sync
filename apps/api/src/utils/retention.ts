export interface Dated {
  readonly seq: number;
  readonly at: number;
}

export interface RetentionPolicy {
  readonly daily: number;
  readonly monthly: number;
}

function newestPerBucket(items: readonly Dated[], bucketOf: (at: number) => string, keep: number): number[] {
  const newest = new Map<string, Dated>();
  for (const item of items) {
    const bucket = bucketOf(item.at);
    const current = newest.get(bucket);
    if (!current || item.seq > current.seq) newest.set(bucket, item);
  }
  return [...newest.values()]
    .toSorted((a, b) => b.seq - a.seq)
    .slice(0, keep)
    .map((item) => item.seq);
}

const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);
const monthOf = (at: number): string => new Date(at).toISOString().slice(0, 7);

export function snapshotsToKeep(snapshots: readonly Dated[], policy: RetentionPolicy): Set<number> {
  const latest = snapshots.reduce<number | null>((max, s) => (max === null || s.seq > max ? s.seq : max), null);
  const keep = new Set([
    ...newestPerBucket(snapshots, dayOf, policy.daily),
    ...newestPerBucket(snapshots, monthOf, policy.monthly),
  ]);
  if (latest !== null) keep.add(latest);
  return keep;
}
