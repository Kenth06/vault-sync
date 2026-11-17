export type FileKind = "markdown" | "image" | "text" | "other";

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);
const TEXT = new Set(["txt", "canvas", "json", "csv", "css", "js", "ts", "yaml", "yml"]);
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

export function extensionOf(vaultPath: string): string {
  const name = vaultPath.slice(vaultPath.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function fileKind(vaultPath: string, size: number): FileKind {
  const extension = extensionOf(vaultPath);
  if (IMAGE.has(extension)) return "image";
  if (size > MAX_TEXT_PREVIEW_BYTES) return "other";
  if (extension === "md") return "markdown";
  return TEXT.has(extension) ? "text" : "other";
}
