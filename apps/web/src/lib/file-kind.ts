export type FileKind = "markdown" | "image" | "audio" | "video" | "pdf" | "canvas" | "code" | "other";

const KINDS: ReadonlyArray<readonly [FileKind, ReadonlySet<string>]> = [
  ["image", new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp"])],
  ["audio", new Set(["mp3", "wav", "m4a", "ogg", "flac", "3gp"])],
  ["video", new Set(["mp4", "webm", "ogv", "mov", "mkv"])],
  ["pdf", new Set(["pdf"])],
];

const CODE = new Set([
  "txt",
  "json",
  "csv",
  "css",
  "js",
  "mjs",
  "ts",
  "tsx",
  "jsx",
  "yaml",
  "yml",
  "toml",
  "py",
  "sh",
  "sql",
  "html",
  "xml",
  "go",
  "rs",
]);
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

export function extensionOf(vaultPath: string): string {
  const name = vaultPath.slice(vaultPath.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function mediaKind(vaultPath: string): FileKind | null {
  const extension = extensionOf(vaultPath);
  return KINDS.find(([, extensions]) => extensions.has(extension))?.[0] ?? null;
}

export function contentWidth(vaultPath: string): string {
  return extensionOf(vaultPath) === "canvas" ? "max-w-none" : "max-w-[68ch]";
}

export function fileKind(vaultPath: string, size: number): FileKind {
  const media = mediaKind(vaultPath);
  if (media !== null) return media;
  if (size > MAX_TEXT_PREVIEW_BYTES) return "other";
  const extension = extensionOf(vaultPath);
  if (extension === "md") return "markdown";
  if (extension === "canvas") return "canvas";
  return CODE.has(extension) ? "code" : "other";
}
