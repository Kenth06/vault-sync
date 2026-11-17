import { DeviceParam, EnrollRequest, VaultScope } from "@vault-sync/protocol";
import { Hono } from "hono";

import type { AppEnv } from "../common/types/context.ts";
import { validate } from "../common/validation.ts";
import { requireAdmin } from "../middlewares/auth.middleware.ts";

export const deviceController = new Hono<AppEnv>()
  .use("*", requireAdmin)

  .post("/enroll", validate("json", EnrollRequest), async (c) => {
    const data = await c.var.container.deviceService.enroll(c.req.valid("json"));
    return c.json({ data }, 201);
  })

  .get("/", validate("query", VaultScope), async (c) => {
    const data = await c.var.container.deviceService.list(c.req.valid("query").vaultId);
    return c.json({ data });
  })

  .post("/:deviceId/revoke", validate("param", DeviceParam), validate("json", VaultScope), async (c) => {
    await c.var.container.deviceService.revoke(c.req.valid("json").vaultId, c.req.valid("param").deviceId);
    return c.json({ data: { revoked: true } });
  });
