import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContract } from "../src/contract/contract.js";
import { validateSchema } from "../src/core/schema.js";
import { validateOverlayStructure, validateOverlayAgainstSource, approximationFromEntry } from "../src/overlay/overlay.js";
import type { SourceManifest } from "../src/figma/manifest.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("JSON Schema authority", () => {
  it("accepts the valid root index", () => {
    const index = JSON.parse(readFileSync(join(fixtureDir, "contract", "figma-roots.index.json"), "utf8"));
    expect(validateSchema("root-index", index).valid).toBe(true);
  });

  it("accepts the valid source manifest and IR", () => {
    const source = JSON.parse(readFileSync(join(fixtureDir, "contract", "Panel", "Meta", "Panel.source.json"), "utf8"));
    const ir = JSON.parse(readFileSync(join(fixtureDir, "contract", "Panel", "Meta", "Panel.ir.json"), "utf8"));
    expect(validateSchema("source-manifest", source).valid).toBe(true);
    expect(validateSchema("ir", ir).valid).toBe(true);
  });

  it("rejects an invalid source manifest with a stable SCH error", () => {
    const result = validateSchema("source-manifest", { prefab: {}, source: {}, identifierTranslations: {}, nodes: [], assets: [] });
    expect(result.valid).toBe(false);
    expect(result.path).toBeTruthy();
  });
});

describe("contract validation", () => {
  function copyFixture(projectRoot: string): string {
    const src = join(fixtureDir, "contract");
    const dest = join(projectRoot, "Assets", "Temp", "_Staging");
    const copy = (rel: string) => {
      const from = join(src, rel);
      const to = join(dest, rel);
      mkdirSync(join(to, ".."), { recursive: true });
      writeFileSync(to, readFileSync(from));
    };
    copy("figma-roots.index.json");
    copy("Panel/Meta/Panel.source.json");
    copy("Panel/Meta/Panel.ir.json");
    return "Assets/Temp/_Staging/figma-roots.index.json";
  }

  it("passes a valid staging layout", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ftu-contract-"));
    try {
      const indexPath = copyFixture(projectRoot);
      const result = validateContract({ projectPath: projectRoot, indexPath });
      expect(result.valid).toBe(true);
      expect(result.rootsChecked).toBe(1);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("fails when IR is missing unless allowMissingIr", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ftu-contract-"));
    try {
      const indexPath = "Assets/Temp/_Staging/figma-roots.index.json";
      copyFixture(projectRoot);
      rmSync(join(projectRoot, "Assets", "Temp", "_Staging", "Panel", "Meta", "Panel.ir.json"));
      expect(validateContract({ projectPath: projectRoot, indexPath }).valid).toBe(false);
      expect(validateContract({ projectPath: projectRoot, indexPath, allowMissingIr: true }).valid).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects a source manifest outside Meta/", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ftu-contract-"));
    try {
      copyFixture(projectRoot);
      const indexFile = join(projectRoot, "Assets", "Temp", "_Staging", "figma-roots.index.json");
      const index = JSON.parse(readFileSync(indexFile, "utf8"));
      index.roots[0].sourceManifestPath = "Assets/Temp/_Staging/Panel/Panel.source.json";
      writeFileSync(indexFile, JSON.stringify(index, null, 2));
      const result = validateContract({ projectPath: projectRoot, indexPath: "Assets/Temp/_Staging/figma-roots.index.json" });
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === "CON_SOURCE_NOT_CANONICAL")).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("approximation overlay", () => {
  const validOverlay = {
    schemaVersion: 1,
    root: { figmaNodeId: "10:1", prefabName: "Panel" },
    entries: [
      {
        figmaNodeId: "10:2",
        approximation: { horizontalConstraint: "stretch", primaryAlign: "center", spacing: 8 },
        reason: "Manual override for review milestone",
      },
    ],
  };

  it("validates structure and whitelist", () => {
    expect(validateOverlayStructure(validOverlay as never).valid).toBe(true);
    const bad = {
      schemaVersion: 1,
      root: { figmaNodeId: "10:1", prefabName: "Panel" },
      entries: [
        { figmaNodeId: "10:2", approximation: { notAllowed: "x" }, reason: "why" },
      ],
    };
    const result = validateOverlayStructure(bad as never);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "OVL_FIELD_NOT_ALLOWED")).toBe(true);
  });

  it("requires a reason per entry", () => {
    const noReason = {
      schemaVersion: 1,
      root: { figmaNodeId: "10:1", prefabName: "Panel" },
      entries: [{ figmaNodeId: "10:2", approximation: {} }],
    };
    const result = validateOverlayStructure(noReason as never);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "OVL_REASON_REQUIRED")).toBe(true);
  });

  it("does not mutate the source manifest (approximationFromEntry returns a new object)", () => {
    const source = JSON.parse(readFileSync(join(fixtureDir, "contract", "Panel", "Meta", "Panel.source.json"), "utf8")) as SourceManifest;
    const overlay = JSON.parse(JSON.stringify(validOverlay));
    const before = JSON.stringify(source);
    const cross = validateOverlayAgainstSource(overlay, source);
    expect(cross.valid).toBe(true);
    const merged = approximationFromEntry(overlay.entries[0]);
    expect(merged.approximation.horizontalConstraint).toBe("stretch");
    expect(JSON.stringify(source)).toBe(before);
  });

  it("rejects an overlay whose root does not match the source", () => {
    const source = JSON.parse(readFileSync(join(fixtureDir, "contract", "Panel", "Meta", "Panel.source.json"), "utf8")) as SourceManifest;
    const wrongNode = JSON.parse(JSON.stringify(validOverlay));
    wrongNode.root.figmaNodeId = "99:1";
    const byNode = validateOverlayAgainstSource(wrongNode, source);
    expect(byNode.valid).toBe(false);
    expect(byNode.issues.some((i) => i.code === "OVL_ROOT_NODE_MISMATCH")).toBe(true);

    const wrongName = JSON.parse(JSON.stringify(validOverlay));
    wrongName.root.prefabName = "Other";
    const byName = validateOverlayAgainstSource(wrongName, source);
    expect(byName.valid).toBe(false);
    expect(byName.issues.some((i) => i.code === "OVL_ROOT_PREFAB_MISMATCH")).toBe(true);
  });

  it("rejects an overlay whose approximation block is empty", () => {
    const result = validateOverlayStructure({
      schemaVersion: 1,
      root: { figmaNodeId: "10:1", prefabName: "Panel" },
      entries: [{ figmaNodeId: "10:2", approximation: {}, reason: "empty" }],
    } as never);
    expect(result.valid).toBe(false);
  });
});
