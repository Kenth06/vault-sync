import { ErrorBody } from "@vault-sync/protocol";
import { describe, expect, it } from "vitest";

import { call, enroll, json, readErrorCode } from "./helpers.ts";

describe("error contract", () => {
  it("answers unknown routes with ERR_NOT_FOUND", async () => {
    const res = await call("/nope");
    expect(res.status).toBe(404);
    expect(await readErrorCode(res)).toBe("ERR_NOT_FOUND");
  });

  it("returns field details for an invalid body", async () => {
    const { token } = await enroll("v-errors");
    const res = await json("/v1/vaults/v-errors/plan", { baseCursor: -1, changes: [] }, token);
    expect(res.status).toBe(400);
    const body = ErrorBody.parse(await res.json());
    expect(body.code).toBe("ERR_BAD_REQUEST");
    expect(body.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: "baseCursor" })]));
  });

  it("answers a missing file with ERR_NOT_FOUND", async () => {
    const { token } = await enroll("v-errors-raw");
    const res = await call("/v1/vaults/v-errors-raw/raw/missing.md", { token });
    expect(res.status).toBe(404);
    expect(await readErrorCode(res)).toBe("ERR_NOT_FOUND");
  });
});
