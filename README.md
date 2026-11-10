# dsh-studio-design

MasterGo 与 Reborn UI 设计协作工作室

本仓库根目录是可安装的 DSH 插件，版本 0.4.1。在插件市场添加本仓库 Git URL，安装后启用。先安装并启用 [工作室容器与共享运行时](https://github.com/1997liuyh-boop/dsh-studio-library)，再启用本插件。

Git 安装使用已提交的 lib/ 与静态资源。开发时执行 npm install --include=dev --legacy-peer-deps、npm run build、npm run check；构建只使用本仓库源码与公开依赖，不引用相邻工作库。

## 功能与上游说明


把 MasterGo 设计稿、Reborn UI 组件和 dsh 的项目会话连在一起。设计任务直接使用 dsh 当前会话的工作区和模型，聊天与悬浮球共享记录。

设计工作室是独立安装、独立启停和独立更新的工作室，不随共享工作台或其他业务工作室自动安装。共享工作台只提供容器和控制入口；未安装本包时，工作室列表不会显示设计工作室业务页面。

主要功能包括 MasterGo MCP 节点读取、内置提示词查看与复制、Reborn 组件和变体检索、节点优化、原始图标与切图登记、项目设计规则生成、预览检查、几何/像素对照和交互断言。MasterGo、Reborn 知识库和项目预览均按当前项目会话隔离。

## 开始使用

1. 在 dsh 左侧工作区打开项目会话。
2. 输入 `@`，选择「设计工作室」，写下需求，例如：`@设计工作室 按当前项目规范实现设置页`。
3. 工作区会话行显示工作室图标，悬停显示名称；会话标题旁也有「设计工作室」标记。它表示该会话已使用工作室，不表示任务仍在运行；进度、工具操作和停止操作都在原会话中查看。

多个工作区分别使用各自会话的目录。页面跟随当前主会话；已提交任务始终留在原会话，不会因切换页面而改用另一个目录。没有明确工作区时提示先打开项目，不借用旧配置或后台会话。相同项目下的多个会话也各自拥有 MasterGo 连接，项目组件映射和预览按真实目录保存。

工作室首页只显示当前工作区、组件资料与实现设计稿、查看节点、优化对应节点、生成设计规则四个入口。按钮将明确任务发送到当前 dsh 会话，不创建另一份聊天；自定义需求直接在聊天中输入。预览和设置默认折叠。

生成设计规则无需 MasterGo。模型检查项目已有配置、主题、组件和代表页面，定向更新 `docs/design-rules.md`，在 `AGENTS.md` 添加一次引用，保留人工约束并标注文件依据，不修改业务代码。规则仍需在会话中审阅。

## 聊天快捷任务

在聊天里写 `@工作室:design 实现设计稿`（也可以写 `@设计工作室 实现设计稿`），标题可换成「查看当前选区 / 生成设计规则 / 优化对应节点」，后面可直接接 MasterGo 节点链接或补充说明，例如 `@工作室:design 优化对应节点 https://mastergo.com/file/...?layer_id=...`。消息进入模型前，宿主把标题替换成完整任务文本（与首页按钮发送的内容相同），链接或补充另起一行保留；没有链接即按当前选区处理。任务文案与首页按钮共用 `src/prompt.ts` 的 `designTaskRequest`，`npm run build` 会把 `designTasks()` 写入 `studio.json` 的 `tasks`，由工作库目录透出给宿主；修改文案只改 `prompt.ts`，不要手改 `studio.json`。

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

共享 SDK 与 Reborn 快照分别由 SDK-SNAPSHOT.json 和 REBORN-SNAPSHOT.json 校验；更新时整份同步，禁止私改共享协议。当前兼容声明为 dsh 0.2.1-rc.2 experimental。宿主更新后需重新验证，工作室更新与上游 dsh 同步见 [更新指南](https://github.com/1997liuyh-boop/dsh-studio-design/blob/main/docs/UPDATE.md)。

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

## 几何与像素审计

预读把每个区块导出 HTML 的节点规格（文字、宽高、位置、字号、行高、字重、字体、颜色、背景、圆角、描边）写进 `docs/design/mastergo-manifest.json` 的 `blocks[].spec`。实现模板给区块根与规格表节点加 `data-design="<节点ID>"`，并把预览地址写进 `docs/design/implementation-checklist.md`；`design_review(stage=compare)` 用 Playwright 在设计稿基准宽度实测这些节点的位置、尺寸与计算样式，与规格表及导出 HTML 的渲染结果比对（位置尺寸容差 2px，其余精确，字体族只提示），再把区块截图与预览图做像素比对，输出按差异排序的清单和相似度，报告在 `docs/design/compare-report.json`，差异图在 `docs/design/compare/`。差异超阈值修复后重查，最多三轮，剩余差异写进清单。Playwright 由环境变量 `DSH_PLAYWRIGHT_MODULE`、目标项目或宿主仓库解析，不随插件打包。

流程门禁：compare 需本会话 check 通过，最多三轮；有规格表的页面在 verify 前必须跑过 compare，未通过的区块要在清单「四、剩余差异」写明。预览不可达时工作室用项目脚本在宿主侧启动预览。

## 交互断言执行

compare 之后调用 `design_review(stage=interact)`（需本会话 check 通过）：工作室读取 `docs/design/interactions.yaml` 已填写的条目，用 Playwright 在基准视口打开预览，每条从初始页面开始，按 `data-design="<node>"`（其次 `<id>`）定位，把 trigger 翻译成 点击 / 悬停 / 输入「文字」/ 按键 / 滚动 执行（节点 ID 或 `data-design` 值可指定内部目标，「或」只执行第一种，trigger 写「无」的条目跳过），再按 response 里可判定的部分断言：节点出现 / 消失、文字「…」、`aria-expanded` 等属性（给值则等于，否则要求变化）、跳转到 `/路径` 或 不跳转、无变化；输入动作自动核对文字写进了输入框。每条前后截图写到 `docs/design/screenshots/<id>-before.png` / `-after.png`，另截一张 390 宽窄屏整页图，报告写 `docs/design/interaction-report.json`。verify 直接采用本会话 interact 的结果与截图（含 compare 的区块实测图作基准视口证据），模型不必再传 interactions 结果与 visuals，也不要自己起浏览器；磁盘上的旧报告不采用。切图方面，导出像素不足稿面九成的位图标 `partial` 并按节点补导出全图（`fullImage`），check 与 compare 都禁止把小图拉伸；预读上限 120 块。组件方面，映射命中的实例不接受 custom（除非需求里写「允许自定义 <节点>」），缺失的组件由工作室从本地 registry（`REBORN_REGISTRY_DIR` / 设置 `rebornRegistry` / Reborn 资料目录）或 Reborn CLI 在实现前装进项目。

## 多状态与交互规范

需求里可以按顺序给出同一文件的多条画板链接：第一条是默认态，按原流程预读并导出区块；其余是状态帧（如「首页/搜索展开」「首页/登录态」），工作室逐帧只读一次结构，写到 `.mastergo/export/frames/<序号-状态-节点ID>/root.html`，manifest 增加 `frames[]`（帧节点、画板名、状态标签、区块列表；状态标签取画板名最后一个 `/`、`-`、`_` 之后的非数字片段）与 `stateDeltas[]`（同名节点跨帧的 added / removed / moved / resized / text / variant / style 差异，节点先按 ID 再按名称与出现次序配对）。状态帧新增的最外层节点在默认态区块导出后单独导出（每帧最多 8 个）。提示词要求按状态实现：每个状态一个响应式变量，差异用 `v-if` / `v-show` 或组件 props 表达。

预读完成后工作室同步 `docs/design/interactions.yaml`：按区块与实例名识别可交互类型生成骨架条目 `{ id, node, name, type, trigger, response, states, notes?, data?, file? }`，带状态属性的实例与每个状态帧生成 `state` 条目。`trigger` / `response` 为空即「待补交互」，plan 阶段列出；可直接编辑 yaml（人工内容再次同步时保留），或在需求里写 `交互 <节点或id>：<触发> → <响应>（状态：a、b）` 由工作室写回。实现时每条规范用 Reborn 组件自带的 props / events 或 `v-if` / `v-show` 实现，在对应节点根元素加 `data-design="<id>"`，数据交互保留 mock 并标 `// TODO`。plan 要求已填写规范登记为 interactions 断言（node 填 id）；check 核对 `data-design` 元素上有事件处理或状态绑定，缺失算问题；交互的执行与截图由 `design_review(stage=interact)` 在宿主侧完成（见「交互断言执行」），模型不写也不运行 Playwright 脚本。

变体属性直接来自 Vibe 导出的 `ui-component` 的 `props` / `text` 属性（已写入 `blocks[].components[].props` 并参与跨帧比较），不再对实例节点补 Magic 读取：官方 Magic MCP 只提供 `mcp_getDsl` / `mcp_getD2c`，且与 Vibe 是互斥的单槽连接配置，补读需要另一条带令牌的连接并承受 429 与大节点超时。

## 提示词与节点优化

页面右上角「内置提示词」显示实际生成器使用的调用指引、实现、节点优化、只读、规则和预读模板，可复制查看；项目、模型能力与节点数据在任务执行时填入。节点链接可填写完整 file 链接及 layer_id，留空使用当前选区；「优化对应节点」强制重新通过 MCP 读取该节点，再对照已有实现和真实组件 API，保留业务逻辑。

设计中的原始 SVG、图片和形状必须导出落盘并逐项登记使用路径，普通图标也不能遗漏。组件映射记录节点语义及 project/reborn/custom 来源；搜索、标签页、表格、轮播等不能统一映射为 Button 加 CSS。项目组件填写源码依据，自定义组件说明兼容原因。

还原按 plan、check、compare、interact、verify 执行。plan 同时登记真实交互期望，check 校验组件和原图，compare 实测几何与像素，interact 在宿主侧执行交互并截图，verify 登记证据（有 interact 报告时直接采用）。evidence-recorded 只表示证据文件已登记，不能证明像素一致或替代视觉对照；未完成项必须明确保留。

## 更新已安装插件

GitHub 代码提交不会自动更新 Desktop profile 中已经锁定的安装版本。请通过插件管理器重新安装本仓库来源；旧共享组合库的用户请先按[控制层迁移步骤](https://github.com/1997liuyh-boop/dsh-studio-library#更新与旧组合库迁移)保留现有子工作室，再移除旧组合库。工作室内升级需要已发布的适配安装包。
