import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { csrf } from "hono/csrf";

import { proxy } from "./proxy.ts";
import { enroll, errorJson, readSession, signOut, SignInRequest, type WebEnv } from "./session.ts";

const app = new Hono<WebEnv>()
  .use("/api/*", csrf())
  .get("/api/session", (c) => {
    const session = readSession(c);
    return c.json({ data: session === null ? null : { vaultId: session.vaultId } });
  })
  .post(
    "/api/session",
    zValidator("json", SignInRequest, (result, c) =>
      result.success
        ? undefined
        : c.json({ error: "enter a vault id and the admin secret", code: "ERR_BAD_REQUEST" }, 400),
    ),
    (c) => enroll(c, c.req.valid("json")),
  )
  .delete("/api/session", signOut)
  .all("/api/*", proxy);

app.notFound((c) => errorJson(c, 404, { error: "no such route", code: "ERR_NOT_FOUND" }));

app.onError((error, c) => {
  console.error(JSON.stringify({ level: "error", event: "web.unhandled", path: c.req.path, message: String(error) }));
  return errorJson(c, 502, { error: "the vault API did not answer", code: "ERR_INTERNAL" });
});

export default app satisfies ExportedHandler<Env>;
