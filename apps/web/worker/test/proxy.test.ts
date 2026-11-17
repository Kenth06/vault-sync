import { describe, expect, it } from "vitest";

import app from "../index.ts";

const TOKEN = `vs1.notas.dev_0123456789abcdef.${"a".repeat(43)}`;
const ORIGIN = "https://viewer.test";

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
}

function fakeEnv(respond: (req: Request) => Response = () => Response.json({ data: [] })) {
  const seen: Seen[] = [];
  const api = {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      seen.push({ url: req.url, method: req.method, headers: req.headers });
      return Promise.resolve(respond(req));
    },
    connect: () => {
      throw new Error("not used");
    },
  };
  const assets = { fetch: () => Promise.resolve(new Response("asset")), connect: api.connect };
  return { env: { API: api, ASSETS: assets }, seen };
}

function request(path: string, init: RequestInit & { cookie?: boolean } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.cookie !== false) headers.set("Cookie", `__Host-vault-sync=${TOKEN}`);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

describe("proxy", () => {
  it("needs a session", async () => {
    const { env, seen } = fakeEnv();
    const res = await app.fetch(request("/api/vault/tree", { cookie: false }), env);
    expect(res.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("forwards reads with the bearer token and never the cookie", async () => {
    const { env, seen } = fakeEnv();
    const res = await app.fetch(request("/api/vault/tree"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(seen[0]?.url).toBe("https://api/v1/vaults/notas/tree");
    expect(seen[0]?.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(seen[0]?.headers.get("Cookie")).toBeNull();
  });

  it("refuses writes and normalized traversal before calling the API", async () => {
    const { env, seen } = fakeEnv();
    const commit = await app.fetch(request("/api/vault/commit", { method: "POST", headers: { Origin: ORIGIN } }), env);
    const traversal = await app.fetch(request("/api/vault/%2e%2e/%2e%2e/v1/devices"), env);
    expect(commit.status).toBe(404);
    expect(traversal.status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it("rejects a cross-origin socket", async () => {
    const { env, seen } = fakeEnv();
    const res = await app.fetch(
      request("/api/vault/ws", { headers: { Upgrade: "websocket", Origin: "https://evil.test" } }),
      env,
    );
    expect(res.status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it("drops the cookie when the API no longer accepts the token", async () => {
    const { env } = fakeEnv(() => Response.json({ error: "revoked", code: "ERR_FORBIDDEN" }, { status: 403 }));
    const res = await app.fetch(request("/api/vault/status"), env);
    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-vault-sync=;/u);
  });
});

describe("session", () => {
  it("signs out by revoking this browser's device", async () => {
    const { env, seen } = fakeEnv(() => Response.json({ data: { revoked: true } }));
    const res = await app.fetch(request("/api/session", { method: "DELETE", headers: { Origin: ORIGIN } }), env);
    expect(res.status).toBe(200);
    expect(seen[0]?.url).toBe("https://api/v1/vaults/notas/devices/self/revoke");
    expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-vault-sync=;/u);
  });
});
