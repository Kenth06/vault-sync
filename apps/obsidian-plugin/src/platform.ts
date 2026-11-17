const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/iu;
const WINDOWS_FORBIDDEN = /[<>:"|?*]/u;

export function windowsUnsafe(vaultPath: string): boolean {
  return vaultPath.split("/").some((segment) => {
    const trailing = segment.endsWith(".") || segment.endsWith(" ");
    return trailing || WINDOWS_FORBIDDEN.test(segment) || WINDOWS_RESERVED.test(segment);
  });
}
