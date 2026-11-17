const UNITS = ["B", "KB", "MB", "GB"] as const;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const dateTime = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fullDate = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const count = new Intl.NumberFormat("en");

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit] ?? "B"}`;
}

export function formatAgo(at: number, now = Date.now()): string {
  const diff = at - now;
  if (Math.abs(diff) < MINUTE) return "just now";
  if (Math.abs(diff) < HOUR) return relative.format(Math.round(diff / MINUTE), "minute");
  if (Math.abs(diff) < DAY) return relative.format(Math.round(diff / HOUR), "hour");
  if (Math.abs(diff) < 7 * DAY) return relative.format(Math.round(diff / DAY), "day");
  return dateTime.format(at);
}

export function formatDate(at: number): string {
  return dateTime.format(at);
}

export function formatFullDate(at: number): string {
  return fullDate.format(at);
}

export function formatCount(n: number, noun: string): string {
  return `${count.format(n)} ${n === 1 ? noun : `${noun}s`}`;
}
