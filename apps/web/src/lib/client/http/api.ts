import { ErrorBody, parseData, type ErrorCode } from "@vault-sync/protocol";
import type { z } from "zod";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function failure(res: Response): Promise<ApiError> {
  const body = ErrorBody.safeParse(await res.json().catch(() => null));
  if (body.success) return new ApiError(res.status, body.data.code, body.data.error);
  return new ApiError(res.status, "ERR_INTERNAL", `The server answered ${res.status}. Try again in a minute.`);
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`/api${path}`, { credentials: "same-origin", ...init });
  if (!res.ok) throw await failure(res);
  return res;
}

export async function getJson<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  signal?: AbortSignal,
): Promise<z.infer<Schema>> {
  const res = await request(path, signal === undefined ? {} : { signal });
  return parseData(schema, await res.json());
}

export async function sendJson<Schema extends z.ZodType>(
  path: string,
  init: { method: "POST" | "DELETE"; body?: unknown },
  schema: Schema,
): Promise<z.infer<Schema>> {
  const res = await request(path, {
    method: init.method,
    headers: { "Content-Type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return parseData(schema, await res.json());
}

export async function getText(path: string, signal?: AbortSignal): Promise<string> {
  const res = await request(path, signal === undefined ? {} : { signal });
  return res.text();
}

export function fileUrl(path: string): string {
  return `/api${path}`;
}
