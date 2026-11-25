// Copyright © 2026 Vant <sl_kevln@163.com>
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import releases from "./release-trees.json";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { atomicWriteFile } from "./atomic.js";
import { compareTree, sha256Tree, type TreeMismatch } from "./integrity.js";

export interface InstallResult {
  status: "Installed" | "AlreadyInstalled" | "DryRun";
  projectPath: string;
  packageName: string;
  packageDir: string;
  fileCount: number;
  receiptPath?: string;
  dryRun?: boolean;
}
export interface InstallOptions {
  projectPath: string;
  sourceDir: string;
  force?: boolean;
  dryRun?: boolean;
  readdirImpl?: typeof readdirSync;
  receiptDir?: string;
}
export interface UninstallResult {
  status: "Uninstalled" | "NotInstalled" | "DryRun" | "ModifiedRejected";
  projectPath: string;
  packageDir: string;
  receiptPath?: string;
}
export interface StatusResult {
  installed: boolean;
  packageDir?: string;
  receiptPath?: string;
  modified: boolean;
  fileCount?: number;
  mismatches?: TreeMismatch[];
}

const PACKAGE_NAME = "com.kevlns.figma-to-uprefab";

export function installedPackageDir(projectPath: string): string {
  return join(projectPath, "Packages", PACKAGE_NAME);
}
export function receiptDirFor(projectPath: string, receiptDir?: string): string {
  return receiptDir ?? join(projectPath, "Library", "figma-to-uprefab");
}
export function receiptPathFor(projectPath: string, receiptDir?: string): string {
  return join(receiptDirFor(projectPath, receiptDir), "install-receipt.json");
}

interface Receipt {
  schemaVersion: 1;
  packageName: string;
  packageVersion: string;
  packageDir: string;
  files: Record<string, string>;
}

function readReceipt(receiptPath: string): Receipt | undefined {
  if (!existsSync(receiptPath)) return undefined;
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Receipt;
    return receipt?.schemaVersion === 1 && receipt.packageName === PACKAGE_NAME &&
      receipt.files && typeof receipt.files === "object" && !Array.isArray(receipt.files) ? receipt : undefined;
  } catch {
    return undefined;
  }
}

const releasedTrees = new Set(Object.values(releases));
async function isPublishedTree(packageDir: string): Promise<boolean> {
  const entries = [...await sha256Tree(packageDir)].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
  return releasedTrees.has(createHash("sha256").update(JSON.stringify(entries)).digest("hex"));
}

async function mismatchesFor(packageDir: string, receipt: Receipt | undefined, sourceDir?: string): Promise<TreeMismatch[]> {
  const prior = receipt ? await compareTree(packageDir, new Map(Object.entries(receipt.files))) : undefined;
  if (prior?.length === 0) return prior;
  if (!receipt && await isPublishedTree(packageDir)) return [];
  if (sourceDir) {
    readPayloadIdentity(sourceDir);
    const current = await compareTree(packageDir, await sha256Tree(sourceDir));
    if (current.length === 0 || !prior) return current;
  }
  return prior ?? [{ kind: "extra", path: "(missing-or-invalid-receipt)" }];
}

function assertOrdinaryDirectory(path: string, code: string): void {
  if (!existsSync(path) || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) {
    throw new Error(`${code}: expected a real directory (not a symlink): ${path}`);
  }
}

function readPayloadIdentity(sourceDir: string): { version: string } {
  assertOrdinaryDirectory(sourceDir, "UNI_PAYLOAD_INVALID");
  const manifestPath = join(sourceDir, "package.json");
  if (!existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink()) {
    throw new Error(`UNI_PAYLOAD_INVALID: missing ordinary package.json: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown; version?: unknown };
  if (manifest.name !== PACKAGE_NAME || typeof manifest.version !== "string") {
    throw new Error(`UNI_PAYLOAD_IDENTITY_INVALID: expected ${PACKAGE_NAME} with a string version.`);
  }
  return { version: manifest.version };
}

export async function status(options: { projectPath: string; receiptDir?: string; sourceDir?: string }): Promise<StatusResult> {
  const packageDir = installedPackageDir(options.projectPath);
  const receiptPath = receiptPathFor(options.projectPath, options.receiptDir);
  if (!existsSync(packageDir)) return { installed: false, receiptPath, modified: false };
  if (lstatSync(packageDir).isSymbolicLink() || !lstatSync(packageDir).isDirectory()) {
    return { installed: true, packageDir, receiptPath, modified: true, mismatches: [{ kind: "extra", path: "(non-directory-or-symlink-package)" }] };
  }
  const mismatches = await mismatchesFor(packageDir, readReceipt(receiptPath), options.sourceDir);
  return { installed: true, packageDir, receiptPath, modified: mismatches.length > 0, fileCount: countFiles(packageDir), mismatches };
}

export async function installPackage(options: InstallOptions): Promise<InstallResult> {
  const { projectPath, sourceDir, force = false, dryRun = false } = options;
  assertOrdinaryDirectory(projectPath, "UNI_PROJECT_INVALID");
  assertOrdinaryDirectory(join(projectPath, "Packages"), "UNI_PROJECT_PACKAGES_MISSING");
  const identity = readPayloadIdentity(sourceDir);
  const packageDir = installedPackageDir(projectPath);
  const receiptDir = receiptDirFor(projectPath, options.receiptDir);
  const receiptPath = receiptPathFor(projectPath, options.receiptDir);
  const sourceHashes = await sha256Tree(sourceDir, options.readdirImpl);
  if (sourceHashes.size === 0) throw new Error("UNI_PAYLOAD_EMPTY: embedded Unity package has no files.");
  const receipt: Receipt = {
    schemaVersion: 1, packageName: PACKAGE_NAME, packageVersion: identity.version,
    packageDir, files: Object.fromEntries(sourceHashes),
  };

  if (existsSync(packageDir)) {
    if (lstatSync(packageDir).isSymbolicLink() || !lstatSync(packageDir).isDirectory()) {
      throw new Error(`UNI_PACKAGE_PATH_UNSAFE: installed package path is not an ordinary directory: ${packageDir}`);
    }
    const previous = readReceipt(receiptPath);
    const payloadDifferences = await compareTree(packageDir, sourceHashes);
    if (payloadDifferences.length === 0) {
      if (!dryRun && (!previous || previous.packageVersion !== identity.version || previous.packageDir !== packageDir ||
          Object.keys(previous.files).length !== sourceHashes.size ||
          [...sourceHashes].some(([path, hash]) => previous.files[path] !== hash))) {
        mkdirSync(receiptDir, { recursive: true });
        atomicWriteFile(receiptPath, JSON.stringify(receipt, null, 2));
      }
      return { status: "AlreadyInstalled", projectPath, packageName: PACKAGE_NAME, packageDir, fileCount: sourceHashes.size, receiptPath };
    }
    const mismatches = previous ? await mismatchesFor(packageDir, previous) : await isPublishedTree(packageDir) ? [] : payloadDifferences;
    if (mismatches.length && !force) {
      const detail = mismatches.slice(0, 5).map((m) => `${m.kind}:${m.path}`).join(", ");
      throw new Error(`UNI_MODIFIED: installed package was modified since install (${detail}). Use --force to replace.`);
    }
  }

  if (dryRun) {
    return { status: "DryRun", projectPath, packageName: PACKAGE_NAME, packageDir, fileCount: sourceHashes.size, receiptPath, dryRun: true };
  }

  const nonce = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const stagingDir = join(dirname(packageDir), `.${PACKAGE_NAME}.staging-${nonce}`);
  const backupDir = join(dirname(packageDir), `.${PACKAGE_NAME}.backup-${nonce}`);
  const previousReceipt = existsSync(receiptPath) ? readFileSync(receiptPath) : undefined;
  let oldMoved = false;
  let newInstalled = false;
  try {
    cpSync(sourceDir, stagingDir, { recursive: true, errorOnExist: true });
    await compareTree(stagingDir, sourceHashes).then((mismatches) => {
      if (mismatches.length > 0) throw new Error(`UNI_STAGE_INTEGRITY_FAILED: ${mismatches[0]!.kind}:${mismatches[0]!.path}`);
    });
    if (existsSync(packageDir)) {
      renameSync(packageDir, backupDir);
      oldMoved = true;
    }
    renameSync(stagingDir, packageDir);
    newInstalled = true;
    mkdirSync(receiptDir, { recursive: true });
    atomicWriteFile(receiptPath, JSON.stringify(receipt, null, 2));
    if (oldMoved) rmSync(backupDir, { recursive: true, force: true });
    return { status: "Installed", projectPath, packageName: PACKAGE_NAME, packageDir, fileCount: sourceHashes.size, receiptPath };
  } catch (error) {
    if (newInstalled && existsSync(packageDir)) rmSync(packageDir, { recursive: true, force: true });
    if (oldMoved && existsSync(backupDir) && !existsSync(packageDir)) renameSync(backupDir, packageDir);
    if (previousReceipt) atomicWriteFile(receiptPath, previousReceipt);
    else if (existsSync(receiptPath)) rmSync(receiptPath, { force: true });
    throw error;
  } finally {
    if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
  }
}

export async function uninstallPackage(options: { projectPath: string; dryRun?: boolean; force?: boolean; receiptDir?: string; sourceDir?: string }): Promise<UninstallResult> {
  const packageDir = installedPackageDir(options.projectPath);
  const receiptPath = receiptPathFor(options.projectPath, options.receiptDir);
  if (!existsSync(packageDir)) return { status: "NotInstalled", projectPath: options.projectPath, packageDir, receiptPath };
  if (lstatSync(packageDir).isSymbolicLink() || !lstatSync(packageDir).isDirectory()) {
    if (!options.force) return { status: "ModifiedRejected", projectPath: options.projectPath, packageDir, receiptPath };
  } else {
    const mismatches = await mismatchesFor(packageDir, readReceipt(receiptPath), options.sourceDir);
    if (mismatches.length > 0 && !options.force) return { status: "ModifiedRejected", projectPath: options.projectPath, packageDir, receiptPath };
  }
  if (options.dryRun) return { status: "DryRun", projectPath: options.projectPath, packageDir, receiptPath };

  const backupDir = `${packageDir}.uninstall-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const previousReceipt = existsSync(receiptPath) ? readFileSync(receiptPath) : undefined;
  try {
    renameSync(packageDir, backupDir);
    if (existsSync(receiptPath)) rmSync(receiptPath, { force: true });
    rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (existsSync(backupDir) && !existsSync(packageDir)) renameSync(backupDir, packageDir);
    if (previousReceipt) atomicWriteFile(receiptPath, previousReceipt);
    throw error;
  }
  return { status: "Uninstalled", projectPath: options.projectPath, packageDir, receiptPath };
}

export function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) stack.push(join(current, entry.name));
      else if (entry.isFile()) count++;
      else throw new Error(`UNI_PAYLOAD_NON_REGULAR_ENTRY: ${join(current, entry.name)}`);
    }
  }
  return count;
}
