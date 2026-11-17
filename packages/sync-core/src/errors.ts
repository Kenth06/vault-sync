import { CommitConflicts, ErrorBody, type ErrorCode } from "@vault-sync/protocol";

import { HTTP_BASE_DELAY_MS, HTTP_MAX_ATTEMPTS } from "./constants.ts";

const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR = 500;
const MS_PER_SECOND = 1000;

type ClientErrorCode = ErrorCode | "ERR_NETWORK" | "ERR_UNKNOWN";

interface ApiErrorInit {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly message: string;
  readonly details?: unknown;
  readonly retryAfterMs?: number;
}

function retryAfter(res: Response): number {
  const seconds = Number(res.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * MS_PER_SECOND : 0;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly details: unknown;
  readonly retryAfterMs: number;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.retryAfterMs = init.retryAfterMs ?? 0;
  }

  get retryable(): boolean {
    return this.code === "ERR_NETWORK" || this.status === TOO_MANY_REQUESTS || this.status >= SERVER_ERROR;
  }

  static async fromResponse(res: Response): Promise<ApiError> {
    const parsed = ErrorBody.safeParse(await res.json().catch(() => null));
    const base = { status: res.status, retryAfterMs: retryAfter(res) };
    if (!parsed.success) return new ApiError({ ...base, code: "ERR_UNKNOWN", message: `HTTP ${res.status}` });
    const { code, error, details } = parsed.data;
    return new ApiError({ ...base, code, message: error, details });
  }
}

const NOT_FOUND = 404;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof ApiError) || !error.retryable || attempt >= HTTP_MAX_ATTEMPTS) throw error;
      const backoff = HTTP_BASE_DELAY_MS * 2 ** (attempt - 1) * (0.5 + Math.random());
      await delay(Math.max(backoff, error.retryAfterMs));
    }
  }
}

export function isStaleBase(error: unknown): boolean {
  return error instanceof ApiError && error.code === "ERR_CONFLICT" && CommitConflicts.safeParse(error.details).success;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === NOT_FOUND;
}
