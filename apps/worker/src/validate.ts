import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z } from "zod";
import { AppError } from "./http.js";

/** zValidator that reports failures through the app's typed error body. */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new AppError("bad_request", `invalid ${target}`, z.treeifyError(result.error));
    }
  });
}
