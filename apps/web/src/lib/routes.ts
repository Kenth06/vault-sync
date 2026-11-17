function encodePath(vaultPath: string): string {
  return vaultPath.split("/").map(encodeURIComponent).join("/");
}

export function noteHref(vaultPath: string): string {
  return `/f/${encodePath(vaultPath)}`;
}

export function snapshotHref(seq: number): string {
  return `/snapshots/${seq}`;
}

export function snapshotFileHref(seq: number, vaultPath: string): string {
  return `/snapshots/${seq}/f/${encodePath(vaultPath)}`;
}
