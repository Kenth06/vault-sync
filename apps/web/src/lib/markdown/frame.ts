const FILE_ROUTE = /^\/api\/(?:vault\/raw|blobs)\//u;

function isPdf(url: URL): boolean {
  const name = decodeURIComponent(url.pathname).toLowerCase();
  return name.endsWith(".pdf") || (url.searchParams.get("name") ?? "").toLowerCase().endsWith(".pdf");
}

export function pdfFrameSource(src: string, origin: string): string | null {
  const url = new URL(src, origin);
  if (url.origin !== origin || !FILE_ROUTE.test(url.pathname) || !isPdf(url)) return null;
  return `${url.pathname}${url.search}`;
}
