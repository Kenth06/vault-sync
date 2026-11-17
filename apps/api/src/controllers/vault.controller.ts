import { ChangesQuery, CommitRequest, PlanRequest } from "@vault-sync/protocol";
import { Hono } from "hono";

import type { DeviceEnv } from "../common/types/context.ts";
import { validate } from "../common/validation.ts";
import { requireDevice, requireOwnVault } from "../middlewares/auth.middleware.ts";
import { rawFileParamSchema } from "../schemas/vault.schema.ts";

export const vaultController = new Hono<DeviceEnv>()
  .use("/:vaultId/*", requireDevice, requireOwnVault)

  .get("/:vaultId/status", async (c) => {
    const data = await c.var.container.vaultService.status(c.var.auth);
    return c.json({ data });
  })

  .post("/:vaultId/plan", validate("json", PlanRequest), async (c) => {
    const data = await c.var.container.vaultService.plan(c.var.auth, c.req.valid("json"));
    return c.json({ data });
  })

  .post("/:vaultId/commit", validate("json", CommitRequest), async (c) => {
    const data = await c.var.container.vaultService.commit(c.var.auth, c.req.valid("json"));
    return c.json({ data });
  })

  .get("/:vaultId/changes", validate("query", ChangesQuery), async (c) => {
    const data = await c.var.container.vaultService.changes(c.var.auth, c.req.valid("query"));
    return c.json({ data });
  })

  .get("/:vaultId/tree", async (c) => {
    const data = await c.var.container.vaultService.tree(c.var.auth);
    return c.json({ data });
  })

  .get("/:vaultId/raw/:path{.+}", validate("param", rawFileParamSchema), async (c) => {
    const file = await c.var.container.vaultService.readFile(c.var.auth, c.req.valid("param").path);
    return new Response(file.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(file.size),
        ETag: `"${file.entry.hash}"`,
        "X-Vault-Mtime": String(file.entry.mtime),
      },
    });
  });
