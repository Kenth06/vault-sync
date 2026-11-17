import { createMiddleware } from "hono/factory";

import type { AppEnv } from "../common/types/context.ts";
import { createContainer } from "../di.ts";

export const containerMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set("container", createContainer(c.env));
  await next();
});
