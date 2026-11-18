import { describe, expect, it } from "vitest";

import { pdfFrameSource } from "../src/lib/markdown/frame.ts";

const ORIGIN = "https://viewer.test";

describe("pdfFrameSource", () => {
  it("keeps same-origin PDF file routes", () => {
    expect(pdfFrameSource("/api/vault/raw/papers/a.pdf", ORIGIN)).toBe("/api/vault/raw/papers/a.pdf");
    expect(pdfFrameSource(`/api/blobs/${"a".repeat(64)}/content?name=a.pdf`, ORIGIN)).toContain("/api/blobs/");
  });

  it("drops traversal, other origins and non-PDF files", () => {
    expect(pdfFrameSource("/api/vault/raw/../../v1/health.pdf", ORIGIN)).toBeNull();
    expect(pdfFrameSource("https://evil.test/api/vault/raw/a.pdf", ORIGIN)).toBeNull();
    expect(pdfFrameSource("/api/vault/raw/page.html", ORIGIN)).toBeNull();
  });
});
