import { parseToken, tokenFromProtocols } from "@vault-sync/protocol";
import { createMiddleware } from "hono/factory";

import { AppError } from "../common/errors.ts";
import type { AppEnv, DeviceEnv } from "../common/types/context.ts";
import { timingSafeEqualSecret } from "../utils/crypto.ts";

function bearer(header: string | undefined): string | null {
  return /^Bearer\s+(\S+)$/u.exec(header ?? "")?.[1] ?? null;
}

export const requireDevice = createMiddleware<DeviceEnv>(async (c, next) => {
  const upgrade = c.req.header("Upgrade") === "websocket";
  const token = upgrade
    ? tokenFromProtocols(c.req.header("Sec-WebSocket-Protocol"))
    : bearer(c.req.header("Authorization"));
  const parsed = token === null ? null : parseToken(token);
  if (token === null || parsed === null) throw new AppError("ERR_UNAUTHORIZED", "missing or malformed token");
  c.set("auth", { token, vaultId: parsed.vaultId });
  await next();
});

export const requireOwnVault = createMiddleware<DeviceEnv>(async (c, next) => {
  if (c.req.param("vaultId") !== c.var.auth.vaultId) throw new AppError("ERR_FORBIDDEN", "token is for another vault");
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const presented = bearer(c.req.header("Authorization"));
  if (presented === null || !(await timingSafeEqualSecret(presented, c.env.ADMIN_SECRET))) {
    throw new AppError("ERR_UNAUTHORIZED", "admin secret required");
  }
  await next();
});
