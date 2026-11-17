import { ErrorBody, type ErrorCode } from "@vault-sync/protocol";

const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR = 500;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "network";
  readonly details: unknown;

  constructor(status: number, code: ErrorCode | "network", message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get retryable(): boolean {
    return this.code === "network" || this.status === TOO_MANY_REQUESTS || this.status >= SERVER_ERROR;
  }

  static async fromResponse(res: Response): Promise<ApiError> {
    const parsed = ErrorBody.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return new ApiError(res.status, "internal", `HTTP ${res.status}`);
    const { code, message, details } = parsed.data.error;
    return new ApiError(res.status, code, message, details);
  }
}
