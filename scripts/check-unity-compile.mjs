#!/usr/bin/env node
/**
 * Compile-check the embedded Unity Editor C# payload against a real Unity
 * installation + Vant.Framework.dll. This is a verification gate (not used by
 * `npm run check` in CI because it requires a Unity install and a Vant Client
 * checkout); run it manually before release.
 *
 * Usage:
 *   node scripts/check-unity-compile.mjs [--unity-root <dir>] [--vant-dll <path>]
 *
 * It locates:
 *   - Unity Editor Data/Managed + NetStandard/ref/2.1.0 under --unity-root
 *     (or a Hub install matching the Client ProjectVersion, or the default path)
 *   - Vant.Framework.dll from the Client Library/ScriptAssemblies (or --vant-dll)
 *   - Unity.TextMeshPro.dll / UnityEngine.UI.dll / UnityEditor.UI.dll from the
 *     same Client Library/ScriptAssemblies
 *
 * Exit code 0 => the payload compiles; non-zero => compile errors.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD = join(
  PKG_ROOT,
  "unity-package",
  "Packages",
  "com.kevlns.figma-to-uprefab",
  "Editor",
  "FigmaPrefab",
);
const DEFAULT_VANT_CLIENT = process.env.VANT_CLIENT ?? "C:/Projects/vant-agent/Client";

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
}

function findCsc() {
  const candidates = [
    "C:/Program Files/dotnet/sdk",
    `${process.env.ProgramFiles}\\dotnet\\sdk`,
    `${process.env.LOCALAPPDATA}\\Microsoft\\dotnet\\sdk`,
    `${homedir().split(sep)[0]}/Program Files/dotnet/sdk`,
  ];
  for (const base of candidates) {
    if (!existsSync(base)) continue;
    for (const version of readdirSync(base)) {
      const csc = join(base, version, "Roslyn", "bincore", "csc.dll");
      if (existsSync(csc)) return csc;
    }
  }
  throw new Error("csc.dll not found under any dotnet SDK path.");
}

function resolveUnityRoot() {
  const explicit = argValue("--unity-root");
  if (explicit) return explicit;
  const hub = process.env.ProgramFiles
    ? join(process.env.ProgramFiles, "Unity", "Hub", "Editor")
    : undefined;
  const clientVersion = existsSync(join(DEFAULT_VANT_CLIENT, "ProjectSettings", "ProjectVersion.txt"))
    ? readFileSync(join(DEFAULT_VANT_CLIENT, "ProjectSettings", "ProjectVersion.txt"), "utf8")
        .match(/m_EditorVersion:\s*([^\r\n]+)/)?.[1]
        ?.trim()
    : undefined;
  if (clientVersion && hub && existsSync(join(hub, clientVersion))) {
    return join(hub, clientVersion);
  }
  if (hub) {
    const dirs = readdirSync(hub).sort().reverse();
    if (dirs[0]) return join(hub, dirs[0]);
  }
  throw new Error("Could not resolve a Unity Editor root. Pass --unity-root.");
}

function collectRefs(unityRoot, vantClient) {
  const refs = [];
  const managed = join(unityRoot, "Editor", "Data", "Managed");
  const engine = join(managed, "UnityEngine");
  for (const dll of [
    "UnityEngine.dll",
    "UnityEngine.CoreModule.dll",
    "UnityEngine.UIModule.dll",
    "UnityEngine.IMGUIModule.dll",
    "UnityEngine.TextRenderingModule.dll",
    "UnityEngine.AudioModule.dll",
    "UnityEngine.InputLegacyModule.dll",
  ]) {
    const p = join(engine, dll);
    if (existsSync(p)) refs.push(p);
  }
  refs.push(join(managed, "UnityEditor.dll"));
  refs.push(join(managed, "Newtonsoft.Json.dll"));
  const sa = join(vantClient, "Library", "ScriptAssemblies");
  refs.push(join(sa, "Unity.TextMeshPro.dll"));
  refs.push(join(sa, "UnityEngine.UI.dll"));
  refs.push(join(sa, "UnityEditor.UI.dll"));
  refs.push(join(sa, "Vant.Framework.dll"));
  const ns = join(unityRoot, "Editor", "Data", "NetStandard", "ref", "2.1.0");
  for (const f of ["netstandard.dll", "mscorlib.dll", "System.Runtime.dll", "System.Collections.dll", "System.IO.dll", "System.Text.RegularExpressions.dll", "System.Linq.dll"]) {
    const p = join(ns, f);
    if (existsSync(p)) refs.push(p);
  }
  return refs;
}

async function main() {
  const unityRoot = resolveUnityRoot();
  const vantClient = process.env.VANT_CLIENT ?? DEFAULT_VANT_CLIENT;
  const explicitVantDll = argValue("--vant-dll");
  const sa = explicitVantDll ? dirname(explicitVantDll) : join(vantClient, "Library", "ScriptAssemblies");
  const vantDll = explicitVantDll ?? join(sa, "Vant.Framework.dll");
  for (const required of [vantDll, join(sa, "Unity.TextMeshPro.dll"), join(sa, "UnityEngine.UI.dll"), join(sa, "UnityEditor.UI.dll")]) {
    if (!existsSync(required)) throw new Error(`Missing reference: ${required}`);
  }

  const csc = findCsc();
  const refs = collectRefs(unityRoot, vantClient).filter((p) => existsSync(p));
  const outDir = join(process.env.TEMP ?? "/tmp", "ftu-cscompile");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const out = join(outDir, "out.dll");
  const sources = [];
  for (const name of readdirSync(PAYLOAD)) {
    if (name.endsWith(".cs")) sources.push(join(PAYLOAD, name));
  }

  const args = [
    "-nologo",
    "-nostdlib+",
    "-target:library",
    `-out:${out}`,
    "-langversion:9.0",
    "-nullable:disable",
    ...refs.flatMap((r) => ["-r:" + r]),
    ...sources,
  ];
  const output = execFileSync("dotnet", [csc, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write(output);
  if (!existsSync(out)) throw new Error("C# payload did not compile (no output DLL).");
  console.log(`\n[check-unity-compile] PASS: ${sources.length} file(s) compiled against Unity ${unityRoot.split(/[\\/]/).pop()} + Vant.Framework.dll`);
}

main().catch((err) => {
  console.error(`[check-unity-compile] FAIL: ${err.message}`);
  process.exitCode = 1;
});
