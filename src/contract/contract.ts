import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { validateSchema } from "../core/schema.js";
import { assertInsideBase, safeJoin } from "../core/atomic.js";
import type { RootIndex } from "./root-index.js";
import type { ManifestNode, SourceManifest } from "../figma/manifest.js";
import { convertToIdentifier, nameTagValue } from "../figma/discovery.js";
import { validateOverlayAgainstSource, type ApproximationOverlay } from "../overlay/overlay.js";

export interface ContractIssue { code: string; message: string; path?: string }
export interface ContractResult { valid: boolean; issues: ContractIssue[]; rootsChecked: number }
export interface ContractOptions { projectPath: string; indexPath: string; allowMissingIr?: boolean }

type JsonObject = Record<string, unknown>;
interface IrNode extends JsonObject {
  name?: string; key?: string; figmaNodeId?: string; figmaName?: string; visible?: boolean;
  tags?: { node?: string; components?: string[] };
  rcg?: { skinName?: string };
  configuredPrefabPath?: string;
  layout?: JsonObject;
  components?: Record<string, JsonObject>;
  children?: IrNode[];
}
interface IrDocument { prefab?: { name?: string }; assets?: JsonObject[]; tree?: IrNode }

function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, "utf8")) as T }
function canonical(path: string): string { return path.replace(/\\/g, "/").replace(/\/+$/, "") }
function resolveProjectPath(projectRoot: string, path: string): string {
  const absolute = isAbsolute(path) ? resolve(path) : safeJoin(projectRoot, path);
  assertInsideBase(projectRoot, absolute, path);
  return absolute;
}
function issue(issues: ContractIssue[], code: string, message: string, path?: string): void { issues.push({ code, message, path }) }
function equalNumber(a: unknown, b: unknown): boolean {
  return typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.001;
}
function get(obj: unknown, key: string): unknown { return obj && typeof obj === "object" ? (obj as JsonObject)[key] : undefined }
function componentsOf(node: IrNode): string[] { return node.tags?.components ?? [] }
function hasComponent(node: IrNode, component: string): boolean { return componentsOf(node).some((value) => value.toLowerCase() === component) }
function sourceComponents(name: string): string[] {
  const match = /\[(?:root|node):([^\]]+)\]/.exec(name);
  return match ? match[1]!.split(",").map((v) => v.trim().toLowerCase()).map((v) => v === "img" ? "image" : v) : [];
}

export function validateContract(options: ContractOptions): ContractResult {
  const issues: ContractIssue[] = [];
  const projectRoot = resolve(options.projectPath);
  let absoluteIndex: string;
  try { absoluteIndex = resolveProjectPath(projectRoot, options.indexPath); }
  catch (error) { return { valid: false, issues: [{ code: "CON_PATH_TRAVERSAL", message: String(error), path: options.indexPath }], rootsChecked: 0 } }
  const indexRel = canonical(relative(projectRoot, absoluteIndex));
  if (!/(^|\/)_Staging(\/|$)/.test(indexRel)) issue(issues, "CON_STAGING_PATH", `Root index must live inside _Staging: ${indexRel}`);
  if (!existsSync(absoluteIndex)) return { valid: false, issues: [...issues, { code: "CON_INDEX_MISSING", message: `Root index does not exist: ${indexRel}` }], rootsChecked: 0 };

  let index: RootIndex;
  try { index = readJson<RootIndex>(absoluteIndex); }
  catch (error) { return { valid: false, issues: [...issues, { code: "CON_INDEX_JSON", message: String(error), path: indexRel }], rootsChecked: 0 } }
  const indexSchema = validateSchema("root-index", index);
  if (!indexSchema.valid) return { valid: false, issues: [...issues, { code: "CON_INDEX_SCHEMA", message: indexSchema.details ?? "invalid root index", path: indexRel }], rootsChecked: 0 };

  const indexRoot = canonical(indexRel.slice(0, -"/figma-roots.index.json".length));
  const names = new Set<string>();
  for (const root of index.roots) {
    const rootPath = root.prefabName;
    if (names.has(root.prefabName)) issue(issues, "CON_ROOT_DUPLICATE", `Duplicate prefabName: ${root.prefabName}`, rootPath);
    names.add(root.prefabName);
    const expectedStaging = `${indexRoot}/${root.prefabName}`;
    const expectedSource = `${expectedStaging}/Meta/${root.prefabName}.source.json`;
    const expectedIr = `${expectedStaging}/Meta/${root.prefabName}.ir.json`;
    if (canonical(root.stagingPath) !== expectedStaging) issue(issues, "CON_ROOT_STAGING_PATH", `Expected ${expectedStaging}, got ${root.stagingPath}`, rootPath);
    if (canonical(root.sourceManifestPath) !== expectedSource) issue(issues, "CON_SOURCE_NOT_CANONICAL", `Expected ${expectedSource}, got ${root.sourceManifestPath}`, rootPath);
    if (canonical(root.irPath) !== expectedIr) issue(issues, "CON_IR_NOT_CANONICAL", `Expected ${expectedIr}, got ${root.irPath}`, rootPath);

    let sourceAbs: string; let irAbs: string;
    try { sourceAbs = resolveProjectPath(projectRoot, root.sourceManifestPath); irAbs = resolveProjectPath(projectRoot, root.irPath); }
    catch (error) { issue(issues, "CON_PATH_TRAVERSAL", String(error), rootPath); continue }
    if (!existsSync(sourceAbs)) { issue(issues, "CON_SOURCE_MISSING", `Source manifest missing: ${root.sourceManifestPath}`, rootPath); continue }
    let source: SourceManifest;
    try { source = readJson<SourceManifest>(sourceAbs) } catch (error) { issue(issues, "CON_SOURCE_JSON", String(error), rootPath); continue }
    const sourceSchema = validateSchema("source-manifest", source);
    if (!sourceSchema.valid) issue(issues, "CON_SOURCE_SCHEMA", sourceSchema.details ?? "invalid source manifest", root.sourceManifestPath);
    validateSourceInvariants(source, root, expectedStaging, issues);

    const overlayRel = `${expectedStaging}/Meta/${root.prefabName}.approximation.json`;
    const overlayAbs = resolveProjectPath(projectRoot, overlayRel);
    if (existsSync(overlayAbs)) {
      try {
        const overlay = readJson<ApproximationOverlay>(overlayAbs);
        const schema = validateSchema("approximation-overlay", overlay);
        if (!schema.valid) issue(issues, "CON_OVERLAY_SCHEMA", schema.details ?? "invalid overlay", overlayRel);
        else for (const item of validateOverlayAgainstSource(overlay, source).issues) issue(issues, item.code, item.message, item.figmaNodeId ?? item.path ?? overlayRel);
      } catch (error) { issue(issues, "CON_OVERLAY_JSON", String(error), overlayRel) }
    }

    if (!existsSync(irAbs)) {
      if (!options.allowMissingIr) issue(issues, "CON_IR_MISSING", `IR missing: ${root.irPath}. Run build.`, rootPath);
      continue;
    }
    let ir: IrDocument;
    try { ir = readJson<IrDocument>(irAbs) } catch (error) { issue(issues, "CON_IR_JSON", String(error), rootPath); continue }
    const irSchema = validateSchema("ir", ir);
    if (!irSchema.valid) issue(issues, "CON_IR_SCHEMA", irSchema.details ?? "invalid IR", root.irPath);
    validateSourceToIr(source, ir, issues);
  }
  return { valid: issues.length === 0, issues, rootsChecked: index.roots.length };
}

function validateSourceInvariants(source: SourceManifest, root: RootIndex["roots"][number], expectedStaging: string, issues: ContractIssue[]): void {
  if (source.prefab.name !== root.prefabName) issue(issues, "CON_PREFAB_NAME_MISMATCH", `Source prefab '${source.prefab.name}' != '${root.prefabName}'.`, root.prefabName);
  if (canonical(source.prefab.stagingPath) !== expectedStaging) issue(issues, "CON_STAGING_MISMATCH", `Source stagingPath must equal ${expectedStaging}.`, root.prefabName);
  if (source.source.frameNodeId !== root.figmaNodeId || source.source.frameName !== root.figmaName) issue(issues, "CON_SOURCE_ROOT_MISMATCH", "Index root identity differs from source manifest.", root.prefabName);
  const ids = new Set<string>(); const assetKeys = new Set<string>();
  for (const node of source.nodes) {
    if (ids.has(node.figmaNodeId)) issue(issues, "CON_SOURCE_NODE_DUPLICATE", `Duplicate figmaNodeId ${node.figmaNodeId}.`, root.prefabName);
    ids.add(node.figmaNodeId);
  }
  for (const asset of source.assets ?? []) {
    if (assetKeys.has(asset.key)) issue(issues, "CON_ASSET_KEY_DUPLICATE", `Duplicate asset key ${asset.key}.`, root.prefabName);
    assetKeys.add(asset.key);
    const prefix = `${expectedStaging}/Assets/`;
    if (!canonical(asset.destPath).startsWith(prefix) || canonical(asset.destPath).includes("/../")) issue(issues, "CON_ASSET_SCOPE", `Asset escapes root Assets/: ${asset.destPath}`, asset.key);
    if (asset.exportMode !== "node") issue(issues, "CON_ASSET_EXPORT_MODE", `Asset ${asset.key} must use exportMode=node.`, asset.key);
  }
}

function validateSourceToIr(source: SourceManifest, ir: IrDocument, issues: ContractIssue[]): void {
  if (!ir.tree) { issue(issues, "CON_IR_TREE_MISSING", "IR tree is missing."); return }
  if (ir.prefab?.name !== source.prefab.name) issue(issues, "CON_IR_PREFAB_NAME", `IR prefab name '${ir.prefab?.name}' != source '${source.prefab.name}'.`);
  const irById = new Map<string, IrNode>(); const rcgSkins = new Set<string>();
  const visit = (node: IrNode): void => {
    if (!node.figmaNodeId) issue(issues, "CON_IR_NODE_ID_MISSING", `IR node '${node.name ?? "?"}' has no figmaNodeId.`);
    else if (irById.has(node.figmaNodeId)) issue(issues, "CON_IR_NODE_ID_DUPLICATE", `Duplicate IR figmaNodeId ${node.figmaNodeId}.`);
    else irById.set(node.figmaNodeId, node);
    for (const component of componentsOf(node)) if (/^(?:s?list)-[hv]$/.test(component)) issue(issues, "CON_CONTAINER_SUFFIX", `Raw container suffix remains: ${component}`, node.figmaNodeId);
    if (["list", "grid", "slist", "sgrid"].some((tag) => hasComponent(node, tag))) {
      const itemCount = (node.children ?? []).filter((child) => hasComponent(child, "item")).length;
      if (itemCount !== 1) issue(issues, "CON_CONTAINER_ITEM_COUNT", `Cached container must have exactly one item, got ${itemCount}.`, node.figmaNodeId);
    }
    if (hasComponent(node, "rcg")) {
      const skin = node.rcg?.skinName;
      if (!skin) issue(issues, "CON_RCG_SKIN_MISSING", "RCG skinName is missing.", node.figmaNodeId);
      else if (rcgSkins.has(skin)) issue(issues, "CON_RCG_SKIN_DUPLICATE", `Duplicate RCG skinName ${skin}.`, node.figmaNodeId);
      else rcgSkins.add(skin);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(ir.tree);

  for (const sourceNode of source.nodes) {
    if (!/\[(?:root|node)(?::[^\]]+)?\]/.test(sourceNode.figmaName)) continue;
    const target = irById.get(sourceNode.figmaNodeId);
    if (!target) { issue(issues, "CON_TAGGED_SOURCE_NODE_MISSING", `Tagged source node missing from IR: ${sourceNode.figmaName}`, sourceNode.figmaNodeId); continue }
    if (target.figmaName !== sourceNode.figmaName) issue(issues, "CON_FIGMA_NAME_CHANGED", "Raw figmaName changed.", sourceNode.figmaNodeId);
    if (target.visible !== sourceNode.visible) issue(issues, "CON_VISIBILITY_CHANGED", "Visibility changed.", sourceNode.figmaNodeId);
    compareLayout(sourceNode, target, issues);
    const sourceName = nameTagValue(sourceNode.figmaName) ?? "__node__";
    let expectedName: string;
    try { expectedName = convertToIdentifier(sourceName, source.identifierTranslations) }
    catch { expectedName = "" }
    if (!expectedName || target.name !== expectedName) issue(issues, "CON_NODE_NAME_TRANSLATION", `Expected translated name '${expectedName}', got '${target.name}'.`, sourceNode.figmaNodeId);
    const tags = sourceComponents(sourceNode.figmaName);
    if (tags.includes("text")) validateText(sourceNode, target, issues);
  }
  validateImages(ir, irById, issues);
}

function compareLayout(sourceNode: ManifestNode, target: IrNode, issues: ContractIssue[]): void {
  const source = sourceNode.layout as unknown as JsonObject; const ir = target.layout;
  if (!ir) { issue(issues, "CON_IR_LAYOUT_MISSING", "IR layout missing.", sourceNode.figmaNodeId); return }
  const sr = get(source, "rect") as JsonObject | undefined; const tr = get(ir, "rect") as JsonObject | undefined;
  if (!sr || !tr) issue(issues, "CON_LAYOUT_RECT_MISSING", "layout.rect missing.", sourceNode.figmaNodeId);
  else for (const field of ["x", "y", "w", "h"]) if (!equalNumber(sr[field], tr[field])) issue(issues, "CON_LAYOUT_RECT_CHANGED", `layout.rect.${field} changed.`, sourceNode.figmaNodeId);
  for (const field of ["positioning", "align"]) if (get(source, field) !== get(ir, field)) issue(issues, "CON_LAYOUT_SEMANTIC_CHANGED", `layout.${field} changed.`, sourceNode.figmaNodeId);
  if (!equalNumber(get(source, "grow"), get(ir, "grow"))) issue(issues, "CON_LAYOUT_GROW_CHANGED", "layout.grow changed.", sourceNode.figmaNodeId);
  for (const [objectName, fields] of [["constraints", ["horizontal", "vertical"]], ["sizing", ["width", "height"]]] as const) {
    for (const field of fields) if (get(get(source, objectName), field) !== get(get(ir, objectName), field)) issue(issues, "CON_LAYOUT_SEMANTIC_CHANGED", `layout.${objectName}.${field} changed.`, sourceNode.figmaNodeId);
  }
  const sa = get(source, "autoLayout"); const ia = get(ir, "autoLayout");
  if ((sa === undefined) !== (ia === undefined)) issue(issues, "CON_AUTO_LAYOUT_PRESENCE_CHANGED", "autoLayout presence changed.", sourceNode.figmaNodeId);
  if (sa && ia) {
    for (const field of ["direction", "primaryAlign", "counterAlign", "wrap"]) if (get(sa, field) !== get(ia, field)) issue(issues, "CON_AUTO_LAYOUT_CHANGED", `autoLayout.${field} changed.`, sourceNode.figmaNodeId);
    if (!equalNumber(get(sa, "spacing"), get(ia, "spacing"))) issue(issues, "CON_AUTO_LAYOUT_CHANGED", "autoLayout.spacing changed.", sourceNode.figmaNodeId);
    if (JSON.stringify(get(sa, "padding")) !== JSON.stringify(get(ia, "padding"))) issue(issues, "CON_AUTO_LAYOUT_CHANGED", "autoLayout.padding changed.", sourceNode.figmaNodeId);
  }
}

function validateText(sourceNode: ManifestNode, target: IrNode, issues: ContractIssue[]): void {
  if (!target.configuredPrefabPath) issue(issues, "CON_TEXT_PREFAB_MISSING", "Text configuredPrefabPath missing.", sourceNode.figmaNodeId);
  const text = target.components?.text; const source = sourceNode.text as unknown as JsonObject | undefined;
  if (!text || !source) { issue(issues, "CON_TEXT_COMPONENT_MISSING", "Tagged text data missing.", sourceNode.figmaNodeId); return }
  const actualText = text.text ?? text.content;
  if (actualText !== source.content) issue(issues, "CON_TEXT_VALUE_CHANGED", "Text content changed.", sourceNode.figmaNodeId);
  for (const field of ["fontSize", "color", "horizontalAlignment", "verticalAlignment", "lineHeight", "letterSpacing"]) {
    if (source[field] !== undefined && text[field] !== source[field]) issue(issues, "CON_TEXT_STYLE_CHANGED", `Text ${field} changed.`, sourceNode.figmaNodeId);
  }
  if (typeof source.rotation === "number" && !equalNumber(text.rotation, -source.rotation)) issue(issues, "CON_TEXT_ROTATION_INVALID", "Text rotation was not converted to Unity coordinates.", sourceNode.figmaNodeId);
}

function validateImages(ir: IrDocument, nodes: Map<string, IrNode>, issues: ContractIssue[]): void {
  const assets = new Map<string, JsonObject>();
  for (const asset of ir.assets ?? []) if (typeof asset.key === "string") assets.set(asset.key, asset);
  for (const [id, node] of nodes) {
    if (!hasComponent(node, "image")) continue;
    const sprite = node.components?.image?.sprite;
    if (typeof sprite !== "string" || !sprite.startsWith("asset:")) { issue(issues, "CON_IMAGE_REFERENCE_MISSING", "Image asset reference missing.", id); continue }
    const asset = assets.get(sprite.slice(6));
    if (!asset) { issue(issues, "CON_IMAGE_ASSET_MISSING", `Undeclared image asset ${sprite}.`, id); continue }
    if (asset.exportMode !== "node") issue(issues, "CON_IMAGE_EXPORT_MODE", "Image asset must use exportMode=node.", id);
    if (asset.figmaNodeId !== id && asset.sharedAsset !== true) issue(issues, "CON_IMAGE_NODE_MISMATCH", "Image is bound to another node's bitmap.", id);
    if (asset.sharedAsset === true && typeof asset.sourceAssetNodeId !== "string") issue(issues, "CON_SHARED_ASSET_SOURCE_MISSING", "Shared asset sourceAssetNodeId missing.", id);
  }
}
