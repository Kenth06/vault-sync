import { z } from "zod";

export type NormalizeResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string };

const DRIVE_LETTER = /^[a-z]:/iu;
const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;

function hasControlChars(value: string): boolean {
  return Array.from(value).some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < FIRST_PRINTABLE || code === DELETE;
  });
}

export function normalizeVaultPath(raw: string): NormalizeResult {
  const path = raw.normalize("NFC").replaceAll("\\", "/");
  if (hasControlChars(path)) return { ok: false, reason: "control characters in path" };
  if (path.startsWith("/") || DRIVE_LETTER.test(path)) return { ok: false, reason: "absolute path" };
  for (const segment of path.split("/")) {
    if (segment === "") return { ok: false, reason: "empty path segment" };
    if (segment === "." || segment === "..") return { ok: false, reason: "dot segment in path" };
  }
  return { ok: true, path };
}

export const VaultPath = z
  .string()
  .min(1)
  .max(1024)
  .transform((raw, ctx) => {
    const result = normalizeVaultPath(raw);
    if (result.ok) return result.path;
    ctx.addIssue({ code: "custom", message: result.reason });
    return z.NEVER;
  })
  .brand<"VaultPath">();
export type VaultPath = z.infer<typeof VaultPath>;
