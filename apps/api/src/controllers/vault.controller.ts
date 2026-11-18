import { ChangesQuery, CommitRequest, HistoryQuery, PlanRequest, SnapshotParam, TreeQuery } from "@vault-sync/protocol";
import { Hono } from "hono";
import { z } from "zod";

import type { DeviceEnv } from "../common/types/context.ts";
import { validate } from "../common/validation.ts";
import { requireDevice, requireOwnVault } from "../middlewares/auth.middleware.ts";
import { rawFileParamSchema } from "../schemas/vault.schema.ts";

export const vaultController = new Hono<DeviceEnv>()
  .use("/:vaultId/*", requireDevice, requireOwnVault)

  .get("/:vaultId/ws", (c) => c.var.container.vaultService.connect(c.var.auth, c.req.raw))

  .get("/:vaultId/status", async (c) => {
    const data = await c.var.container.vaultService.status(c.var.auth);
    return c.json({ data });
  })

  .get("/:vaultId/devices", async (c) => {
    const data = await c.var.container.vaultService.devices(c.var.auth);
    return c.json({ data });
  })

  .post("/:vaultId/devices/self/revoke", async (c) => {
    await c.var.container.vaultService.revokeSelf(c.var.auth);
    return c.json({ data: { revoked: true } });
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

  .get("/:vaultId/tree", validate("query", TreeQuery), async (c) => {
    const data = await c.var.container.vaultService.tree(c.var.auth, c.req.valid("query").at);
    return c.json({ data });
  })

  .get("/:vaultId/history", validate("query", HistoryQuery), async (c) => {
    const data = await c.var.container.vaultService.history(c.var.auth, c.req.valid("query"));
    return c.json({ data });
  })

  .get("/:vaultId/snapshots", async (c) => {
    const data = await c.var.container.vaultService.snapshots(c.var.auth);
    return c.json({ data });
  })

  .post("/:vaultId/snapshots", async (c) => {
    const data = await c.var.container.vaultService.createSnapshot(c.var.auth);
    return c.json({ data }, data === null ? 200 : 201);
  })

  .get("/:vaultId/snapshots/:seq", validate("param", SnapshotParam.extend({ vaultId: z.string() })), async (c) => {
    const data = await c.var.container.vaultService.snapshotTree(c.var.auth, c.req.valid("param").seq);
    return c.json({ data });
  })

  .get("/:vaultId/raw/:path{.+}", validate("param", rawFileParamSchema), async (c) => {
    const file = await c.var.container.vaultService.readFile(
      c.var.auth,
      c.req.valid("param").path,
      c.req.header("Range") ?? null,
    );
    if (file.kind === "unsatisfiable") {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
    }
    const headers = new Headers({
      "Content-Type": "application/octet-stream",
      "Accept-Ranges": "bytes",
      ETag: `"${file.entry.hash}"`,
      "X-Vault-Mtime": String(file.entry.mtime),
    });
    if (file.range.kind !== "part") {
      headers.set("Content-Length", String(file.size));
      return new Response(file.body, { headers });
    }
    headers.set("Content-Length", String(file.range.end - file.range.start + 1));
    headers.set("Content-Range", `bytes ${file.range.start}-${file.range.end}/${file.size}`);
    return new Response(file.body, { status: 206, headers });
  });
