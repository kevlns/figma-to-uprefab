/**
 * Approximation overlay: an independent, schemaVersion'd document that lets
 * humans/agents adjust layout approximation decisions for specific Figma
 * nodes. Hard rules:
 *   - it never rewrites the source manifest (merging happens in the C#
 *     converter at IR time);
 *   - entries are keyed by root + figmaNodeId;
 *   - only the approximation whitelist fields are allowed;
 *   - every entry MUST carry a reason.
 */

import { readFileSync } from "node:fs";
import { errors } from "../core/errors.js";
import { validateSchema } from "../core/schema.js";
import type { ManifestNode, SourceManifest } from "../figma/manifest.js";

export const APPROXIMATION_FIELDS = [
  "horizontalConstraint",
  "verticalConstraint",
  "positioning",
  "align",
  "widthSizing",
  "heightSizing",
  "direction",
  "primaryAlign",
  "counterAlign",
  "spacing",
  "padding",
  "spaceBetween",
] as const;

export type ApproximationField = (typeof APPROXIMATION_FIELDS)[number];

export interface ApproximationValues {
  horizontalConstraint?: string;
  verticalConstraint?: string;
  positioning?: string;
  align?: string;
  widthSizing?: string;
  heightSizing?: string;
  direction?: string;
  primaryAlign?: string;
  counterAlign?: string;
  spacing?: number;
  padding?: number[];
  spaceBetween?: boolean;
}

export interface OverlayEntry {
  figmaNodeId: string;
  approximation: ApproximationValues;
  reason: string;
}

export interface ApproximationOverlay {
  schemaVersion: 1;
  root: {
    figmaNodeId: string;
    prefabName: string;
  };
  entries: OverlayEntry[];
}

export interface OverlayValidationIssue {
  code: string;
  message: string;
  figmaNodeId?: string;
  path?: string;
}

export interface OverlayValidationResult {
  valid: boolean;
  issues: OverlayValidationIssue[];
}

export function loadOverlay(path: string): ApproximationOverlay {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw errors.overlayInvalid(error instanceof Error ? error.message : String(error));
  }

  const schemaResult = validateSchema("approximation-overlay", raw);
  if (!schemaResult.valid) {
    throw errors.overlayInvalid(`${schemaResult.details ?? schemaResult.message} (${path})`);
  }

  const overlay = raw as ApproximationOverlay;
  if (overlay.schemaVersion !== 1) {
    throw errors.overlayInvalid(`schemaVersion must be 1, got ${overlay.schemaVersion}`);
  }

  return overlay;
}

/** Whitelist-only + reason enforcement independent of the source manifest. */
export function validateOverlayStructure(overlay: ApproximationOverlay): OverlayValidationResult {
  const issues: OverlayValidationIssue[] = [];
  if (!overlay.root?.figmaNodeId || !overlay.root?.prefabName) {
    issues.push({ code: "OVL_ROOT_MISSING", message: "Overlay root {figmaNodeId, prefabName} is required.", path: "root" });
  }

  const seen = new Set<string>();
  for (const entry of overlay.entries ?? []) {
    if (!entry.figmaNodeId) {
      issues.push({ code: "OVL_ENTRY_ID_MISSING", message: "Overlay entry is missing figmaNodeId.", path: "entries" });
      continue;
    }

    if (seen.has(entry.figmaNodeId)) {
      issues.push({ code: "OVL_ENTRY_DUPLICATE", message: `Duplicate overlay entry for ${entry.figmaNodeId}.`, figmaNodeId: entry.figmaNodeId });
    }

    seen.add(entry.figmaNodeId);
    const reason = (entry.reason ?? "").trim();
    if (!reason) {
      issues.push({ code: "OVL_REASON_REQUIRED", message: "Every approximation overlay entry must carry a reason.", figmaNodeId: entry.figmaNodeId });
    }

    for (const key of Object.keys(entry.approximation ?? {})) {
      if (!(APPROXIMATION_FIELDS as readonly string[]).includes(key)) {
        issues.push({
          code: "OVL_FIELD_NOT_ALLOWED",
          message: `Field '${key}' is not in the approximation whitelist.`,
          figmaNodeId: entry.figmaNodeId,
          path: `entries[].approximation.${key}`,
        });
      }
    }
    if (!entry.approximation || Object.keys(entry.approximation).length === 0) {
      issues.push({
        code: "OVL_APPROXIMATION_EMPTY",
        message: "Every approximation overlay entry must declare at least one approximation field.",
        figmaNodeId: entry.figmaNodeId,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

/** Cross-check overlay entries against a source manifest (no mutation). */
export function validateOverlayAgainstSource(
  overlay: ApproximationOverlay,
  source: SourceManifest,
): OverlayValidationResult {
  const result = validateOverlayStructure(overlay);
  if (overlay.root.figmaNodeId !== source.source.frameNodeId) {
    result.issues.push({
      code: "OVL_ROOT_NODE_MISMATCH",
      message: `Overlay root figmaNodeId '${overlay.root.figmaNodeId}' does not match source root '${source.source.frameNodeId}'.`,
      figmaNodeId: overlay.root.figmaNodeId,
    });
  }
  if (overlay.root.prefabName !== source.prefab.name) {
    result.issues.push({
      code: "OVL_ROOT_PREFAB_MISMATCH",
      message: `Overlay root prefabName '${overlay.root.prefabName}' does not match source prefab '${source.prefab.name}'.`,
      path: "root.prefabName",
    });
  }
  const sourceIds = new Set(source.nodes.map((node: ManifestNode) => node.figmaNodeId));
  for (const entry of overlay.entries ?? []) {
    if (!sourceIds.has(entry.figmaNodeId)) {
      result.issues.push({
        code: "OVL_NODE_NOT_IN_SOURCE",
        message: `Overlay references figmaNodeId '${entry.figmaNodeId}' that is absent from the source manifest.`,
        figmaNodeId: entry.figmaNodeId,
      });
    }
  }

  return { valid: result.issues.length === 0, issues: result.issues };
}

/**
 * Produce the approximation object to merge into IR.layout.approximation.
 * Returns a NEW object; it never touches the source node.
 */
export function approximationFromEntry(entry: OverlayEntry): { approximation: ApproximationValues; reason: string } {
  const approximation: ApproximationValues = {};
  for (const field of APPROXIMATION_FIELDS) {
    const value = (entry.approximation as Record<string, unknown>)[field];
    if (value !== undefined) {
      (approximation as Record<string, unknown>)[field] = value;
    }
  }

  return { approximation, reason: entry.reason };
}
