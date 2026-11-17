import type { Bytes } from "@vault-sync/sync-core";

export function toArrayBuffer(content: Bytes): Promise<ArrayBuffer> {
  return content instanceof ArrayBuffer ? Promise.resolve(content) : new Response(content).arrayBuffer();
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
