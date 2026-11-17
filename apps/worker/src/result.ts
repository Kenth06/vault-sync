import type { ErrorCode } from "@vault-sync/protocol";

/** Results crossing the RPC boundary. Hono maps `code` to an HTTP status in one place. */
export type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string; readonly details?: unknown };

export const ok = <T>(value: T): RpcResult<T> => ({ ok: true, value });

export const fail = <T = never>(code: ErrorCode, message: string, details?: unknown): RpcResult<T> =>
  details === undefined ? { ok: false, code, message } : { ok: false, code, message, details };
