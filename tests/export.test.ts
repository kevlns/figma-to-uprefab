import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runExport } from "../src/figma/export.js";
import { FigmaTransport } from "../src/core/http.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("runExport (fixture-driven)", () => {
  let projectRoot: string;
  let transport: FigmaTransport;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "ftu-export-"));
    // Replace the transport with a stub that returns fixture payloads.
    transport = new FigmaTransport({
      token: "test-token",
      fetchImpl: (async (input: unknown) => {
        const url = String(input);
        if (url.includes("/images")) {
          const idMatch = /ids=([^&]+)/.exec(url);
          const id = decodeURIComponent(idMatch?.[1] ?? "");
          return new Response(JSON.stringify({ images: { [id]: `https://cdn.example.com/${id}.png` } }), { status: 200 });
        }

        if (url.includes("/nodes?")) {
          const idMatch = /ids=([^&]+)/.exec(url);
          const id = decodeURIComponent(idMatch?.[1] ?? "");
          const node = JSON.parse(readFileSync(join(fixtureDir, "layout-nodes", `${id.replace(":", "_")}.json`), "utf8"));
          return new Response(JSON.stringify({ nodes: { [id]: { document: node } } }), { status: 200 });
        }

        throw new Error(`unexpected request: ${url}`);
      }) as unknown as typeof fetch,
    });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("discovers-only writes the root index with Meta/ paths", async () => {
    const result = await runExport({
      fileKey: "fixture-file",
      config: {
        projectPath: projectRoot,
        stagingRoot: "Assets/Temp/_Staging",
        variantFrom: "Assets/base.prefab",
        translations: { 月卡详情: "MonthlyCardDetailPanel" },
      },
      discoveryDocumentPath: join(fixtureDir, "root-discovery-file.json"),
      discoveryOnly: true,
      transport,
    });

    expect(result.rootEntries).toHaveLength(3);
    expect(result.rootEntries[0]?.sourceManifestPath).toBe("Assets/Temp/_Staging/MonthlyCardDetailPanel/Meta/MonthlyCardDetailPanel.source.json");
    expect(result.rootEntries[0]?.irPath).toContain("/Meta/");
    const indexPath = join(projectRoot, "Assets", "Temp", "_Staging", "figma-roots.index.json");
    expect(existsSync(indexPath)).toBe(true);
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    expect(index.schemaVersion).toBe(1);
    expect(index.source.discovery).toBe("all-tagged-roots");
  });

  it("exports a root source manifest into Meta/ and exports node-scoped PNG", async () => {
    const result = await runExport({
      fileKey: "fixture-file",
      config: {
        projectPath: projectRoot,
        stagingRoot: "Assets/Temp/_Staging",
        variantFrom: "Assets/base.prefab",
        translations: {},
      },
      discoveryDocumentPath: join(fixtureDir, "layout-extraction-file.json"),
      nodeDocumentDirectory: join(fixtureDir, "layout-nodes"),
      transport,
      bytesOverride: async () => new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]).buffer as ArrayBuffer,
    });

    expect(result.rootEntries).toHaveLength(1);
    const root = result.rootEntries[0]!;
    expect(root.prefabName).toBe("LayoutPanel");
    const sourcePath = join(projectRoot, root.sourceManifestPath.replace(/\//g, "\\"));
    expect(existsSync(sourcePath)).toBe(true);
    const source = JSON.parse(readFileSync(sourcePath, "utf8"));
    expect(source.prefab.name).toBe("LayoutPanel");
    expect(source.nodes[0]?.layout?.autoLayout?.direction).toBe("horizontal");
    // image node 10:3 present in nodes; assets populated by exportNodeAssets.
    expect(source.assets.length).toBeGreaterThan(0);
    const asset = source.assets.find((a: { figmaNodeId: string }) => a.figmaNodeId === "10:3");
    expect(asset).toBeDefined();
    expect(asset.key).toMatch(/^figma_/);
    expect(asset.destPath).toContain("_Staging/LayoutPanel/Assets/");
  });

  it("rejects a staging root outside _Staging", async () => {
    await expect(
      runExport({
        fileKey: "fixture-file",
        config: { projectPath: projectRoot, stagingRoot: "Assets/NotStaging", variantFrom: "Assets/base.prefab", translations: {} },
        discoveryDocumentPath: join(fixtureDir, "root-discovery-file.json"),
        discoveryOnly: true,
        transport,
      }),
    ).rejects.toThrow(/STAGING_ROOT_INVALID/);
  });
});
