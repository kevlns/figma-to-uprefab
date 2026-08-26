# Changelog

All notable changes to @kevlns/figma-to-uprefab are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] - 2025-08-26

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
  (source + overlay -> IR -> Prefab), self-contained (no Vant.System.UI),
  token-free config, parameterless batch entrypoint (request/report protocol),
  legacy `Assets/Vant-Framework/Editor/FigmaPrefab` fail-closed guard.
- Tests: config split, root discovery hidden/nested/duplicate, layout/text,
  contract, overlay does not mutate source, token redaction, path traversal,
  installer dry-run/receipt/modification detection, package manifest.

### Changed
- Canonical staging layout now places `Meta/<name>.source.json` and
  `Meta/<name>.ir.json` under each root's `Meta/` directory (old fixtures
  updated accordingly).
