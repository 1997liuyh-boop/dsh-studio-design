# dsh-studio-design

[English](README.md)

**仓库名称：** $n\n\n**仓库描述：**MasterGo 与 Reborn UI 设计协作工作室，用于读取设计节点、匹配真实组件，并在 DSH 项目会话中检查实现。

`dsh-studio-design` 是独立安装的 DSH 工作室，将 MasterGo Vibe MCP、Reborn 组件知识库、项目文件和当前 DSH 会话连接起来。工作台只提供工作室容器，不替换项目自身的 UI 框架，也不会静默修改文件。

## 功能与特性

- 通过 MCP 读取 MasterGo 节点或当前选区，包括布局、变体、交互和原始图片/SVG 切图。
- 查看并复制实现、只读检查、设计规则和节点优化使用的内置提示词。
- 将设计实例匹配到项目已有组件或 Reborn 组件，保留变体和来源依据。
- 按项目会话登记导出的图标与图片、组件决策、设计规则和实现证据。
- 在项目预览可访问时执行 plan、check、compare、interact、verify，生成几何、像素和交互报告。
- 隔离每个项目会话的 MasterGo 连接、组件映射和预览证据。
- 通过 `@设计工作室` 或 `@studio:design` 发送快捷任务，不创建第二个聊天。

## 安装

本仓库在 `package.json` 的 `dsh.bundle.patch` 中声明 DSH 插件包。请使用 DSH Desktop 插件管理器，先添加控制包，再添加以下固定版本来源：

```text
github:1997liuyh-boop/dsh-studio-library#v0.1.3
github:1997liuyh-boop/dsh-studio-design#v0.4.2
```

确认插件管理器显示 `dsh-studio-design` 版本 `0.4.2`，然后打开“设计”工作室。本插件要求兼容的 `dsh-worktable ^0.6.0` 和 `dsh-studio-projects ^0.5.0`，由控制包提供。使用对应功能时，还需要可用的 MasterGo MCP 和可选 Playwright 集成。

本地开发需要 Node.js 22.19 或更高版本以及 npm：

```sh
npm ci
npm run build
npm run check
npm test
npm run pack
```

## 要求与限制

请打开 MasterGo Desktop 的 Vibe MCP，并配置本机服务地址。Reborn 知识库可使用内置快照或用户指定的本地/GitHub 来源；远程内容只作为数据读取，不执行仓库脚本。项目预览使用项目自身脚本和 DSH Shell 权限；预览不等于视觉验收。缺少 MCP、Playwright 或外部服务时会明确报告，不用伪造结果替代。

工作室会在当前 DSH 工作室目录写入项目设计证据和映射，不会静默修改业务文件，不会读取其他项目的会话，也不会在没有明确任务时修改 MasterGo 画布。实现结果应遵守项目的 Tailwind、组件和注释规范。

## 来源与许可

宿主为 [1997liuyh-boop/deepseek-harness](https://github.com/1997liuyh-boop/deepseek-harness)，组件知识库来自 [1997liuyh-boop/Reborn-UI](https://github.com/1997liuyh-boop/Reborn-UI)，MasterGo 接入遵循 [Vibe MCP 文档](https://mastergo.com/help/ai-features/vibe-mcp.html)。固定提交、适配信息和许可记录见 [UPSTREAM.json](UPSTREAM.json)、[REBORN-SNAPSHOT.json](REBORN-SNAPSHOT.json) 和 [SDK-SNAPSHOT.json](SDK-SNAPSHOT.json)。本仓库原创集成代码采用 MIT 许可，详见 [LICENSE](LICENSE)。
