import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configInit, configValidate, configMigrate, setupCommand } from "../src/commands/config.js";
import { loadUserConfig, normalizeProjectKey, readConfig, resolveTokenDetailed } from "../src/core/config.js";
import { atomicWriteFile } from "../src/core/atomic.js";

describe("user config init / validate / migrate", () => {
  let configDir: string;
  let projectDir: string;
  let prevConfigEnv: string | undefined;
  let prevToken: string | undefined;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "ftu-ucfg-"));
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

  const configPath = () => join(configDir, "config.json");

  const writeSegment = (mutate: (segment: Record<string, unknown>) => void): void => {
    const config = JSON.parse(readFileSync(configPath(), "utf8")) as { projects: Record<string, Record<string, unknown>> };
    mutate(config.projects[normalizeProjectKey(projectDir)]!);
    atomicWriteFile(configPath(), JSON.stringify(config, null, 2));
  };

  it("init creates the user config + project section (uiSystem UGUI default, no token field)", () => {
    const result = configInit({ projectPath: projectDir });
    expect(result.created).toBe(true);
    expect(result.configPath).toBe(configPath());
    expect(existsSync(result.configPath)).toBe(true);

    const config = loadUserConfig(result.configPath);
    const segment = config.projects[result.projectKey]!;
    expect(segment.uiSystem).toBe("UGUI");
    expect(segment.figmaAccessToken).toBeUndefined();
    expect(Object.hasOwn(segment, "figmaAccessToken")).toBe(false);
    expect(segment.staging?.root).toBe("Assets/Arts/Game/FigmaAssets/_Staging");
  });

  it("init is idempotent without force and force overwrites", () => {
    configInit({ projectPath: projectDir });
    const second = configInit({ projectPath: projectDir });
    expect(second.created).toBe(false);

    writeSegment((segment) => {
      segment.uiSystem = "NGUI";
    });
    const forced = configInit({ projectPath: projectDir, force: true });
    expect(forced.created).toBe(true);
    expect(loadUserConfig(configPath()).projects[forced.projectKey]!.uiSystem).toBe("UGUI");
  });

  it("setup is an alias for config init", () => {
    const result = setupCommand({ projectPath: projectDir });
    expect(result.created).toBe(true);
    expect(result.projectKey).toBe(normalizeProjectKey(projectDir));
  });

  it("validate is invalid until a token is provided, then valid via the project section", () => {
    configInit({ projectPath: projectDir });
    let validate = configValidate({ projectPath: projectDir });
    expect(validate.valid).toBe(false);
    expect(validate.issues.some((issue) => issue.path === `projects/${normalizeProjectKey(projectDir)}.figmaAccessToken`)).toBe(true);

    writeSegment((segment) => {
      segment.figmaAccessToken = "test-token-1234567890";
    });
    validate = configValidate({ projectPath: projectDir });
    expect(validate.valid).toBe(true);
    expect(validate.issues).toEqual([]);
  });

  it("validate is valid via env FIGMA_ACCESS_TOKEN", () => {
    configInit({ projectPath: projectDir });
    process.env.FIGMA_ACCESS_TOKEN = "test-token-1234567890";
    expect(configValidate({ projectPath: projectDir }).valid).toBe(true);
  });

  it("NGUI section fails validation with a uiSystem issue", () => {
    configInit({ projectPath: projectDir });
    writeSegment((segment) => {
      segment.uiSystem = "NGUI";
      segment.figmaAccessToken = "test-token-1234567890";
    });

    const validate = configValidate({ projectPath: projectDir });
    expect(validate.valid).toBe(false);
    expect(validate.issues.some((issue) => issue.path === `projects/${normalizeProjectKey(projectDir)}.uiSystem` && /NGUI/.test(issue.message))).toBe(true);
  });

  it("readConfig resolves effective defaults and honors segment overrides", () => {
    configInit({ projectPath: projectDir });

    const resolved = readConfig(projectDir);
    expect(resolved.uiSystem).toBe("UGUI");
    expect(resolved.effective.stagingRoot).toBe("Assets/Arts/Game/FigmaAssets/_Staging");
    expect(resolved.effective.baseUiPrefab).toBe("Assets/Arts/Game/Prefabs/UI Common/ui_base.prefab");
    expect(resolved.effective.textPrefab).toBe("Assets/Arts/Game/Prefabs/UI Common/ui_base_text.prefab");
    expect(resolved.userConfigPath).toBe(configPath());

    writeSegment((segment) => {
      segment.staging = { root: "Assets/Custom/_Staging" };
      segment.baseUiPrefab = "Assets/Custom/base.prefab";
      segment.uiSystem = "UGUI";
    });

    const overridden = readConfig(projectDir);
    expect(overridden.effective.stagingRoot).toBe("Assets/Custom/_Staging");
    expect(overridden.effective.baseUiPrefab).toBe("Assets/Custom/base.prefab");
    expect(overridden.projectKey).toBe(normalizeProjectKey(projectDir));
  });

  it("project key normalization: section written for C:\\Proj\\A is found via c:/proj/a", () => {
    if (process.platform !== "win32") {
      // Non-Windows keys stay case-sensitive; separator/trailing-slash normalization still applies.
      expect(normalizeProjectKey("/tmp/some/proj/")).toBe("/tmp/some/proj");
      return;
    }

    const winProject = "C:\\Proj\\A";
    const result = configInit({ projectPath: winProject });
    expect(result.projectKey).toBe("c:/proj/a");

    // Lookup with different casing/separators must find the same section.
    const resolved = readConfig("c:/proj/a");
    expect(resolved.projectKey).toBe(result.projectKey);
    expect(resolved.segment.uiSystem).toBe("UGUI");
    expect(resolveTokenDetailed("c:/proj/a").source).toBe("none");
  });

  it("legacy two-file configs fail closed until migrated", () => {
    writeFileSync(
      join(projectDir, "figma-to-uprefab.json"),
      JSON.stringify({ schemaVersion: 1, unity: {}, staging: { root: "Assets/X/_Staging" }, tagMappings: {}, translations: {} }),
    );

    expect(() => readConfig(projectDir)).toThrow(/CFG_LEGACY_CONFIG_FOUND/);

    const validate = configValidate({ projectPath: projectDir });
    expect(validate.valid).toBe(false);
    expect(validate.issues.some((issue) => issue.path === "(legacy)" && /migrate/.test(issue.message))).toBe(true);
  });

  it("migrate merges tracked+local, strips tokens, renames legacy files", () => {
    writeFileSync(
      join(projectDir, "figma-to-uprefab.json"),
      JSON.stringify({
        schemaVersion: 1,
        unity: {},
        staging: { root: "Assets/X/_Staging" },
        tagMappings: { btn: { kind: "component", unityType: "UnityEngine.UI.Button" } },
        translations: {},
      }),
    );
    writeFileSync(
      join(projectDir, "figma-to-uprefab.local.json"),
      JSON.stringify({
        schemaVersion: 1,
        figmaAccessToken: "test-token-1234567890",
        staging: { root: "Assets/Y/_Staging" },
        tagMappings: { btn: { kind: "prefab", prefabPath: "Assets/x.prefab" } },
      }),
    );

    const result = configMigrate({ projectPath: projectDir });
    expect(result.configPath).toBe(configPath());
    expect(result.renamedLegacy).toHaveLength(2);

    const segment = loadUserConfig(result.configPath).projects[result.projectKey]!;
    expect(segment.staging?.root).toBe("Assets/Y/_Staging");
    expect(segment.tagMappings?.btn).toEqual({ kind: "prefab", prefabPath: "Assets/x.prefab" });
    expect(segment.uiSystem).toBe("UGUI");
    expect(segment.figmaAccessToken).toBeUndefined();
    expect(Object.hasOwn(segment, "figmaAccessToken")).toBe(false);

    expect(existsSync(join(projectDir, "figma-to-uprefab.json"))).toBe(false);
    expect(existsSync(join(projectDir, "figma-to-uprefab.local.json"))).toBe(false);
    expect(existsSync(join(projectDir, "figma-to-uprefab.json.migrated"))).toBe(true);
    expect(existsSync(join(projectDir, "figma-to-uprefab.local.json.migrated"))).toBe(true);

    // After migration readConfig works against the user config.
    expect(readConfig(projectDir).effective.stagingRoot).toBe("Assets/Y/_Staging");
  });

  it("migrate refuses to overwrite an existing section without --force", () => {
    configInit({ projectPath: projectDir });
    writeFileSync(
      join(projectDir, "figma-to-uprefab.json"),
      JSON.stringify({ schemaVersion: 1, unity: {}, staging: { root: "Assets/X/_Staging" }, tagMappings: {}, translations: {} }),
    );

    expect(() => configMigrate({ projectPath: projectDir })).toThrow(/CFG_PROJECT_CONFIG_EXISTS/);
    // Refusal must not rename the legacy files.
    expect(existsSync(join(projectDir, "figma-to-uprefab.json"))).toBe(true);
  });

  it("migrate without legacy files reports nothing to migrate", () => {
    expect(() => configMigrate({ projectPath: projectDir })).toThrow(/CFG_MIGRATE_NOTHING_TO_MIGRATE/);
  });

  it("loadUserConfig failures carry stable codes", () => {
    expect(() => loadUserConfig(configPath())).toThrow(/CFG_USER_FILE_MISSING/);

    atomicWriteFile(configPath(), "{ not json");
    expect(() => loadUserConfig(configPath())).toThrow(/CFG_USER_JSON_INVALID/);

    atomicWriteFile(configPath(), JSON.stringify({ schemaVersion: 1, projects: { "c:/x": { uiSystem: "HGUI" } } }));
    expect(() => loadUserConfig(configPath())).toThrow(/CFG_USER_SCHEMA_INVALID/);
  });
});
