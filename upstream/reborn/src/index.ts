import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { KnowledgeBase, resolveKbDir } from "./kb.js";
import type { KbComponent } from "./kb.js";
import { searchComponents } from "./search.js";
import { readSpec } from "./spec.js";

const kb = new KnowledgeBase(resolveKbDir());

/**
 * MCP 协议的 server instructions：客户端会自动注入系统提示，无需任何 tool call。
 * 这是写作规范唯一能「不被跳过」的投递通道，因此这里放压缩版骨架 + 硬规则，
 * 全文走 get_authoring_spec 工具按需取。改动须与 docs/authoring/*.md 保持一致。
 */
const instructions = `Reborn-UI 组件库知识库服务。这是一个双端组件库：Web（Nuxt/Vue）与 UniApp 两端同名同构。

选型与写码工作流：search_components 或 list_components 找候选 → get_component 读 props / events / slots 与使用边界（whenToUse / whenNotToUse / pitfalls）→ get_component_example 取示例 → get_install_command 拿安装命令。props / 事件 / 插槽一律以知识库返回为准，不要按同类库的印象推断。

改组件样式（颜色、背景、边框、圆角、尺寸、间距、字体、阴影、hover 态、某个内部部件的外观）依次走：① 已有 prop 取值能表达的直接用 prop（如胶囊按钮用 variant="round"，不写 rounded-full）；② 其余一律用组件的 ui 对象 :ui="{ 键: '类名' }"，最外层元素也用 ui 里的 root / base 键而不是裸 class；③ 只有 ui 里没有对应部件的键时，才退回插槽 + 工具类，并说明该组件没有暴露这个键。可用键看 get_component 返回的 ui 条目描述（「可用键（从源码抽取，以此为准）」，按 Web / UniApp 分端，两端不通用；带 * 的键在填了同名插槽后失效），只能用列出的键，猜的键静默无效。不要用套一层 div/span、:deep()、改组件内部类名的写法改样式——这些绕开了组件的样式接口，组件升级就会失效。

为本组件库编写或修改「组件文档」（content/2.components/**/*.md）与「组件 demo」（app/components/reborn/examples/**、packages/uniapp-project/src/pages/**）时，必须先调 get_authoring_spec 取规范全文再动笔。骨架压缩版：

- 文档：frontmatter（title / description 一句话 ≤60 字 / category / tags）→ ::ComponentViewer{componentId="<id>"} → ## 简介（① 一句话定位 + 双端同名同构 ② 正交维度拆解 ③ 剩余 API 分组概览）→ ### 何时使用（3-5 条，每条点名具体 prop）→ ### 何时不使用（2-3 条，每条给替代组件）→ ## 用法（一节一能力：一句话引子 → 维度表 → 5-15 行可运行 vue 块）→ ## API（### Props / ### Emits / ### Slots / ### Expose / ### 自定义样式（ui）/ ### CSS 变量）→ ## 两端差异对照（仅双端组件）→ ## 注意事项（每条 = 粗体结论句 + 机制 + 后果）。唯一参考范本 content/2.components/button/reborn-button.md。
- demo：顶部 Playground「交互演练场」（defaultState + resetState + controls 分组 + code computed）→ 若干 DemoSection，节序与节名同文档 ## 用法 的 ### 小节一一对应。唯一参考范本 app/components/reborn/examples/reborn-button/RebornButtonDemo.vue。

三条硬规则：① ### Props|Emits|Slots|Expose 下的表格行名必须与源码成员逐字一致（CI 强校验会失败），ui 键位表与 CSS 变量表必须放在非 API 标题下；② 不描述源码里不存在的能力，声明了但未接线的 prop 要在「注意事项」里明说；③ 一律中文（代码标识符与路径除外）、给理由不给口号、禁营销词（优雅/强大/时尚/炫酷/极致/完美）、禁「xxx 属性」式废话，数值必带单位并区分端（Web px / UniApp rpx）。`;

const server = new McpServer(
  {
    name: "reborn-ui",
    version: "0.1.0",
  },
  { instructions },
);

/** 统一的文本返回体（内容一律 JSON 序列化，方便调用方解析） */
function jsonResult(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

/** get_component 的字段裁剪：未指定 fields 时返回除示例代码外的全部信息（示例另有专用工具） */
function pickFields(component: KbComponent, fields?: string[]) {
  if (!fields?.length) {
    const { examples, ...rest } = component;
    return {
      ...rest,
      // 只保留示例标题清单，完整代码用 get_component_example 获取，控制返回体 token
      exampleTitles: (examples ?? []).map((e, i) => e.title ?? `示例 ${i + 1}`),
    };
  }
  const result: Record<string, unknown> = { id: component.id };
  for (const f of fields) {
    if (f in component) result[f] = component[f as keyof KbComponent];
  }
  return result;
}

server.tool(
  "list_components",
  "列出 Reborn-UI 组件（轻量索引），可按分类/平台/标签过滤。选型第一步。",
  {
    category: z.string().optional().describe("按分类过滤，如 form/basic/effect，全部分类见 list_categories"),
    platform: z.enum(["web", "uniapp"]).optional().describe("按支持平台过滤"),
    tag: z.string().optional().describe("按标签过滤，如 button/switch"),
  },
  async ({ category, platform, tag }) => {
    let entries = kb.list();
    if (category) entries = entries.filter((e) => e.category === category);
    if (platform) entries = entries.filter((e) => e.platforms?.includes(platform));
    if (tag) entries = entries.filter((e) => e.tags?.includes(tag));
    return jsonResult({
      total: entries.length,
      components: entries.map(({ id, title, description, category: c, platforms }) => ({
        id,
        title,
        description,
        category: c,
        platforms,
      })),
    });
  },
);

server.tool(
  "search_components",
  "按关键词检索组件（id 精确 > 名称 > 标签 > 描述加权），返回按相关度排序的候选列表。",
  {
    query: z.string().min(1).describe("检索词，中英文均可，如「按钮」「switch 开关」"),
    limit: z.number().int().min(1).max(50).optional().describe("返回条数上限，默认 10"),
  },
  async ({ query, limit }) => {
    const hits = searchComponents(kb.list(), query).slice(0, limit ?? 10);
    return jsonResult({
      total: hits.length,
      components: hits.map(({ score, id, title, description, category, platforms }) => ({
        id,
        title,
        description,
        category,
        platforms,
        score,
      })),
    });
  },
);

server.tool(
  "get_component",
  "获取组件完整知识条目：props/events/slots/使用边界（whenToUse/whenNotToUse/pitfalls）等。写代码前必读。",
  {
    id: z.string().describe("组件 id（kebab-case），如 reborn-button"),
    fields: z
      .array(z.string())
      .optional()
      .describe("只返回指定字段（如 [\"props\",\"pitfalls\"]），默认返回除示例代码外的全部"),
  },
  async ({ id, fields }) => {
    const component = kb.get(id);
    if (!component) {
      return errorResult(`组件不存在：${id}。请先用 search_components 或 list_components 确认 id。`);
    }
    return jsonResult(pickFields(component, fields));
  },
);

server.tool(
  "get_component_example",
  "获取组件用法示例代码。不传 title 时返回全部示例。",
  {
    id: z.string().describe("组件 id（kebab-case）"),
    title: z.string().optional().describe("示例标题（见 get_component 返回的 exampleTitles）"),
    platform: z.enum(["web", "uniapp"]).optional().describe("按平台过滤示例"),
  },
  async ({ id, title, platform }) => {
    const component = kb.get(id);
    if (!component) return errorResult(`组件不存在：${id}`);
    let examples = component.examples ?? [];
    if (platform) examples = examples.filter((e) => !e.platform || e.platform === platform);
    if (title) examples = examples.filter((e) => e.title === title);
    if (!examples.length) {
      return errorResult(`组件 ${id} 没有匹配的示例${title ? `（title=${title}）` : ""}`);
    }
    return jsonResult({ id, examples });
  },
);

server.tool(
  "get_install_command",
  "获取组件的 CLI 安装命令。",
  {
    id: z.string().describe("组件 id（kebab-case）"),
    packageManager: z.enum(["pnpm", "npm", "yarn", "bun"]).optional().describe("包管理器，默认 pnpm"),
  },
  async ({ id, packageManager }) => {
    const component = kb.get(id);
    if (!component) return errorResult(`组件不存在：${id}`);
    const pm = packageManager ?? "pnpm";
    // 各包管理器的 dlx 等价写法
    const runner: Record<string, string> = {
      pnpm: "pnpm dlx",
      npm: "npx",
      yarn: "yarn dlx",
      bun: "bunx",
    };
    return jsonResult({
      id,
      command: `${runner[pm]} reborn-ui@latest add ${id}`,
      dependencies: component.dependencies ?? [],
      note: "首次使用需先执行 init 生成 components.json：`" + `${runner[pm]} reborn-ui@latest init` + "`",
    });
  },
);

server.tool(
  "list_categories",
  "列出全部组件分类及各分类的组件数量。",
  {},
  async () => jsonResult({ categories: kb.categories() }),
);

// ===== 写作规范 =====

server.tool(
  "get_authoring_spec",
  "获取 Reborn-UI 的写作规范全文：kind=\"doc\" 为组件文档（content/2.components/**/*.md），kind=\"demo\" 为组件 demo（examples / uniapp 示例页）。编写或修改文档、demo 前必须先调本工具，不要凭印象写。",
  {
    kind: z
      .enum(["doc", "demo"])
      .describe("doc=组件文档写作规范；demo=组件 demo 写作规范（含文案规范）"),
    includeTemplate: z
      .boolean()
      .optional()
      .describe("是否附带唯一参考范本原文（reborn-button 的文档 / demo，体积较大），默认 false"),
  },
  async ({ kind, includeTemplate }) => {
    try {
      return jsonResult(readSpec(kind, { includeTemplate }));
    } catch (error) {
      // 规范正文缺失不应影响组件查询能力，这里降级为工具级报错
      return errorResult(
        `读取写作规范失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

// stdio 传输：MCP 客户端以子进程方式拉起本服务
const transport = new StdioServerTransport();
await server.connect(transport);
