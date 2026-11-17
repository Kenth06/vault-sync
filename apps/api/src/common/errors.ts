import type { ErrorBody, ErrorCode } from "@vault-sync/protocol";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  ERR_BAD_REQUEST: 400,
  ERR_UNAUTHORIZED: 401,
  ERR_FORBIDDEN: 403,
  ERR_NOT_FOUND: 404,
  ERR_CONFLICT: 409,
  ERR_PAYLOAD_TOO_LARGE: 413,
  ERR_RATE_LIMITED: 429,
  ERR_INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get status(): ContentfulStatusCode {
    return STATUS[this.code];
  }
}

export function errorResponse(c: Context, error: AppError): Response {
  const body: ErrorBody =
    error.details === undefined
      ? { error: error.message, code: error.code }
      : { error: error.message, code: error.code, details: error.details };
  return c.json(body, error.status);
}
