const INLINE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  pdf: "application/pdf",
};

const TEXT_EXTENSIONS = new Set(["md", "txt", "canvas", "json", "csv", "css", "js", "ts", "yaml", "yml"]);
const FORWARDED = ["Content-Length", "Content-Range", "Accept-Ranges", "ETag", "X-Vault-Mtime"];

const SANDBOXED = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const PDF_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; frame-ancestors 'self'";

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function contentType(extension: string): string {
  if (TEXT_EXTENSIONS.has(extension)) return "text/plain; charset=utf-8";
  return INLINE_TYPES[extension] ?? "application/octet-stream";
}

export function jsonHeaders(upstream: Headers): Headers {
  const headers = new Headers({ "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
  for (const key of ["Content-Type", "Retry-After"]) {
    const value = upstream.get(key);
    if (value !== null) headers.set(key, value);
  }
  return headers;
}

function disposition(extension: string, destination: string | null): "inline" | "attachment" {
  if (!(extension in INLINE_TYPES)) return "attachment";
  return extension === "pdf" && destination === "document" ? "attachment" : "inline";
}

export function fileHeaders(upstream: Headers, name: string, destination: string | null = null): Headers {
  const extension = extensionOf(name);
  const headers = new Headers({
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": extension === "pdf" ? PDF_POLICY : SANDBOXED,
    "Cache-Control": "private, no-cache",
  });
  for (const key of FORWARDED) {
    const value = upstream.get(key);
    if (value !== null) headers.set(key, value);
  }
  const fileName = encodeURIComponent(name.slice(name.lastIndexOf("/") + 1)).replaceAll("'", "%27");
  headers.set("Content-Type", contentType(extension));
  headers.set("Content-Disposition", `${disposition(extension, destination)}; filename*=UTF-8''${fileName}`);
  return headers;
}
