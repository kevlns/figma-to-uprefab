// Package install smoke test: npm pack -> install into an isolated temp dir ->
// verify the bin runs (`--version` / `--help`) and the package is installable.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function extractJsonArray(text) {
  const clean = stripAnsi(text);
  const lines = clean.split("\n");
  const start = lines.findIndex((line) => line.trimStart().startsWith("["));
  if (start < 0) {
    throw new Error(`npm pack --json 未输出 JSON 数组:\n${clean.slice(0, 500)}`);
  }

  return JSON.parse(lines.slice(start).join("\n"))[0];
}

function run() {
  const dir = mkdtempSync(join(tmpdir(), "ftu-pkg-install-"));
  try {
    const cli = process.env.npm_execpath;
    if (!cli) throw new Error("缺少 npm_execpath；请通过 npm run test:package 执行");
    const packOut = execFileSync(process.execPath, [cli, "pack", "--json", "--pack-destination", dir], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    const packed = extractJsonArray(packOut);
    const tgz = packed.filename;

    // Install into the temp dir as the consumer package.
    execFileSync(process.execPath, [cli, "init", "-y"], { cwd: dir, encoding: "utf8", windowsHide: true });
    execFileSync(process.execPath, [cli, "install", "--no-save", join(dir, tgz)], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
    });

    const pkgJson = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const dep = pkgJson.dependencies?.["@kevlns/figma-to-uprefab"];
    // --no-save keeps node_modules but not package.json; verify the installed
    // tree instead, and accept either recording style.
    const installed = readFileSync(join(dir, "node_modules", "@kevlns", "figma-to-uprefab", "package.json"), "utf8");
    if (!dep && !installed.includes("\"@kevlns/figma-to-uprefab\"")) {
      throw new Error("package was not installed into node_modules");
    }

    // Bin smoke: run the installed cli.mjs directly via node (Windows .bin
    // shims are .cmd wrappers that are awkward to spawn by path).
    const cliPath = join(dir, "node_modules", "@kevlns", "figma-to-uprefab", "dist", "cli.mjs");
    const versionOut = execFileSync(process.execPath, [cliPath, "--version"], { encoding: "utf8", windowsHide: true }).trim();
    const helpOut = execFileSync(process.execPath, [cliPath, "--help"], { encoding: "utf8", windowsHide: true });
    if (versionOut !== "0.1.2") throw new Error(`bin --version 输出异常: ${versionOut}`);
    if (!helpOut.includes("export") || !helpOut.includes("contract")) throw new Error("bin --help 缺少关键命令");

    console.log(`test:package passed: installed ${tgz}, bin version ${versionOut}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

run();
