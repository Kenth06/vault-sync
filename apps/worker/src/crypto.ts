const encoder = new TextEncoder();

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCodePoint(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  return ab.byteLength === bb.byteLength && crypto.subtle.timingSafeEqual(ab, bb);
}

/** Hashes both sides first so the comparison never short-circuits on length. */
export async function timingSafeEqualSecret(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  return timingSafeEqualHex(ha, hb);
}
