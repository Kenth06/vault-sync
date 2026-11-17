import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { z } from "zod";

import { AppError } from "./errors.ts";

export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result) => {
    if (result.success) return;
    const details = result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    throw new AppError("ERR_BAD_REQUEST", `invalid ${target}`, details);
  });
}
