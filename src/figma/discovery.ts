/**
 * Deterministic [root] discovery, ported from the PowerShell exporter.
 *
 * Behaviors preserved:
 *   - only CANVAS pages are walked
 *   - a FRAME tagged [root(:...)] becomes a root candidate
 *   - a [root] nested under another [root] is a hard error (ROOT_NESTED)
 *   - a [root] that is not a FRAME is a hard error (ROOT_NODE_TYPE_UNSUPPORTED)
 *   - hidden roots stay in the index with visible:false
 *   - duplicate translated prefab names are a hard error
 */

import { errors } from "../core/errors.js";
import type { FigmaNode } from "./types.js";

export interface RootCandidate {
  figmaNodeId: string;
  figmaName: string;
  prefabName: string;
  pageNodeId: string;
  pageName: string;
  visible: boolean;
}

/** True when a Figma layer name carries a [root(:...)] tag. */
export function testRootTag(figmaName: string): boolean {
  return /\[root(?::[^\]]+)?\]/.test(figmaName);
}

/** True when a name carries [root] or [node] tag (used for layout gating). */
export function isGeneratedNode(figmaName: string): boolean {
  return /\[(?:root|node)(?::[^\]]+)?\]/.test(figmaName);
}

/** Extract [name=...] tag value. */
export function nameTagValue(figmaName: string): string | undefined {
  const match = /\[name=([^\]]+)\]/.exec(figmaName);
  return match?.[1]?.trim() || undefined;
}

function invalidFileNameChars(): RegExp {
  const literal = '<>:"\\|?*';
  let pattern = literal
    .split("")
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("");
  for (let i = 0; i <= 0x1f; i++) {
    pattern += "\\u" + i.toString(16).padStart(4, "0");
  }

  return new RegExp("[" + pattern + "]", "g");
}

const INVALID_FILE_NAME_CHARS = invalidFileNameChars();

export interface DiscoveryResult {
  roots: RootCandidate[];
  /** Non-fatal warnings collected during discovery (e.g. approximation). */
  warnings: string[];
}

export interface DiscoveryOptions {
  /** Identifier translations used to derive prefab names. */
  translations?: Record<string, string>;
  /** Throw on the first problem instead of collecting (default true). */
  strict?: boolean;
}

/** Convert a raw name into a safe identifier (port of ConvertTo-Identifier). */
export function convertToIdentifier(source: string, translations: Record<string, string>): string {
  if (!source) {
    throw errors.identifierTranslationMissing(source, source);
  }

  let value = source;
  const translated = translations[source];
  if (translated && translated.length > 0) {
    value = translated;
  } else {
    for (const char of source) {
      if (char.charCodeAt(0) > 127) {
        throw errors.identifierTranslationMissing(source, source);
      }
    }
  }

  let builder = "";
  for (const char of value) {
    builder += /[A-Za-z0-9_]/.test(char) ? char : "_";
  }

  if (!builder) {
    throw new Error(`EXP_IDENTIFIER_TRANSLATION_INVALID: identifier '${source}' is empty after escaping.`);
  }

  if (/^\d/.test(builder)) {
    builder = "_" + builder;
  }

  return builder;
}

function addRootCandidates(
  node: FigmaNode,
  pageNodeId: string,
  pageName: string,
  ancestorRootName: string | undefined,
  translations: Record<string, string>,
  target: RootCandidate[],
): void {
  const nodeId = String(node.id);
  const isRoot = testRootTag(node.name);
  if (isRoot) {
    if (ancestorRootName) {
      throw errors.rootNested(node.name, ancestorRootName);
    }

    if (node.type !== "FRAME") {
      throw errors.rootNodeTypeUnsupported(node.name, node.type);
    }

    const prefabName = rootPrefabName(node.name, translations);
    target.push({
      figmaNodeId: nodeId,
      figmaName: node.name,
      prefabName,
      pageNodeId,
      pageName,
      visible: getNodeVisible(node),
    });
    ancestorRootName = node.name;
  }

  for (const child of node.children ?? []) {
    addRootCandidates(child, pageNodeId, pageName, ancestorRootName, translations, target);
  }
}

export function rootPrefabName(figmaName: string, translations: Record<string, string>): string {
  const nameValue = nameTagValue(figmaName);
  if (!nameValue) {
    throw errors.rootNameMissing(figmaName);
  }

  const prefabName = convertToIdentifier(nameValue, translations);
  if (
    prefabName === "." ||
    prefabName === ".." ||
    INVALID_FILE_NAME_CHARS.test(prefabName)
  ) {
    throw errors.rootNameInvalid(figmaName, prefabName);
  }

  return prefabName;
}

export function getNodeVisible(node: FigmaNode): boolean {
  return node.visible !== false;
}

export interface DiscoverRootsInput {
  /** The Figma file document (from fixture or REST). */
  file: { document?: FigmaNode };
  translations?: Record<string, string>;
}

export function discoverRoots(input: DiscoverRootsInput): DiscoveryResult {
  const document = input.file.document;
  if (!document) {
    throw new Error("DSC_DOCUMENT_MISSING: Figma file did not return a document tree.");
  }

  const translations = input.translations ?? {};
  const pages = (document.children ?? []).filter((node) => node.type === "CANVAS");
  if (pages.length === 0) {
    throw errors.noPages();
  }

  const roots: RootCandidate[] = [];
  const warnings: string[] = [];
  for (const page of pages) {
    addRootCandidates(page, String(page.id), page.name, undefined, translations, roots);
  }

  if (roots.length === 0) {
    throw errors.rootNotFound();
  }

  const duplicates = groupDuplicates(roots.map((root) => root.prefabName));
  if (duplicates.length > 0) {
    throw errors.rootPrefabNameDuplicate(duplicates);
  }

  return { roots, warnings };
}

function groupDuplicates(names: string[]): string[] {
  const seen = new Map<string, number>();
  for (const name of names) {
    seen.set(name, (seen.get(name) ?? 0) + 1);
  }

  return [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}
