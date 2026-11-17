import { Hono } from "hono";
import { AppError, errorResponse } from "./http.js";
import { blobs } from "./routes/blobs.js";
import { devices } from "./routes/devices.js";
import { vaults } from "./routes/vaults.js";

export { VaultDO } from "./vault-do.js";

const app = new Hono<{ Bindings: Env }>()
  // Liveness check that never wakes a Durable Object.
  .get("/healthz", (c) => c.json({ ok: true }))
  .route("/v1/devices", devices)
  .route("/v1/vaults", vaults)
  .route("/v1/blobs", blobs);

app.notFound((c) => errorResponse(c, new AppError("not_found", "no such route")));

app.onError((err, c) => {
  if (err instanceof AppError) return errorResponse(c, err);
  console.error(JSON.stringify({ level: "error", msg: "unhandled", path: c.req.path, error: String(err) }));
  return errorResponse(c, new AppError("internal", "internal error"));
});

/** Imported as a type by the CLI for the `hc` client. */
export type AppType = typeof app;

export default app satisfies ExportedHandler<Env>;
