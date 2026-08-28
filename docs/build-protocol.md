# Build request/report protocol

`figma-to-uprefab build` orchestrates the C# converter in Unity batch mode.
Node writes a request, Unity runs the parameterless entrypoint, then Node reads
the report. Node never converts source -> IR.

## Request

Written by Node to `<project>/Library/figma-to-uprefab/request.json`:

```json
{
  "schemaVersion": 1,
  "mode": "convert-and-build",
  "rootIndexPath": "Assets/Arts/Game/FigmaAssets/_Staging/figma-roots.index.json",
  "configPath": "<project>/Library/figma-to-uprefab/resolved-config.json",
  "overlaySuffix": ".approximation.json"
}
```

The `configPath` points at the **token-free resolved config** written by Node
for each build: Node resolves the user-config project section
(`~/.config/figma-to-uprefab/config.json`, projects map keyed by normalized
absolute project path) and writes `Library/figma-to-uprefab/resolved-config.json`
containing only non-secret fields (`schemaVersion`, `uiSystem`, prefab/root
paths, `tagMappings`). The Figma access token is resolved by Node only and is
never written into the resolved config. The C# converter reads `uiSystem` from
it and fails closed with `CFG_UISYSTEM_UNSUPPORTED` for anything other than
UGUI (empty/missing falls back to UGUI); Node also rejects non-UGUI
`uiSystem` up front with `CFG_UISYSTEM_UNSUPPORTED` before writing the
resolved config or spawning Unity.

`configPath` is written by Node as an ABSOLUTE path (the resolved
`<project>/Library/figma-to-uprefab/resolved-config.json`); the C#
`ResolveProjectPath` accepts both absolute paths and project-root-relative
paths, so hand-written requests may use either form. All other paths in the
request are project-relative (Unity-style). An optional
`FIGMA_TO_UPREFAB_REQUEST` env var overrides the request location.

## Entrypoint

`Kevlns.Editor.FigmaToUprefab.FigmaPrefabCliBatch.Run` (public static, no args)
is invoked via `-executeMethod`. It:

1. detects the legacy `Assets/Vant-Framework/Editor/FigmaPrefab` and fails
   closed (UNI_LEGACY_VANT_FIGMA_PREFAB) until migrated;
2. reads the request + the build-time resolved config (token-free; see above);
3. per root: converts source manifest + optional overlay -> IR, writes
   `Meta/<name>.ir.json`, then builds the staging prefab;
4. writes the report and exits 0/1.

## Report

Written to `<project>/Library/figma-to-uprefab/report.json`:

```json
{
  "schemaVersion": 1,
  "status": "ok",
  "entries": [
    {
      "figmaNodeId": "25:148",
      "prefabName": "MonthlyCardDetail",
      "errorCode": null,
      "errorMessage": null,
      "conversion": { ... },
      "build": { ... }
    }
  ],
  "issues": []
}
```

`status` is `ok` only when every root built. `buildCommand` throws `BLD_FAILED`
with the summarized issue list when `status` is `error`.

## Fail-closed checks (Node side)

- package not installed -> `UNI_NOT_INSTALLED`
- package installed but no receipt -> `UNI_RECEIPT_MISSING`
- Unity running (unless `--allow-running-editor`) -> `UNI_RUNNING`
- Unity editor not found -> `UNI_EDITOR_NOT_FOUND`
