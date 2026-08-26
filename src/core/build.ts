/**
 * Build orchestration (request/report protocol with the C# converter).
 *
 * Node writes a request JSON, runs Unity in batch mode (the embedded Editor
 * package's parameterless entrypoint reads the request and writes a report),
 * then reads the report. Node never converts source -> IR itself; the C#
 * package is the only converter.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic.js";
import { errors } from "./errors.js";
import { invokeUnityBatch, resolveEditorPath, runningUnityProcesses } from "./unity.js";

export interface BuildRequest {
  schemaVersion: 1;
  mode: "convert-and-build";
  rootIndexPath: string;
  configPath?: string;
  /** Optional overlay file suffix inside each root's Meta/ dir. */
  overlaySuffix?: string;
}

export interface BuildReportEntry {
  figmaNodeId?: string;
  prefabName?: string;
  errorCode?: string;
  errorMessage?: string;
  conversion?: unknown;
  build?: unknown;
}

export interface BuildReport {
  schemaVersion: 1;
  status: "ok" | "error";
  entries: BuildReportEntry[];
  issues: Array<{ code: string; message: string }>;
}

export interface BuildOrchestrationOptions {
  projectPath: string;
  editorPath?: string;
  rootIndexPath: string;
  configPath?: string;
  allowRunningEditor?: boolean;
  /** Library/figma-to-uprefab dir override for tests. */
  workDir?: string;
  /** Skip actually spawning Unity; return a canned report (tests). */
  fakeReport?: BuildReport;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

export function buildWorkDir(projectPath: string, workDir?: string): string {
  return workDir ?? join(projectPath, "Library", "figma-to-uprefab");
}

export function requestPathFor(workDir: string): string {
  return join(workDir, "request.json");
}

export function reportPathFor(workDir: string): string {
  return join(workDir, "report.json");
}

export function writeBuildRequest(workDir: string, request: BuildRequest): string {
  const path = requestPathFor(workDir);
  mkdirSync(workDir, { recursive: true });
  atomicWriteFile(path, JSON.stringify(request, null, 2));
  return path;
}

export function readBuildReport(workDir: string): BuildReport {
  const path = reportPathFor(workDir);
  if (!existsSync(path)) throw new Error(`BLD_REPORT_MISSING: Unity did not produce a report at ${path}`);
  const report = JSON.parse(readFileSync(path, "utf8")) as Partial<BuildReport>;
  if (report.schemaVersion !== 1 || (report.status !== "ok" && report.status !== "error") || !Array.isArray(report.entries) || !Array.isArray(report.issues)) {
    throw new Error(`BLD_REPORT_INVALID: Unity produced an invalid report at ${path}`);
  }
  return report as BuildReport;
}

export async function orchestrateBuild(options: BuildOrchestrationOptions): Promise<BuildReport> {
  const workDir = buildWorkDir(options.projectPath, options.workDir);
  const request: BuildRequest = {
    schemaVersion: 1,
    mode: "convert-and-build",
    rootIndexPath: options.rootIndexPath,
    configPath: options.configPath,
    overlaySuffix: ".approximation.json",
  };

  writeBuildRequest(workDir, request);
  const staleReport = reportPathFor(workDir);
  if (existsSync(staleReport)) rmSync(staleReport, { force: true });

  if (options.fakeReport) {
    return options.fakeReport;
  }

  const editorPath = resolveEditorPath(options.projectPath, options.editorPath);
  if (!existsSync(editorPath)) {
    throw errors.unityNotFound(editorPath);
  }

  if (!options.allowRunningEditor) {
    const running = runningUnityProcesses();
    if (running.queryFailed) throw new Error("UNI_PROCESS_QUERY_FAILED: could not verify whether Unity is running.");
    if (running.processes.length > 0) throw errors.unityRunning();
  }

  const result = await invokeUnityBatch({
    editorPath,
    projectPath: options.projectPath,
    allowRunningEditor: options.allowRunningEditor,
    extraArgs: [
      "-executeMethod",
      "Kevlns.Editor.FigmaToUprefab.FigmaPrefabCliBatch.Run",
      "-logFile",
      join(workDir, "unity-batch.log"),
    ],
    onStdout: options.onStdout,
    onStderr: options.onStderr,
  });

  if (result.timedOut) {
    throw new Error("BLD_TIMEOUT: Unity batch build timed out.");
  }

  if (result.exitCode !== 0) {
    const report = safeReadReport(workDir);
    if (report && report.status === "error") {
      return report;
    }

    throw new Error(`BLD_UNITY_FAILED: Unity batch exited with code ${result.exitCode}. See ${join(workDir, "unity-batch.log")}.`);
  }

  return readBuildReport(workDir);
}

function safeReadReport(workDir: string): BuildReport | undefined {
  try {
    return readBuildReport(workDir);
  } catch {
    return undefined;
  }
}
