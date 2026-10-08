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

Set a token (export requires it). `FIGMA_ACCESS_TOKEN` wins over the config
file; tokens never go into tracked repo files:

```bash
export FIGMA_ACCESS_TOKEN=<your-token>   # preferred
# or: edit ~/.config/figma-to-uprefab/config.json and set figmaAccessToken
#     inside your project's section (see "User config" below)
```

## Quick start

```bash
# 1. Add this Unity project's section to the user config, then edit
#    ~/.config/figma-to-uprefab/config.json: set figmaAccessToken unless
#    FIGMA_ACCESS_TOKEN is set; keep uiSystem as UGUI (the default).
#    Optionally configure baseUiPrefab and the other project prefab paths.
figma-to-uprefab config init --project C:/path/to/UnityProject

# 2. Install the embedded Unity converter package (modifies the project)
figma-to-uprefab unity install --project C:/path/to/UnityProject

# 3. Export a Figma file into staging (no Unity side effects)
figma-to-uprefab export <fileKey> --project C:/path/to/UnityProject

# 4. Validate exported source and assets; build has not generated IR yet
figma-to-uprefab contract --project C:/path/to/UnityProject --allow-missing-ir

# 5. Run the C# converter in Unity batch (source + overlay -> IR -> prefabs)
figma-to-uprefab build --project C:/path/to/UnityProject

# 6. Validate the complete source/IR contract after build
figma-to-uprefab contract --project C:/path/to/UnityProject
```

## User config

One user-level file: `~/.config/figma-to-uprefab/config.json` (override the
location with the `FIGMA_TO_UPREFAB_CONFIG` env var). It holds a section per
Unity project, keyed by normalized absolute project path. Full contract:
`schemas/user-config.schema.json`.

```json
{
  "schemaVersion": 1,
  "projects": {
    "c:/path/to/unityproject": {
      "figmaAccessToken": "<your-token>",
      "uiSystem": "UGUI"
    },
    "c:/path/to/other-project": {
      "uiSystem": "UGUI",
      "staging": { "root": "Assets/Custom/_Staging" },
      "unity": { "editorPath": "C:/Program Files/Unity/Hub/Editor/2022.3.59f1c1/Editor/Unity.exe" }
    }
  }
}
```

- `figmaAccessToken`: optional per-project token; `FIGMA_ACCESS_TOKEN` env
  takes precedence. Never stored in tracked repo files, never logged
  (registered with the redactor on startup).
- `uiSystem`: `UGUI` (default) or `NGUI`. NGUI fails closed in both Node and
  the C# converter (`CFG_UISYSTEM_UNSUPPORTED`) in this milestone.
- Legacy `figma-to-uprefab.json` / `figma-to-uprefab.local.json` files fail
  closed (`CFG_LEGACY_CONFIG_FOUND`) until you run
  `figma-to-uprefab config migrate --project <path>`.

## Commands

| Command | Description |
| --- | --- |
| `setup <project>` | add the project's section to the user config (alias of `config init`) |
| `config init\|validate\|migrate` | manage the user config and its per-project sections |
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

- Tokens come from `FIGMA_ACCESS_TOKEN` (preferred) or the user config's
  per-project `figmaAccessToken`; never from tracked repo files; always
  redacted in logs.
- All writes are path-safety-checked and published atomically.
- Unity installs are dry-run-able, receipted, modification-detecting, and
  atomic with rollback.

## Documentation

See [AGENTS.md](./AGENTS.md) (canonical agent spec), `docs/`, and the JSON
Schemas under `schemas/`.

## License

MIT
