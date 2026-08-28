import { describe, expect, it } from "vitest";
import { Redactor, maskToken } from "../src/core/redact.js";
import { assertInsideBase, safeJoin, atomicWriteFile, toAssetPath } from "../src/core/atomic.js";
import { collectUserConfigSecrets } from "../src/core/config.js";
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

  it("keeps SCREAMING_SNAKE_CASE error codes readable while masking token-like strings", () => {
    const redactor = new Redactor();
    const code = "EXP_IDENTIFIER_TRANSLATION_MISSING";
    const out = redactor.redact(`${code}: Figma layer is missing an English translation.`);
    expect(out).toContain(code);

    const masked = redactor.redact("figd_aaaabbbbccccdddd0000111122223333");
    expect(masked).not.toContain("aaaabbbbccccdddd");
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

describe("collectUserConfigSecrets", () => {
  it("returns every project section token and [] on a malformed file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ftu-secrets-"));
    const configPath = join(dir, "config.json");
    const previous = process.env.FIGMA_TO_UPREFAB_CONFIG;
    process.env.FIGMA_TO_UPREFAB_CONFIG = configPath;
    try {
      atomicWriteFile(
        configPath,
        JSON.stringify({
          schemaVersion: 1,
          projects: {
            "c:/proj/a": { figmaAccessToken: "test-token-aaaaaaaaaa" },
            "c:/proj/b": { figmaAccessToken: "test-token-bbbbbbbbbb" },
            "c:/proj/c": { uiSystem: "UGUI" },
          },
        }),
      );
      expect(collectUserConfigSecrets().sort()).toEqual(["test-token-aaaaaaaaaa", "test-token-bbbbbbbbbb"].sort());

      atomicWriteFile(configPath, "{ malformed");
      expect(collectUserConfigSecrets()).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.FIGMA_TO_UPREFAB_CONFIG;
      else process.env.FIGMA_TO_UPREFAB_CONFIG = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
