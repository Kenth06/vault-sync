const INLINE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

const TEXT_EXTENSIONS = new Set(["md", "txt", "canvas", "json", "csv", "css", "js", "ts", "yaml", "yml"]);

const FILE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "Cache-Control": "private, no-cache",
};

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

export function fileHeaders(upstream: Headers, name: string): Headers {
  const headers = new Headers(FILE_HEADERS);
  for (const key of ["Content-Length", "ETag", "X-Vault-Mtime"]) {
    const value = upstream.get(key);
    if (value !== null) headers.set(key, value);
  }
  const extension = extensionOf(name);
  const disposition = extension in INLINE_TYPES ? "inline" : "attachment";
  const fileName = encodeURIComponent(name.slice(name.lastIndexOf("/") + 1)).replaceAll("'", "%27");
  headers.set("Content-Type", contentType(extension));
  headers.set("Content-Disposition", `${disposition}; filename*=UTF-8''${fileName}`);
  return headers;
}
