/**
 * Path safety + atomic file publication.
 *
 * - `assertInsideBase` rejects any resolved path that escapes its base
 *   (defense against traversal from untrusted names / fixtures).
 * - `atomicWriteFile` writes to a sibling temp file then renames, so readers
 *   never observe a half-written JSON document.
 * - `forwardSlash` normalizes Windows separators for canonical paths that are
 *   stored in manifests (Unity-friendly "Assets/..." form).
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize, relative, resolve, sep } from "node:path";

/**
 * Throw PAT_TRAVERSAL unless `target` resolves inside `base`. The default
 * throws a plain Error with the PAT_TRAVERSAL marker so tests can assert the
 * code while callers choose how to surface it.
 */
export function assertInsideBase(base: string, target: string, label = "path"): void {
  const baseResolved = resolve(base);
  const targetResolved = resolve(target);
  const rel = relative(baseResolved, targetResolved);
  if (rel === "") {
    return;
  }

  if (rel === ".." || rel.startsWith(".." + sep)) {
    throw new Error(`PAT_TRAVERSAL: ${label} escapes base directory: ${target}`);
  }
}

/**
 * Join a root with a forward-slash relative path and assert the result stays
 * inside the root. `rel` must not contain absolute or `..` segments.
 */
export function safeJoin(base: string, relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`PAT_TRAVERSAL: absolute path rejected: ${relPath}`);
  }

  const parts = normalized.split("/");
  for (const part of parts) {
    if (part === "..") {
      throw new Error(`PAT_TRAVERSAL: '..' segment rejected: ${relPath}`);
    }
  }

  const target = join(base, normalized);
  assertInsideBase(base, target, relPath);
  return target;
}

/** Normalize to forward slashes (for manifest paths / index entries). */
export function forwardSlash(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Create parent directories for a file path if missing. */
export function ensureDirFor(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

/**
 * Atomically publish `content` to `filePath`: write temp in the same
 * directory, then rename over the target. The temp file is removed on failure.
 */
export function atomicWriteFile(filePath: string, content: string | Uint8Array, encoding: BufferEncoding = "utf8"): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const suffix = randomBytes(6).toString("hex");
  const tmp = join(dir, `.${basename(filePath)}.${suffix}.tmp`);
  try {
    if (typeof content === "string") writeFileSync(tmp, content, encoding);
    else writeFileSync(tmp, content);
    renameSync(tmp, filePath);
  } catch (error) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best effort cleanup */
    }
    throw error;
  }
}

/** Normalize `path` into a Unity-relative asset path (forward slashes, no leading slash). */
export function toAssetPath(path: string): string {
  return forwardSlash(normalize(path)).replace(/^\/+/, "");
}
