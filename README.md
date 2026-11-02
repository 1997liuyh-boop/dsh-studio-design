# 设计工作室

把 MasterGo 设计稿、Reborn UI 组件和 dsh 的项目会话连在一起。设计任务直接使用 dsh 当前会话的工作区和模型，聊天与悬浮球共享记录。

## 开始使用

1. 在 dsh 左侧工作区打开项目会话。
2. 输入 `@`，选择「设计工作室」，写下需求，例如：`@设计工作室 按当前项目规范实现设置页`。
3. 工作区会话行显示工作室图标，悬停显示名称；会话标题旁也有「设计工作室」标记。它表示该会话已使用工作室，不表示任务仍在运行；进度、工具操作和停止操作都在原会话中查看。

多个工作区分别使用各自会话的目录。页面跟随当前主会话；已提交任务始终留在原会话，不会因切换页面而改用另一个目录。没有明确工作区时提示先打开项目，不借用旧配置或后台会话。相同项目下的多个会话也各自拥有 MasterGo 连接，项目组件映射和预览按真实目录保存。

工作室首页只显示当前工作区、组件资料与三个常用入口：实现设计稿、查看当前选区、生成设计规则。按钮将明确任务发送到当前 dsh 会话，不创建另一份聊天；自定义需求直接在聊天中输入。预览和设置默认折叠。

生成设计规则无需 MasterGo。模型检查项目已有配置、主题、组件和代表页面，定向更新 `docs/design-rules.md`，在 `AGENTS.md` 添加一次引用，保留人工约束并标注文件依据，不修改业务代码。规则仍需在会话中审阅。

## 设置

MasterGo：在本机 MasterGo 桌面端打开文档并开启 Vibe MCP，在工作室「设置」填写服务地址。设计任务发起时自动为该会话连接，资料写入该会话项目的 `.mastergo` 目录。离线时明确报错，不伪造读取成功。默认适配器为 `@mastergo/vibe-mcp@1.0.32`，旧自定义命令保留在高级设置中。

Reborn：内置 172 个组件的完整资料，支持 GitHub 和本地知识库。「使用最新完整知识库」选择本仓库 knowledge 分支，保存后更新；本机只下载数据，不执行远程仓库脚本。普通页面只显示来源、组件数量和就绪状态，仓库与提交信息放在版本详情。原始 Reborn 源码仓库缺少生成资料时沿用内置快照，来源状态可在设置中核对。

Reborn 高级启动参数：`--kb-dir <目录>` 指定包含 index.json 与 components 的知识库，`--spec-dir <目录>` 指定打包后的写作规范。对应环境变量为 REBORN_KB_DIR 与 REBORN_SPEC_DIR。内置服务自动设置，无需 Token、模型或端口。自定义命令按参数数组运行。

[Build latest Reborn knowledge](https://github.com/1997liuyh-boop/dsh-studio-design/actions/workflows/refresh-reborn.yml) 在 main 推送、手动运行和每 6 小时执行，从干净 Reborn 源码构建并验证知识库，发布数据分支和下载产物。失败不会发布半成品，更新失败保留原缓存。此流程不会自动升级已安装的工作室。

## 开发与打包

需要 Node.js >=22.19，无需 Python 或独立显卡。

```sh
npm ci
npm run build
npm run check
npm test
npm run pack
```

产物为 `artifacts/dsh-studio-design-0.4.0.tgz`，摘要见 artifacts/manifest.json。GitHub Actions 在 Windows 和 Linux 执行以上检查；`npm run test:host` 需要 DSH_HARNESS_ROOT 指向已构建的 dsh 检出，验证真实 Cordis、MCP、两工作区隔离、取消与卸载。

共享 SDK 与 Reborn 快照分别由 SDK-SNAPSHOT.json 和 REBORN-SNAPSHOT.json 校验；更新时整份同步，禁止私改共享协议。当前兼容声明为 dsh 0.2.1-rc.2 experimental。宿主更新后需重新验证，工作室更新与上游 dsh 同步见 [更新指南](docs/UPDATE.md)；本次入口调整见 [0.4.0 升级说明](docs/UPGRADE-0.4.md)。

## 数据与限制

设置与映射保存在 DSH_HOME/studio/design，默认使用 ~/.dsh/studio/design。旧项目配置、映射和会话记录保留；0.4.0 不再以旧 projectRoot 或项目绑定会话作为任务入口。新增参与投影由已有会话日志恢复，无需迁移 Session 格式。

页面生成当前支持 Vue / Nuxt Web；UniApp 只识别并提示。目录与配置只读检查，实际文件修改由普通 dsh 工具完成，生成依据通过工具结果记录到会话。已有组件优先，其次 Reborn，再按需求自定义；遵守 Tailwind、项目主题和中文注释规范。

项目预览使用项目已有脚本，沿用 dsh Shell 权限与 Jobs 服务，只停止工作室创建的任务。进程与地址均从实际状态读取；Host 重启不会假装恢复旧进程。隔离 iframe 的登录与存储能力可能受限，预览不能代替项目检查。修改 MasterGo 画布须在聊天中明确授权，且仅支持已验证的静态 HTML。

## 来源与致谢

- 宿主 [1997liuyh-boop/deepseek-harness](https://github.com/1997liuyh-boop/deepseek-harness) fork 自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，感谢其插件、工具与会话体系。
- 容器来自 [dsh-studio-library](https://github.com/1997liuyh-boop/dsh-studio-library)，最初参考 [Aisland-SJL/dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable)。
- 组件资料与 MCP 来自 [1997liuyh-boop/Reborn-UI](https://github.com/1997liuyh-boop/Reborn-UI)，锁定提交、摘要与 MIT 许可保存在 REBORN-SNAPSHOT.json 和 upstream/reborn/LICENSE。
- MasterGo 接入依据 [官方 Vibe MCP 文档](https://mastergo.com/help/ai-features/vibe-mcp.html)，官方适配器按配置运行，不复制其源码。

本仓库是新增集成插件，非 MasterGo 的 fork。原创代码采用 MIT 许可，上游快照保留原许可。
