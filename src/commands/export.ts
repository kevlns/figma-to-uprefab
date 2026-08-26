/**
 * `export <fileKey>`: Figma REST -> source manifests + node PNGs + root index.
 * No Unity side effects.
 */

import { readConfig, resolveToken } from "../core/config.js";
import { errors } from "../core/errors.js";
import { FigmaTransport } from "../core/http.js";
import { runExport, type ExportOptions } from "../figma/export.js";

export interface ExportCommandOptions {
  fileKey: string;
  projectPath?: string;
  configPath?: string;
  discoveryDocumentPath?: string;
  nodeDocumentDirectory?: string;
  discoveryOnly?: boolean;
  imageScale?: number;
  /** Test injection: bypass network, use a fake transport. */
  transport?: FigmaTransport;
}

export async function exportCommand(options: ExportCommandOptions): Promise<{
  rootCount: number;
  index: unknown;
  warnings: string[];
  writtenFiles: string[];
}> {
  const resolved = readConfig(options.projectPath, options.configPath);
  const { stagingRoot, projectPath, translations } = resolved.effective;

  let transport = options.transport;
  const networkNeeded = !(options.discoveryOnly && options.discoveryDocumentPath);
  if (!transport && networkNeeded) {
    const token = resolveToken();
    if (!token) {
      throw errors.tokenMissing();
    }

    transport = new FigmaTransport({ token });
  }

  const variantFrom = resolved.effective.baseUiPrefab;
  const exportOptions: ExportOptions = {
    fileKey: options.fileKey,
    config: {
      projectPath,
      stagingRoot,
      variantFrom,
      translations,
    },
    transport,
    discoveryDocumentPath: options.discoveryDocumentPath,
    nodeDocumentDirectory: options.nodeDocumentDirectory,
    discoveryOnly: options.discoveryOnly,
    imageScale: options.imageScale,
  };

  const result = await runExport(exportOptions);
  return {
    rootCount: result.rootEntries.length,
    index: result.index,
    warnings: result.warnings,
    writtenFiles: result.writtenFiles,
  };
}
