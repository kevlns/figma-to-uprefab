import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeBuildRequest, readBuildReport, orchestrateBuild, buildWorkDir } from "../src/core/build.js";
import { configInit } from "../src/commands/config.js";
import { assertUnityPackageInstalled } from "../src/commands/unity.js";

describe("build request/report protocol", () => {
  it("writes and reads the request/report JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "ftu-build-"));
    try {
      const workDir = buildWorkDir(dir);
      writeBuildRequest(workDir, {
        schemaVersion: 1,
        mode: "convert-and-build",
        rootIndexPath: "Assets/_Staging/figma-roots.index.json",
        overlaySuffix: ".approximation.json",
      });
      const request = JSON.parse(readFileSync(join(workDir, "request.json"), "utf8")) as { schemaVersion: number; mode: string };
      expect(request.schemaVersion).toBe(1);
      expect(request.mode).toBe("convert-and-build");

      const report = { schemaVersion: 1, status: "ok" as const, entries: [], issues: [] };
      writeFileSync(join(workDir, "report.json"), JSON.stringify(report));
      expect(readBuildReport(workDir).status).toBe("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses a fake report for test orchestration without spawning Unity", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ftu-build-"));
    try {
      const projectPath = mkdtempSync(join(tmpdir(), "ftu-proj-"));
      mkdirSync(join(projectPath, "Library", "figma-to-uprefab"), { recursive: true });
      const fakeReport = {
        schemaVersion: 1 as const,
        status: "ok" as const,
        entries: [{ figmaNodeId: "1:1", prefabName: "Panel", errorCode: undefined }],
        issues: [],
      };
      const report = await orchestrateBuild({
        projectPath,
        rootIndexPath: "Assets/_Staging/figma-roots.index.json",
        fakeReport,
        workDir: join(projectPath, "Library", "figma-to-uprefab"),
      });
      expect(report.status).toBe("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed when the Unity package is not installed", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "ftu-proj-"));
    try {
      await expect(assertUnityPackageInstalled(projectPath)).rejects.toThrow(/UNI_NOT_INSTALLED/);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("fails closed when the package exists but the receipt is missing", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "ftu-proj-"));
    try {
      mkdirSync(join(projectPath, "Packages", "com.kevlns.figma-to-uprefab"), { recursive: true });
      await expect(assertUnityPackageInstalled(projectPath)).rejects.toThrow(/UNI_RECEIPT_MISSING/);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});

describe("config-init based setup", () => {
  it("setup writes a tracked config inside the project", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "ftu-setup-"));
    try {
      const result = configInit({ projectPath });
      expect(result.configPath).toBe(join(projectPath, "figma-to-uprefab.json"));
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
