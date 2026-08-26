/**
 * `unity install|status|uninstall`: manage the embedded UPM package in a
 * Unity project. Explicit, dry-run supported, hash-receipt based, fails
 * closed on modification detection.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "../core/config.js";
import { errors } from "../core/errors.js";
import {
  installPackage,
  installedPackageDir,
  receiptPathFor,
  status as packageStatus,
  uninstallPackage,
  type InstallOptions,
  type StatusResult,
} from "../core/installer.js";

const thisDir = dirname(fileURLToPath(import.meta.url));

/** Locate the embedded UPM payload shipped in this npm package. */
export function embeddedPackageDir(): string {
  const explicit = process.env.FIGMA_TO_UPREFAB_PAYLOAD;
  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  // Walk up from this module (dist/cli.mjs in built layout, src/commands in dev)
  // until <pkg>/unity-package/Packages/com.kevlns.figma-to-uprefab is found.
  const rel = join("unity-package", "Packages", "com.kevlns.figma-to-uprefab");
  let dir = thisDir;
  for (let depth = 0; depth < 6; depth++) {
    if (existsSync(join(dir, rel))) {
      return join(dir, rel);
    }
    dir = dirname(dir);
  }

  throw new Error("UNI_PAYLOAD_MISSING: embedded UPM package not found. Reinstall @kevlns/figma-to-uprefab.");
}

export async function unityInstallCommand(options: {
  projectPath?: string;
  configPath?: string;
  force?: boolean;
  dryRun?: boolean;
}): Promise<{ status: string; projectPath: string; packageDir: string; fileCount: number; receiptPath?: string }> {
  const resolved = readConfig(options.projectPath, options.configPath);
  const projectPath = resolved.effective.projectPath;
  const sourceDir = embeddedPackageDir();
  const installOptions: InstallOptions = {
    projectPath,
    sourceDir,
    force: options.force,
    dryRun: options.dryRun,
  };

  const result = await installPackage(installOptions);
  return {
    status: result.status,
    projectPath: result.projectPath,
    packageDir: result.packageDir,
    fileCount: result.fileCount,
    receiptPath: result.receiptPath,
  };
}

export async function unityStatusCommand(options: {
  projectPath?: string;
  configPath?: string;
}): Promise<StatusResult & { projectPath: string }> {
  const resolved = readConfig(options.projectPath, options.configPath);
  const projectPath = resolved.effective.projectPath;
  const result = await packageStatus({ projectPath });
  return { ...result, projectPath };
}

export async function unityUninstallCommand(options: {
  projectPath?: string;
  configPath?: string;
  force?: boolean;
  dryRun?: boolean;
}): Promise<{ status: string; projectPath: string; packageDir: string; receiptPath?: string }> {
  const resolved = readConfig(options.projectPath, options.configPath);
  const projectPath = resolved.effective.projectPath;
  const result = await uninstallPackage({ projectPath, force: options.force, dryRun: options.dryRun });
  return {
    status: result.status,
    projectPath,
    packageDir: result.packageDir,
    receiptPath: result.receiptPath,
  };
}

/** Assert the Unity package is installed (fail-closed for build). */
export async function assertUnityPackageInstalled(projectPath: string): Promise<void> {
  const packageDir = installedPackageDir(projectPath);
  if (!existsSync(packageDir)) throw errors.unityNotInstalled(projectPath);
  const receiptPath = receiptPathFor(projectPath);
  if (!existsSync(receiptPath)) {
    throw new Error(`UNI_RECEIPT_MISSING: package exists but no install receipt at ${receiptPath}. Re-run 'unity install'.`);
  }
  const verified = await packageStatus({ projectPath });
  if (!verified.installed || verified.modified) {
    const detail = verified.mismatches?.slice(0, 5).map((item) => `${item.kind}:${item.path}`).join(", ") ?? "unknown mismatch";
    throw new Error(`UNI_PACKAGE_MODIFIED: installed Unity package does not match its receipt (${detail}).`);
  }
}
