import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSchema } from "../src/core/schema.js";
import { PACKAGE_NAME, VERSION } from "../src/version.js";

// Package manifest + payload identity guard (mirrors scripts/pack-guard.mjs).
describe("package manifest identity", () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    name: string;
    version: string;
    bin: Record<string, string>;
    type: string;
    engines: { node: string };
    files: string[];
    vCli?: { manifest: string };
  };

  it("is the expected identity", () => {
    expect(pkg.name).toBe("@kevlns/figma-to-uprefab");
    expect(pkg.version).toBe("0.1.0");
    expect(pkg.type).toBe("module");
    expect(pkg.engines.node).toBe(">=20");
    expect(pkg.bin["figma-to-uprefab"]).toBe("dist/cli.mjs");
    expect(PACKAGE_NAME).toBe("@kevlns/figma-to-uprefab");
    expect(VERSION).toBe("0.1.0");
  });

  it("ships the required files", () => {
    for (const required of ["dist", "schemas", "unity-package", "v-cli.plugin.json", "AGENTS.md", "README.md", "LICENSE", "docs"]) {
      expect(pkg.files).toContain(required);
    }
  });

  it("points at the v-cli plugin manifest", () => {
    expect(pkg.vCli?.manifest).toBe("v-cli.plugin.json");
  });
});

describe("schema files are loadable by name", () => {
  it("loads all five authoritative schemas", () => {
    for (const name of ["user-config", "source-manifest", "root-index", "approximation-overlay", "ir"] as const) {
      expect(validateSchema(name, {}).valid).toBe(false); // schema compiles, {} is invalid
    }
  });
});

describe("v-cli.plugin.json is well-formed", () => {
  it("has a stable command/bin identity", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "v-cli.plugin.json"), "utf8")) as {
      schemaVersion: number;
      package: string;
      command: string;
      bin: string;
      platforms: string[];
      agent: { commands: Array<{ path: string[] }> };
    };
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.package).toBe("@kevlns/figma-to-uprefab");
    expect(manifest.command).toBe("figma");
    expect(manifest.bin).toBe("figma-to-uprefab");
    expect(manifest.platforms).toContain("win32");
    const paths = manifest.agent.commands.map((c) => c.path.join(" "));
    for (const expected of ["export", "contract", "doctor", "unity install", "unity status", "unity uninstall", "build", "config validate", "agent docs"]) {
      expect(paths).toContain(expected);
    }
  });
});

describe("unity-package payload is present", () => {
  it("has package.json + asmdef + batch entrypoint", () => {
    const payloadRoot = join(process.cwd(), "unity-package", "Packages", "com.kevlns.figma-to-uprefab");
    const pkg = JSON.parse(readFileSync(join(payloadRoot, "package.json"), "utf8")) as { name: string; unity: string };
    expect(pkg.name).toBe("com.kevlns.figma-to-uprefab");
    expect(pkg.unity).toBe("2022.3");
    const asmdef = JSON.parse(readFileSync(join(payloadRoot, "Editor", "Kevlns.FigmaToUprefab.Editor.asmdef"), "utf8")) as {
      name: string;
      includePlatforms: string[];
      references: string[];
    };
    expect(asmdef.name).toBe("Kevlns.FigmaToUprefab.Editor");
    expect(asmdef.includePlatforms).toEqual(["Editor"]);
    expect(asmdef.references).toContain("Newtonsoft.Json");
  });
});
