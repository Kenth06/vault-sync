import path from "node:path";

const UNSAFE = /[<>:"/\\|?*]/gu;
const MAX_STEM = 150;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function stamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function conflictName(vaultPath: string, device: string, date: Date, attempt = 1): string {
  const dir = path.posix.dirname(vaultPath);
  const ext = path.posix.extname(vaultPath);
  const stem = path.posix.basename(vaultPath, ext).slice(0, MAX_STEM);
  const label = device.replaceAll(UNSAFE, "-");
  const suffix = attempt > 1 ? ` ${attempt}` : "";
  const name = `${stem} (conflicto ${label} ${stamp(date)}${suffix})${ext}`;
  return dir === "." ? name : `${dir}/${name}`;
}
