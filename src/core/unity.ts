/**
 * Unity detection + batch orchestration support.
 *   - resolve the Unity Editor executable (config editorPath or Hub discovery
 *     via ProjectSettings/ProjectVersion.txt)
 *   - detect running Unity processes (fail-closed guard for build)
 *   - never fabricates a compile result: batch exit + report JSON are the only
 *     sources of truth for build outcomes
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { errors } from "./errors.js";

const HUB_ROOT_CANDIDATES = [
  process.env.ProgramFiles ? join(process.env.ProgramFiles, "Unity", "Hub", "Editor") : undefined,
  process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "Unity", "Hub", "Editor") : undefined,
  join(process.env.LOCALAPPDATA ?? "", "Programs", "Unity", "Hub", "Editor"),
].filter((p): p is string => Boolean(p));

export function projectVersionOf(projectPath: string): string | undefined {
  const versionFile = join(projectPath, "ProjectSettings", "ProjectVersion.txt");
  if (!existsSync(versionFile)) {
    return undefined;
  }

  const match = /m_EditorVersion:\s*([^\r\n]+)/.exec(readFileSync(versionFile, "utf8"));
  return match?.[1]?.trim();
}

/** Resolve an explicit editor path, or discover via Hub + ProjectVersion. */
export function resolveEditorPath(projectPath: string, editorPath?: string): string {
  if (editorPath) {
    return editorPath;
  }

  const version = projectVersionOf(projectPath);
  if (!version) {
    throw errors.unityNotFound("(unresolved: no ProjectSettings/ProjectVersion.txt)");
  }

  for (const hubRoot of HUB_ROOT_CANDIDATES) {
    const candidate = join(hubRoot, version, "Editor", "Unity.exe");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw errors.unityNotFound(`(Hub candidates for ${version} not found)`);
}

export interface UnityProcessInfo {
  id: number;
  name: string;
}

/**
 * Detect running Unity processes. Windows-first: uses PowerShell Get-Process.
 * A failed query is reported as `queryFailed` rather than fatal.
 */
export function runningUnityProcesses(): { processes: UnityProcessInfo[]; queryFailed: boolean } {
  if (process.platform !== "win32") {
    return { processes: [], queryFailed: false };
  }

  try {
    const ps = `Get-Process Unity -ErrorAction SilentlyContinue | Select-Object Id, ProcessName | ConvertTo-Json -Compress`;
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    }).trim();
    if (!out) {
      return { processes: [], queryFailed: false };
    }

    const parsed = JSON.parse(out) as UnityProcessInfo | UnityProcessInfo[];
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return { processes: list, queryFailed: false };
  } catch {
    return { processes: [], queryFailed: true };
  }
}

export interface UnityStatus {
  projectPath: string;
  editorVersion?: string;
  editorPath?: string;
  editorExists: boolean;
  packageInstalled: boolean;
  running: boolean;
  runningQueryFailed: boolean;
}

export function unityStatus(opts: {
  projectPath: string;
  editorPath?: string;
  packageInstalled: boolean;
}): UnityStatus {
  const version = projectVersionOf(opts.projectPath);
  let editorPath: string | undefined;
  let editorExists = false;
  try {
    editorPath = resolveEditorPath(opts.projectPath, opts.editorPath);
    editorExists = existsSync(editorPath);
  } catch {
    editorPath = opts.editorPath;
  }

  const running = runningUnityProcesses();
  return {
    projectPath: opts.projectPath,
    editorVersion: version,
    editorPath,
    editorExists,
    packageInstalled: opts.packageInstalled,
    running: running.processes.length > 0,
    runningQueryFailed: running.queryFailed,
  };
}

export interface BatchInvokeOptions {
  editorPath: string;
  projectPath: string;
  allowRunningEditor?: boolean;
  timeoutMs?: number;
  extraArgs?: string[];
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

export interface BatchInvokeResult {
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run Unity in batch mode. Fail-closed: if Unity is running and
 * allowRunningEditor is not set, we refuse to start a second instance.
 */
export async function invokeUnityBatch(options: BatchInvokeOptions): Promise<BatchInvokeResult> {
  if (!allowRunningEditor(options)) {
    const running = runningUnityProcesses();
    if (running.queryFailed) throw new Error("UNI_PROCESS_QUERY_FAILED: could not verify whether Unity is running.");
    if (running.processes.length > 0) throw errors.unityRunning();
  }

  return new Promise((resolve, reject) => {
    const args = [
      "-batchmode",
      "-nographics",
      "-projectPath",
      options.projectPath,
      "-quit",
      ...(options.extraArgs ?? []),
    ];
    const child = spawn(options.editorPath, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ exitCode: -1, timedOut: true, stdout, stderr });
    }, options.timeoutMs ?? 10 * 60 * 1000);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 0, timedOut: false, stdout, stderr });
    });
  });
}

function allowRunningEditor(options: BatchInvokeOptions): boolean {
  return options.allowRunningEditor === true;
}
