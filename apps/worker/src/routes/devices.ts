import { Hono } from "hono";
import { EnrollRequest } from "@vault-sync/protocol";
import { adminAuth } from "../auth.js";
import { validate } from "../validate.js";

export const devices = new Hono<{ Bindings: Env }>().post(
  "/enroll",
  adminAuth,
  validate("json", EnrollRequest),
  async (c) => {
    const { vaultId, name } = c.req.valid("json");
    const result = await c.env.VAULT.getByName(vaultId).enroll(vaultId, name);
    return c.json(result, 201);
  },
);
