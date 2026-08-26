import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CliError, DEFAULT_BASE_UI_PREFAB } from "./errors.js";
import { validateSchema } from "./schema.js";

export const DEFAULT_TEXT_PREFAB = "Assets/Arts/Game/Prefabs/UI Common/ui_base_text.prefab";
export const DEFAULT_SPECIAL_LIST_PREFAB = "Assets/Arts/Game/Prefabs/UI Common/ui_base_scroll_list.prefab";
export const DEFAULT_SPECIAL_GRID_PREFAB = "Assets/Arts/Game/Prefabs/UI Common/ui_base_scroll_grid.prefab";
export const DEFAULT_FORMAL_PREFAB_ROOT = "Assets/Arts/Game/Prefabs";
export const DEFAULT_FORMAL_SPRITE_ROOT = "Assets/Arts/Game/Sprite";

export interface TagMapping {
  kind: "component" | "prefab";
  unityType?: string;
  prefabPath?: string;
}

export interface ProjectConfig {
  schemaVersion: 1;
  /** Machine-independent Unity settings only. Project root is derived from the config location/--project. */
  unity: { editorPath?: string };
  staging: { root: string };
  baseUiPrefab?: string;
  textPrefab?: string;
  specialListPrefab?: string;
  specialGridPrefab?: string;
  formalPrefabRoot?: string;
  formalSpriteRoot?: string;
  tagMappings?: Record<string, TagMapping>;
  translations?: Record<string, string>;
}

export interface LocalConfig {
  schemaVersion: 1;
  unity?: { editorPath?: string };
  staging?: { root?: string };
  baseUiPrefab?: string;
  textPrefab?: string;
  specialListPrefab?: string;
  specialGridPrefab?: string;
  formalPrefabRoot?: string;
  formalSpriteRoot?: string;
  tagMappings?: Record<string, TagMapping>;
  translations?: Record<string, string>;
}

export interface ResolvedConfig {
  configPath: string;
  config: ProjectConfig;
  localPath?: string;
  local?: LocalConfig;
  effective: {
    projectPath: string;
    editorPath?: string;
    stagingRoot: string;
    baseUiPrefab: string;
    textPrefab: string;
    specialListPrefab: string;
    specialGridPrefab: string;
    formalPrefabRoot: string;
    formalSpriteRoot: string;
    tagMappings: Record<string, TagMapping>;
    translations: Record<string, string>;
  };
}

export interface UserSecret { figmaAccessToken?: string }

export function configSearchPaths(projectPath?: string, explicit?: string): string[] {
  const candidates: string[] = [];
  if (explicit) candidates.push(resolve(explicit));
  candidates.push(resolve(projectPath ?? process.cwd(), "figma-to-uprefab.json"));
  return [...new Set(candidates)];
}

export function findConfigPath(projectPath?: string, explicit?: string): string | undefined {
  return configSearchPaths(projectPath, explicit).find((candidate) => existsSync(candidate));
}

export function readConfig(projectPath?: string, explicit?: string): ResolvedConfig {
  const configPath = findConfigPath(projectPath, explicit);
  if (!configPath) {
    throw new CliError(
      "CFG_FILE_MISSING",
      "Tracked config file was not found. Run 'figma-to-uprefab setup <project>' or 'config init' first.",
      1,
      `searched: ${configSearchPaths(projectPath, explicit).join(", ")}`,
    );
  }
  return loadConfigFrom(configPath, projectPath);
}

export function loadConfigFrom(configPath: string, projectPath?: string): ResolvedConfig {
  const absoluteConfigPath = resolve(configPath);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(absoluteConfigPath, "utf8"));
  } catch (error) {
    throw new CliError("CFG_JSON_INVALID", `Tracked config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = validateSchema("project-config", raw);
  if (!result.valid) {
    throw new CliError("CFG_SCHEMA_INVALID", `Tracked config is invalid: ${result.details ?? result.message}`, 1, absoluteConfigPath);
  }
  const config = raw as ProjectConfig;

  const localPath = join(dirname(absoluteConfigPath), "figma-to-uprefab.local.json");
  let local: LocalConfig | undefined;
  if (existsSync(localPath)) {
    let localRaw: unknown;
    try {
      localRaw = JSON.parse(readFileSync(localPath, "utf8"));
    } catch (error) {
      throw new CliError("CFG_LOCAL_JSON_INVALID", `Local config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const localResult = validateSchema("project-config-local", localRaw);
    if ((localRaw as { figmaAccessToken?: unknown }).figmaAccessToken !== undefined) {
      throw new CliError("CFG_LOCAL_TOKEN_FORBIDDEN", "figma-to-uprefab.local.json must not contain a figmaAccessToken. Use FIGMA_ACCESS_TOKEN or the user secret file.");
    }
    if (!localResult.valid) {
      throw new CliError("CFG_LOCAL_SCHEMA_INVALID", `Local config is invalid: ${localResult.details ?? localResult.message}`, 1, localPath);
    }
    local = localRaw as LocalConfig;
  }

  const effectiveProjectPath = resolve(projectPath ?? dirname(absoluteConfigPath));
  return {
    configPath: absoluteConfigPath,
    config,
    localPath: local ? localPath : undefined,
    local,
    effective: {
      projectPath: effectiveProjectPath,
      editorPath: local?.unity?.editorPath ?? config.unity.editorPath,
      stagingRoot: local?.staging?.root ?? config.staging.root,
      baseUiPrefab: local?.baseUiPrefab ?? config.baseUiPrefab ?? DEFAULT_BASE_UI_PREFAB,
      textPrefab: local?.textPrefab ?? config.textPrefab ?? DEFAULT_TEXT_PREFAB,
      specialListPrefab: local?.specialListPrefab ?? config.specialListPrefab ?? DEFAULT_SPECIAL_LIST_PREFAB,
      specialGridPrefab: local?.specialGridPrefab ?? config.specialGridPrefab ?? DEFAULT_SPECIAL_GRID_PREFAB,
      formalPrefabRoot: local?.formalPrefabRoot ?? config.formalPrefabRoot ?? DEFAULT_FORMAL_PREFAB_ROOT,
      formalSpriteRoot: local?.formalSpriteRoot ?? config.formalSpriteRoot ?? DEFAULT_FORMAL_SPRITE_ROOT,
      tagMappings: { ...(config.tagMappings ?? {}), ...(local?.tagMappings ?? {}) },
      translations: { ...(config.translations ?? {}), ...(local?.translations ?? {}) },
    },
  };
}

function userSecretPath(): string {
  return process.env.FIGMA_TO_UPREFAB_SECRET ?? join(homedir(), ".config", "figma-to-uprefab", "secret.json");
}

export function readUserSecret(): UserSecret {
  const path = userSecretPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as UserSecret;
    return { figmaAccessToken: typeof parsed.figmaAccessToken === "string" ? parsed.figmaAccessToken : undefined };
  } catch {
    throw new CliError("TOK_SECRET_READ_FAILED", `Could not read user secret file: ${path}`);
  }
}

export function resolveToken(): string | undefined {
  return process.env.FIGMA_ACCESS_TOKEN || readUserSecret().figmaAccessToken;
}

export function defaultConfig(): ProjectConfig {
  return {
    schemaVersion: 1,
    unity: {},
    staging: { root: "Assets/Arts/Game/FigmaAssets/_Staging" },
    baseUiPrefab: DEFAULT_BASE_UI_PREFAB,
    textPrefab: DEFAULT_TEXT_PREFAB,
    specialListPrefab: DEFAULT_SPECIAL_LIST_PREFAB,
    specialGridPrefab: DEFAULT_SPECIAL_GRID_PREFAB,
    formalPrefabRoot: DEFAULT_FORMAL_PREFAB_ROOT,
    formalSpriteRoot: DEFAULT_FORMAL_SPRITE_ROOT,
    tagMappings: {},
    translations: {},
  };
}
