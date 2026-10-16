// npm pack content guard for @kevlns/figma-to-uprefab.
// Unlike packages that must NOT ship C#, this package SHIPS its C# Unity
// payload (unity-package/), so the guard enforces the opposite for those:
//   - must include dist/cli.mjs, schemas/, unity-package payload, v-cli.plugin.json, AGENTS.md
//   - must NOT include: *.tgz, node_modules, *.local.json, nul, .env, real secrets
// Runs a REAL `npm pack` into an isolated temp dir (never left in the repo).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

const EXPECTED_PACKAGE_NAME = "@kevlns/figma-to-uprefab";
const EXPECTED_VERSION = "0.1.3";
const EXPECTED_TGZ = `kevlns-figma-to-uprefab-${EXPECTED_VERSION}.tgz`;
const MANIFEST_PATH = "v-cli.plugin.json";
const PAYLOAD_PKG_JSON = "unity-package/Packages/com.kevlns.figma-to-uprefab/package.json";

const FORBIDDEN_EXT = new Set([".tgz", ".exe", ".dll", ".pdb"]);
const FORBIDDEN_NAMES = new Set(["nul", ".env"]);
const REQUIRED_ENTRIES = [
  "dist/cli.mjs",
  "dist/index.mjs",
  "schemas/user-config.schema.json",
  "schemas/source-manifest.schema.json",
  "schemas/root-index.schema.json",
  "schemas/approximation-overlay.schema.json",
  "schemas/ir.schema.json",
  PAYLOAD_PKG_JSON,
  "unity-package/Packages/com.kevlns.figma-to-uprefab/Editor/Kevlns.FigmaToUprefab.Editor.asmdef",
  "unity-package/Packages/com.kevlns.figma-to-uprefab/Editor/FigmaPrefab/FigmaPrefabCliBatch.cs",
  MANIFEST_PATH,
  "AGENTS.md",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "package.json",
];

function npmPackArgs(packDir) {
  const cli = process.env.npm_execpath;
  if (!cli) {
    throw new Error("缺少 npm_execpath；请通过 npm run pack:guard 执行");
  }
  return [process.execPath, [cli, "pack", "--json", "--pack-destination", packDir]];
}

function validateManifestIdentity() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (pkg.name !== EXPECTED_PACKAGE_NAME) throw new Error(`package.json name 与预期不符：${pkg.name}`);
  if (pkg.version !== EXPECTED_VERSION) throw new Error(`package.json version 与预期不符：${pkg.version}`);
  if (pkg.vCli?.manifest !== MANIFEST_PATH) throw new Error("package.json vCli.manifest 与预期不符");
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.schemaVersion !== 1) throw new Error("v-cli.plugin.json schemaVersion 与预期不符");
  if (manifest.package !== EXPECTED_PACKAGE_NAME) throw new Error("v-cli.plugin.json package 与预期不符");
  if (manifest.command !== "figma") throw new Error("v-cli.plugin.json command 与预期不符");
  if (manifest.bin !== "figma-to-uprefab") throw new Error("v-cli.plugin.json bin 与预期不符");
  const payload = JSON.parse(readFileSync(PAYLOAD_PKG_JSON, "utf8"));
  if (payload.name !== "com.kevlns.figma-to-uprefab") throw new Error("UPM payload name 与预期不符");
}

function validateEntries(entries) {
  const violations = [];
  const paths = new Set();
  for (const entry of entries) {
    const name = entry.path.split("/").pop() ?? "";
    const ext = extname(entry.path).toLowerCase();
    paths.add(entry.path);
    if (ext !== "" && FORBIDDEN_EXT.has(ext)) violations.push(`forbidden extension: ${entry.path}`);
    if (FORBIDDEN_NAMES.has(name) || FORBIDDEN_NAMES.has(entry.path)) violations.push(`forbidden file: ${entry.path}`);
    if (entry.path.includes("figma-to-uprefab.local.json")) violations.push(`forbidden local config: ${entry.path}`);
    if (/\.(env|env\.|pem|key)$/i.test(entry.path)) violations.push(`forbidden secret-ish file: ${entry.path}`);
  }
  for (const required of REQUIRED_ENTRIES) {
    if (!paths.has(required)) violations.push(`missing required entry: ${required}`);
  }
  return violations;
}

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

  const joined = lines.slice(start).join("\n");
  return JSON.parse(joined)[0];
}

function run() {
  validateManifestIdentity();
  const dir = mkdtempSync(join(tmpdir(), "ftu-pack-guard-"));
  try {
    const [packFile, packArgsFrom] = npmPackArgs(dir);
    const dryOut = execFileSync(packFile, [...packArgsFrom, "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    const dryParsed = extractJsonArray(dryOut);
    const violations = validateEntries(dryParsed.files ?? []);
    if (violations.length > 0) {
      throw new Error(`pack --dry-run 内容违规：\n${violations.join("\n")}`);
    }

    // Real tarball check.
    execFileSync(packFile, [...packArgsFrom], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    const files = readdirSync(dir);
    if (!files.includes(EXPECTED_TGZ)) {
      throw new Error(`pack 未生成预期的 tarball：${EXPECTED_TGZ} (got: ${files.join(", ")})`);
    }
    console.log(`pack:guard passed: ${EXPECTED_TGZ} (${entriesCount(dryParsed)} entries)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function entriesCount(parsed) {
  return (parsed?.files ?? []).length;
}

run();
