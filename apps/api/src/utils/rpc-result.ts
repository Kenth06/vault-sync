import type { ErrorCode } from "@vault-sync/protocol";

export type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string; readonly details?: unknown };

export function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(code: ErrorCode, message: string, details?: unknown): RpcResult<T> {
  return details === undefined ? { ok: false, code, message } : { ok: false, code, message, details };
}
