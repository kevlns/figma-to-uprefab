# Vant Figma 预制体工具 Agent 规范

## 定位

将 Figma 标记画板转换为 Unity UGUI 暂存预制体。Node 负责导出与调度，Unity C# 负责源清单到 IR、IR 到预制体的转换。本文件由 `figma-to-uprefab agent docs` 提供。

## 调用流程

1. 使用 `config init --project <工程目录>` 创建配置，核实 `FIGMA_ACCESS_TOKEN` 或工程 `figmaAccessToken`，运行 `config validate` 与 `doctor`。
2. 在目标工程安装 Unity 转换器，确认 Vant.Framework.dll 可用。
3. `export <fileKey>` 生成源清单和节点图片；`contract --allow-missing-ir` 校验源数据。
4. `build` 在 Unity 中生成 IR 与预制体；再次 `contract` 检查完整产物。

## 调用规范

### 数据和写入

Node 不执行源数据到 IR 的转换。近似配置为 schemaVersion 1，以根节点和 figmaNodeId 定位，字段受 schema 限定，每项包含 reason。转换器合并到 IR.layout.approximation，不修改源清单。产物目录见 README，构建请求与报告见 docs/build-protocol.md。

export 和 contract 只操作或读取暂存目录；unity install/uninstall 修改工程内的转换器包。config init 写入用户配置。安装支持预演、哈希回执、改动检测、原子替换与回滚；回执位于 Library/figma-to-uprefab/install-receipt.json。构建所需路径必须在工具规定的工程范围内，路径越界返回 PAT_TRAVERSAL。

### 配置与凭据

配置为 ~/.config/figma-to-uprefab/config.json，可通过 FIGMA_TO_UPREFAB_CONFIG 指定。projects 以规范化工程绝对路径为键。FIGMA_ACCESS_TOKEN 优先于配置中的 figmaAccessToken；凭据不进入版本库、source、IR、PNG、报告或 resolved-config.json，日志必须脱敏。uiSystem 使用 UGUI，其他值返回 CFG_UISYSTEM_UNSUPPORTED。

### 工程与错误

构建要求转换器已安装、回执有效且 Unity Editor 未占用工程；显式 --allow-running-editor 才改变占用检查。报告 CFG_*（配置）、SCH_*（结构）、TOK_*（令牌）、PAT_*（路径）、RST_*（Figma 请求）、DSC_*（节点发现）、EXP_*（导出）、LYT_*（布局）、OVL_*（近似配置）、CON_*（契约）、UNI_*（Unity 包）和 BLD_*（构建）错误的原始代码与信息。

业务图层名称到标识符的 translations 只放在工程配置或示例中，发布默认数据不包含实际业务内容。包提供 Agent 文档和 v-cli.plugin.json，不自动安装其他 Agent 技能。

使用 `--json` 返回结构化完成回执；构建进度写入 stderr。配置错误与参数错误返回非零退出码。通过 `v-cli capability describe figma.export --json` 或 `figma.build` 读取结构化执行契约。

## 结果验证

以 Unity 退出码、report.json 和完整 contract 校验共同判断构建结果。Node 编译、源数据导出成功或模拟测试不代表 Unity 预制体已正确生成。target project 必须提供 Vant.System.UI 所需的 ReferenceContainerGenerator、CachedListComponent、CachedGridComponent 和 FigmaAutoLayoutGroup。

## 参考资料

[使用说明](README.md) · [构建协议](docs/build-protocol.md) · [文档规范](docs/documentation.md) · schemas/

## 许可与版权

MIT。Copyright © 2026 Vant。Figma、Unity 及第三方组件适用各自许可。
