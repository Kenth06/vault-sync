export function gzipJson(value: unknown): Promise<ArrayBuffer> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export function gunzipJson(body: ReadableStream): Promise<unknown> {
  return new Response(body.pipeThrough(new DecompressionStream("gzip"))).json();
}
