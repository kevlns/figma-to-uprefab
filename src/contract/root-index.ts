/** Root index document (canonical _Staging/figma-roots.index.json). */

export interface RootIndexEntry {
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

export interface RootIndex {
  schemaVersion: 1;
  source: {
    fileKey: string;
    discovery: "all-tagged-roots";
  };
  roots: RootIndexEntry[];
}
