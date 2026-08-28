/**
 * Stable, machine-readable error codes for @kevlns/figma-to-uprefab.
 *
 * Every surfaced failure uses a stable `code` so agents and CI can route
 * errors deterministically. Codes are grouped by subsystem prefix:
 *   CFG_*   user config / project config
 *   SCH_*   JSON Schema validation
 *   TOK_*   token handling (never logs the token itself)
 *   PAT_*   path safety
 *   RST_*   Figma REST transport
 *   DSC_*   root discovery
 *   EXP_*   source manifest / PNG export
 *   LYT_*   layout / text extraction
 *   OVL_*   approximation overlay
 *   CON_*   contract validation
 *   UNI_*   Unity install / status / batch orchestration
 *   BLD_*   build orchestration
 *   DOC_*   agent docs
 */

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details?: string;

  constructor(code: string, message: string, exitCode = 1, details?: string) {
    super(`${code}: ${message}`);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

/** Convenience constructors for the most common classes of failure. */
export const errors = {
  tokenMissing(): CliError {
    return new CliError(
      "TOK_MISSING",
      "Set FIGMA_ACCESS_TOKEN or add figmaAccessToken to the project section of the user config (~/.config/figma-to-uprefab/config.json).",
    );
  },

  schemaInvalid(schemaName: string, details: string): CliError {
    return new CliError("SCH_INVALID", `${schemaName} failed JSON Schema validation.`, 1, details);
  },

  stagingRootInvalid(root: string): CliError {
    return new CliError(
      "PAT_STAGING_ROOT_INVALID",
      `StagingRoot must resolve inside a _Staging folder: ${root}`,
    );
  },

  pathEscape(rel: string): CliError {
    return new CliError("PAT_TRAVERSAL", `Refusing path that escapes its base directory: ${rel}`);
  },

  rootNotFound(): CliError {
    return new CliError("DSC_ROOT_NOT_FOUND", "Figma file contains no valid FRAME with a [root] tag.");
  },

  noPages(): CliError {
    return new CliError("DSC_PAGE_MISSING", "Figma file has no canvases/pages.");
  },

  rootNested(name: string, ancestor: string): CliError {
    return new CliError(
      "DSC_ROOT_NESTED",
      `Figma layer '${name}' is nested under Figma root '${ancestor}'. Each prefab root must be independent.`,
    );
  },

  rootNodeTypeUnsupported(name: string, type: string): CliError {
    return new CliError(
      "DSC_ROOT_NODE_TYPE_UNSUPPORTED",
      `Figma layer '${name}' must be a Figma FRAME, but was ${type}.`,
    );
  },

  rootPrefabNameDuplicate(duplicates: string[]): CliError {
    return new CliError(
      "DSC_ROOT_PREFAB_NAME_DUPLICATE",
      `Every discovered root must have a unique [name=...]. Duplicates: ${duplicates.join(", ")}`,
    );
  },

  rootNameMissing(name: string): CliError {
    return new CliError(
      "DSC_ROOT_NAME_MISSING",
      `Figma root '${name}' must include a non-empty [name=...] tag.`,
    );
  },

  rootNameInvalid(name: string, prefabName: string): CliError {
    return new CliError("DSC_ROOT_NAME_INVALID", `Figma root '${name}' has an unsafe prefab name: ${prefabName}`);
  },

  identifierTranslationMissing(layer: string, source: string): CliError {
    return new CliError(
      "EXP_IDENTIFIER_TRANSLATION_MISSING",
      `Figma layer '${layer}' is missing an English translation for '${source}'.`,
    );
  },

  overlayMissing(path: string): CliError {
    return new CliError("OVL_FILE_MISSING", `Approximation overlay file was not found: ${path}`);
  },

  overlayInvalid(details: string): CliError {
    return new CliError("OVL_SCHEMA_INVALID", "Approximation overlay failed schema validation.", 1, details);
  },

  unityNotInstalled(project: string): CliError {
    return new CliError(
      "UNI_NOT_INSTALLED",
      `The com.kevlns.figma-to-uprefab Unity package is not installed in ${project}. Run 'figma-to-uprefab unity install'.`,
    );
  },

  unityRunning(): CliError {
    return new CliError(
      "UNI_RUNNING",
      "Unity Editor is currently running. Close it (or use --allow-running-editor) before batch build.",
    );
  },

  unityNotFound(editorPath: string): CliError {
    return new CliError(
      "UNI_EDITOR_NOT_FOUND",
      `Unity Editor executable was not found at ${editorPath}. Set unity.editorPath in the user config.`,
    );
  },

  unityUnsupportedPlatform(): CliError {
    return new CliError("UNI_PLATFORM_UNSUPPORTED", "Unity install/status/build is only supported on win32 in this milestone.");
  },

  buildFailed(details: string): CliError {
    return new CliError("BLD_FAILED", "Unity build reported errors.", 1, details);
  },
};

/** Default (untracked, non-Vant-specific) staging root when the user config omits it. */
export const DEFAULT_STAGING_ROOT = "Assets/Arts/Game/FigmaAssets/_Staging";

/** Default base UI prefab variant used by the C# converter when config omits it. */
export const DEFAULT_BASE_UI_PREFAB = "Assets/Arts/Game/Prefabs/UI Common/ui_base.prefab";
