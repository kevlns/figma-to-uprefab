/**
 * Deterministic layout + text extraction, ported from the PowerShell exporter.
 *
 * Normalizes Figma aliases into the canonical semantics consumed by the C#
 * converter: constraints min/center/max/stretch/scale, positioning auto/
 * absolute, align inherit/stretch, sizing fixed/hug/fill, and autoLayout
 * direction/spacing/padding/primaryAlign/counterAlign/wrap.
 *
 * Unsupported values are approximated with a stable fallback and reported as
 * warnings (never silently dropped).
 */

import type { FigmaNode, FigmaPaint, FigmaStyle } from "./types.js";

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutConstraints {
  horizontal: string;
  vertical: string;
}

export interface LayoutAutoLayout {
  direction: string;
  spacing: number;
  padding: number[];
  primaryAlign: string;
  counterAlign: string;
  wrap: string;
}

export interface LayoutSizing {
  width: string;
  height: string;
}

export interface LayoutManifest {
  rect?: LayoutRect;
  constraints: LayoutConstraints;
  positioning: string;
  align: string;
  grow: number;
  autoLayout?: LayoutAutoLayout;
  sizing: LayoutSizing;
}

export interface TextManifest {
  content: string;
  fontSize: number;
  rotation: number;
  horizontalAlignment?: string;
  verticalAlignment?: string;
  lineHeight?: number;
  letterSpacing?: number;
  color?: string;
}

export interface ExtractResult<T> {
  value: T | undefined;
  warnings: string[];
}

export function normalizeConstraint(value: string | undefined, axis: string, warnings: string[]): string {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) {
    return "min";
  }

  if (["MIN", "LEFT", "TOP"].includes(normalized)) {
    return "min";
  }

  if (["MAX", "RIGHT", "BOTTOM"].includes(normalized)) {
    return "max";
  }

  if (normalized === "CENTER") {
    return "center";
  }

  if (["STRETCH", "LEFT_RIGHT", "TOP_BOTTOM"].includes(normalized)) {
    return "stretch";
  }

  if (normalized === "SCALE") {
    return "scale";
  }

  warnings.push(`SOURCE_LAYOUT_CONSTRAINT_APPROXIMATED: Unsupported ${axis} constraint '${value}' was approximated as MIN.`);
  return "min";
}

export function normalizeAlignment(value: string | undefined, fallback: string): string {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) {
    return fallback;
  }

  switch (normalized) {
    case "START":
    case "MIN":
      return "min";
    case "CENTER":
      return "center";
    case "END":
    case "MAX":
      return "max";
    case "SPACE_BETWEEN":
      return "space_between";
    case "BASELINE":
      return "baseline";
    case "AUTO":
    case "INHERIT":
      return "inherit";
    case "STRETCH":
      return "stretch";
    default:
      return fallback;
  }
}

export function colorToHtml(paint: FigmaPaint | undefined): string | undefined {
  if (!paint?.color) {
    return undefined;
  }

  const r = Math.round(paint.color.r * 255);
  const g = Math.round(paint.color.g * 255);
  const b = Math.round(paint.color.b * 255);
  const opacity = paint.opacity ?? 1;
  const a = Math.round(opacity * 255);
  const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  if (a >= 255) {
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }

  return `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`;
}

export function textManifest(node: FigmaNode): TextManifest | undefined {
  if (node.type !== "TEXT") {
    return undefined;
  }

  const style: FigmaStyle | undefined = node.style;
  const manifest: TextManifest = {
    content: node.characters ?? "",
    fontSize: style?.fontSize ?? 0,
    rotation: (node.rotation ?? 0) * (180 / Math.PI),
  };

  if (style) {
    if (style.textAlignHorizontal) {
      manifest.horizontalAlignment = style.textAlignHorizontal;
    }

    if (style.textAlignVertical) {
      manifest.verticalAlignment = style.textAlignVertical;
    }

    if (style.lineHeightPx != null) {
      manifest.lineHeight = style.lineHeightPx;
    }

    if (style.letterSpacing != null) {
      manifest.letterSpacing = style.letterSpacing;
    }
  }

  if (node.fills && node.fills.length > 0) {
    const color = colorToHtml(node.fills[0]);
    if (color) {
      manifest.color = color;
    }
  }

  return manifest;
}

export function layoutManifest(node: FigmaNode, warnings: string[]): LayoutManifest {
  const rect = rectManifest(node);
  if (isGeneratedNode(node.name) && !rect) {
    throw new Error(`SOURCE_LAYOUT_RECT_MISSING: Tagged node ${node.id} must expose Figma absoluteBoundingBox.`);
  }

  const constraints = node.constraints ?? {};
  const positioningValue = (node.layoutPositioning ?? "auto").toLowerCase();
  let positioning = positioningValue;
  if (positioning !== "auto" && positioning !== "absolute") {
    warnings.push(`SOURCE_LAYOUT_POSITIONING_APPROXIMATED: Unsupported positioning '${positioningValue}' on node ${node.id} was approximated as auto.`);
    positioning = "auto";
  }

  const layout: LayoutManifest = {
    rect,
    constraints: {
      horizontal: normalizeConstraint(constraints.horizontal, "horizontal", warnings),
      vertical: normalizeConstraint(constraints.vertical, "vertical", warnings),
    },
    positioning,
    align: node.layoutAlign != null ? normalizeAlignment(node.layoutAlign, "inherit") : "inherit",
    grow: node.layoutGrow ?? 0,
    sizing: { width: "fixed", height: "fixed" },
  };

  if (node.layoutMode && ["HORIZONTAL", "VERTICAL", "GRID"].includes(node.layoutMode)) {
    layout.autoLayout = {
      direction: node.layoutMode.toLowerCase(),
      spacing: node.itemSpacing ?? 0,
      padding: [
        node.paddingTop ?? 0,
        node.paddingRight ?? 0,
        node.paddingBottom ?? 0,
        node.paddingLeft ?? 0,
      ],
      primaryAlign: node.primaryAxisAlignItems != null ? normalizeAlignment(node.primaryAxisAlignItems, "min") : "min",
      counterAlign: node.counterAxisAlignItems != null ? normalizeAlignment(node.counterAxisAlignItems, "min") : "min",
      wrap: (node.layoutWrap ?? "no_wrap").toLowerCase(),
    };
  }

  let widthSizing = (node.layoutSizingHorizontal ?? "fixed").toLowerCase();
  if (!["fixed", "hug", "fill"].includes(widthSizing)) {
    warnings.push(`SOURCE_AUTO_LAYOUT_SIZING_APPROXIMATED: Unsupported width sizing '${widthSizing}' on node ${node.id} was approximated as fixed.`);
    widthSizing = "fixed";
  }

  let heightSizing = (node.layoutSizingVertical ?? "fixed").toLowerCase();
  if (!["fixed", "hug", "fill"].includes(heightSizing)) {
    warnings.push(`SOURCE_AUTO_LAYOUT_SIZING_APPROXIMATED: Unsupported height sizing '${heightSizing}' on node ${node.id} was approximated as fixed.`);
    heightSizing = "fixed";
  }

  layout.sizing = { width: widthSizing, height: heightSizing };
  return layout;
}

export function rectManifest(node: FigmaNode): LayoutRect | undefined {
  const box = node.absoluteBoundingBox;
  if (!box) {
    return undefined;
  }

  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

export function isGeneratedNode(name: string): boolean {
  return /\[(?:root|node)(?::[^\]]+)?\]/.test(name);
}
