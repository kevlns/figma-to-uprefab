/**
 * @kevlns/figma-to-uprefab CLI entrypoint.
 *
 * The executable shebang is injected by tsup's banner at build time.
 */

import { Command } from "commander";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { CliError } from "./core/errors.js";
import { Logger } from "./core/logger.js";
import { collectUserConfigSecrets } from "./core/config.js";
import { Redactor } from "./core/redact.js";
import { agentsDocContent } from "./core/agent-docs.js";
import { VERSION } from "./version.js";
import {
  configInit,
  configMigrate,
  configValidate,
  setupCommand,
} from "./commands/config.js";
import { exportCommand } from "./commands/export.js";
import { contractCommand } from "./commands/contract.js";
import { doctorCommand } from "./commands/doctor.js";
import { agentDocsCommand } from "./commands/agent-docs.js";
import {
  unityInstallCommand,
  unityStatusCommand,
  unityUninstallCommand,
} from "./commands/unity.js";
import { buildCommand } from "./commands/build.js";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("figma-to-uprefab")
    .description("Figma REST -> staging-only Unity UGUI prefabs (Node orchestration + embedded Unity Editor converter)")
    .version(VERSION)
    .option("--json", "输出结构化完成回执。");

  function emit(result: unknown): boolean {
    if (!program.opts().json) return false;
    const r = result as Record<string, unknown>;
    const failed = r.valid === false || r.status === "ModifiedRejected" || r.configValid === false || (Array.isArray(r.checks) && r.checks.some((c: unknown) => typeof c === "object" && c !== null && "ok" in c && c.ok === false));
    process.stdout.write(redactor.redact(JSON.stringify(result)) + "\n");
    if (failed) process.exitCode = 1;
    return true;
  }

  program
    .command("setup <project>")
    .description("Add the project's section to the user config (~/.config/figma-to-uprefab/config.json).")
    .option("--config <path>", "用户配置的明确路径。")
    .option("-f, --force", "覆盖已有工程配置。")
    .action(async (project: string, opts: { config?: string; force?: boolean }) => {
      const result = setupCommand({ projectPath: project, configPath: opts.config, force: opts.force });
      if (emit(result)) return;
      log(`User config project section ${result.created ? "created" : "already exists"} [${result.projectKey}]: ${result.configPath}`);
    });

  program
    .command("config")
    .description("Manage the user config (~/.config/figma-to-uprefab/config.json) and its per-project sections.")
    .argument("<action>", "init | validate | migrate")
    .option("--project <path>", "Unity 工程路径。")
    .option("--config <path>", "用户配置的明确路径。")
    .option("-f, --force", "overwrite an existing project section (init/migrate)")
    .action(async (action: string, opts: { project?: string; config?: string; force?: boolean }) => {
      if (action === "init") {
        const project = opts.project ?? process.cwd();
        const result = configInit({ projectPath: project, configPath: opts.config, force: opts.force });
      if (emit(result)) return;
        log(`User config project section ${result.created ? "created" : "already exists"} [${result.projectKey}]: ${result.configPath}`);
        return;
      }

      if (action === "validate") {
        const result = configValidate({ projectPath: opts.project, configPath: opts.config });
      if (emit(result)) return;
        if (result.valid) {
          log(`Config valid: ${result.configPath}`);
          return;
        }

        for (const issue of result.issues) {
          logError(`config invalid: ${issue.path} ${issue.message}`);
        }

        process.exitCode = 1;
        return;
      }

      if (action === "migrate") {
        const project = opts.project ?? process.cwd();
        const result = configMigrate({ projectPath: project, configPath: opts.config, force: opts.force });
      if (emit(result)) return;
        log(`migrated project section '${result.projectKey}' into ${result.configPath}`);
        for (const renamed of result.renamedLegacy) {
          log(`renamed legacy config: ${renamed}`);
        }

        return;
      }

      throw new CliError("CFG_ACTION_UNKNOWN", `Unknown config action: ${action}`);
    });

  program
    .command("export <fileKey>")
    .description("Export Figma source manifests + node PNGs + root index into staging (no Unity side effects).")
    .option("--project <path>", "Unity 工程路径。")
    .option("--config <path>", "用户配置的明确路径。")
    .option("--discovery-document <path>", "测试输入：已捕获的 GET /v1/files/:key 响应。")
    .option("--node-documents <dir>", "测试输入：从 <safe-id>.json 读取节点文档。")
    .option("--discovery-only", "discover and validate roots without fetching node docs or images")
    .option("--image-scale <n>", "图片导出倍率，范围 0.01–4.0。", parseFloat)
    .action(async (fileKey: string, opts: { project?: string; config?: string; discoveryDocument?: string; nodeDocuments?: string; discoveryOnly?: boolean; imageScale?: number }) => {
      const result = await exportCommand({
        fileKey,
        projectPath: opts.project,
        configPath: opts.config,
        discoveryDocumentPath: opts.discoveryDocument,
        nodeDocumentDirectory: opts.nodeDocuments,
        discoveryOnly: opts.discoveryOnly,
        imageScale: opts.imageScale,
      });
      if (emit(result)) return;

      log(`Figma root discovery completed: ${result.rootCount} root(s).`);
      for (const warning of result.warnings) {
        logWarning(warning);
      }
    });

  program
    .command("contract")
    .description("Validate the canonical staging layout against schemas + invariants (read-only).")
    .option("--project <path>", "Unity 工程路径。")
    .option("--config <path>", "用户配置的明确路径。")
    .option("--index <path>", "指定根索引路径。")
    .option("--allow-missing-ir", "report missing IR as a warning instead of error")
    .action((opts: { project?: string; config?: string; index?: string; allowMissingIr?: boolean }) => {
      const result = contractCommand({
        projectPath: opts.project,
        configPath: opts.config,
        indexPath: opts.index,
        allowMissingIr: opts.allowMissingIr,
      });
      if (emit(result)) return;

      if (result.valid) {
        log(`Contract valid: ${result.rootsChecked} root(s).`);
        return;
      }

      for (const issue of result.issues) {
        logError(`contract: ${issue.code}${issue.path ? ` @ ${issue.path}` : ""}: ${issue.message}`);
      }

      process.exitCode = 1;
    });

  program
    .command("doctor")
    .description("Read-only diagnostics of config, staging, Unity, and token presence.")
    .option("--project <path>", "Unity 工程路径。")
    .option("--config <path>", "用户配置的明确路径。")
    .action(async (opts: { project?: string; config?: string }) => {
      const report = await doctorCommand({ projectPath: opts.project, configPath: opts.config });
      if (emit(report)) return;
      for (const check of report.checks) {
        log(`${check.ok ? "[ok]   " : "[FAIL] "}${check.name}: ${check.message}`);
      }

      if (!report.configValid || report.checks.some((check) => !check.ok)) {
        process.exitCode = 1;
      }
    });

  program
    .command("agent")
    .description("Agent documentation (AGENTS.md is the canonical agent spec).")
    .command("docs")
    .description("Print or export the canonical AGENTS.md agent spec.")
    .option("-o, --out <path>", "将文档写入文件。")
    .action((opts: { out?: string }) => {
      const result = agentDocsCommand({ out: opts.out });
      if (emit({...result, content: agentsDocContent()})) return;
      if (opts.out) {
        log(`Agent docs written to ${result.target} (${result.bytes} bytes).`);
      } else {
        process.stdout.write(agentsDocContent());
      }
    });

  program
    .command("unity")
    .description("Manage the embedded com.kevlns.figma-to-uprefab UPM package in the project.")
    .argument("<action>", "install | status | uninstall")
    .option("--project <path>", "Unity 工程路径。")
    .option("--config <path>", "用户配置的明确路径。")
    .option("--dry-run", "validate + preview without writing to the project")
    .option("-f, --force", "明确覆盖已有安装或修改检测结果。")
    .action(async (action: string, opts: { project?: string; config?: string; dryRun?: boolean; force?: boolean }) => {
      if (action === "install") {
        const result = await unityInstallCommand({ projectPath: opts.project, configPath: opts.config, dryRun: opts.dryRun, force: opts.force });
      if (emit(result)) return;
        log(`unity install: ${result.status} (${result.fileCount} file(s))`);
        if (result.receiptPath) {
          log(`receipt: ${result.receiptPath}`);
        }

        return;
      }

      if (action === "status") {
        const result = await unityStatusCommand({ projectPath: opts.project, configPath: opts.config });
      if (emit(result)) return;
        log(`unity status: installed=${result.installed} modified=${result.modified}`);
        if (result.packageDir) {
          log(`package: ${result.packageDir}`);
        }

        return;
      }

      if (action === "uninstall") {
        const result = await unityUninstallCommand({ projectPath: opts.project, configPath: opts.config, dryRun: opts.dryRun, force: opts.force });
      if (emit(result)) return;
        log(`unity uninstall: ${result.status}`);
        if (result.status === "ModifiedRejected") {
          logError("Refusing to uninstall a modified package without --force.");
          process.exitCode = 1;
        }

        return;
      }

      throw new CliError("UNI_ACTION_UNKNOWN", `Unknown unity action: ${action}`);
    });

  program
    .command("build")
    .description("Run the C# converter in Unity batch mode (request/report protocol).")
    .option("--project <path>", "Unity 工程路径。")
    .option("--config <path>", "用户配置的明确路径。")
    .option("--index <path>", "指定根索引路径。")
    .option("--allow-running-editor", "明确允许编辑器运行时继续操作。")
    .action(async (opts: { project?: string; config?: string; index?: string; allowRunningEditor?: boolean }) => {
      const result = await buildCommand({
        projectPath: opts.project,
        configPath: opts.config,
        indexPath: opts.index,
        allowRunningEditor: opts.allowRunningEditor,
        onStdout: (line) => (program.opts().json ? process.stderr : process.stdout).write(`[unity] ${redactor.redact(line)}`),
        onStderr: (line) => process.stderr.write(`[unity] ${redactor.redact(line)}`),
      });
      if (emit(result)) return;

      const okCount = result.report.entries.filter((entry) => !entry.errorCode).length;
      log(`build completed: ${okCount}/${result.report.entries.length} root(s) OK. Report: ${result.reportPath}`);
      if (result.report.issues.length > 0) {
        for (const issue of result.report.issues) {
          logWarning(`${issue.code}: ${issue.message}`);
        }
      }
    });

  return program;
}

const redactor = new Redactor();
redactor.addSecret(process.env.FIGMA_ACCESS_TOKEN);
try {
  for (const secret of collectUserConfigSecrets()) {
    redactor.addSecret(secret);
  }
} catch {
  /* collectUserConfigSecrets never throws, but guard the registration anyway */
}
const logger = new Logger({ level: "info", redact: (text) => redactor.redact(text) });

function log(message: string): void {
  logger.info(message);
}

function logWarning(message: string): void {
  logger.warn(message);
}

function logError(message: string): void {
  logger.error(message);
}

export async function main(argv: string[]): Promise<void> {
  const program = buildProgram();
  program.exitOverride();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CliError) {
      if (program.opts().json) { process.stdout.write(redactor.redact(JSON.stringify({ok:false,error:{code:error.code,message:error.message}}))+"\n"); process.exitCode=error.exitCode; return; }
      logError(error.message);
      if (error.details) {
        logError(error.details);
      }

      process.exitCode = error.exitCode;
      return;
    }

    if (error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string") {
      const code = (error as { code: string }).code;
      // commander's --help / --version throw under exitOverride; they already
      // printed their output and should exit 0, not be treated as failures.
      if (code.startsWith("commander.")) {
        process.exitCode = ["commander.helpDisplayed", "commander.version", "commander.help"].includes(code) ? 0 : 2;
        return;
      }

      logError(`${code}: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    logError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const entryFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(entryFile)) {
  await main(process.argv);
}
