/**
 * Public API surface for @kevlns/figma-to-uprefab.
 */

export { CliError, errors } from "./core/errors.js";
export { VERSION, PACKAGE_NAME } from "./version.js";
export { Redactor, maskToken } from "./core/redact.js";
export {
  assertInsideBase,
  safeJoin,
  forwardSlash,
  atomicWriteFile,
  toAssetPath,
} from "./core/atomic.js";
export { validateSchema, type SchemaName } from "./core/schema.js";
export {
  readConfig,
  resolveToken,
  defaultConfig,
  type ProjectConfig,
  type ResolvedConfig,
} from "./core/config.js";
export { FigmaTransport, chunk, type FigmaTransportOptions } from "./core/http.js";
export { discoverRoots, convertToIdentifier, testRootTag } from "./figma/discovery.js";
export {
  layoutManifest,
  textManifest,
  normalizeConstraint,
  normalizeAlignment,
  colorToHtml,
} from "./figma/layout.js";
export { buildSourceManifest, nodeComponents } from "./figma/manifest.js";
export { exportNodeAssets, assetKeyFor } from "./figma/assets.js";
export { runExport } from "./figma/export.js";
export { validateContract } from "./contract/contract.js";
export {
  loadOverlay,
  validateOverlayStructure,
  validateOverlayAgainstSource,
  approximationFromEntry,
  APPROXIMATION_FIELDS,
} from "./overlay/overlay.js";
export {
  installPackage,
  uninstallPackage,
  status as packageStatus,
  type InstallResult,
  type UninstallResult,
  type StatusResult,
} from "./core/installer.js";
export { sha256Tree, compareTree, sha256File } from "./core/integrity.js";
export { invokeUnityBatch, resolveEditorPath, unityStatus } from "./core/unity.js";
export { orchestrateBuild, writeBuildRequest, readBuildReport } from "./core/build.js";
export { doctorCommand } from "./commands/doctor.js";
export { contractCommand } from "./commands/contract.js";
export { exportCommand } from "./commands/export.js";
export { unityInstallCommand, unityStatusCommand, unityUninstallCommand } from "./commands/unity.js";
export { buildCommand } from "./commands/build.js";
export { agentsDocContent } from "./core/agent-docs.js";
