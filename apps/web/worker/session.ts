import { EnrollResponse, parseData, parseToken, VaultId, type ErrorCode, type ParsedToken } from "@vault-sync/protocol";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";

const COOKIE = "__Host-vault-sync";
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 400;
const DEVICE_NAME = "Web viewer";

type ApiCaller = (request: Request) => Promise<Response>;

export type WebEnv = { Bindings: Env; Variables: { callApi: ApiCaller } };

export const SignInRequest = z.object({
  vaultId: VaultId,
  adminSecret: z.string().min(1),
});
export type SignInRequest = z.infer<typeof SignInRequest>;

export interface Session extends ParsedToken {
  readonly token: string;
}

export function readSession(c: Context<WebEnv>): Session | null {
  const token = getCookie(c, COOKIE);
  const parsed = token === undefined ? null : parseToken(token);
  return token === undefined || parsed === null ? null : { ...parsed, token };
}

export function errorJson(c: Context<WebEnv>, status: 401 | 403 | 404 | 502, body: { error: string; code: ErrorCode }) {
  return c.json(body, status);
}

export async function enroll(c: Context<WebEnv>, input: SignInRequest): Promise<Response> {
  const upstream = await c.var.callApi(
    new Request("https://vault-sync.internal/v1/devices/enroll", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.adminSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ vaultId: input.vaultId, name: DEVICE_NAME }),
    }),
  );
  if (upstream.status !== 201) return new Response(upstream.body, upstream);
  const { token } = parseData(EnrollResponse, await upstream.json());
  setCookie(c, COOKIE, token, {
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Strict",
    maxAge: COOKIE_MAX_AGE_S,
  });
  return c.json({ data: { vaultId: input.vaultId } }, 201);
}

export function forgetSession(c: Context<WebEnv>): void {
  deleteCookie(c, COOKIE, { path: "/", secure: true });
}

export async function signOut(c: Context<WebEnv>): Promise<Response> {
  const session = readSession(c);
  if (session !== null) {
    const revoke = `https://vault-sync.internal/v1/vaults/${session.vaultId}/devices/self/revoke`;
    await c.var.callApi(
      new Request(revoke, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.token}` },
      }),
    );
  }
  forgetSession(c);
  return c.json({ data: null });
}
