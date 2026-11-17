import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorBody, ErrorCode } from "@vault-sync/protocol";
import type { RpcResult } from "./result.js";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  forbidden: 403,
  device_revoked: 403,
  vault_mismatch: 403,
  bad_request: 400,
  checksum_mismatch: 400,
  not_found: 404,
  missing_blobs: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal: 500,
};

/** Thrown anywhere in a handler; `onError` turns it into the JSON error body. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  get status(): ContentfulStatusCode {
    return STATUS[this.code];
  }
}

export function errorResponse(c: Context, err: AppError): Response {
  const body: ErrorBody = {
    error: err.details === undefined
      ? { code: err.code, message: err.message }
      : { code: err.code, message: err.message, details: err.details },
  };
  return c.json(body, err.status);
}

/** Unwraps a Durable Object result or throws the error it carries. */
export function unwrap<T>(result: RpcResult<T>): T {
  if (result.ok) return result.value;
  throw new AppError(result.code, result.message, result.details);
}
