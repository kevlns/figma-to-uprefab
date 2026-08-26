/**
 * Node-scoped PNG export, ported from the PowerShell exporter with batching.
 *
 * For every node tagged with the `image` component, the exporter asks Figma
 * to render that exact node and downloads the PNG into the root's own
 * `Assets/` directory. IDs are batched (Figma limits ids per images request);
 * each batch is retried via FigmaTransport. Files are published atomically.
 */

import { join } from "node:path";
import { assertInsideBase, atomicWriteFile } from "../core/atomic.js";
import { chunk, downloadBytes, type FigmaTransport } from "../core/http.js";
import type { FigmaImagesResponse } from "./types.js";
import type { ManifestAsset } from "./manifest.js";

export interface ExportAssetsOptions {
  fileKey: string;
  transport: FigmaTransport;
  /** Project-relative staging root for this root, e.g. Assets/.../_Staging/X. */
  stagingPath: string;
  /** Absolute project root used to resolve destPath for writing. */
  projectRoot: string;
  imageNodeIds: string[];
  imageScale?: number;
  batchSize?: number;
  /** Inject raw byte source for tests (keyed by image URL). */
  bytesOverride?: (url: string) => Promise<ArrayBuffer>;
}

export interface ExportAssetsResult {
  assets: ManifestAsset[];
  written: string[];
}

export function assetKeyFor(nodeId: string): string {
  const sanitized = nodeId.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  return `figma_${sanitized}`;
}

export async function exportNodeAssets(options: ExportAssetsOptions): Promise<ExportAssetsResult> {
  const scale = options.imageScale ?? 1;
  const batchSize = options.batchSize ?? 50;
  const assets: ManifestAsset[] = [];
  const written: string[] = [];

  // Two-pass: first fetch all image URLs (batched), then download all bytes.
  const imageNodeIds = options.imageNodeIds;
  const urlById = new Map<string, string>();
  for (const batch of chunk(imageNodeIds, batchSize)) {
    const ids = batch.join(",");
    const images = await options.transport.get<FigmaImagesResponse>(
      `images/${encodeURIComponent(options.fileKey)}?ids=${encodeURIComponent(ids)}&format=png&scale=${encodeURIComponent(String(scale))}`,
    );

    for (const id of batch) {
      const url = images.images[id];
      if (!url) {
        throw new Error(`Figma could not render tagged image node: ${id}`);
      }

      urlById.set(id, url);
    }
  }

  for (const nodeId of imageNodeIds) {
    const url = urlById.get(nodeId)!;
    const key = assetKeyFor(nodeId);
    const relDest = `${stagingRelative(options.stagingPath)}/Assets/${key}.png`;
    const absDest = join(options.projectRoot, relDest.split("/").join("\\"));
    assertInsideBase(options.projectRoot, absDest, relDest);

    const bytes = options.bytesOverride
      ? await options.bytesOverride(url)
      : await downloadBytes(url);

    // Canonical forward-slash path stored in the manifest.
    const destPath = relDest.replace(/\\/g, "/");
    atomicWriteFile(absDest, Buffer.from(bytes));
    written.push(absDest);

    assets.push({
      key,
      format: "png",
      figmaNodeId: nodeId,
      exportMode: "node",
      destPath,
      import: { textureType: "Sprite" },
    });
  }

  return { assets, written };
}

function stagingRelative(stagingPath: string): string {
  return stagingPath.replace(/[\\/]+$/, "");
}
