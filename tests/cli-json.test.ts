import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("CLI 结构化回执", () => {
  it("配置初始化和文档输出完整 JSON，错误参数返回非零", () => {
    const root = mkdtempSync(join(tmpdir(), "figma-json-"));
    const env = { ...process.env, FIGMA_TO_UPREFAB_CONFIG: join(root, "config.json") };
    const call = (args: string[]) => spawnSync(process.execPath, ["dist/cli.mjs", ...args], { encoding: "utf8", env });
    try {
      const init = call(["config", "init", "--project", root, "--json"]);
      expect(init.status, init.stderr).toBe(0);
      expect(JSON.parse(init.stdout).configPath).toBe(join(root, "config.json"));
      const docs = call(["agent", "docs", "--json"]);
      expect(docs.status).toBe(0);
      expect(JSON.parse(docs.stdout).content).toContain("## 定位");
      expect(call(["config", "init", "--unknown"]).status).not.toBe(0);
      expect(call(["--help"]).status).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
