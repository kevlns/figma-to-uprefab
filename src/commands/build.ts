/**
 * `build`: orchestrate the C# converter via Unity batch mode.
 * Fail-closed on missing package install, missing receipt, or a running
 * Unity Editor. Uses the request/report protocol.
 */

import { readConfig } from "../core/config.js";
import { errors } from "../core/errors.js";
import { buildWorkDir, orchestrateBuild, type BuildReport } from "../core/build.js";
import { assertUnityPackageInstalled } from "./unity.js";
import { validateContract } from "../contract/contract.js";

export interface BuildCommandOptions {
  projectPath?: string;
  configPath?: string;
  indexPath?: string;
  allowRunningEditor?: boolean;
  /** Test injection: canned report, no Unity spawn. */
  fakeReport?: BuildReport;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

export async function buildCommand(options: BuildCommandOptions): Promise<{
  report: BuildReport;
  workDir: string;
  requestPath: string;
  reportPath: string;
}> {
  const resolved = readConfig(options.projectPath, options.configPath);
  const projectPath = resolved.effective.projectPath;
  const stagingRoot = resolved.effective.stagingRoot.replace(/[\\/]+$/, "");
  const indexPath = options.indexPath ?? `${stagingRoot}/figma-roots.index.json`;

  if (!options.fakeReport) {
    await assertUnityPackageInstalled(projectPath);
    const preflight = validateContract({ projectPath, indexPath, allowMissingIr: true });
    if (!preflight.valid) {
      const summary = preflight.issues.slice(0, 8).map((issue) => `${issue.code}: ${issue.message}`).join("; ");
      throw new Error(`BLD_CONTRACT_INVALID: ${summary}`);
    }
  }

  const workDir = buildWorkDir(projectPath);
  const report = await orchestrateBuild({
    projectPath,
    editorPath: resolved.effective.editorPath,
    rootIndexPath: indexPath,
    configPath: resolved.configPath,
    allowRunningEditor: options.allowRunningEditor,
    fakeReport: options.fakeReport,
    onStdout: options.onStdout,
    onStderr: options.onStderr,
  });

  if (report.status === "error") {
    const summary = (report.issues ?? [])
      .map((issue) => `${issue.code}: ${issue.message}`)
      .join("; ");
    throw errors.buildFailed(summary);
  }

  const reportPath = `${workDir}/report.json`;
  return { report, workDir, requestPath: `${workDir}/request.json`, reportPath };
}
