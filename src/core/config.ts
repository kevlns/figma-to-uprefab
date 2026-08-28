/**
 * Single user-level config model.
 *
 * Replaces the old two-file project config (tracked `figma-to-uprefab.json` +
 * ignored `figma-to-uprefab.local.json`) and the previous user secret file
 * with ONE user config:
 *   `~/.config/figma-to-uprefab/config.json` (overridable via
 *   `FIGMA_TO_UPREFAB_CONFIG`), holding a section per Unity project keyed by
 *   normalized absolute project path.
 *
 * The Figma access token is resolved as FIGMA_ACCESS_TOKEN (preferred) or the
 * project section's `figmaAccessToken`. It is never written into tracked repo
 * files and never copied into the build-time resolved config.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { atomicWriteFile } from "./atomic.js";
import { CliError, DEFAULT_BASE_UI_PREFAB, DEFAULT_STAGING_ROOT } from "./errors.js";
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

export interface UserProjectConfig {
  figmaAccessToken?: string;
  uiSystem?: "UGUI" | "NGUI";
  baseUiPrefab?: string;
  textPrefab?: string;
  specialListPrefab?: string;
  specialGridPrefab?: string;
  formalPrefabRoot?: string;
  formalSpriteRoot?: string;
  staging?: { root?: string };
  unity?: { editorPath?: string };
  tagMappings?: Record<string, TagMapping>;
  translations?: Record<string, string>;
}

export interface UserConfig {
  schemaVersion: 1;
  projects: Record<string, UserProjectConfig>;
}

export interface ResolvedConfig {
  userConfigPath: string;
  /** The user config path used (same as userConfigPath; kept for call sites). */
  configPath: string;
  projectPath: string;
  projectKey: string;
  segment: UserProjectConfig;
  uiSystem: "UGUI" | "NGUI";
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

/** Absolute path of the user config file (env override wins). */
export function userConfigPath(): string {
  return process.env.FIGMA_TO_UPREFAB_CONFIG ?? join(homedir(), ".config", "figma-to-uprefab", "config.json");
}

/**
 * Canonical projects-map key for a project path: resolved absolute path with
 * forward slashes, lowercased on win32 (case-insensitive filesystems), and a
 * single trailing "/" stripped (drive roots like "c:/" are preserved). The
 * exact same function is used for writing (init/migrate) and lookup
 * (readConfig), so keying is always consistent.
 */
export function normalizeProjectKey(p: string): string {
  let key = resolve(p).replace(/\\/g, "/");
  if (process.platform === "win32") {
    key = key.toLowerCase();
  }

  if (key.length > 3 && key.endsWith("/")) {
    key = key.slice(0, -1);
  }

  return key;
}

export function projectSegmentFor(config: UserConfig, projectPath: string): UserProjectConfig | undefined {
  return config.projects[normalizeProjectKey(projectPath)];
}

export function loadUserConfig(configPath?: string): UserConfig {
  const path = resolve(configPath ?? userConfigPath());
  if (!existsSync(path)) {
    throw new CliError(
      "CFG_USER_FILE_MISSING",
      `User config file was not found: ${path}. Run 'figma-to-uprefab config init --project <path>' to create the project section.`,
      1,
      path,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new CliError(
      "CFG_USER_JSON_INVALID",
      `User config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      1,
      path,
    );
  }

  const result = validateSchema("user-config", raw);
  if (!result.valid) {
    throw new CliError(
      "CFG_USER_SCHEMA_INVALID",
      `User config is invalid against the user-config schema: ${result.details ?? result.message}`,
      1,
      path,
    );
  }

  return raw as UserConfig;
}

export function writeUserConfig(config: UserConfig, configPath?: string): void {
  atomicWriteFile(resolve(configPath ?? userConfigPath()), JSON.stringify(config, null, 2));
}

/** Legacy two-file model: tracked + ignored local config inside the project. */
export function legacyConfigPaths(projectPath: string): string[] {
  const project = resolve(projectPath ?? process.cwd());
  return [
    join(project, "figma-to-uprefab.json"),
    join(project, "figma-to-uprefab.local.json"),
  ].filter((candidate) => existsSync(candidate));
}

/** Fresh default project section. Deliberately carries no token field. */
export function defaultProjectSegment(): UserProjectConfig {
  return {
    uiSystem: "UGUI",
    staging: { root: DEFAULT_STAGING_ROOT },
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

export function readConfig(projectPath?: string, configPath?: string): ResolvedConfig {
  const userPath = resolve(configPath ?? userConfigPath());
  const project = resolve(projectPath ?? process.cwd());

  if (legacyConfigPaths(project).length > 0) {
    throw new CliError(
      "CFG_LEGACY_CONFIG_FOUND",
      "The two-file config model (figma-to-uprefab.json + figma-to-uprefab.local.json) was replaced by a single user-level config (~/.config/figma-to-uprefab/config.json). Legacy files fail closed until migrated.",
      1,
      `Run 'figma-to-uprefab config migrate --project ${project}' to migrate them.`,
    );
  }

  const config = loadUserConfig(userPath);
  const key = normalizeProjectKey(project);
  const segment = projectSegmentFor(config, project);
  if (!segment) {
    throw new CliError(
      "CFG_PROJECT_CONFIG_MISSING",
      `projects['${key}'] section missing in ${userPath}`,
      1,
      `Run 'figma-to-uprefab config init --project ${project}' to create it.`,
    );
  }

  const uiSystem = segment.uiSystem ?? "UGUI";
  return {
    userConfigPath: userPath,
    configPath: userPath,
    projectPath: project,
    projectKey: key,
    segment,
    uiSystem,
    effective: {
      projectPath: project,
      editorPath: segment.unity?.editorPath,
      stagingRoot: segment.staging?.root ?? DEFAULT_STAGING_ROOT,
      baseUiPrefab: segment.baseUiPrefab ?? DEFAULT_BASE_UI_PREFAB,
      textPrefab: segment.textPrefab ?? DEFAULT_TEXT_PREFAB,
      specialListPrefab: segment.specialListPrefab ?? DEFAULT_SPECIAL_LIST_PREFAB,
      specialGridPrefab: segment.specialGridPrefab ?? DEFAULT_SPECIAL_GRID_PREFAB,
      formalPrefabRoot: segment.formalPrefabRoot ?? DEFAULT_FORMAL_PREFAB_ROOT,
      formalSpriteRoot: segment.formalSpriteRoot ?? DEFAULT_FORMAL_SPRITE_ROOT,
      tagMappings: segment.tagMappings ?? {},
      translations: segment.translations ?? {},
    },
  };
}

export interface TokenResolution {
  token?: string;
  source: "env" | "config" | "none";
}

/**
 * Resolve the Figma token: FIGMA_ACCESS_TOKEN env (preferred), else the
 * project section's figmaAccessToken. The env lookup happens before the user
 * config is touched, so an env token wins even when the config is missing or
 * broken. Without an env token: a missing config file yields source "none"
 * (fresh machine), while a broken (invalid JSON/schema) config is rethrown so
 * the user sees the real problem.
 */
export function resolveTokenDetailed(projectPath?: string, configPath?: string): TokenResolution {
  const env = process.env.FIGMA_ACCESS_TOKEN;
  let segment: UserProjectConfig | undefined;
  try {
    const config = loadUserConfig(configPath);
    segment = projectSegmentFor(config, resolve(projectPath ?? process.cwd()));
  } catch (error) {
    if (env) {
      // Config problems are moot while the env token exists.
      return { token: env, source: "env" };
    }

    if (error instanceof CliError && error.code === "CFG_USER_FILE_MISSING") {
      // No user config yet: the token is simply absent (doctor must run pre-config).
      return { source: "none" };
    }

    throw error;
  }

  if (env) {
    return { token: env, source: "env" };
  }

  const token = segment?.figmaAccessToken;
  return token ? { token, source: "config" } : { source: "none" };
}

export function resolveToken(projectPath?: string, configPath?: string): string | undefined {
  return resolveTokenDetailed(projectPath, configPath).token;
}

/**
 * Best-effort secret harvest for the startup redactor: every project
 * section's figmaAccessToken. Never throws; on any problem the caller simply
 * gets no extra secrets (the env token is registered separately).
 */
export function collectUserConfigSecrets(configPath?: string): string[] {
  try {
    const config = loadUserConfig(configPath);
    const secrets: string[] = [];
    for (const segment of Object.values(config.projects)) {
      if (segment.figmaAccessToken) {
        secrets.push(segment.figmaAccessToken);
      }
    }

    return secrets;
  } catch {
    return [];
  }
}
