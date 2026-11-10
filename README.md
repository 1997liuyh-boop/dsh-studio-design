# dsh-studio-design

[简体中文](README.zh.md)

**Repository name:** $n\n\n**Repository description:** MasterGo and Reborn UI design collaboration studio for reading design nodes, mapping real components, and checking implementation in a DSH project session.

`dsh-studio-design` is an independently installed DSH studio. It connects MasterGo Vibe MCP, the Reborn component knowledge base, project files, and the current DSH session. The worktable provides the studio container; it does not replace the project's own UI framework or silently edit files.

## Features

- Read a MasterGo node or current selection through MCP, including layout, variants, interactions, and original image/SVG assets.
- Show and copy the built-in prompts for implementation, read-only inspection, design rules, and node optimization.
- Map design instances to existing project components or Reborn components, preserving component variants and source references.
- Record exported icons and images, component decisions, design rules, and implementation evidence per project session.
- Run plan, check, compare, interact, and verify stages with geometry, pixel, and interaction reports when the project supplies a reachable preview.
- Keep each project session's MasterGo connection, mappings, and preview evidence isolated.
- Send shortcut tasks through `@设计工作室` or `@studio:design` without creating a second chat.

## Installation

This repository declares a DSH bundle at `package.json` → `dsh.bundle.patch`. Install with the DSH Desktop plugin manager. Add the control package first, then this exact tagged source:

```text
github:1997liuyh-boop/dsh-studio-library#v0.1.3
github:1997liuyh-boop/dsh-studio-design#v0.4.2
```

Confirm that the plugin manager lists `dsh-studio-design` version `0.4.2`, then open Design studio. The package requires compatible `dsh-worktable` `^0.6.0` and `dsh-studio-projects` `^0.5.0`, supplied by the control package. MasterGo MCP and optional Playwright are peer integrations and must be available when their features are used.

For local development, use Node.js 22.19 or newer and npm:

```sh
npm ci
npm run build
npm run check
npm test
npm run pack
```

## Requirements and limitations

Open MasterGo Desktop with Vibe MCP and configure its local service address. The Reborn knowledge base can use the included snapshot or a user-selected local/GitHub source; remote data is read as data and its scripts are not executed. Project previews use the project's own scripts and DSH shell permissions. A preview is not proof of visual correctness, and missing MCP, Playwright, or external services are reported rather than replaced with fabricated results.

The studio writes project-specific design evidence and mappings under the current DSH studio directory. It does not silently modify business files, read another project's session, or change a MasterGo canvas without an explicit task. Follow the project's Tailwind, component, and comment rules when implementing results.

## Sources and license

The host is [1997liuyh-boop/deepseek-harness](https://github.com/1997liuyh-boop/deepseek-harness), the component knowledge source is [1997liuyh-boop/Reborn-UI](https://github.com/1997liuyh-boop/Reborn-UI), and the MasterGo integration follows the [Vibe MCP documentation](https://mastergo.com/help/ai-features/vibe-mcp.html). Locked commits, adapter details, and licenses are recorded in [UPSTREAM.json](UPSTREAM.json), [REBORN-SNAPSHOT.json](REBORN-SNAPSHOT.json), and [SDK-SNAPSHOT.json](SDK-SNAPSHOT.json). Original integration code is MIT licensed; see [LICENSE](LICENSE).
