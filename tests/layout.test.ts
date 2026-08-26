import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { layoutManifest, textManifest, normalizeConstraint, normalizeAlignment, colorToHtml } from "../src/figma/layout.js";
import { buildManifestNodes, nodeComponents } from "../src/figma/manifest.js";
import type { FigmaNode } from "../src/figma/types.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function nodeDoc(): FigmaNode {
  return JSON.parse(readFileSync(join(fixtureDir, "layout-nodes", "10_1.json"), "utf8")) as FigmaNode;
}

describe("layout extraction", () => {
  it("extracts root auto layout + sizing", () => {
    const warnings: string[] = [];
    const layout = layoutManifest(nodeDoc(), warnings);
    expect(layout.autoLayout?.direction).toBe("horizontal");
    expect(layout.autoLayout?.primaryAlign).toBe("space_between");
    expect(layout.autoLayout?.counterAlign).toBe("center");
    expect(layout.autoLayout?.spacing).toBe(12);
    expect(layout.autoLayout?.padding).toEqual([8, 8, 8, 8]);
    expect(layout.sizing.width).toBe("fixed");
    expect(layout.sizing.height).toBe("hug");
    // GRID direction is preserved verbatim (approximated later by the converter).
    expect(layout.rect).toEqual({ x: 0, y: 0, w: 320, h: 200 });
  });

  it("extracts child semantics (max/stretch/absolute/fill)", () => {
    const warnings: string[] = [];
    const node = nodeDoc();
    const button = node.children?.[0];
    const layout = layoutManifest(button!, warnings);
    expect(layout.constraints.horizontal).toBe("max");
    expect(layout.constraints.vertical).toBe("stretch");
    expect(layout.positioning).toBe("absolute");
    expect(layout.sizing.height).toBe("fill");
  });

  it("approximates unknown constraint with a warning", () => {
    const warnings: string[] = [];
    const normalized = normalizeConstraint("FLOATY", "horizontal", warnings);
    expect(normalized).toBe("min");
    expect(warnings.some((w) => w.startsWith("SOURCE_LAYOUT_CONSTRAINT_APPROXIMATED"))).toBe(true);
  });

  it("normalizes alignment aliases", () => {
    expect(normalizeAlignment("START", "min")).toBe("min");
    expect(normalizeAlignment("END", "min")).toBe("max");
    expect(normalizeAlignment("SPACE_BETWEEN", "min")).toBe("space_between");
    expect(normalizeAlignment("AUTO", "inherit")).toBe("inherit");
    expect(normalizeAlignment("BOGUS", "inherit")).toBe("inherit");
  });

  it("converts paint to html color", () => {
    expect(colorToHtml({ color: { r: 1, g: 0.5, b: 0 }, opacity: 1 })).toBe("#FF8000");
    expect(colorToHtml({ color: { r: 1, g: 1, b: 1 }, opacity: 0.5 })).toBe("#FFFFFF80");
    expect(colorToHtml(undefined)).toBeUndefined();
  });
});

describe("text extraction", () => {
  it("extracts characters, style and rotation", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "[node:text][name=Title]",
      type: "TEXT",
      characters: "Hello",
      rotation: Math.PI / 2,
      style: { fontSize: 20, textAlignHorizontal: "LEFT", textAlignVertical: "TOP", lineHeightPx: 24, letterSpacing: 1 },
      fills: [{ color: { r: 1, g: 0, b: 0 }, opacity: 1 }],
    };
    const text = textManifest(node)!;
    expect(text.content).toBe("Hello");
    expect(text.fontSize).toBe(20);
    expect(text.rotation).toBeCloseTo(90);
    expect(text.lineHeight).toBe(24);
    expect(text.color).toBe("#FF0000");
  });
});

describe("manifest nodes", () => {
  it("collects image node ids and text", () => {
    const warnings: string[] = [];
    const { nodes, imageNodeIds } = buildManifestNodes(nodeDoc(), warnings);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes[0]?.figmaName).toContain("[root");
    expect(imageNodeIds).toContain("10:3");
  });

  it("nodeComponents normalizes img -> image", () => {
    expect(nodeComponents("[node:img,button][name=X]")).toEqual(["image", "button"]);
    expect(nodeComponents("[node:list-h][name=X]")).toEqual(["list-h"]);
  });
});
