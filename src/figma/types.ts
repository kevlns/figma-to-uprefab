/**
 * Minimal structural types for the Figma REST payloads consumed by the
 * exporter. Only the fields the deterministic extraction needs are modeled.
 */

export interface FigmaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaPaint {
  type?: string;
  color?: { r: number; g: number; b: number };
  opacity?: number;
}

export interface FigmaStyle {
  fontSize?: number;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  lineHeightPx?: number;
  letterSpacing?: number;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  children?: FigmaNode[];
  absoluteBoundingBox?: FigmaRect;
  constraints?: { horizontal?: string; vertical?: string };
  layoutMode?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutWrap?: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  layoutPositioning?: string;
  layoutAlign?: string;
  layoutGrow?: number;
  style?: FigmaStyle;
  characters?: string;
  rotation?: number;
  fills?: FigmaPaint[];
}

export interface FigmaFileDocument {
  document?: FigmaNode;
  name?: string;
}

export interface FigmaNodesResponse {
  nodes: Record<string, { document?: FigmaNode }>;
}

export interface FigmaImagesResponse {
  images: Record<string, string | null>;
}
