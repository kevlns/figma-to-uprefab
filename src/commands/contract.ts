/**
 * `contract`: validate the canonical staging layout (root index + source
 * manifests + IR + overlays). Read-only; no Unity side effects.
 */

import { join } from "node:path";
import { validateContract } from "../contract/contract.js";
import { readConfig } from "../core/config.js";

export interface ContractCommandOptions {
  projectPath?: string;
  configPath?: string;
  indexPath?: string;
  allowMissingIr?: boolean;
}

export function contractCommand(options: ContractCommandOptions): {
  valid: boolean;
  rootsChecked: number;
  issues: Array<{ code: string; message: string; path?: string }>;
} {
  const resolved = readConfig(options.projectPath, options.configPath);
  const projectPath = resolved.effective.projectPath;
  const stagingRoot = resolved.effective.stagingRoot.replace(/[\\/]+$/, "");
  const indexPath = options.indexPath ?? `${stagingRoot}/figma-roots.index.json`;

  const result = validateContract({
    projectPath,
    indexPath,
    allowMissingIr: options.allowMissingIr,
  });

  return { valid: result.valid, rootsChecked: result.rootsChecked, issues: result.issues };
}

export function defaultIndexPath(stagingRoot: string): string {
  return join(stagingRoot, "figma-roots.index.json").replace(/\\/g, "/");
}
