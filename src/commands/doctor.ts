/**
 * `doctor`: read-only diagnostics of config, staging, Unity install, editor,
 * and token presence (never prints the token).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { readConfig, resolveTokenDetailed, userConfigPath } from "../core/config.js";
import { installedPackageDir, status as packageStatus } from "../core/installer.js";
import { projectVersionOf, resolveEditorPath, runningUnityProcesses } from "../core/unity.js";

export interface DoctorReport {
  projectPath?: string;
  userConfigPath?: string;
  projectKey?: string;
  uiSystem?: string;
  configValid: boolean;
  stagingRoot?: string;
  stagingExists: boolean;
  tokenPresent: boolean;
  tokenMasked?: string;
  unity: {
    editorVersion?: string;
    editorPath?: string;
    editorExists: boolean;
    packageInstalled: boolean;
    packageModified: boolean;
    running: boolean;
    runningQueryFailed: boolean;
  };
  checks: Array<{ name: string; ok: boolean; message: string }>;
}

export async function doctorCommand(options: { projectPath?: string; configPath?: string }): Promise<DoctorReport> {
  const checks: DoctorReport["checks"] = [];
  let stagingExists = false;

  // Token check runs BEFORE config loading so a broken/missing config never
  // hides an env token (and vice versa). Never prints the value.
  const tokenInfo = resolveTokenDetailed(options.projectPath ?? process.cwd(), options.configPath);
  checks.push({
    name: "token",
    ok: Boolean(tokenInfo.token),
    message: tokenInfo.token
      ? `FIGMA token present via ${tokenInfo.source === "env" ? "FIGMA_ACCESS_TOKEN env" : "user config project section"} (value never printed).`
      : "No Figma token (set FIGMA_ACCESS_TOKEN or add figmaAccessToken to the user config project section).",
  });

  let resolved: ReturnType<typeof readConfig> | undefined;
  try {
    resolved = readConfig(options.projectPath, options.configPath);
  } catch (error) {
    checks.push({ name: "config", ok: false, message: error instanceof Error ? error.message : String(error) });
    return {
      projectPath: options.projectPath,
      userConfigPath: options.configPath ?? userConfigPath(),
      configValid: false,
      stagingExists,
      tokenPresent: Boolean(tokenInfo.token),
      tokenMasked: tokenInfo.token ? "[REDACTED]" : undefined,
      unity: { editorExists: false, packageInstalled: false, packageModified: false, running: false, runningQueryFailed: false },
      checks,
    };
  }

  const projectPath = resolved.effective.projectPath;
  const userConfigPathUsed = resolved.userConfigPath;
  const projectKey = resolved.projectKey;
  const uiSystem = resolved.uiSystem;
  const stagingRoot = resolved.effective.stagingRoot;

  checks.push({ name: "config", ok: true, message: `User config: ${resolved.userConfigPath} [projects['${resolved.projectKey}']]` });
  checks.push({
    name: "ui-system",
    ok: resolved.uiSystem === "UGUI",
    message: `uiSystem: ${resolved.uiSystem}${resolved.uiSystem !== "UGUI" ? " (not supported yet)" : ""}`,
  });

  const cfg = resolved;

  stagingExists = Boolean(stagingRoot && existsSync(join(projectPath!, stagingRoot.split("/").join("\\"))));
  checks.push({ name: "staging", ok: stagingExists, message: stagingExists ? `Staging exists: ${stagingRoot}` : `Staging missing: ${stagingRoot}` });

  const version = projectVersionOf(projectPath!);
  let editorPath: string | undefined;
  let editorExists = false;
  try {
    editorPath = resolveEditorPath(projectPath!, cfg.effective.editorPath);
    editorExists = existsSync(editorPath);
  } catch {
    editorPath = cfg.effective.editorPath;
  }

  const packageDir = installedPackageDir(projectPath!);
  const pkgInstalled = existsSync(packageDir);
  const pkg = pkgInstalled ? await packageStatus({ projectPath: projectPath! }) : undefined;
  const running = runningUnityProcesses();

  const unity = {
    editorVersion: version,
    editorPath,
    editorExists,
    packageInstalled: pkgInstalled,
    packageModified: pkg?.modified ?? false,
    running: running.processes.length > 0,
    runningQueryFailed: running.queryFailed,
  };

  checks.push({
    name: "editor",
    ok: editorExists,
    message: editorExists ? `Editor: ${editorPath}` : `Editor not found: ${editorPath ?? "(unresolved)"}`,
  });
  checks.push({
    name: "unity-package",
    ok: pkgInstalled && !(pkg?.modified ?? false),
    message: pkgInstalled
      ? pkg?.modified
        ? "Package installed but modified since receipt"
        : `Package installed: ${packageDir}`
      : "Package not installed (run 'unity install')",
  });

  return {
    projectPath,
    userConfigPath: userConfigPathUsed,
    projectKey,
    uiSystem,
    configValid: true,
    stagingRoot,
    stagingExists,
    tokenPresent: Boolean(tokenInfo.token),
    tokenMasked: tokenInfo.token ? "[REDACTED]" : undefined,
    unity,
    checks,
  };
}
