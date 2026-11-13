import type { KbComponent, KbProp } from "./kb.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { KnowledgeBase, resolveKbDir } from "./kb.js";
import { matchDesignNodes, searchComponents } from "./search.js";
import { readSpec } from "./spec.js";

const kb = new KnowledgeBase(resolveKbDir());

/**
 * MCP 协议的 server instructions：客户端会自动注入系统提示，无需任何 tool call。
 * 这是写作规范唯一能「不被跳过」的投递通道，因此这里放压缩版骨架 + 硬规则，
 * 全文走 get_authoring_spec 工具按需取。改动须与 docs/authoring/*.md 保持一致。
 */
const instructions = `Reborn-UI 组件库知识库服务。这是一个双端组件库：Web（Nuxt/Vue）与 UniApp 两端同名同构。

选型与写码工作流：search_components 或 list_components 找候选 → get_component 读 props / events / slots 与使用边界（whenToUse / whenNotToUse / pitfalls）→ get_component_example 取示例 → get_install_command 拿安装命令。props / 事件 / 插槽一律以知识库返回为准，不要按同类库的印象推断。候选条目的 whenNotToUse 若把当前场景指向了别的组件，先读那个组件再定。search_components 支持同义词与其它组件库的叫法（tag、badge、红点、胶囊标签），按 UI 稿上看到的样子搜即可。

选型前先按外观对照下表。本库有两处命名与 Element / Ant 相反，最容易选错：
- 不可点击的小标签：状态、分类、筛选项（Element / Ant 的 Tag，MUI 的 Chip）→ reborn-badge，不是 reborn-button（按钮会被读屏器报成可操作元素）。
- 图标、头像右上角的红点或数字（Element / Ant / Vuetify 的 Badge）→ reborn-chip，不是 reborn-badge。
- 一排互斥切换、选中块滑动（Ant 的 Segmented、Element 的 radio-button）→ reborn-segmented，不是 reborn-tabs 或一排 reborn-button。
- 点选后执行动作的下拉菜单 → reborn-dropdown；从选项里取一个值 → reborn-select；两者不互换。
- 单句操作反馈 → reborn-toast；屏幕角落、带标题正文的异步通知 → reborn-notification；页内常驻提示条 → reborn-alert。
- 居中确认弹窗 → reborn-dialog；侧边滑入面板 → reborn-drawer；UniApp 底部弹层 → reborn-popup。
- 带时间戳的事件记录 → reborn-timeline；用户逐步推进的流程 → reborn-steps；滚动叙事动效 → timeline（无前缀，社区移植）。
- 页面主操作、提交、确认 → reborn-button；固定位置的悬浮入口 → reborn-fab。

还原设计稿（MasterGo / Figma 节点 → 页面）时，先把读到的节点名、变体值与子节点名整批传给 match_design_nodes，再按返回的 component / recipe / uses 逐个 get_component 核对，最后 get_component_example 取示例；不要只按节点名的字面意思去猜组件。设计稿里最常漏掉的几组：
- 一列「缩略图」实例（变体 已选/未选）+ 一张主图 + 左右箭头 = 商品图廊 → 一个 reborn-carousel（thumbs 联动缩略图，#prev / #next 放箭头并加 pointer-events-auto），不是一列 RebornButton + img。
- 一排页签 + 内容面板 → reborn-tabs + RebornTabPane（title 传稿面文案，选中态由组件按 type / color 管，不在 #title 插槽里手动切颜色；line 类型自带头部分隔线）。RebornTabPane 这类与目录不同名的子组件在 Nuxt pathPrefix: true 下自动导入会改名，须显式 import。
- 同一容器里一列同名实例（如「分類列表」×9，变体 選中 / 未選中）= 一组互斥选择 → 纵向的分类列表、侧栏导航用一个 reborn-menu（每项一个 RebornMenuItem，v-model:selected-keys 管当前项，样式经 ui.root / ui.menu / ui.menuItem），不是九个手写的 a；名字没命中配方表时 match_design_nodes 会在 hints 里按结构提示，候选见该节点的 alternatives。
- 搜索区（站点选择 + 输入 + 搜索键）→ reborn-search-box 的 #leading / #trailing 插槽；数量加减 → reborn-input-number；规格项 → reborn-sku；悬浮操作组 → reborn-fab；图标 / 分割线不是组件，用导出素材或 border。
写完模板自查：不得残留原生 <button> / <input> / <select>，也不得用 Button + CSS 仿造上面这些复合组件；本库没有的（Web 页脚、卡片容器）才按稿面自写。

改组件样式（颜色、背景、边框、圆角、尺寸、间距、字体、阴影、hover 态、某个内部部件的外观）依次走：① 已有 prop 取值能表达的直接用 prop（如 Badge 的胶囊形用 round，不写 rounded-full）；② 其余一律用组件的 ui 对象 :ui="{ 键: '类名' }"，最外层元素也用 ui 里的 root / base 键而不是裸 class；③ 只有 ui 里没有对应部件的键时，才退回插槽 + 工具类，并说明该组件没有暴露这个键。可用键看 get_component 返回的 ui 条目描述（「可用键（从源码抽取，以此为准）」，按 Web / UniApp 分端，两端不通用；带 * 的键在填了同名插槽后失效），只能用列出的键，猜的键静默无效。不要用套一层 div/span、:deep()、改组件内部类名的写法改样式——这些绕开了组件的样式接口，组件升级就会失效。

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
  "按关键词检索组件（id 精确 > 名称 > 别名 > 标签 > 描述加权），返回按相关度排序的候选列表。别名含其它组件库的叫法与 UI 稿上的外观描述，按看到的样子搜即可（tag、badge、红点、胶囊标签）。",
  {
    query: z.string().min(1).describe("检索词，中英文均可，如「按钮」「switch 开关」「红点」「Element 的 Tag」"),
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
    platform: z
      .enum(["web", "uniapp"])
      .optional()
      .describe("只保留该平台通用或专属的 props：两端取值不同的 prop（如 size、ui）按平台并存两条并带 platform 字段，不传则两条都返回"),
  },
  async ({ id, fields, platform }) => {
    const component = kb.get(id);
    if (!component) {
      return errorResult(`组件不存在：${id}。请先用 search_components 或 list_components 确认 id。`);
    }
    const result = pickFields(component, fields) as Record<string, unknown>;
    if (platform && Array.isArray(result.props)) {
      result.props = (result.props as KbProp[]).filter((p) => !p.platform || p.platform === platform);
      result.platform = platform;
    }
    return jsonResult(result);
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
      // CLI 按 components.json 的 componentsDir 字面量落盘（默认 components）；Nuxt 4 的源码目录是 app/，不改目录会写到项目根、框架扫不到
      layoutNote: `组件写入 components.json 的 componentsDir（默认 components，相对项目根）。Nuxt 4 项目的源码在 app/ 下时加上 --components-dir app/components --lib-dir app/lib，或把 components.json 的 componentsDir / libDir 改成 app/ 开头的路径；装完确认文件落在框架实际扫描的组件目录里。`,
    });
  },
);

server.tool(
  "list_categories",
  "列出全部组件分类及各分类的组件数量。",
  {},
  async () => jsonResult({ categories: kb.categories() }),
);

// ===== 设计稿还原 =====

server.tool(
  "match_design_nodes",
  "把设计稿（MasterGo / Figma）里的一批节点落到 Reborn 组件：按配方表匹配节点名、变体值与子节点名，返回每个节点该用的组件、配方（props / 插槽 / ui 键写法、禁止的替代实现）、需显式 import 的子组件，以及图廊这类跨节点的整体提示；配方表没覆盖的退回别名检索给候选。还原设计稿时先调它，再对返回的组件逐个 get_component 核对。",
  {
    nodes: z
      .array(
        z.object({
          name: z.string().min(1).describe("节点 / 实例名，如「缩略图」「Tab 2」「icon/44/箭头」"),
          variant: z
            .union([z.record(z.union([z.string(), z.number(), z.boolean()])), z.string()])
            .optional()
            .describe("变体属性对象（{\"属性 1\": \"已选\", \"已登录\": true}）或状态文字，只匹配值"),
          children: z.array(z.string()).optional().describe("直接子节点名；节点名本身没命中时才参与匹配"),
          group: z.string().optional().describe("所属区块名或 id；同区块的缩略图、主图、箭头会被合并成图廊提示"),
          count: z.number().int().min(1).optional().describe("同名实例个数，缺省按本次输入统计"),
        }),
      )
      .min(1)
      .max(500)
      .describe("一批节点，建议整页或整块一次传入，图廊这类整体关系才判断得出来"),
    platform: z
      .enum(["web", "uniapp"])
      .optional()
      .describe("目标端；传了会把仅另一端可用的组件标为不可用并给替代候选"),
  },
  async ({ nodes, platform }) => {
    const result = matchDesignNodes(kb.designPatterns(), kb.list(), nodes, {
      platform,
      getComponent: (id) => kb.get(id),
    });
    return jsonResult({
      ...result,
      nextSteps:
        "对每个 component（含 with 里的配套组件）调 get_component(id, platform) 核对 props / slots / ui 键，再 get_component_example 取示例；按 recipe 实现，uses 之外的 prop / 插槽 / ui 键一律以 get_component 返回为准。status=search 的候选要先读 whenToUse / whenNotToUse 再决定；带 selectionGroup 的节点是一组互斥选择，按 note 里的排布说明从 alternatives 里选一个组件整组实现；ignore 的节点用导出素材；custom / unmapped 的按稿面自写并在实现清单里说明。",
    });
  },
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

// stdio 传输：MCP 客户端以子进程方式拉起本服务。
// 不用顶层 await（仓库 eslint 禁用）：连接失败时打印原因并以非零退出，与此前未捕获拒绝的效果一致
const transport = new StdioServerTransport();
server.connect(transport).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
