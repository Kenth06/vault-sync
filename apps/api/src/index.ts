import { Hono } from "hono";

import { AppError, errorResponse } from "./common/errors.ts";
import type { AppEnv } from "./common/types/context.ts";
import { containerMiddleware } from "./middlewares/container.middleware.ts";
import { router } from "./router.ts";

const app = new Hono<AppEnv>()
  .get("/health", (c) => c.json({ status: "ok" }))
  .use("*", containerMiddleware)
  .route("/", router);

app.notFound((c) => errorResponse(c, new AppError("ERR_NOT_FOUND", "no such route")));

app.onError((error, c) => {
  if (error instanceof AppError) return errorResponse(c, error);
  console.error(JSON.stringify({ level: "error", event: "unhandled", path: c.req.path, message: String(error) }));
  return errorResponse(c, new AppError("ERR_INTERNAL", "internal error"));
});

export type AppType = typeof app;

export { VaultDO } from "./durable-objects/vault.durable-object.ts";

export default app satisfies ExportedHandler<Env>;
