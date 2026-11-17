import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { blobKey, ChangesQuery, CommitRequest, PlanRequest, VaultPath } from "@vault-sync/protocol";
import { z } from "zod";
import { deviceAuth, type AppEnv } from "../auth.js";
import { AppError, unwrap } from "../http.js";
import { validate } from "../validate.js";

/** A token may only touch the vault it was issued for. */
const sameVault = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.param("id") !== c.var.auth.vaultId) throw new AppError("vault_mismatch", "token is for another vault");
  await next();
});

export const vaults = new Hono<AppEnv>()
  .use("/:id/*", deviceAuth, sameVault)

  .get("/:id/status", async (c) => {
    const { vault, token } = c.var.auth;
    return c.json(unwrap(await vault.status(token)));
  })

  .post("/:id/plan", validate("json", PlanRequest), async (c) => {
    const { vault, token } = c.var.auth;
    return c.json(unwrap(await vault.plan(token, c.req.valid("json"))));
  })

  .post("/:id/commit", validate("json", CommitRequest), async (c) => {
    const { vault, token } = c.var.auth;
    return c.json(unwrap(await vault.commit(token, c.req.valid("json"))));
  })

  .get("/:id/changes", validate("query", ChangesQuery), async (c) => {
    const { vault, token } = c.var.auth;
    const { since, limit } = c.req.valid("query");
    return c.json(unwrap(await vault.listChanges(token, since, limit)));
  })

  .get("/:id/tree", async (c) => {
    const { vault, token } = c.var.auth;
    return c.json(unwrap(await vault.tree(token)));
  })

  .get("/:id/raw/:path{.+}", validate("param", z.object({ id: z.string(), path: VaultPath })), async (c) => {
    const { vault, token } = c.var.auth;
    const entry = unwrap(await vault.getFile(token, c.req.valid("param").path));
    const object = await c.env.BUCKET.get(blobKey(entry.hash));
    if (!object) throw new AppError("internal", "manifest points at a blob missing from R2");
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(object.size),
        ETag: `"${entry.hash}"`,
        "X-Vault-Mtime": String(entry.mtime),
      },
    });
  });
