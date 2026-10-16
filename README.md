# Vant Figma 预制体工具

`@kevlns/figma-to-uprefab`

## 功能

将 Figma 标记画板导出为源数据和图片，通过 Unity 转换器生成 UGUI 预制体。

## 环境要求

Node.js 20 及以上、Windows、Unity 2022.3；目标工程需提供 Vant.Framework.dll 中的 Vant.System.UI。

## 安装

```sh
npm install -g @kevlns/figma-to-uprefab
```

## 快速开始

```sh
figma-to-uprefab config init --project <工程目录>
figma-to-uprefab doctor --project <工程目录>
```

## 使用说明

### 工程配置

配置文件为 `~/.config/figma-to-uprefab/config.json`，可通过 `FIGMA_TO_UPREFAB_CONFIG` 指定路径。`projects` 以规范化工程绝对路径为键。`FIGMA_ACCESS_TOKEN` 优先于工程配置中的 `figmaAccessToken`；令牌不进入版本库、源数据、图片、IR 或构建报告。

```json
{"schemaVersion":1,"projects":{"c:/projects/game":{"uiSystem":"UGUI"}}}
```

界面系统使用 `UGUI`。其他值返回 `CFG_UISYSTEM_UNSUPPORTED`。完整字段见 `schemas/user-config.schema.json`。

### 导出与构建

```sh
figma-to-uprefab unity install --project <工程目录>
figma-to-uprefab export <fileKey> --project <工程目录>
figma-to-uprefab contract --project <工程目录> --allow-missing-ir
figma-to-uprefab build --project <工程目录>
figma-to-uprefab contract --project <工程目录>
```

Node 导出源清单、节点 PNG 和根索引，执行配置与契约校验。Unity C# 转换器负责源数据到 IR、IR 到预制体的转换。`export` 和 `contract` 不修改 Unity 工程；`unity install` 安装转换器，`build` 运行 Unity 并写入暂存产物。

### 输出结构

```text
<stagingRoot>/figma-roots.index.json
<stagingRoot>/<PrefabName>/
  <PrefabName>.prefab
  <PrefabName><Container><Cell>.prefab
  Assets/
  Meta/
    <PrefabName>.source.json
    <PrefabName>.ir.json
    <PrefabName>.approximation.json
```

近似配置使用 `schemaVersion: 1`，通过根节点和 `figmaNodeId` 定位；字段受 `schemas/approximation-overlay.schema.json` 限定，每项必须给出 `reason`。转换器将它合并到 `IR.layout.approximation`，不改写源清单。

### 诊断与写入边界

`doctor` 只读检查环境。安装支持预演、哈希回执、改动检测和失败回滚。路径越界返回 `PAT_TRAVERSAL`；令牌始终脱敏。构建结果以 Unity 退出码和报告 JSON 为准，不能以 Node 构建通过代替 Unity 验证。

## 开发与验证

```sh
npm ci
npm run check
npm run test:package
```

命令返回、结构校验、模拟测试与外部平台实际运行分别核验。发布版本和依赖以随包 `package.json` 为准。

## 文档

[Agent 调用规范](AGENTS.md) · [文档规范](docs/documentation.md) · [Build request/report protocol](docs/build-protocol.md)

## 许可与版权

本工具采用 [MIT 许可](LICENSE)。Copyright © 2026 Vant。Vant 为工具集品牌；Figma、Unity、Steam、微信及其组件归各自权利人所有，第三方组件适用各自许可。
