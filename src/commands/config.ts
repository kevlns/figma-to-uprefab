/**
 * `config init` / `config validate`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "../core/atomic.js";
import { defaultConfig, findConfigPath, loadConfigFrom } from "../core/config.js";
import { CliError } from "../core/errors.js";
import { validateSchema } from "../core/schema.js";

export interface ConfigInitOptions {
  projectPath: string;
  configPath?: string;
  force?: boolean;
}

export function configInit(options: ConfigInitOptions): { configPath: string; created: boolean } {
  const configPath = options.configPath ?? join(options.projectPath, "figma-to-uprefab.json");
  if (existsSync(configPath) && !options.force) {
    return { configPath, created: false };
  }

  const config = defaultConfig();
  atomicWriteFile(configPath, JSON.stringify(config, null, 2));
  return { configPath, created: true };
}

export interface ConfigValidateResult {
  configPath?: string;
  valid: boolean;
  issues: Array<{ path: string; message: string }>;
  errors: string[];
}

/** `setup <project>`: write the tracked config into a Unity project. */
export function setupCommand(options: { projectPath: string; configPath?: string; force?: boolean }): {
  configPath: string;
  created: boolean;
} {
  return configInit(options);
}

export function configValidate(options: { projectPath?: string; configPath?: string }): ConfigValidateResult {
  const configPath = findConfigPath(options.projectPath, options.configPath);
  if (!configPath) {
    throw new CliError("CFG_FILE_MISSING", "No tracked config found. Run 'config init' or 'setup' first.");
  }

  const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  const schemaResult = validateSchema("project-config", raw);
  if (!schemaResult.valid) {
    return {
      configPath,
      valid: false,
      issues: [{ path: schemaResult.path ?? "(root)", message: schemaResult.message ?? "schema error" }],
      errors: [`${schemaResult.path ?? "(root)"} ${schemaResult.message ?? ""}`.trim()],
    };
  }

  // Also confirm the local overlay (if any) does not smuggle a token.
  try {
    loadConfigFrom(configPath, options.projectPath);
  } catch (error) {
    if (error instanceof CliError) {
      return { configPath, valid: false, issues: [{ path: "(config)", message: error.message }], errors: [error.message] };
    }

    throw error;
  }

  return { configPath, valid: true, issues: [], errors: [] };
}
