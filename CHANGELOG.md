# Changelog

All notable changes to @kevlns/figma-to-uprefab are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.1.1] - 2026-10-08

### Fixed
- CI detects Figma credential values instead of flagging HTTP header names.
- Quick start validates source before build and the complete source/IR contract after build.
- Updated fast-uri, brace-expansion, js-yaml and source-map-js patch versions to resolve high-severity dependency advisories.

### Added
- Single user-level config file `~/.config/figma-to-uprefab/config.json`
  (overridable via `FIGMA_TO_UPREFAB_CONFIG`) with per-project sections keyed
  by normalized absolute project path (`schemas/user-config.schema.json`),
  including a `uiSystem` field (`UGUI` | `NGUI`).
- `uiSystem`: `UGUI` default; NGUI fails closed in both Node (`config validate`
  issue) and the C# converter (`CFG_UISYSTEM_UNSUPPORTED`).
- `config migrate`: folds legacy `figma-to-uprefab.json` +
  `figma-to-uprefab.local.json` into the user config and renames them to
  `*.migrated` (tokens are stripped, never copied).
- Token resolvable from the user config project section
  (`figmaAccessToken`); `FIGMA_ACCESS_TOKEN` env takes precedence. Config
  tokens are registered with the log redactor on startup.
- Build writes a token-free `resolved-config.json` into
  `Library/figma-to-uprefab/` for the C# converter.
- Build fails fast on a non-UGUI `uiSystem` (`CFG_UISYSTEM_UNSUPPORTED`)
  before writing `resolved-config.json` or spawning Unity batch.

### Changed
- **BREAKING**: the two-file project config (tracked `figma-to-uprefab.json` +
  ignored `figma-to-uprefab.local.json`) and the `~/.config/figma-to-uprefab/secret.json`
  user secret file are replaced by ONE user-level config file
  `~/.config/figma-to-uprefab/config.json` with per-project sections. Legacy
  files fail closed with `CFG_LEGACY_CONFIG_FOUND` until migrated via
  `figma-to-uprefab config migrate --project <path>`.
- Token priority is now env > user config (`FIGMA_ACCESS_TOKEN` preferred over
  the project section's `figmaAccessToken`).

### Removed
- Tracked/local project config schemas (`schemas/project-config.schema.json`,
  `schemas/project-config-local.schema.json`) and secret-file support
  (`~/.config/figma-to-uprefab/secret.json`, `FIGMA_TO_UPREFAB_SECRET`).

### Fixed
- `*.migrated` legacy config files (produced by `config migrate`; the renamed
  local file may still contain a real `figmaAccessToken`) are now gitignored
  so they cannot be committed.

## [0.1.0] - 2026-08-26

First reviewable milestone.

### Changed (review pass)
- Restored the real `Vant.System.UI` dependency: removed the framework stubs;
  the asmdef now references `Vant.Framework`, and the embedded converter
  authors runtime-faithful components (`ReferenceContainerGenerator`,
  `CachedListComponent`/`CachedGridComponent`, `FigmaAutoLayoutGroup`).
- Project paths (`textPrefab`, `specialListPrefab`, `specialGridPrefab`,
  `formalPrefabRoot`, `formalSpriteRoot`) moved from C# hardcodes into the
  tracked config; the project root is now derived from the config location
  (`unity.projectPath` was removed so configs stay machine-independent).
- Installer hardened: payload identity check, staged install + verify,
  receipt with package version, atomic rollback of both tree and receipt,
  symlink rejection; `build` verifies install integrity against the receipt
  and pre-runs the contract gate.
- Contract validation rewritten to port the original PowerShell checks
  (per-node geometry/semantics/visibility, translated names, text styles with
  rotation sign, RCG skins, image bindings) plus canonical path enforcement.
- Overlay validation now requires root identity match and non-empty
  approximation entries.

### Fixed (final review pass)
- Token redaction is now wired into the shared CLI logger (previously the
  logger printed raw text); the fallback pattern no longer masks our own
  SCREAMING_SNAKE_CASE error codes, and regression tests cover both.
- `doctor` never prints even a masked token prefix/suffix anymore; presence
  is reported as text only.
- `CliError` output no longer double-prefixes the code (`CODE: CODE: ...`).
- pack-guard requires `schemas/project-config-local.schema.json` so the local
  override contract cannot silently disappear from the tarball.
- The Unity menu entrypoint no longer calls `EditorApplication.Exit` outside
  batch mode (it used to close the editor); batch behavior is unchanged.
- Removed dead `makeRedactor` / `redactAll`; added `downloadBytes` retry tests.

### Validated
- `npm run check` green (65 tests).
- Real Unity compile: embedded UPM installed into an isolated Unity
  2022.3.59f1c1 project compiled to `Kevlns.FigmaToUprefab.Editor.dll`
  with exit code 0 (`scripts/check-unity-compile.mjs` reproduces the csc-level
  gate against Unity DLLs + `Vant.Framework.dll`).

### Added
- Package scaffolding: `@kevlns/figma-to-uprefab@0.1.0`, ESM, Node >= 20,
  bin `figma-to-uprefab`, strict TS, eslint, vitest, CI, pack guard, package
  install smoke test.
- Authoritative JSON Schemas (`schemas/`): project-config, source-manifest,
  root-index, approximation-overlay, ir; TS validates against them with stable
  `SCH_*` / `CFG_*` error codes.
- CLI: `setup`, `config init/validate`, `export`, `contract`, `doctor`,
  `agent docs`, `unity install/status/uninstall`, `build`.
- Deterministic export ported from the PowerShell exporter: multi-page `[root]`
  discovery, hidden/nested/duplicate handling, raw names/layout/text, node-scoped
  PNGs, timeouts, bounded 429/5xx retry, image batching, atomic publish, token
  redaction, path safety, fixture injection.
- Approximation overlay: independent, schemaVersion-1, root+figmaNodeId keyed,
  whitelisted fields, mandatory reason; merged by the C# converter into
  `IR.layout.approximation`; source manifests are never rewritten.
- Embedded Unity package `com.kevlns.figma-to-uprefab`: C# Editor converter
  (source + overlay -> IR -> Prefab), requires Vant.Framework,
  token-free config, parameterless batch entrypoint (request/report protocol),
  legacy `Assets/Vant-Framework/Editor/FigmaPrefab` fail-closed guard.
- Tests: config split, root discovery hidden/nested/duplicate, layout/text,
  contract, overlay does not mutate source, token redaction, path traversal,
  installer dry-run/receipt/modification detection, package manifest.

### Changed
- Canonical staging layout now places `Meta/<name>.source.json` and
  `Meta/<name>.ir.json` under each root's `Meta/` directory (old fixtures
  updated accordingly).
