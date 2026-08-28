# AGENTS.md — @kevlns/figma-to-uprefab

> This file is the canonical Agent specification ("正本"). Agents operating on
> this package MUST follow it. `figma-to-uprefab agent docs` prints this file.

## 1. What this package does

`@kevlns/figma-to-uprefab` converts tagged Figma frames into staging-only Unity
UGUI prefabs. Architecture is split by a hard boundary:

- **Node** (this CLI): Figma REST -> source manifest + node-scoped PNGs; user
  config/schema/contract validation; approximation overlay validation; Unity
  install & build orchestration.
- **C#** (embedded UPM package `com.kevlns.figma-to-uprefab`): the ONLY
  source->IR->Prefab converter. Node never converts source to IR.

## 2. Hard constraints

1. **No Node source->IR converter.** Node writes source manifests + PNGs + the
   root index only. IR and prefabs are produced by the C# converter via
   `figma-to-uprefab build` (request/report protocol).
2. **Source manifest is immutable by overlays.** An approximation overlay never
   rewrites `<name>.source.json`. It is merged by the C# converter into
   `IR.layout.approximation` at build time.
3. **Overlay contract**: schemaVersion 1, keyed by root + `figmaNodeId`, only
   the approximation whitelist fields (see `schemas/approximation-overlay.schema.json`),
   and every entry MUST carry a `reason`.
4. **Canonical output** (staging only):
   ```
   <stagingRoot>/figma-roots.index.json
   <stagingRoot>/<PrefabName>/
     <PrefabName>.prefab            # root prefab
     <PrefabName>...<Cell>.prefab   # item prefabs (C#)
     Assets/                        # node-scoped PNGs
     Meta/
       <PrefabName>.source.json
       <PrefabName>.ir.json
       <PrefabName>.approximation.json  # optional overlay
   ```
5. **Side effects**: `export` and `contract` have NO Unity project side effects.
   Only `unity install` modifies the project (`config init` writes the user
   config, not the project).
6. **Tokens**: resolved from `FIGMA_ACCESS_TOKEN` (preferred) or the
   per-project `figmaAccessToken` inside the user config
   `~/.config/figma-to-uprefab/config.json` (projects map keyed by normalized
   absolute project path). Never stored in tracked repo files, never logged
   (registered with the redactor on startup), never copied into
   source/IR/PNG/reports or the build-time resolved-config.json.

## 3. Commands

| Command | Purpose | Side effects |
| --- | --- | --- |
| `setup <project>` | add the current project's section to the user config | writes user config (not the project) |
| `config init` | add a project section (defaults, `uiSystem` UGUI) to the user config | writes user config |
| `config validate` | validate the user config project section, token presence, `uiSystem` | none |
| `config migrate` | fold legacy `figma-to-uprefab.json`/`.local.json` into the user config (renames them to `*.migrated`) | writes user config, renames legacy files |
| `export <fileKey>` | source manifests + PNGs + root index | writes staging only |
| `contract` | validate staging layout vs schemas + invariants | none |
| `doctor` | read-only diagnostics | none |
| `agent docs` | print/export AGENTS.md | none |
| `unity install/status/uninstall` | manage embedded UPM package | install/uninstall write project |
| `build` | run C# converter in Unity batch (request/report) | runs Unity, writes IR+prefabs to staging |

## 4. Error routing

Errors are machine-readable `CODE` strings. Group prefixes:
`CFG_*` config, `SCH_*` schema, `TOK_*` token, `PAT_*` path safety,
`RST_*` Figma REST, `DSC_*` discovery, `EXP_*` export, `LYT_*` layout/text,
`OVL_*` overlay, `CON_*` contract, `UNI_*` Unity install/status,
`BLD_*` build. Agents should surface the code + message verbatim.

User-config `CFG_*` codes: `CFG_USER_FILE_MISSING`, `CFG_USER_JSON_INVALID`,
`CFG_USER_SCHEMA_INVALID`, `CFG_LEGACY_CONFIG_FOUND`,
`CFG_PROJECT_CONFIG_MISSING`, `CFG_PROJECT_CONFIG_EXISTS`,
`CFG_MIGRATE_NOTHING_TO_MIGRATE`, `CFG_MIGRATE_SOURCE_INVALID`,
`CFG_MIGRATE_RESULT_INVALID`, `CFG_ACTION_UNKNOWN`, and
`CFG_UISYSTEM_UNSUPPORTED` (fail-closed for non-UGUI: rejected by Node before
Unity batch runs, and again by the C# converter).

## 5. Security & safety

- **Path safety**: all writes go through `assertInsideBase`/`safeJoin`; a path
  escaping its base is `PAT_TRAVERSAL` and is rejected.
- **Token redaction**: `Redactor` masks registered secrets before any log line.
  Never echo `figmaAccessToken`.
- **Unity install**: explicit, dry-run supported, hash receipt in
  `<project>/Library/figma-to-uprefab/install-receipt.json`, modification
  detection fails closed, atomic install with rollback.
- **Build fails closed** when the Unity package is not installed, when the
  receipt is missing, or when Unity is running (unless `--allow-running-editor`).
- **Build handoff**: build writes a token-free resolved-config.json into
  `Library/figma-to-uprefab/` for the C# converter (which reads `uiSystem` and
  fails closed with `CFG_UISYSTEM_UNSUPPORTED` for non-UGUI).
- **Do not fabricate Unity compile results.** A build outcome is only accepted
  from Unity's exit code + the report JSON.

## 6. Translations

Business `translations` (Chinese layer names -> English identifiers) may only
appear in `examples/` and `tests/fixtures/`. The shipped defaults and fixtures
carry no real business data.

## 7. Skills

This package does NOT install skills into any agent framework. It provides
agent documentation only (`agent docs`). `v-cli.plugin.json` is shipped for
v-cli integration but v-cli itself is never modified.
