import { ErrorBody, type ErrorCode } from "@vault-sync/protocol";

const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR = 500;

type ClientErrorCode = ErrorCode | "ERR_NETWORK" | "ERR_UNKNOWN";

interface ApiErrorInit {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly message: string;
  readonly details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly details: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
  }

  get retryable(): boolean {
    return this.code === "ERR_NETWORK" || this.status === TOO_MANY_REQUESTS || this.status >= SERVER_ERROR;
  }

  static async fromResponse(res: Response): Promise<ApiError> {
    const parsed = ErrorBody.safeParse(await res.json().catch(() => null));
    if (!parsed.success)
      return new ApiError({ status: res.status, code: "ERR_UNKNOWN", message: `HTTP ${res.status}` });
    const { code, error, details } = parsed.data;
    return new ApiError({ status: res.status, code, message: error, details });
  }
}
