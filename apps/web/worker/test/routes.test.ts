import { VaultId } from "@vault-sync/protocol";
import { describe, expect, it } from "vitest";

import { fileHeaders } from "../content-type.ts";
import { upstreamPath } from "../routes.ts";

const vault = VaultId.parse("notas");

describe("upstreamPath", () => {
  it("maps read routes onto the session's vault", () => {
    expect(upstreamPath("GET", "/api/vault/tree", vault)).toBe("/v1/vaults/notas/tree");
    expect(upstreamPath("GET", "/api/vault/raw/Ideas/Plan.md", vault)).toBe("/v1/vaults/notas/raw/Ideas/Plan.md");
    expect(upstreamPath("GET", "/api/vault/snapshots/12", vault)).toBe("/v1/vaults/notas/snapshots/12");
    expect(upstreamPath("POST", "/api/vault/snapshots", vault)).toBe("/v1/vaults/notas/snapshots");
    expect(upstreamPath("GET", `/api/blobs/${"a".repeat(64)}/content`, vault)).toBe(
      `/v1/blobs/${"a".repeat(64)}/content`,
    );
  });

  it("refuses every write and anything outside the allowlist", () => {
    expect(upstreamPath("POST", "/api/vault/commit", vault)).toBeNull();
    expect(upstreamPath("POST", "/api/vault/plan", vault)).toBeNull();
    expect(upstreamPath("PUT", `/api/blobs/${"a".repeat(64)}`, vault)).toBeNull();
    expect(upstreamPath("GET", "/api/devices", vault)).toBeNull();
    expect(upstreamPath("GET", "/api/vault/../devices", vault)).toBeNull();
  });
});

describe("fileHeaders", () => {
  it("serves images inline and everything else as a sandboxed download", () => {
    const upstream = new Headers({ "Content-Length": "5", ETag: '"abc"', "Set-Cookie": "x=1" });
    const image = fileHeaders(upstream, "attachments/photo.PNG");
    expect(image.get("Content-Type")).toBe("image/png");
    expect(image.get("Content-Disposition")).toMatch(/^inline;/u);
    expect(image.get("Set-Cookie")).toBeNull();

    const page = fileHeaders(upstream, "evil.html");
    expect(page.get("Content-Type")).toBe("application/octet-stream");
    expect(page.get("Content-Disposition")).toMatch(/^attachment;/u);
    expect(page.get("Content-Security-Policy")).toContain("sandbox");
    expect(page.get("X-Content-Type-Options")).toBe("nosniff");
    expect(page.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  });

  it("renders PDFs inline only inside a frame, never as a top-level page", () => {
    const upstream = new Headers();
    expect(fileHeaders(upstream, "paper.pdf", "iframe").get("Content-Disposition")).toMatch(/^inline;/u);
    expect(fileHeaders(upstream, "paper.pdf", "document").get("Content-Disposition")).toMatch(/^attachment;/u);
    expect(fileHeaders(upstream, "paper.pdf").get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
  });
});
