const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const STEP = 1024;

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${UNITS[unit] ?? "B"}`;
}

export function formatDate(at: number): string {
  return new Date(at).toISOString().replace("T", " ").slice(0, 19);
}

export function shortHash(hash: string | null): string {
  return hash === null ? "-" : hash.slice(0, 10);
}
