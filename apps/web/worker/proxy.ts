import { WS_PROTOCOL } from "@vault-sync/protocol";
import type { Context } from "hono";

import { fileHeaders, jsonHeaders } from "./content-type.ts";
import { upstreamPath } from "./routes.ts";
import { errorJson, forgetSession, readSession, type Session, type WebEnv } from "./session.ts";

const FORWARDED = ["Accept", "Content-Type", "If-None-Match", "Sec-WebSocket-Key", "Sec-WebSocket-Version", "Upgrade"];

function isUpgrade(request: Request): boolean {
  return request.headers.get("Upgrade") === "websocket";
}

function upstreamHeaders(request: Request, session: Session): Headers {
  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (isUpgrade(request)) headers.set("Sec-WebSocket-Protocol", `${WS_PROTOCOL}, ${session.token}`);
  else headers.set("Authorization", `Bearer ${session.token}`);
  return headers;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fileName(path: string, url: URL): string | null {
  const raw = /^\/v1\/vaults\/[^/]+\/raw\/(.+)$/u.exec(path)?.[1];
  if (raw !== undefined) return safeDecode(raw);
  return path.endsWith("/content") ? (url.searchParams.get("name") ?? "file") : null;
}

function foreignUpgrade(request: Request, url: URL): boolean {
  return isUpgrade(request) && request.headers.get("Origin") !== url.origin;
}

export async function proxy(c: Context<WebEnv>): Promise<Response> {
  const session = readSession(c);
  if (session === null) return errorJson(c, 401, { error: "sign in to view this vault", code: "ERR_UNAUTHORIZED" });
  const url = new URL(c.req.url);
  const path = upstreamPath(c.req.method, url.pathname, session.vaultId);
  if (path === null) return errorJson(c, 404, { error: "no such route", code: "ERR_NOT_FOUND" });
  if (foreignUpgrade(c.req.raw, url)) return errorJson(c, 403, { error: "cross-origin socket", code: "ERR_FORBIDDEN" });

  const upstream = await c.env.API.fetch(`https://api${path}${url.search}`, {
    method: c.req.method,
    headers: upstreamHeaders(c.req.raw, session),
  });
  return upstream.status === 101 ? upstream : respond(c, upstream, fileName(path, url));
}

function respond(c: Context<WebEnv>, upstream: Response, name: string | null): Response {
  if (upstream.status === 401 || upstream.status === 403) forgetSession(c);
  const headers = name !== null && upstream.ok ? fileHeaders(upstream.headers, name) : jsonHeaders(upstream.headers);
  for (const [key, value] of c.res.headers) if (key === "set-cookie") headers.append(key, value);
  return new Response(upstream.body, { status: upstream.status, headers });
}
