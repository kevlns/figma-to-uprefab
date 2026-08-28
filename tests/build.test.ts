import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeBuildRequest, readBuildReport, orchestrateBuild, buildWorkDir, writeResolvedConfigForBuild, type ResolvedBuildConfig } from "../src/core/build.js";
import { atomicWriteFile } from "../src/core/atomic.js";
import { normalizeProjectKey } from "../src/core/config.js";
import { configInit } from "../src/commands/config.js";
import { buildCommand } from "../src/commands/build.js";
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
  it("setup writes the project section into the user config (env override)", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "ftu-setup-"));
    const configDir = mkdtempSync(join(tmpdir(), "ftu-setup-cfg-"));
    const previous = process.env.FIGMA_TO_UPREFAB_CONFIG;
    process.env.FIGMA_TO_UPREFAB_CONFIG = join(configDir, "config.json");
    try {
      const result = configInit({ projectPath });
      expect(result.configPath).toBe(join(configDir, "config.json"));
      expect(existsSync(result.configPath)).toBe(true);
      const config = JSON.parse(readFileSync(result.configPath, "utf8")) as { projects: Record<string, unknown> };
      expect(Object.keys(config.projects)).toContain(result.projectKey);
    } finally {
      if (previous === undefined) delete process.env.FIGMA_TO_UPREFAB_CONFIG;
      else process.env.FIGMA_TO_UPREFAB_CONFIG = previous;
      rmSync(configDir, { recursive: true, force: true });
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});

describe("build uiSystem fail-fast gate", () => {
  let configDir: string;
  let projectDir: string;
  let prevConfigEnv: string | undefined;
  let prevToken: string | undefined;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "ftu-bld-cfg-"));
    projectDir = mkdtempSync(join(tmpdir(), "ftu-proj-"));
    prevConfigEnv = process.env.FIGMA_TO_UPREFAB_CONFIG;
    process.env.FIGMA_TO_UPREFAB_CONFIG = join(configDir, "config.json");
    prevToken = process.env.FIGMA_ACCESS_TOKEN;
    delete process.env.FIGMA_ACCESS_TOKEN;
  });

  afterEach(() => {
    if (prevConfigEnv === undefined) delete process.env.FIGMA_TO_UPREFAB_CONFIG;
    else process.env.FIGMA_TO_UPREFAB_CONFIG = prevConfigEnv;
    if (prevToken === undefined) delete process.env.FIGMA_ACCESS_TOKEN;
    else process.env.FIGMA_ACCESS_TOKEN = prevToken;
    rmSync(configDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("rejects a NGUI project section with CFG_UISYSTEM_UNSUPPORTED before Unity batch", async () => {
    const configPath = join(configDir, "config.json");
    configInit({ projectPath: projectDir });
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { projects: Record<string, Record<string, unknown>> };
    config.projects[normalizeProjectKey(projectDir)]!.uiSystem = "NGUI";
    config.projects[normalizeProjectKey(projectDir)]!.figmaAccessToken = "test-token-1234567890";
    atomicWriteFile(configPath, JSON.stringify(config, null, 2));

    // Canned report: without the gate the command would consume it and "succeed"
    // without spawning Unity, so a missing rejection cannot pass silently.
    const fakeReport = { schemaVersion: 1 as const, status: "ok" as const, entries: [], issues: [] };
    const workDir = join(projectDir, "Library", "figma-to-uprefab");

    await expect(buildCommand({ projectPath: projectDir, fakeReport })).rejects.toThrow(/CFG_UISYSTEM_UNSUPPORTED/);

    // The gate fires before any build side effect: no resolved config was
    // written and no request either (orchestration never ran, so the
    // fakeReport was not consumed).
    expect(existsSync(join(workDir, "resolved-config.json"))).toBe(false);
    expect(existsSync(join(workDir, "request.json"))).toBe(false);
  });
});

describe("writeResolvedConfigForBuild", () => {
  it("writes a token-free resolved-config.json inside the work dir", () => {
    const workDir = mkdtempSync(join(tmpdir(), "ftu-resolved-"));
    try {
      // Deliberately smuggle a token to prove the writer strips it.
      const config = {
        schemaVersion: 1 as const,
        uiSystem: "UGUI",
        baseUiPrefab: "Assets/base.prefab",
        textPrefab: "Assets/text.prefab",
        specialListPrefab: "Assets/list.prefab",
        specialGridPrefab: "Assets/grid.prefab",
        formalPrefabRoot: "Assets/Formal",
        formalSpriteRoot: "Assets/Sprite",
        tagMappings: { btn: { kind: "component", unityType: "UnityEngine.UI.Button" } },
        figmaAccessToken: "test-token-1234567890",
      } as unknown as ResolvedBuildConfig;

      const path = writeResolvedConfigForBuild(workDir, config);
      expect(path).toBe(join(workDir, "resolved-config.json"));

      const written = readFileSync(path, "utf8");
      expect(written).not.toContain("figmaAccessToken");
      const parsed = JSON.parse(written) as Record<string, unknown>;
      expect(parsed.uiSystem).toBe("UGUI");
      expect(parsed.baseUiPrefab).toBe("Assets/base.prefab");
      expect(parsed.tagMappings).toEqual({ btn: { kind: "component", unityType: "UnityEngine.UI.Button" } });
      expect(parsed.schemaVersion).toBe(1);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
