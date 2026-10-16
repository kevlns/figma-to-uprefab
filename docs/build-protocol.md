# Vant Figma 构建协议

## 定位

`figma-to-uprefab build` 由 Node 写入请求，运行 Unity C# 转换器，再读取构建报告。源清单到 IR 的转换在 Unity 中完成。

## 前置条件

目标工程已安装并校验转换器包，提供 Vant.Framework.dll。编辑器路径、工程配置、源数据和暂存图片通过检查。

## 字段与示例

### 请求

请求位于 `<project>/Library/figma-to-uprefab/request.json`，可通过 `FIGMA_TO_UPREFAB_REQUEST` 指定位置。

```json
{"schemaVersion":1,"mode":"convert-and-build","rootIndexPath":"Assets/Arts/Game/FigmaAssets/_Staging/figma-roots.index.json","configPath":"<project>/Library/figma-to-uprefab/resolved-config.json","overlaySuffix":".approximation.json"}
```

Node 从用户配置解析非敏感字段，将 schemaVersion、uiSystem、预制体路径和 tagMappings 写入 resolved-config.json，令牌不进入此文件。configPath 由 Node 写成绝对路径；转换器也接受工程相对路径。其他请求路径采用工程相对路径。

### 转换入口

通过 `-executeMethod` 调用 `Kevlns.Editor.FigmaToUprefab.FigmaPrefabCliBatch.Run`，读取请求与解析配置，逐根节点合并近似配置、生成 IR 和暂存预制体，最后写入报告并返回退出码。

### 报告

报告位于 `<project>/Library/figma-to-uprefab/report.json`。

```json
{"schemaVersion":1,"status":"ok","entries":[],"issues":[]}
```

entries 的每项包含 figmaNodeId、prefabName、errorCode、errorMessage、conversion 和 build。所有根节点成功时 status 才为 ok；失败时为 error，Node 返回 BLD_FAILED 和问题摘要。

## 执行边界

uiSystem 使用 UGUI，其他值在 Node 和 C# 两侧均返回 CFG_UISYSTEM_UNSUPPORTED。转换器不改写源清单，不将暂存文件直接提升为运行时资源。

| 条件 | 错误码 |
| --- | --- |
| 转换器未安装 | UNI_NOT_INSTALLED |
| 安装回执缺失 | UNI_RECEIPT_MISSING |
| 编辑器占用且未明确允许 | UNI_RUNNING |
| 编辑器路径不可用 | UNI_EDITOR_NOT_FOUND |
| 源数据或图片契约无效 | BLD_CONTRACT_INVALID |

## 结果验证

同时核对 Unity 退出码、报告的根节点结果与完整 contract 校验。仅有请求文件或 Node 进程成功不代表预制体构建成功。

## 参考资料

[使用说明](../README.md) · [Agent 规范](../AGENTS.md) · [文档规范](documentation.md)
