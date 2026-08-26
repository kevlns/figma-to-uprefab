import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { embeddedPackageDir } from "../src/commands/unity.js";

// Regression: embeddedPackageDir() must resolve the real shipped payload from
// the built dist/ layout (repo dev and npm tarball share <pkg>/dist -> <pkg>/unity-package).
describe("embedded UPM payload resolution", () => {
  it("resolves without FIGMA_TO_UPREFAB_PAYLOAD and contains the full payload", () => {
    const previous = process.env.FIGMA_TO_UPREFAB_PAYLOAD;
    delete process.env.FIGMA_TO_UPREFAB_PAYLOAD;
    try {
      const dir = embeddedPackageDir();
      expect(existsSync(dir)).toBe(true);
      // Payload identity
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
      expect(pkg.name).toBe("com.kevlns.figma-to-uprefab");
      // Editor asmdef + batch entrypoint + no framework stubs
      const editor = join(dir, "Editor");
      expect(readdirSync(editor)).toContain("Kevlns.FigmaToUprefab.Editor.asmdef");
      const figmaPrefab = join(editor, "FigmaPrefab");
      const files = readdirSync(figmaPrefab);
      expect(files).toContain("FigmaPrefabCliBatch.cs");
      expect(files.some((f) => f.includes("FrameworkStubs"))).toBe(false);
    } finally {
      if (previous !== undefined) process.env.FIGMA_TO_UPREFAB_PAYLOAD = previous;
    }
  });
});
