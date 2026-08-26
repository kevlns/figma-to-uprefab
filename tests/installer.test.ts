import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPackage, uninstallPackage, status as packageStatus } from "../src/core/installer.js";

const FAKE_PKG = "com.kevlns.figma-to-uprefab";

function makeSourceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ftu-src-"));
  mkdirSync(join(dir, "Editor"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: FAKE_PKG, version: "0.1.0" }));
  writeFileSync(join(dir, "Editor", "A.cs"), "// A\n");
  return dir;
}

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "ftu-proj-"));
  mkdirSync(join(dir, "Packages"), { recursive: true });
  return dir;
}

describe("unity package installer", () => {
  it("dry-run writes nothing", async () => {
    const source = makeSourceDir();
    const project = makeProject();
    try {
      const result = await installPackage({ projectPath: project, sourceDir: source, dryRun: true });
      expect(result.status).toBe("DryRun");
      expect(existsSync(join(project, "Packages", FAKE_PKG))).toBe(false);
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("installs and writes a receipt", async () => {
    const source = makeSourceDir();
    const project = makeProject();
    try {
      const result = await installPackage({ projectPath: project, sourceDir: source });
      expect(result.status).toBe("Installed");
      expect(result.fileCount).toBe(2);
      const receipt = join(project, "Library", "figma-to-uprefab", "install-receipt.json");
      expect(existsSync(receipt)).toBe(true);
      const st = await packageStatus({ projectPath: project });
      expect(st.installed).toBe(true);
      expect(st.modified).toBe(false);
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("is idempotent (AlreadyInstalled)", async () => {
    const source = makeSourceDir();
    const project = makeProject();
    try {
      await installPackage({ projectPath: project, sourceDir: source });
      const second = await installPackage({ projectPath: project, sourceDir: source });
      expect(second.status).toBe("AlreadyInstalled");
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("detects modification and fails closed without force", async () => {
    const source = makeSourceDir();
    const project = makeProject();
    try {
      await installPackage({ projectPath: project, sourceDir: source });
      writeFileSync(join(project, "Packages", FAKE_PKG, "Editor", "A.cs"), "// modified\n");
      const st = await packageStatus({ projectPath: project });
      expect(st.modified).toBe(true);
      await expect(installPackage({ projectPath: project, sourceDir: source })).rejects.toThrow(/UNI_MODIFIED/);
      // uninstall also refuses without force
      const uninstall = await uninstallPackage({ projectPath: project });
      expect(uninstall.status).toBe("ModifiedRejected");
      // force uninstall works
      const forced = await uninstallPackage({ projectPath: project, force: true });
      expect(forced.status).toBe("Uninstalled");
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("force re-install replaces a modified install", async () => {
    const source = makeSourceDir();
    const project = makeProject();
    try {
      await installPackage({ projectPath: project, sourceDir: source });
      writeFileSync(join(project, "Packages", FAKE_PKG, "Editor", "A.cs"), "// modified\n");
      const result = await installPackage({ projectPath: project, sourceDir: source, force: true });
      expect(result.status).toBe("Installed");
      const st = await packageStatus({ projectPath: project });
      expect(st.modified).toBe(false);
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });
});
