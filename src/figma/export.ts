/**
 * Export orchestration: Figma REST (or injected fixtures) -> canonical
 * `_Staging` layout with `Meta/<name>.source.json` per root.
 *
 *   _Staging/figma-roots.index.json
 *   _Staging/<PrefabName>/Meta/<PrefabName>.source.json
 *   _Staging/<PrefabName>/Assets/<key>.png   (node-scoped)
 *
 * This step has no Unity side effects. IR and prefabs are produced later by
 * the C# converter via `build`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile, assertInsideBase } from "../core/atomic.js";
import { errors } from "../core/errors.js";
import type { FigmaTransport } from "../core/http.js";
import { exportNodeAssets } from "./assets.js";
import { discoverRoots, testRootTag, type RootCandidate } from "./discovery.js";
import { buildSourceManifest, type ManifestAsset } from "./manifest.js";
import type { FigmaFileDocument, FigmaNode, FigmaNodesResponse } from "./types.js";

export interface ExportOptions {
  fileKey: string;
  config: {
    projectPath: string;
    stagingRoot: string;
    variantFrom: string;
    translations: Record<string, string>;
  };
  transport?: FigmaTransport;
  /** Test hooks (mirror the PowerShell exporter). */
  discoveryDocumentPath?: string;
  nodeDocumentDirectory?: string;
  discoveryOnly?: boolean;
  imageScale?: number;
  /** Bypass network entirely when a discovery document is provided. */
  noNetwork?: boolean;
  /** Test hook: override PNG byte download (keyed by image URL). */
  bytesOverride?: (url: string) => Promise<ArrayBuffer>;
}

export interface ExportRootEntry {
  figmaNodeId: string;
  figmaName: string;
  prefabName: string;
  pageNodeId: string;
  pageName: string;
  visible: boolean;
  sourceManifestPath: string;
  irPath: string;
  stagingPath: string;
}

export interface ExportResult {
  index: {
    schemaVersion: 1;
    source: { fileKey: string; discovery: "all-tagged-roots" };
    roots: ExportRootEntry[];
  };
  rootEntries: ExportRootEntry[];
  warnings: string[];
  writtenFiles: string[];
}

function readDiscoveryDocument(path: string): FigmaFileDocument {
  if (!existsSync(path)) {
    throw new Error(`Discovery document does not exist: ${path}`);
  }

  return JSON.parse(readFileSync(path, "utf8")) as FigmaFileDocument;
}

function safeNodeId(nodeId: string): string {
  return nodeId.replace(/[^A-Za-z0-9_-]/g, "_");
}

async function readCapturedNodeDocument(
  dir: string,
  nodeId: string,
): Promise<FigmaNode> {
  const capturedPath = join(dir, `${safeNodeId(nodeId)}.json`);
  if (!existsSync(capturedPath)) {
    throw new Error(`CAPTURED_NODE_DOCUMENT_MISSING: ${capturedPath}`);
  }

  return JSON.parse(readFileSync(capturedPath, "utf8")) as FigmaNode;
}

async function fetchNodeDocument(
  transport: FigmaTransport,
  fileKey: string,
  rootNodeId: string,
): Promise<FigmaNode> {
  const response = await transport.get<FigmaNodesResponse>(
    `files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(rootNodeId)}`,
  );

  const doc = response.nodes[rootNodeId]?.document;
  if (!doc) {
    throw new Error(`Figma did not return the discovered root node: ${rootNodeId}`);
  }

  return doc;
}

export async function runExport(options: ExportOptions): Promise<ExportResult> {
  const { fileKey, config } = options;
  const stagingRoot = config.stagingRoot.replace(/[\\/]+$/, "");
  if (!/(^|\/)_Staging(\/|$)/.test(stagingRoot)) {
    throw errors.stagingRootInvalid(stagingRoot);
  }

  const projectRoot = config.projectPath;
  const absoluteStaging = join(projectRoot, stagingRoot.split("/").join("\\"));
  assertInsideBase(projectRoot, absoluteStaging, stagingRoot);

  let fileDocument: FigmaFileDocument;
  if (options.discoveryDocumentPath) {
    fileDocument = readDiscoveryDocument(options.discoveryDocumentPath);
  } else {
    if (!options.transport) {
      throw errors.tokenMissing();
    }

    fileDocument = await options.transport.get<FigmaFileDocument>(`files/${encodeURIComponent(fileKey)}`);
  }

  const { roots, warnings } = discoverRoots({ file: fileDocument, translations: config.translations });

  const rootEntries: ExportRootEntry[] = [];
  const writtenFiles: string[] = [];

  for (const root of roots) {
    const stagingPath = `${stagingRoot}/${root.prefabName}`;
    const metaPath = `${stagingPath}/Meta`;
    const sourceManifestPath = `${metaPath}/${root.prefabName}.source.json`;
    const irPath = `${metaPath}/${root.prefabName}.ir.json`;

    if (options.discoveryOnly) {
      rootEntries.push({
        figmaNodeId: root.figmaNodeId,
        figmaName: root.figmaName,
        prefabName: root.prefabName,
        pageNodeId: root.pageNodeId,
        pageName: root.pageName,
        visible: root.visible,
        sourceManifestPath,
        irPath,
        stagingPath,
      });
      continue;
    }

    const exportEntry = await exportOneRoot(root, options, stagingPath, sourceManifestPath);
    rootEntries.push(exportEntry.entry);
    writtenFiles.push(exportEntry.manifestFile);
    for (const written of exportEntry.writtenAssets) {
      writtenFiles.push(written);
    }
  }

  const index = {
    schemaVersion: 1 as const,
    source: { fileKey, discovery: "all-tagged-roots" as const },
    roots: rootEntries,
  };

  const indexPath = `${stagingRoot}/figma-roots.index.json`;
  const absoluteIndex = join(projectRoot, indexPath.split("/").join("\\"));
  assertInsideBase(projectRoot, absoluteIndex, indexPath);
  atomicWriteFile(absoluteIndex, JSON.stringify(index, null, 2));
  writtenFiles.push(absoluteIndex);

  return { index, rootEntries, warnings, writtenFiles };
}

async function exportOneRoot(
  root: RootCandidate,
  options: ExportOptions,
  stagingPath: string,
  sourceManifestPath: string,
): Promise<{ entry: ExportRootEntry; manifestFile: string; writtenAssets: string[] }> {
  const projectRoot = options.config.projectPath;
  let nodeDocument: FigmaNode;
  if (options.nodeDocumentDirectory) {
    nodeDocument = await readCapturedNodeDocument(options.nodeDocumentDirectory, root.figmaNodeId);
  } else {
    if (!options.transport) {
      throw errors.tokenMissing();
    }

    nodeDocument = await fetchNodeDocument(options.transport, options.fileKey, root.figmaNodeId);
  }

  if (!testRootTag(nodeDocument.name)) {
    throw new Error(
      `ROOT_TAG_CHANGED: Discovered root ${root.figmaNodeId} no longer has a [root] tag when its full document was read.`,
    );
  }

  const { manifest, imageNodeIds } = buildSourceManifest(nodeDocument, {
    fileKey: options.fileKey,
    prefabName: root.prefabName,
    variantFrom: options.config.variantFrom,
    stagingPath,
    translations: options.config.translations,
  });

  if (imageNodeIds.length > 0) {
    if (!options.transport) {
      throw errors.tokenMissing();
    }

    const assetResult = await exportNodeAssets({
      fileKey: options.fileKey,
      transport: options.transport,
      stagingPath,
      projectRoot,
      imageNodeIds,
      imageScale: options.imageScale,
      bytesOverride: options.bytesOverride,
    });
    manifest.assets = assetResult.assets;
    return {
      entry: rootEntry(root, stagingPath, sourceManifestPath),
      manifestFile: writeManifest(projectRoot, sourceManifestPath, manifest),
      writtenAssets: assetResult.written,
    };
  }

  manifest.assets = [] as ManifestAsset[];
  return {
    entry: rootEntry(root, stagingPath, sourceManifestPath),
    manifestFile: writeManifest(projectRoot, sourceManifestPath, manifest),
    writtenAssets: [],
  };
}

function rootEntry(root: RootCandidate, stagingPath: string, sourceManifestPath: string): ExportRootEntry {
  const metaPath = `${stagingPath}/Meta`;
  return {
    figmaNodeId: root.figmaNodeId,
    figmaName: root.figmaName,
    prefabName: root.prefabName,
    pageNodeId: root.pageNodeId,
    pageName: root.pageName,
    visible: root.visible,
    sourceManifestPath,
    irPath: `${metaPath}/${root.prefabName}.ir.json`,
    stagingPath,
  };
}

function writeManifest(projectRoot: string, relPath: string, manifest: unknown): string {
  const absolute = join(projectRoot, relPath.split("/").join("\\"));
  assertInsideBase(projectRoot, absolute, relPath);
  atomicWriteFile(absolute, JSON.stringify(manifest, null, 2));
  return absolute;
}
