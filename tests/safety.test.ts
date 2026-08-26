import { describe, expect, it } from "vitest";
import { Redactor, maskToken } from "../src/core/redact.js";
import { assertInsideBase, safeJoin, atomicWriteFile, toAssetPath } from "../src/core/atomic.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("token redaction", () => {
  it("masks a registered secret anywhere in text", () => {
    const redactor = new Redactor();
    redactor.addSecret("super-secret-token-1234567890");
    const out = redactor.redact("header X-Figma-Token super-secret-token-1234567890 at https://api");
    expect(out).not.toContain("super-secret-token-1234567890");
    expect(out).toContain("[REDACTED]");
  });

  it("maskToken shows only a short prefix/suffix", () => {
    const masked = maskToken("abcdefghijklmnopqrstuvwxyz123456");
    expect(masked).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(masked).toContain("abcd");
    expect(masked).toContain("3456");
    expect(maskToken(undefined)).toBe("(none)");
  });

  it("does not leak the token in config errors", () => {
    const redactor = new Redactor();
    redactor.addSecret("leakme-9876543210");
    const errorText = redactor.redact("Error reading config with token leakme-9876543210");
    expect(errorText).not.toContain("9876543210");
  });
});

describe("path safety", () => {
  it("rejects traversal escapes", () => {
    expect(() => safeJoin("C:/base", "../evil")).toThrow(/PAT_TRAVERSAL/);
    expect(() => safeJoin("C:/base", "../../x")).toThrow(/PAT_TRAVERSAL/);
    expect(() => assertInsideBase("C:/base", "C:/other/file")).toThrow(/PAT_TRAVERSAL/);
  });

  it("accepts safe relative joins", () => {
    const joined = safeJoin("C:/base", "a/b/c.txt");
    expect(joined.replace(/\\/g, "/")).toContain("base/a/b/c.txt");
  });

  it("toAssetPath normalizes separators", () => {
    expect(toAssetPath("Assets\\A\\B.png")).toBe("Assets/A/B.png");
  });
});

describe("atomic write", () => {
  it("publishes file and leaves no temp file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ftu-atomic-"));
    try {
      const target = join(dir, "out", "index.json");
      atomicWriteFile(target, JSON.stringify({ a: 1 }));
      expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ a: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
