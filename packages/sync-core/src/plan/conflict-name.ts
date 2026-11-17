const UNSAFE = /[<>:"/\\|?*]/gu;
const MAX_STEM = 150;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function stamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function splitPath(vaultPath: string): { dir: string; stem: string; ext: string } {
  const slash = vaultPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : vaultPath.slice(0, slash);
  const base = vaultPath.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const hasExt = dot > 0;
  return { dir, stem: hasExt ? base.slice(0, dot) : base, ext: hasExt ? base.slice(dot) : "" };
}

export function conflictName(vaultPath: string, device: string, date: Date, attempt = 1): string {
  const { dir, stem, ext } = splitPath(vaultPath);
  const label = device.replaceAll(UNSAFE, "-");
  const suffix = attempt > 1 ? ` ${attempt}` : "";
  const name = `${stem.slice(0, MAX_STEM)} (conflicto ${label} ${stamp(date)}${suffix})${ext}`;
  return dir === "" ? name : `${dir}/${name}`;
}
