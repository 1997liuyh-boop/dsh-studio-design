# 设计工作室

将 MasterGo 选区、Reborn UI 组件与项目现有配置连接到 dsh 的开发会话。一个工作室对应一个仓库；本仓库只提供设计协作插件，不修改 dsh 核心。

## 使用

1. 在 dsh 安装共享工作室容器 `dsh-worktable ^0.6.0`、运行时 `dsh-studio-projects ^0.5.0` 及与宿主同版本的 `@deepseek-ai/dsh-mcp-client`。
2. 从本仓库 GitHub Actions 下载插件包，解压下载的 artifact，或按下方步骤构建。
3. 退出桌面应用后，在您的 dsh 安装中运行 `dsh plugin --profile desktop add <设计工作室 tgz 的绝对路径>`，然后重新启动应用。开发源码宿主使用 `pnpm dsh plugin --profile desktop add <路径>`。不要使用 npm 安装整个源码根目录。
4. 从工作室列表打开「设计工作室」，选择 Vue / Nuxt Web 项目文件夹，或填写绝对路径，点击「读取并保存」。
5. 打开 MasterGo 桌面端及目标文档，在 MCP 面板确认服务地址，内置 Reborn 自动连接，点击 MasterGo 的「连接」。默认使用 `@mastergo/vibe-mcp@1.0.32` 和 `http://127.0.0.1:30678`；地址不同可在高级配置中修改参数数组并保存。
6. 选择 MasterGo 页面或根节点，点击「读取当前选区」查看真实读取摘要。组件选择与映射默认收起，可留空让 dsh 分析；已有映射继续按项目保留。
7. 填写页面需求并交给 dsh。每个项目绑定一个普通 dsh 会话，使用主程序配置的模型；主窗口与悬浮球可查看同一会话，也可在主窗口切换模型、审批工具和停止任务。插件不保存模型密钥。
8. 从项目已有脚本选择 dev / preview，点击「启动预览」。插件通过 dsh Shell 和 Jobs 运行，展示日志、后台任务及真实本机地址，也可停止本工作室创建的服务。手动启动的服务可以输入地址查看。

主流程为项目与连接、实现与预览。组件映射、资料来源和高级连接默认收起。组件使用顺序为项目已有 → Reborn → 自定义；安装按需进行，主题变量、目录别名、registry 与版本优先读取目标项目配置。Vue 样式使用 Tailwind，新增代码注释使用中文。

## Reborn MCP 与版本

目前 `reborn-ui-mcp` 尚未在 npm 发布。本插件内置来源锁定的官方 MCP、知识库、内联示例和写作规范，构建时打包到子进程中。首版快照包含 172 个组件，支持查询 Props、Events、Slots、平台、示例及 CLI 安装建议。安装建议不代表对应 npm CLI 已发布，生成时仍需核查实际可用的 CLI 与项目锁定版本。

资料来源支持内置快照、本地目录及 GitHub 仓库。本地目录可以直接选择，需已有有效的 knowledge；GitHub 获取仓库文件并固定实际提交，仅验证和读取知识库与源码，不安装依赖、不执行仓库脚本。仓库没有生成后的 knowledge/components 时，源码仍可供 dsh 查阅，组件参数明确继续使用内置快照；具有完整知识库时才切换查询资料。失败保留当前资料。内置 Reborn 自动连接，不依赖业务项目；只切换项目不重启它。自定义命令仍需显式连接。MCP 启动参数是命令行 argv，不是组件 Props，普通使用保持默认即可。

## 开发和打包

需要 Node.js >=22.19。无需 Python 或独立显卡。

```sh
npm ci
npm run build
npm run check
npm test
npm run pack
```

产物为 `artifacts/dsh-studio-design-0.2.0.tgz`，SHA256 记录在 `artifacts/manifest.json`。GitHub Actions 在 Windows 和 Linux 运行构建、类型检查、行为测试和打包，上传安装包与摘要。`npm run test:host` 需要 `DSH_HARNESS_ROOT` 指向已构建的 dsh 源码检出，用于真实 Cordis 加载、路由与 MCP 连接验证。

更新内置 Reborn：在干净的 Reborn 检出生成知识库后，运行 `node scripts/sync-reborn.mjs <Reborn-UI 目录>`。提交更新后的 `upstream/reborn` 与 `REBORN-SNAPSHOT.json`，重新检查与打包。共享 SDK 源码和摘要位于 `packages/sdk` 与 `SDK-SNAPSHOT.json`，整份同步，禁止私改协议。

## 数据与限制

设置、映射、会话绑定与预览地址存放于 `DSH_HOME/studio/design`，未设置 DSH_HOME 时使用 `~/.dsh/studio/design`。按真实项目路径隔离，使用 revision 拒绝过期保存。工作室只读取目标项目的限定配置和组件路径，不执行配置文件，也不直接覆盖业务源文件；代码修改由记录在 dsh 会话中的工具执行。内置 Reborn 在启动时准备；MasterGo 和自定义命令由用户显式连接。预览任务引用保存在当前 Host 内存中，页面刷新保留；Host 重启后不冒充已恢复进程。 预览沿用宿主 Shell 权限；启动失败时展示实际日志和退出原因，没有输出时仍保留退出码。

MasterGo 必须在本机桌面端打开文档并开启 MCP。连接失败会阻止依赖设计稿的任务；没有模拟成功数据。画布回写需点击「更多」中的显式同步动作，且仅支持已验证的静态 HTML，不能把 Vue / TSX 源文件直接交给 `agent_sync_design`。隔离预览没有宿主同源权限，登录、持久存储等浏览器能力可能受限。

首版支持 Vue / Nuxt Web。UniApp 仅识别并提示，不允许套用 Web 组件生成。dsh 的兼容声明为 `0.2.1-rc.2 experimental`，升级宿主后须重新验证；不能承诺自动兼容后续预稳定 API。

更新工作室包与同步 dsh 上游是两件事，操作和兼容限制见 [更新指南](docs/UPDATE.md)。

## 来源与致谢

- 宿主 [1997liuyh-boop/deepseek-harness](https://github.com/1997liuyh-boop/deepseek-harness) fork 自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，感谢原项目提供插件、工具与会话体系。
- 工作室容器沿用 [dsh-studio-library](https://github.com/1997liuyh-boop/dsh-studio-library)，最初参考 [Aisland-SJL/dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable)。
- 组件知识与 MCP 来自 [1997liuyh-boop/Reborn-UI](https://github.com/1997liuyh-boop/Reborn-UI)，锁定提交、分发文件摘要及原始 MIT 许可见 `REBORN-SNAPSHOT.json` 与 `upstream/reborn/LICENSE`。原项目保留其上游作者声明。
- MasterGo 接入依据 [官方 Vibe MCP 文档](https://mastergo.com/help/ai-features/vibe-mcp.html)，官方适配包按配置运行，不在本仓库复制其源码。

本仓库是新增的集成插件，非 MasterGo 的 fork。原创集成代码采用 MIT 许可，上游快照保留各自许可。
