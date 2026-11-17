import { EnrollResponse, parseData, ErrorBody, PutChange, type ErrorCode } from "@vault-sync/protocol";
import { exports } from "cloudflare:workers";
import type { z } from "zod";

export const ADMIN = "test-admin-secret";
const BASE = "https://vault-sync.test";

export function call(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.token !== undefined) headers.set("Authorization", `Bearer ${init.token}`);
  return exports.default.fetch(new Request(`${BASE}${path}`, { ...init, headers }));
}

export function json(path: string, body: unknown, token?: string): Promise<Response> {
  return call(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    ...(token === undefined ? {} : { token }),
  });
}

export async function readData<Schema extends z.ZodType>(res: Response, schema: Schema): Promise<z.infer<Schema>> {
  return parseData(schema, await res.json());
}

export async function readErrorCode(res: Response): Promise<ErrorCode> {
  return ErrorBody.parse(await res.json()).code;
}

export async function enroll(vaultId: string, name = "test-pc"): Promise<EnrollResponse> {
  const res = await json("/v1/devices/enroll", { vaultId, name }, ADMIN);
  if (res.status !== 201) throw new Error(`enroll failed: ${res.status} ${await res.text()}`);
  return readData(res, EnrollResponse);
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function putBlob(hash: string, content: string, token: string): Promise<Response> {
  const bytes = new TextEncoder().encode(content);
  return call(`/v1/blobs/${hash}`, {
    method: "PUT",
    body: bytes,
    headers: { "Content-Length": String(bytes.byteLength) },
    token,
  });
}

export async function putChange(path: string, content: string, mtime = 1_700_000_000_000): Promise<PutChange> {
  const size = new TextEncoder().encode(content).byteLength;
  return PutChange.parse({ op: "put", path, hash: await sha256(content), size, mtime });
}
