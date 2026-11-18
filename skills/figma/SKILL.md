---
name: figma
description: "将 Figma 标记画板导出为源数据和图片，通过 Unity 转换器生成 UGUI 预制体。"
---

# Figma 预制体

用 `export` 将标记画板和图片导出到暂存目录，`contract --allow-missing-ir` 检查源清单。已配置转换器的工程用 `build` 生成 IR 和 UGUI 预制体，再用 `contract` 核对产物。配置新工程或检查转换器时分别用 `setup` 和 `unity status`。

在 Vant 会话的 shell 中，示例里的 `v-cli` 代表插件入口：PowerShell 写作 `node "$env:DSH_VANT_CLI"`，sh 写作 `node "$DSH_VANT_CLI"`。 后接 `figma` 和对应参数。完整参数与交付条件见[操作与边界](references/project.md)。
