import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverRoots, convertToIdentifier, testRootTag, rootPrefabName } from "../src/figma/discovery.js";
import type { FigmaFileDocument } from "../src/figma/types.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function discoveryDoc(name: string): FigmaFileDocument {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as FigmaFileDocument;
}

describe("root discovery", () => {
  it("discovers multi-page roots and keeps hidden roots with visible:false", () => {
    const translations = JSON.parse(readFileSync(join(fixtureDir, "root-discovery-translations.json"), "utf8"));
    const { roots } = discoverRoots({ file: discoveryDoc("root-discovery-file.json"), translations });
    expect(roots).toHaveLength(3);
    const names = roots.map((r) => r.prefabName).sort();
    expect(names).toEqual(["MonthlyCardDetailPanel", "ProfilePanel", "PurchasePanel"]);
    const hidden = roots.find((r) => r.prefabName === "PurchasePanel");
    expect(hidden?.visible).toBe(false);
    const translated = roots.find((r) => r.prefabName === "MonthlyCardDetailPanel");
    expect(translated?.figmaNodeId).toBe("2:1");
    expect(translated?.pageName).toBe("Shop");
  });

  it("rejects nested roots (ROOT_NESTED)", () => {
    const file = discoveryDoc("root-discovery-file.json") as unknown as {
      document: { children: { type: string; children: unknown[] }[] };
    };
    // Build a nested doc: a [root] frame containing another [root] frame.
    const nested = {
      document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        children: [
          {
            id: "1:1",
            name: "Page",
            type: "CANVAS",
            children: [
              {
                id: "2:1",
                name: "[root][name=Outer]",
                type: "FRAME",
                children: [
                  { id: "2:2", name: "[root][name=Inner]", type: "FRAME", children: [] },
                ],
              },
            ],
          },
        ],
      },
    };
    expect(() => discoverRoots({ file: nested as FigmaFileDocument })).toThrow(/ROOT_NESTED|nested under/);
    void file;
  });

  it("rejects non-FRAME roots (ROOT_NODE_TYPE_UNSUPPORTED)", () => {
    const bad = {
      document: {
        id: "0:0",
        type: "DOCUMENT",
        children: [
          { id: "1:1", name: "Page", type: "CANVAS", children: [{ id: "2:1", name: "[root][name=X]", type: "GROUP", children: [] }] },
        ],
      },
    };
    expect(() => discoverRoots({ file: bad as unknown as FigmaFileDocument })).toThrow(/must be a Figma FRAME/);
  });

  it("rejects duplicate prefab names (ROOT_PREFAB_NAME_DUPLICATE)", () => {
    const dup = {
      document: {
        id: "0:0",
        type: "DOCUMENT",
        children: [
          { id: "1:1", name: "Page", type: "CANVAS", children: [
            { id: "2:1", name: "[root][name=Dup]", type: "FRAME", children: [] },
            { id: "2:2", name: "[root][name=Dup]", type: "FRAME", children: [] },
          ] },
        ],
      },
    };
    expect(() => discoverRoots({ file: dup as unknown as FigmaFileDocument })).toThrow(/duplicate|unique \[name=...\]/);
  });

  it("throws when there are no roots", () => {
    const empty = {
      document: { id: "0:0", type: "DOCUMENT", children: [{ id: "1:1", name: "Page", type: "CANVAS", children: [] }] },
    };
    expect(() => discoverRoots({ file: empty as unknown as FigmaFileDocument })).toThrow(/no valid FRAME with a \[root\] tag/);
  });
});

describe("identifier conversion", () => {
  it("uses translations and escapes invalid identifier chars", () => {
    expect(convertToIdentifier("月卡详情", { 月卡详情: "MonthlyCardDetail" })).toBe("MonthlyCardDetail");
    expect(convertToIdentifier("Price", {})).toBe("Price");
    expect(convertToIdentifier("my-label", {})).toBe("my_label");
    expect(convertToIdentifier("123start", {})).toBe("_123start");
  });

  it("throws when a non-ASCII identifier has no translation", () => {
    expect(() => convertToIdentifier("月卡详情", {})).toThrow(/missing an English translation/);
  });
});

describe("tag helpers", () => {
  it("testRootTag recognizes [root] and [root:...]", () => {
    expect(testRootTag("[root][name=X]")).toBe(true);
    expect(testRootTag("[root:rcg][name=X]")).toBe(true);
    expect(testRootTag("[node:text][name=X]")).toBe(false);
  });

  it("rootPrefabName escapes unsafe characters and rejects missing names", () => {
    // Non-alphanumeric chars are escaped to underscores after translation.
    expect(rootPrefabName("[root][name=..]", {})).toBe("__");
    expect(rootPrefabName("[root][name=Safe]", {})).toBe("Safe");
    expect(() => rootPrefabName("[root]", {})).toThrow(/non-empty \[name=...\]/);
  });
});
