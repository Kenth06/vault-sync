import { EnrollRequest } from "@vault-sync/protocol";
import { Hono } from "hono";

import type { AppEnv } from "../common/types/context.ts";
import { validate } from "../common/validation.ts";
import { requireAdmin } from "../middlewares/auth.middleware.ts";

export const deviceController = new Hono<AppEnv>().post(
  "/enroll",
  requireAdmin,
  validate("json", EnrollRequest),
  async (c) => {
    const data = await c.var.container.deviceService.enroll(c.req.valid("json"));
    return c.json({ data }, 201);
  },
);
