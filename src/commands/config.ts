/**
 * `config init | validate | migrate` against the single user-level config.
 */

import { existsSync, readFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  defaultProjectSegment,
  legacyConfigPaths,
  loadUserConfig,
  normalizeProjectKey,
  projectSegmentFor,
  resolveTokenDetailed,
  userConfigPath,
  writeUserConfig,
  type UserConfig,
  type UserProjectConfig,
} from "../core/config.js";
import { CliError } from "../core/errors.js";
import { validateSchema } from "../core/schema.js";

export interface ConfigInitOptions {
  projectPath: string;
  configPath?: string;
  force?: boolean;
}

export interface ConfigInitResult {
  configPath: string;
  projectKey: string;
  created: boolean;
}

/** `config init`: add the current project's section to the user config. */
export function configInit(options: ConfigInitOptions): ConfigInitResult {
  const configPath = resolve(options.configPath ?? userConfigPath());
  const projectKey = normalizeProjectKey(options.projectPath);

  let config: UserConfig;
  if (existsSync(configPath)) {
    config = loadUserConfig(configPath);
  } else {
    config = { schemaVersion: 1, projects: {} };
  }

  if (config.projects[projectKey] && !options.force) {
    return { configPath, projectKey, created: false };
  }

  config.projects[projectKey] = defaultProjectSegment();
  writeUserConfig(config, configPath);
  return { configPath, projectKey, created: true };
}

/** `setup <project>`: alias of `config init` (same return type). */
export function setupCommand(options: { projectPath: string; configPath?: string; force?: boolean }): ConfigInitResult {
  return configInit(options);
}

export interface ConfigValidateResult {
  configPath: string;
  projectKey: string;
  valid: boolean;
  issues: Array<{ path: string; message: string }>;
  errors: string[];
}

export function configValidate(options: { projectPath?: string; configPath?: string }): ConfigValidateResult {
  const projectPath = resolve(options.projectPath ?? process.cwd());
  const configPath = resolve(options.configPath ?? userConfigPath());
  const projectKey = normalizeProjectKey(projectPath);
  const issues: ConfigValidateResult["issues"] = [];
  const errors: string[] = [];
  const push = (path: string, message: string): void => {
    issues.push({ path, message });
    errors.push(`${path} ${message}`.trim());
  };

  // (a) Legacy two-file model detection (fail closed with a migrate hint).
  if (legacyConfigPaths(projectPath).length > 0) {
    push(
      "(legacy)",
      "Legacy figma-to-uprefab.json / figma-to-uprefab.local.json detected. Run 'figma-to-uprefab config migrate --project <path>'.",
    );
  }

  // (b) User config file + schema.
  let segment: UserProjectConfig | undefined;
  let configBroken = false;
  try {
    const config = loadUserConfig(configPath);
    segment = projectSegmentFor(config, projectPath);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    configBroken = true;
    let issuePath = "(root)";
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
      const result = validateSchema("user-config", raw);
      if (!result.valid) issuePath = result.path ?? "(root)";
    } catch {
      /* missing file / invalid JSON: keep (root) */
    }

    push(issuePath, error.message);
  }

  // (c) Missing project section.
  if (!configBroken && !segment) {
    push(`projects/${projectKey}`, "missing project section; run 'config init'");
  }

  // (d) Token presence (env or project section).
  try {
    const tokenInfo = resolveTokenDetailed(projectPath, configPath);
    if (tokenInfo.source === "none") {
      push(
        `projects/${projectKey}.figmaAccessToken`,
        "figmaAccessToken is required: add it to the user config project section or set FIGMA_ACCESS_TOKEN",
      );
    }
  } catch {
    /* the config-level problem is already reported above */
  }

  // (e) NGUI fail-closed.
  if (segment?.uiSystem === "NGUI") {
    push(`projects/${projectKey}.uiSystem`, "uiSystem 'NGUI' is not supported yet; only UGUI is supported");
  }

  return { configPath, projectKey, valid: issues.length === 0, issues, errors };
}

export interface ConfigMigrateResult {
  configPath: string;
  projectKey: string;
  renamedLegacy: string[];
}

/**
 * `config migrate`: fold the legacy tracked + local two-file config into the
 * user config, then rename the legacy files to *.migrated. Never copies a
 * figmaAccessToken out of legacy files.
 */
export function configMigrate(options: { projectPath: string; configPath?: string; force?: boolean }): ConfigMigrateResult {
  const projectPath = resolve(options.projectPath ?? process.cwd());
  const configPath = resolve(options.configPath ?? userConfigPath());
  const projectKey = normalizeProjectKey(projectPath);

  const trackedPath = join(projectPath, "figma-to-uprefab.json");
  if (!existsSync(trackedPath)) {
    throw new CliError("CFG_MIGRATE_NOTHING_TO_MIGRATE", `No legacy tracked config at ${trackedPath}. Nothing to migrate.`);
  }

  const readLegacyJson = (path: string): Record<string, unknown> => {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch (error) {
      throw new CliError(
        "CFG_MIGRATE_SOURCE_INVALID",
        `Legacy config ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const tracked = readLegacyJson(trackedPath);
  const localPath = join(projectPath, "figma-to-uprefab.local.json");
  const local: Record<string, unknown> = existsSync(localPath) ? readLegacyJson(localPath) : {};

  const merged: UserProjectConfig = {};
  // Shallow spread local-over-tracked for the plain scalar fields.
  for (const field of ["baseUiPrefab", "textPrefab", "specialListPrefab", "specialGridPrefab", "formalPrefabRoot", "formalSpriteRoot"] as const) {
    const value = local[field] ?? tracked[field];
    if (value !== undefined) {
      merged[field] = value as string;
    }
  }

  // Object sections: shallow spread local-over-tracked as well.
  const unity = { ...asRecord(tracked.unity), ...asRecord(local.unity) } as { editorPath?: string };
  if (Object.keys(unity).length > 0) merged.unity = unity;
  const staging = { ...asRecord(tracked.staging), ...asRecord(local.staging) } as { root?: string };
  if (Object.keys(staging).length > 0) merged.staging = staging;

  // Maps: merged local-over-tracked.
  merged.tagMappings = { ...asRecord(tracked.tagMappings), ...asRecord(local.tagMappings) } as UserProjectConfig["tagMappings"];
  merged.translations = { ...asRecord(tracked.translations), ...asRecord(local.translations) } as UserProjectConfig["translations"];

  // Never copy the token out of legacy files; uiSystem defaults to UGUI.
  delete (merged as Record<string, unknown>).figmaAccessToken;
  if (!merged.uiSystem) merged.uiSystem = "UGUI";

  const probe = { schemaVersion: 1 as const, projects: { [projectKey]: merged } };
  const schemaResult = validateSchema("user-config", probe);
  if (!schemaResult.valid) {
    throw new CliError(
      "CFG_MIGRATE_RESULT_INVALID",
      "The merged project section failed user-config schema validation.",
      1,
      schemaResult.details ?? schemaResult.message,
    );
  }

  let config: UserConfig;
  try {
    config = loadUserConfig(configPath);
  } catch (error) {
    if (error instanceof CliError && error.code === "CFG_USER_FILE_MISSING") {
      config = { schemaVersion: 1, projects: {} };
    } else {
      throw error;
    }
  }

  if (config.projects[projectKey] && !options.force) {
    throw new CliError(
      "CFG_PROJECT_CONFIG_EXISTS",
      `projects['${projectKey}'] already exists in ${configPath}. Use --force to overwrite the existing project section.`,
    );
  }

  config.projects[projectKey] = merged;
  writeUserConfig(config, configPath);

  const renamedLegacy: string[] = [];
  for (const legacyPath of [trackedPath, localPath]) {
    if (existsSync(legacyPath)) {
      const migratedPath = `${legacyPath}.migrated`;
      renameSync(legacyPath, migratedPath);
      renamedLegacy.push(migratedPath);
    }
  }

  return { configPath, projectKey, renamedLegacy };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}
