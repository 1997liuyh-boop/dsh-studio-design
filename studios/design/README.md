# 设计工作室插件

独立安装包入口，包含 Host 插件、共享 SDK 卡片、Vue / Tailwind 工作台及锁定的 Reborn MCP。使用与构建步骤见 [项目 README](https://github.com/1997liuyh-boop/dsh-studio-design#readme)。

安装前需要共享工作室运行时与宿主同版本的 MCP client。工作室通过 `studioProjects.register` 登记，不修改宿主循环；数据保存到 DSH_HOME/studio/design。切换项目和卸载释放 MCP，未连接工具时不生成依赖设计稿的任务。

感谢 deepseek-ai/deepseek-harness、其 1997liuyh-boop fork、dsh-studio-library、Aisland-SJL/dsh-worktable、Reborn-UI 与 MasterGo。该插件为原创集成；Reborn 内置快照保留 MIT 许可，来源见 UPSTREAM.json 与 reborn/LICENSE。宿主首版兼容为 0.2.1-rc.2 experimental，Vue Web 以外平台尚不支持生成。
