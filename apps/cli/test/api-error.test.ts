import { describe, expect, it, vi } from "vitest";

import { withRetry } from "../src/clients/api.client.ts";
import { ApiError } from "../src/common/errors.ts";

const error = (status: number, code: ApiError["code"]) => new ApiError({ status, code, message: "x" });

describe("ApiError.retryable", () => {
  it.each([
    [0, "ERR_NETWORK", true],
    [429, "ERR_RATE_LIMITED", true],
    [500, "ERR_INTERNAL", true],
    [400, "ERR_BAD_REQUEST", false],
    [401, "ERR_UNAUTHORIZED", false],
    [409, "ERR_CONFLICT", false],
  ] as const)("status %i (%s) → %s", (status, code, expected) => {
    expect(error(status, code).retryable).toBe(expected);
  });

  it("parses the error envelope", async () => {
    const res = Response.json({ error: "nope", code: "ERR_FORBIDDEN" }, { status: 403 });
    const parsed = await ApiError.fromResponse(res);
    expect(parsed).toMatchObject({ status: 403, code: "ERR_FORBIDDEN", message: "nope" });
  });

  it("keeps the status for bodies that are not the envelope", async () => {
    const parsed = await ApiError.fromResponse(new Response("bad gateway", { status: 502 }));
    expect(parsed).toMatchObject({ status: 502, code: "ERR_UNKNOWN", retryable: true });
  });
});

describe("withRetry", () => {
  it("retries retryable failures, then succeeds", async () => {
    vi.useFakeTimers();
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(error(503, "ERR_INTERNAL"))
      .mockResolvedValue("ok");
    const result = withRetry(run);
    await vi.runAllTimersAsync();
    expect(await result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("waits at least Retry-After before retrying a 429", async () => {
    vi.useFakeTimers();
    const limited = new ApiError({ status: 429, code: "ERR_RATE_LIMITED", message: "slow down", retryAfterMs: 30_000 });
    const run = vi.fn<() => Promise<string>>().mockRejectedValueOnce(limited).mockResolvedValue("ok");
    const result = withRetry(run);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toBe("ok");
    vi.useRealTimers();
  });

  it("reads Retry-After from the response", async () => {
    const res = Response.json(
      { error: "slow down", code: "ERR_RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": "12" } },
    );
    expect((await ApiError.fromResponse(res)).retryAfterMs).toBe(12_000);
  });

  it("does not retry client errors", async () => {
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(error(409, "ERR_CONFLICT"));
    await expect(withRetry(run)).rejects.toMatchObject({ code: "ERR_CONFLICT" });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
