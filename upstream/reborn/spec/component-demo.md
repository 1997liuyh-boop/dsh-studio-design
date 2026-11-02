# 组件 Demo 写作规范

**唯一参考范本：`app/components/reborn/examples/reborn-button/RebornButtonDemo.vue`。** 写任何组件 demo 前先读一遍范本，新 demo 的结构、命名、注释风格必须与之对齐。

demo 里的**文案**与组件文档遵循同一套写作规范，见 §7 与 `docs/authoring/component-doc.md`。

---

## 1. 文件位置与配套

| 文件 | 路径 |
| --- | --- |
| web demo | `app/components/reborn/examples/<componentId>/Reborn<X>Demo.vue` |
| web 配置演示 | `app/components/reborn/configs/<componentId>/Reborn<X>Config.vue`（内容为 `ComponentPlayground` 包一层 demo，双端组件加 `uniapp` 属性与 uni-render URL） |
| uniapp demo 页 | `packages/uniapp-project/src/pages/<componentId>/Reborn<X>Demo.vue`（须注册进 `pages.json`） |
| 文档引用 | `content/2.components/<分类>/<componentId>.md` 的 `::ComponentViewer{demoFile="..." config="..."}` |

---

## 2. Web demo 的 script 区

- `<script setup lang="ts">`，**显式 import**：组件从 `~/components/reborn/ui/<id>/...` 导入，config 枚举（colors/variants/sizes/shapes 等）一并导入并 `map` 成 `{ label, value }` 选项数组（label 首字母大写或中英对照）。
- 用 `// ─── 交互演练场 ─────` / `// ─── 场景演示状态 ─────` 分隔注释划分区块。
- **注释全中文**，每个状态 / 函数一行 JSDoc 式说明。
- 演练场三件套：
  1. `defaultState`（`Record<string, any>` 字面量，含全部演练轴的默认值）+ `const state = ref({ ...defaultState })`；
  2. `resetState()` 重置函数（连同交互计数 / 事件回显一起重置）；
  3. `controls` 分组配置：`[{ title: '基础属性'|'状态'|'行为', children: [{ label, key, component, defaultValue, props? }] }]`，`component` 可选 `select` / `checkbox` / `input` / `slider` / `color-picker` / `input-number`。
- 传参明细 `code` computed：完整列出当前所有参数（含默认值）拼成可复制的 `<RebornX ...>` 代码串；有插槽的组件在串里用 `<template #xxx>...</template>` 占位提示。
- 预览区交互要「有回应」：点击计数（`clickCount`）或事件回显（`lastEvent`），展示在 `DemoNote` 中。

---

## 3. Web demo 的 template 区

```
<div class="flex w-full flex-col">
  <Playground v-model="state" :controls="controls" :code="xxxCode"
    component-name="RebornX" title="交互演练场" description="调节上方参数，实时查看…">
    <template #tag>
      <RebornButton size="sm" variant="soft" color="neutral" @click="resetState">
        <template #leading><Icon name="lucide:rotate-ccw" size="12" /></template>
        重置配置
      </RebornButton>
    </template>
    <!-- 预览区：绑定 state 的组件实例 + DemoNote 回显 -->
  </Playground>

  <DemoSection title="…" description="…">   <!-- 或 <template #description> 内嵌 <code> -->
    <DemoBlock layout="stack|grid" class="gap-*">…</DemoBlock>
  </DemoSection>
  …
</div>
```

- 演练场永远是第一节；之后每个能力一节 `DemoSection`，一节只讲一件事。
- 说明文字里的 prop / 取值用 `<code>` 包裹（放进 `<template #description>`）。
- 辅助说明用 `DemoNote tone="dimmed"`；代码 / 参数回显加 `font-mono text-xs`。
- 含浮层 / 下拉面板的组件：各分节按出现顺序加 `class="relative z-30/z-20/z-10/z-1"` 递减，防止面板被后一节遮挡；预览区给面板预留空间（如 `pb-40`）。

---

## 4. 内容覆盖要求

- 演练场覆盖组件的主要 props 轴（color / variant / size / 状态开关等）。
- 场景分节覆盖：全部变体矩阵、插槽用法（带作用域参数示范）、事件回显、典型组合编排。
- **严禁传组件不存在的 prop**（死开关）；demo 中用到的每个 prop / 插槽 / 事件必须真实存在于组件实现。
- 文档 API 表中列出的能力尽量都有对应演示；确实无法演示的在文档「注意事项」中说明。

---

## 5. 分节应与文档 `## 用法` 对齐

`DemoSection` 的节序与节名应与该组件文档 `## 用法` 下的 `###` 小节**一一对应**（同名、同顺序）。两处讲同一件事时，措辞也应一致——不要一处说「隐含禁用」另一处说「自动变灰」。

---

## 6. UniApp demo 页

- 章节结构尽量与 web demo 一一对应（演练场用 `RebornCard` + 各控制组件搭建）。
- 外层 `RebornPage`（title + description），分区 `RebornCard`。
- 尺寸样式一律 rpx（tailwind 任意值 `size-[40rpx]` 或 rpx 令牌 `text-24/28`，禁止 `px-3` / `size-4` 等 px 默认刻度）。
- 注释全中文；条件编译注释（`// #ifdef`）不得破坏；作用域插槽逐项展开，**禁止 `v-bind="scope"` 整包透传**（mp 编译炸点）。

---

## 7. 文案规范（与文档规范同源）

demo 里的所有说明文字与组件文档遵循**同一套**写作规范，正文见 `docs/authoring/component-doc.md`。这里只列 demo 特有的落点：

| 落点 | 要求 |
| --- | --- |
| `Playground` 的 `title` | 固定「交互演练场」，不要自创。 |
| `Playground` 的 `description` | 一句话说明可调什么、看什么，动词开头：「调节上方参数，实时查看按钮在不同语义色与变体下的表现」。 |
| `DemoSection` 的 `title` | **能力名**，不是 prop 名：写「加载与禁用」不写「loading 属性」；与文档 `## 用法` 的小节名对齐。 |
| `DemoSection` 的 `description` | 一句话引子：这一节演示什么 + 由哪个 prop 控制 + 关键联动。prop 名与取值用 `<code>` 包裹。 |
| `DemoNote` | 机制性旁注或事件回显说明，对应文档里的 `::tip`：给理由、给后果，不复述界面上已有的信息。 |

通用要求（与文档完全一致）：

- **一律中文**，代码标识符、类型字面量、文件路径除外。
- **给理由不给口号。** 「`text` 变体不占固定高度，与其他变体并排时基线不齐是预期行为」优于「text 变体更轻量」。
- **禁营销词**：优雅、强大、时尚、炫酷、极致、完美。
- **禁「xxx 属性」式废话。** 写实际语义，含单位与取值范围。
- **不描述组件不存在的能力**，与 §4 的「严禁传组件不存在的 prop」是同一条底线的两面。

反例 → 正例：

```
✗ <DemoSection title="loading 属性" description="演示 loading 属性的使用。">
✓ <DemoSection title="加载与禁用" description="loading 为 true 时按钮同时被禁用，click 不再触发；加载动画颜色随变体走。">

✗ <DemoNote>这里是按钮的展示区域。</DemoNote>
✓ <DemoNote tone="dimmed">已点击 {{ clickCount }} 次；loading 期间点击不计数，因为加载态隐含禁用。</DemoNote>
```

---

## 8. 修改 demo 后的必做动作

1. `npx eslint --fix <demo 文件>`（web 端可 `--fix`；**uniapp 端禁止 `--fix`**，会破坏条件编译，只跑检查）。
2. `pnpm kb:build --only <componentId>` 重新生成知识库（demo 是知识库 `examples` 的来源之一），再 `pnpm kb:check`。
3. uniapp demo 改动后在 `packages/uniapp-project` 跑 `npx uni build` 冒烟。
