import { createMiddleware } from "hono/factory";
import { parseToken, type VaultId } from "@vault-sync/protocol";
import { timingSafeEqualSecret } from "./crypto.js";
import { AppError } from "./http.js";
import type { VaultDO } from "./vault-do.js";

export interface DeviceAuth {
  readonly token: string;
  readonly vaultId: VaultId;
  readonly vault: DurableObjectStub<VaultDO>;
}

export type AppEnv = { Bindings: Env; Variables: { auth: DeviceAuth } };

function bearer(header: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/u.exec(header ?? "");
  return m?.[1] ?? null;
}

/**
 * Routes the request to its vault's Durable Object. The token itself is
 * verified inside the DO, in the same RPC as the operation (one billable DO
 * request per API call).
 */
export const deviceAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearer(c.req.header("Authorization"));
  const parsed = token === null ? null : parseToken(token);
  if (token === null || parsed === null) throw new AppError("unauthorized", "missing or malformed token");
  c.set("auth", { token, vaultId: parsed.vaultId, vault: c.env.VAULT.getByName(parsed.vaultId) });
  await next();
});

export const adminAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const presented = bearer(c.req.header("Authorization"));
  if (presented === null || !(await timingSafeEqualSecret(presented, c.env.ADMIN_SECRET))) {
    throw new AppError("unauthorized", "admin secret required");
  }
  await next();
});
