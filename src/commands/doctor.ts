/**
 * `doctor`: read-only diagnostics of config, staging, Unity install, editor,
 * and token presence (never prints the token).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { findConfigPath, readConfig, resolveToken } from "../core/config.js";
import { installedPackageDir, status as packageStatus } from "../core/installer.js";
import { projectVersionOf, resolveEditorPath, runningUnityProcesses } from "../core/unity.js";

export interface DoctorReport {
  projectPath?: string;
  configPath?: string;
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
  let projectPath: string | undefined;
  let configPath: string | undefined;
  let stagingRoot: string | undefined;
  let stagingExists = false;

  const token = resolveToken();
  checks.push({
    name: "token",
    ok: Boolean(token),
    message: token ? "FIGMA token present (value never printed)." : "No Figma token (set FIGMA_ACCESS_TOKEN or user secret).",
  });

  const found = findConfigPath(options.projectPath, options.configPath);
  if (!found) {
    checks.push({ name: "config", ok: false, message: "No tracked figma-to-uprefab.json found." });
    return {
      configValid: false,
      stagingExists,
      tokenPresent: Boolean(token),
      tokenMasked: token ? "[REDACTED]" : undefined,
      unity: { editorExists: false, packageInstalled: false, packageModified: false, running: false, runningQueryFailed: false },
      checks,
    };
  }

  configPath = found;
  let resolved: ReturnType<typeof readConfig> | undefined;
  try {
    resolved = readConfig(undefined, found);
    projectPath = resolved.effective.projectPath;
    stagingRoot = resolved.effective.stagingRoot;
    configPath = resolved.configPath;
    checks.push({ name: "config", ok: true, message: `Tracked config: ${found}` });
  } catch (error) {
    checks.push({ name: "config", ok: false, message: error instanceof Error ? error.message : String(error) });
    return {
      configPath,
      configValid: false,
      stagingExists,
      tokenPresent: Boolean(token),
      tokenMasked: token ? "[REDACTED]" : undefined,
      unity: { editorExists: false, packageInstalled: false, packageModified: false, running: false, runningQueryFailed: false },
      checks,
    };
  }

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
    configPath,
    configValid: true,
    stagingRoot,
    stagingExists,
    tokenPresent: Boolean(token),
    tokenMasked: token ? "[REDACTED]" : undefined,
    unity,
    checks,
  };
}
