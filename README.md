# @kevlns/figma-to-uprefab

Figma REST -> staging-only Unity UGUI prefabs, with a hard Node/C# split.

- **Node** CLI: Figma export to source manifests + node-scoped PNGs, schema
  validation, approximation overlay validation, contract checks, Unity package
  install/status/uninstall, and build orchestration.
- **Embedded Unity package** `com.kevlns.figma-to-uprefab` (C#): the *only*
  converter from source manifest (+ optional approximation overlay) to IR to
  Prefab.

## Requirements

- Node >= 20
- Windows (Unity install/status/build are Windows-first in this milestone)
- Unity 2022.3 project (the C# payload targets 2022.3)
- The **Vant Framework** runtime assembly (`Vant.Framework.dll`) in the target
  project: the embedded converter references `Vant.System.UI`
  (`ReferenceContainerGenerator`, `CachedListComponent`/`CachedGridComponent`,
  `FigmaAutoLayoutGroup`) to author runtime-faithful prefab skeletons. Without
  it the C# package will not compile in the project.

## Install

```bash
npm i -g @kevlns/figma-to-uprefab
# or run from source
npm install && npm run build
```

Set a token (export requires it; never put it in tracked config):

```bash
export FIGMA_ACCESS_TOKEN=<your-token>   # preferred
# or: ~/.config/figma-to-uprefab/secret.json -> { "figmaAccessToken": "..." }
```

## Quick start

```bash
# 1. Initialize the tracked config in a Unity project
figma-to-uprefab setup C:/path/to/UnityProject

# 2. Install the embedded Unity converter package (modifies the project)
figma-to-uprefab unity install --project C:/path/to/UnityProject

# 3. Export a Figma file into staging (no Unity side effects)
figma-to-uprefab export <fileKey> --project C:/path/to/UnityProject

# 4. Validate staging layout
figma-to-uprefab contract --project C:/path/to/UnityProject

# 5. Run the C# converter in Unity batch (source + overlay -> IR -> prefabs)
figma-to-uprefab build --project C:/path/to/UnityProject
```

## Commands

| Command | Description |
| --- | --- |
| `setup <project>` | write tracked `figma-to-uprefab.json` into a project |
| `config init\|validate` | manage tracked config |
| `export <fileKey>` | Figma REST -> source manifests + PNGs + root index |
| `contract` | validate staging layout vs schemas + invariants |
| `doctor` | read-only diagnostics |
| `agent docs` | print/export the canonical AGENTS.md |
| `unity install\|status\|uninstall` | manage the embedded UPM package (dry-run, receipt, modification detection) |
| `build` | run the C# converter in Unity batch (request/report) |

## Canonical staging layout

```
<stagingRoot>/figma-roots.index.json
<stagingRoot>/<PrefabName>/
  <PrefabName>.prefab
  <PrefabName><Container><Cell>.prefab
  Assets/
  Meta/
    <PrefabName>.source.json
    <PrefabName>.ir.json
    <PrefabName>.approximation.json   # optional overlay
```

## Approximation overlays

Overlays are independent, schemaVersion-1 documents keyed by root +
`figmaNodeId`. They only allow whitelisted approximation fields and every entry
requires a `reason`. The C# converter merges them into `IR.layout.approximation`
and never rewrites the source manifest. See
`schemas/approximation-overlay.schema.json`.

## Security

- Tokens come from `FIGMA_ACCESS_TOKEN` or the per-user secret file; never from
  tracked/local config; always redacted in logs.
- All writes are path-safety-checked and published atomically.
- Unity installs are dry-run-able, receipted, modification-detecting, and
  atomic with rollback.

## Documentation

See [AGENTS.md](./AGENTS.md) (canonical agent spec), `docs/`, and the JSON
Schemas under `schemas/`.

## License

MIT
