/**
 * Agent documentation. AGENTS.md at the package root is the canonical agent
 * spec ("正本"); `agent docs` reads it from the package and can emit it to
 * stdout or a target path. The CLI never installs skills; it only surfaces
 * documentation.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = dirname(fileURLToPath(import.meta.url));

/** Locate the canonical AGENTS.md by walking up from the module. */
export function agentsDocPath(): string {
  const explicit = process.env.FIGMA_TO_UPREFAB_AGENTS;
  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  let dir = thisDir;
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(dir, "AGENTS.md");
    if (existsSync(candidate)) {
      return candidate;
    }

    dir = join(dir, "..");
  }

  throw new Error("DOC_AGENTS_MISSING: AGENTS.md was not found in the package.");
}

export function agentsDocContent(): string {
  return readFileSync(agentsDocPath(), "utf8");
}
