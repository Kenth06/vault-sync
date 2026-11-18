import { describe, expect, it } from "vitest";

import { createApp } from "../app.ts";

const TOKEN = `vs1.notas.dev_0123456789abcdef.${"a".repeat(43)}`;
const ORIGIN = "https://viewer.test";

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
}

function harness(respond: (req: Request) => Response = () => Response.json({ data: [] })) {
  const seen: Seen[] = [];
  const app = createApp((req) => {
    seen.push({ url: req.url, method: req.method, headers: req.headers });
    return respond(req);
  });
  return { app, seen };
}

function request(path: string, init: RequestInit & { cookie?: boolean } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.cookie !== false) headers.set("Cookie", `__Host-vault-sync=${TOKEN}`);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

describe("proxy", () => {
  it("needs a session", async () => {
    const { app, seen } = harness();
    const res = await app.fetch(request("/api/vault/tree", { cookie: false }));
    expect(res.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("forwards reads with the bearer token and never the cookie", async () => {
    const { app, seen } = harness();
    const res = await app.fetch(request("/api/vault/tree"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(seen[0]?.url).toBe("https://vault-sync.internal/v1/vaults/notas/tree");
    expect(seen[0]?.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(seen[0]?.headers.get("Cookie")).toBeNull();
  });

  it("refuses writes before calling the API", async () => {
    const { app, seen } = harness();
    const commit = await app.fetch(request("/api/vault/commit", { method: "POST", headers: { Origin: ORIGIN } }));
    expect(commit.status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it("never attaches the session token to a path that escapes /api/vault", async () => {
    const { app, seen } = harness();
    await app.fetch(request("/api/vault/%2e%2e/%2e%2e/v1/devices"));
    expect(seen[0]?.url).toBe(`${ORIGIN}/v1/devices`);
    expect(seen[0]?.headers.get("Authorization")).toBeNull();
  });

  it("rejects a cross-origin socket", async () => {
    const { app, seen } = harness();
    const res = await app.fetch(
      request("/api/vault/ws", { headers: { Upgrade: "websocket", Origin: "https://evil.test" } }),
    );
    expect(res.status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it("drops the cookie when the API no longer accepts the token", async () => {
    const { app } = harness(() => Response.json({ error: "revoked", code: "ERR_FORBIDDEN" }, { status: 403 }));
    const res = await app.fetch(request("/api/vault/status"));
    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-vault-sync=;/u);
  });
});

describe("api", () => {
  it("serves the device API at /v1 from the same Worker", async () => {
    const { app, seen } = harness(() => Response.json({ status: "ok" }));
    const res = await app.fetch(new Request(`${ORIGIN}/v1/vaults/notas/status`));
    expect(res.status).toBe(200);
    expect(seen[0]?.url).toBe(`${ORIGIN}/v1/vaults/notas/status`);
  });
});

describe("session", () => {
  it("signs out by revoking this browser's device", async () => {
    const { app, seen } = harness(() => Response.json({ data: { revoked: true } }));
    const res = await app.fetch(request("/api/session", { method: "DELETE", headers: { Origin: ORIGIN } }));
    expect(res.status).toBe(200);
    expect(seen[0]?.url).toBe("https://vault-sync.internal/v1/vaults/notas/devices/self/revoke");
    expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-vault-sync=;/u);
  });
});
