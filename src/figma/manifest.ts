/**
 * Source manifest generation (port of the PowerShell Add-ManifestNodes +
 * Export-RootSourceManifest). Produces the canonical `Meta/<name>.source.json`
 * document: raw names, layout/text semantics, node-scoped assets. The source
 * manifest is never rewritten by overlays.
 */

import type { FigmaNode } from "./types.js";
import { layoutManifest, textManifest, type LayoutManifest, type TextManifest } from "./layout.js";

export interface ManifestNode {
  figmaNodeId: string;
  figmaName: string;
  parentFigmaNodeId: string;
  visible: boolean;
  type: string;
  layout: LayoutManifest;
  text?: TextManifest;
}

export interface ManifestAsset {
  key: string;
  format: string;
  figmaNodeId: string;
  exportMode: string;
  destPath: string;
  import: { textureType: string };
}

export interface SourceManifest {
  prefab: {
    name: string;
    variantFrom: string;
    stagingPath: string;
  };
  source: {
    fileKey: string;
    frameNodeId: string;
    frameName: string;
  };
  identifierTranslations: Record<string, string>;
  nodes: ManifestNode[];
  assets: ManifestAsset[];
}

export interface BuildManifestOptions {
  fileKey: string;
  prefabName: string;
  variantFrom: string;
  stagingPath: string;
  translations: Record<string, string>;
}

export function nodeComponents(figmaName: string): string[] {
  const match = /\[node:([^\]]+)\]/.exec(figmaName);
  if (!match) {
    return [];
  }

  const tag = match[1] ?? "";
  return tag
    .split(",")
    .map((component) => component.trim().toLowerCase())
    .map((component) => (component === "img" ? "image" : component));
}

export interface ManifestNodesResult {
  nodes: ManifestNode[];
  imageNodeIds: string[];
  warnings: string[];
}

export function buildManifestNodes(root: FigmaNode, warnings: string[]): ManifestNodesResult {
  const nodes: ManifestNode[] = [];
  const imageNodeIds: string[] = [];
  walk(root, "", nodes, imageNodeIds, warnings);
  return { nodes, imageNodeIds, warnings };
}

function walk(
  node: FigmaNode,
  parentNodeId: string,
  target: ManifestNode[],
  imageNodeIds: string[],
  warnings: string[],
): void {
  const entry: ManifestNode = {
    figmaNodeId: String(node.id),
    figmaName: node.name,
    parentFigmaNodeId: parentNodeId,
    visible: node.visible !== false,
    type: node.type,
    layout: layoutManifest(node, warnings),
  };

  const text = textManifest(node);
  if (text) {
    entry.text = text;
  }

  target.push(entry);
  if (nodeComponents(node.name).includes("image")) {
    imageNodeIds.push(entry.figmaNodeId);
  }

  for (const child of node.children ?? []) {
    walk(child, entry.figmaNodeId, target, imageNodeIds, warnings);
  }
}

export function buildSourceManifest(root: FigmaNode, options: BuildManifestOptions): {
  manifest: SourceManifest;
  imageNodeIds: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const { nodes, imageNodeIds } = buildManifestNodes(root, warnings);
  const manifest: SourceManifest = {
    prefab: {
      name: options.prefabName,
      variantFrom: options.variantFrom,
      stagingPath: options.stagingPath,
    },
    source: {
      fileKey: options.fileKey,
      frameNodeId: String(root.id),
      frameName: root.name,
    },
    identifierTranslations: options.translations,
    nodes,
    assets: [],
  };

  return { manifest, imageNodeIds, warnings };
}
