import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configInit, configValidate, setupCommand } from "../src/commands/config.js";
import { readConfig, loadConfigFrom } from "../src/core/config.js";
import { atomicWriteFile } from "../src/core/atomic.js";

describe("config init / validate", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ftu-config-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("init writes a schema-valid tracked config", () => {
    const result = configInit({ projectPath: dir });
    expect(result.created).toBe(true);
    expect(existsSync(result.configPath)).toBe(true);
    const validate = configValidate({ projectPath: dir });
    expect(validate.valid).toBe(true);
  });

  it("init is idempotent without force", () => {
    configInit({ projectPath: dir });
    const second = configInit({ projectPath: dir });
    expect(second.created).toBe(false);
  });

  it("setup is an alias for config init", () => {
    const result = setupCommand({ projectPath: dir });
    expect(result.created).toBe(true);
  });

  it("rejects a local overlay that smuggles a token", () => {
    configInit({ projectPath: dir });
    const localPath = join(dir, "figma-to-uprefab.local.json");
    atomicWriteFile(localPath, JSON.stringify({ schemaVersion: 1, figmaAccessToken: "nope-1234567890" }));
    expect(() => loadConfigFrom(join(dir, "figma-to-uprefab.json"))).toThrow(/TOKEN_FORBIDDEN/);
    const validate = configValidate({ projectPath: dir });
    expect(validate.valid).toBe(false);
  });

  it("readConfig merges local staging override", () => {
    configInit({ projectPath: dir });
    const localPath = join(dir, "figma-to-uprefab.local.json");
    atomicWriteFile(localPath, JSON.stringify({ schemaVersion: 1, staging: { root: "Assets/Custom/_Staging" } }));
    const resolved = readConfig(dir);
    expect(resolved.effective.stagingRoot).toBe("Assets/Custom/_Staging");
    expect(resolved.localPath).toBe(localPath);
  });

  it("rejects an invalid tracked config with CFG_SCHEMA_INVALID", () => {
    const configPath = join(dir, "figma-to-uprefab.json");
    atomicWriteFile(configPath, JSON.stringify({ schemaVersion: 1, staging: { root: "x" } }));
    expect(() => readConfig(dir)).toThrow(/CFG_SCHEMA_INVALID/);
  });
});
