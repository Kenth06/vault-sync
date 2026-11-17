import { z } from "zod";

export const ErrorCode = z.enum([
  "ERR_BAD_REQUEST",
  "ERR_UNAUTHORIZED",
  "ERR_FORBIDDEN",
  "ERR_NOT_FOUND",
  "ERR_CONFLICT",
  "ERR_PAYLOAD_TOO_LARGE",
  "ERR_RATE_LIMITED",
  "ERR_INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorBody = z.object({
  error: z.string(),
  code: ErrorCode,
  details: z.unknown().optional(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export const DataEnvelope = z.object({ data: z.unknown() });

export function parseData<Schema extends z.ZodType>(schema: Schema, body: unknown): z.infer<Schema> {
  return schema.parse(DataEnvelope.parse(body).data);
}
