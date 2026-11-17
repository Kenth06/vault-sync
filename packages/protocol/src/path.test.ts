import { describe, expect, it } from "vitest";
import { normalizeVaultPath } from "./path.ts";
import { parseToken } from "./ids.ts";

describe("normalizeVaultPath", () => {
  it("normalizes NFD to NFC and backslashes to slashes", () => {
    const nfd = "Notas\\Cafe\u0301.md";
    expect(normalizeVaultPath(nfd)).toEqual({ ok: true, path: "Notas/Café.md" });
  });

  it.each(["../x.md", "a/../b.md", "/etc/passwd", "C:/x.md", "a//b.md", "a/\u0007.md", "./a.md"])(
    "rejects %j",
    (p) => {
      expect(normalizeVaultPath(p).ok).toBe(false);
    },
  );
});

describe("parseToken", () => {
  it("parses a well-formed token", () => {
    const secret = "A".repeat(43);
    expect(parseToken(`vs1.my-vault.dev_0123456789abcdef.${secret}`)).toEqual({
      vaultId: "my-vault",
      deviceId: "dev_0123456789abcdef",
    });
  });

  it("rejects garbage", () => {
    expect(parseToken("Bearer nope")).toBeNull();
    expect(parseToken("vs1.MY_VAULT.dev_0123456789abcdef." + "A".repeat(43))).toBeNull();
  });
});
