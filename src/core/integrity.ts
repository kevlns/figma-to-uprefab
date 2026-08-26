/**
 * Directory integrity: compute a recursive SHA-256 tree so install receipts
 * can detect any modification to the installed Unity package. Symlinks and
 * other non-regular entries are rejected (fail-closed).
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync as ReaddirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join, relative } from "node:path";

export type ReaddirImpl = typeof ReaddirSync;

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(file);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }

  return hash.digest("hex");
}

export type EntryKind = "dir" | "file" | "other";

export function entryKind(entry: Dirent): EntryKind {
  if (entry.isDirectory()) {
    return "dir";
  }

  if (entry.isFile()) {
    return "file";
  }

  return "other";
}

/** Walk `root` and return {relPath(forward slash): sha256} for every file. */
export async function sha256Tree(
  root: string,
  readdirImpl: ReaddirImpl = ReaddirSync,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!exists(root)) {
    return result;
  }

  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirImpl(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).split("\\").join("/");
      const kind = entryKind(entry);
      if (kind === "dir") {
        stack.push(abs);
      } else if (kind === "file") {
        result.set(rel, await sha256File(abs));
      } else {
        throw new Error(`Integrity check rejects non-regular entry: ${rel}`);
      }
    }
  }

  return result;
}

function exists(path: string): boolean {
  return existsSync(path);
}

export interface TreeMismatch {
  kind: "missing" | "extra" | "hash";
  path: string;
}

/** Two-way comparison: expected entries must match exactly; extras rejected. */
export async function compareTree(root: string, expected: Map<string, string>): Promise<TreeMismatch[]> {
  const actual = await sha256Tree(root);
  const mismatches: TreeMismatch[] = [];
  for (const [rel, expectedHash] of expected) {
    const actualHash = actual.get(rel);
    if (actualHash === undefined) {
      mismatches.push({ kind: "missing", path: rel });
    } else if (actualHash !== expectedHash) {
      mismatches.push({ kind: "hash", path: rel });
    }
  }

  for (const rel of actual.keys()) {
    if (!expected.has(rel)) {
      mismatches.push({ kind: "extra", path: rel });
    }
  }

  return mismatches;
}
