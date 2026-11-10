---
title: Button 按钮
description: 双端基础按钮：7 种语义色，Web 支持 5 种风格与独立胶囊、圆形参数，以及加载与禁用状态。
category: 按钮
platform: both
tags: [css, tailwind, button, uniapp]
badge: New
---

::ComponentViewer{demoFile="RebornButtonDemo.vue" config="RebornButtonConfig" componentId="reborn-button" :componentFiles='["RebornButton.vue", "reborn-button.config.ts"]' :uniappFiles='["RebornButton.vue", "reborn-button.config.ts"]'}
::

## 简介

Button 是 Reborn UI 中最基础的操作触发组件，Web 与 UniApp 两端同名同构。

Web 端样式由独立维度组合：`color` 决定语义色，`variant` 决定视觉风格（`filled` / `outlined` / `soft` / `subtle` / `text`），`round` / `circle` 决定形状。例如描边胶囊可写为 `variant="outlined" round`，不必为每种组合新增变体。

`size` 控制尺寸，`loading` / `disabled` 控制状态，`leading` / `trailing` 插槽承载图标。UniApp 端仍通过 `variant="round"` / `variant="circle"` 设置形状，并额外代理小程序原生 `button` 的开放能力；本轮独立形状参数仅适用于 Web。

### 何时使用

- 表单提交、确认 / 取消、保存等常规操作触发。
- 需要按强度分层的按钮体系：主操作用 `filled`，次操作用 `outlined`，弱操作用 `text`。
- 需要语义色表达操作后果，例如删除用 `error`、完成用 `success`。
- 需要图文按钮，通过 `leading` / `trailing` 插槽放置图标。
- 小程序开放能力场景，通过 `openType` 触发原生能力。

### 何时不使用

- 页面固定位置的悬浮操作入口 —— 改用 `reborn-fab`。
- 仅 Web 的营销风格按钮特效 —— 改用 `gradient-button`、`ripple-button` 或 `shimmer-button`。
- 纯跳转、无副作用的导航链接 —— 优先使用链接语义元素，而非按钮。

## 用法

### 基础用法

文本可以通过 `label` prop 传入，也可以用默认插槽。两者同时存在时**默认插槽优先**，`label` 被忽略。

```vue
<template>
  <!-- 两种写法等价 -->
  <RebornButton label="确认提交" />
  <RebornButton>确认提交</RebornButton>
</template>
```

### 颜色与变体

`color` 控制语义色，`variant` 控制视觉强度，两者自由组合：

Web 默认 `primary` 为蓝色、`secondary` 为薄荷绿；UniApp 保持红色主色与灰色次色。Web 实底使用语义背景及配套前景角色，悬停、按下分别使用对应状态角色，前景色随主题保证可读性；主题切换可同时作用于 Button、Badge 等语义色消费者。

| 变体       | 外观                                                  | 典型用途                       |
| ---------- | ----------------------------------------------------- | ------------------------------ |
| `filled`   | 实心填充，搭配主题前景色                              | 页面主行动（每屏建议只有一个） |
| `outlined` | 透明底 + 1px 描边                                     | 次级操作，如「取消」           |
| `soft`     | 10% 透明度浅色底，无边框                              | 并列的多个同级操作             |
| `subtle`   | 浅色底 + 同色描边                                     | 需要比 `soft` 更明确边界的场景 |
| `text`     | 无背景无边框，高度与内边距归零                        | 表格行内操作、辅助链接         |

```vue
<template>
  <RebornButton color="primary">确认提交</RebornButton>
  <RebornButton
    color="neutral"
    variant="outlined"
    >取消</RebornButton
  >
  <RebornButton
    color="error"
    variant="soft"
    >删除</RebornButton
  >
  <RebornButton
    color="success"
    variant="subtle"
    >已完成</RebornButton
  >
  <RebornButton
    color="primary"
    variant="text"
    >查看详情</RebornButton
  >
</template>
```

::tip
`text` 变体通过 `h-auto px-0` 覆盖了 `size` 的固定高度与水平内边距，适合嵌在文本流或表格单元格里；Web 同时开启 `circle` 时例外，圆形仍按 `size` 固定宽高。外部普通 `class` / `ui.base` 可以继续覆盖这些默认值。
::

Web 端可用 `borderStyle="dashed"` 把边框改为虚线，仅对渲染了边框的 `outlined` / `subtle` 生效（边框宽度固定 1px）。

```vue
<template>
  <RebornButton
    variant="outlined"
    border-style="dashed"
    >添加字段</RebornButton
  >
</template>
```

### 尺寸

两端的尺寸档位不同，这是为适配各自的输入精度与屏幕密度而有意分化的。

::tabs{sync="platform"}

:::tabs-item{label="Web" icon="tabler:world"}
三档高度使用 `h-6` / `h-8` / `h-10`，水平内边距统一 `px-3`。默认根字号为 16px 时分别为 24 / 32 / 40px 高、12px 水平内边距，均随 Tailwind `--spacing` 缩放；字号与圆角仍取固定 px 设计令牌：

图标与文字的间距跟随 `size`：`sm` 使用 `gap-1.5`（默认 6px），`md` / `lg` 使用 `gap-2`（默认 8px）；内部内容容器继承根节点间距，可通过 `ui.base` 的 `gap-*` 统一覆盖。

| `size`       | 高度 | 字号                | 直角圆角             |
| ------------ | ---- | ------------------- | -------------------- |
| `sm`         | 24px | `text-sm`（12px）   | 4px（`--radius-sm`） |
| `md`（默认） | 32px | `text-base`（14px） | 4px（`--radius-sm`） |
| `lg`         | 40px | `text-lg`（16px）   | 4px（`--radius-sm`） |

:::

:::tabs-item{label="UniApp" icon="tabler:brand-wechat"}
七档，高度用 `rpx` 随屏宽缩放；非形状变体（`filled` / `outlined` / `soft` / `subtle`）的直角圆角随尺寸取设计令牌：

| `size`       | 高度  | 水平内边距 | 字号  | 直角圆角                  |
| ------------ | ----- | ---------- | ----- | ------------------------- |
| `xs`         | 48rpx | 12rpx      | 22rpx | 4rpx（`--radius-ui-2xs`） |
| `sm`         | 56rpx | 12rpx      | 24rpx | 4rpx（`--radius-ui-2xs`） |
| `default`    | 64rpx | 16rpx      | 26rpx | 6rpx（`--radius-ui-xs`）  |
| `md`（默认） | 64rpx | 16rpx      | 26rpx | 6rpx（`--radius-ui-xs`）  |
| `lg`         | 76rpx | 24rpx      | 28rpx | 8rpx（`--radius-ui-sm`）  |
| `xl`         | 86rpx | 24rpx      | 30rpx | 8rpx（`--radius-ui-sm`）  |
| `2xl`        | 96rpx | 24rpx      | 32rpx | 8rpx（`--radius-ui-sm`）  |

`default` 与 `md` 完全等价，前者保留用于对齐旧代码。

圆角规则两端不同：Web 常规按钮统一使用 `rounded-sm`（`--radius-sm`，固定 4px），不随 `size` 变化；UniApp 仍使用 `--radius-ui-*`、值为 `rpx`，并随尺寸取档。
:::

::

```vue
<template>
  <RebornButton size="sm">小按钮</RebornButton>
  <RebornButton size="md">中按钮</RebornButton>
  <RebornButton size="lg">大按钮</RebornButton>
</template>
```

### 形状

Web 用独立布尔参数控制形状，配色、边框及禁用样式仍由 `variant` 决定。

| 参数组合 | 外形 | 典型用途 |
| --- | --- | --- |
| 不传形状参数 | Web 为固定 4px 圆角，UniApp 随尺寸取档；`text` 无圆角 | 常规操作、行内文本操作 |
| `round` | 胶囊，宽度由内容撑开 | 描边标签式操作、主行动 |
| `circle` | 固定等宽高、无内边距 | 单图标操作 |
| `round circle` | `circle` 优先 | 同时开启两个开关的确定行为 |

::tabs{sync="platform"}

:::tabs-item{label="Web" icon="tabler:world"}

`circle` 按 `size` 使用 24 / 32 / 40px 的等宽高；即使是 `text` 也保留圆形占位。纯图标按钮应提供 `aria-label`。

```vue
<template>
  <RebornButton variant="outlined" round>描边胶囊</RebornButton>
  <RebornButton variant="soft" round>浅底胶囊</RebornButton>
  <RebornButton variant="outlined" circle aria-label="添加">
    <Icon name="lucide:plus" />
  </RebornButton>
  <RebornButton variant="text" circle aria-label="收藏">
    <Icon name="lucide:star" />
  </RebornButton>
</template>
```

旧 `variant="round"` / `variant="circle"` 仍可用，但不再出现在风格选择器中。新代码使用独立参数。Web 端旧 `round` 与 `variant="filled" round` 的禁用文字均为 `text-gray-1`，底色为对应色系第 3 阶；旧 `circle` 使用 `bg-gray-2`、`border-gray-4` 和 `text-gray-5`，迁移为 `variant="filled" circle` 后则采用 Filled 的禁用配色。
:::

:::tabs-item{label="UniApp" icon="tabler:brand-wechat"}

UniApp 本轮不变，尚无 `round` / `circle` 布尔参数，继续使用旧变体。

```vue
<template>
  <RebornButton variant="round">胶囊按钮</RebornButton>
  <RebornButton variant="circle">
    <view class="i-lucide-plus" />
  </RebornButton>
</template>
```

:::

::

### 加载与禁用

Web 端禁用配色由 `variant` 决定，独立的 `round` / `circle` 只改变形状，不改变下表规则。

| `variant` | 禁用底色 | 禁用文字 | 典型用途 |
| --- | --- | --- | --- |
| `filled` / 旧 `round` | 对应色系第 3 阶 | `text-gray-1` | 不可用的主要操作 |
| `outlined` / 旧 `circle` | `bg-gray-2`，边框 `border-gray-4` | `text-gray-5` | 不可用的描边操作 |
| `text` | 透明 | `text-gray-5` | 不可用的文字操作 |
| `soft` / `subtle` | 保留各自的浅底样式 | 保留语义色，`neutral` 为 `text-gray-10` | 保留低强调层级的不可用操作 |

上述配色为 Web 端规则，不代表 UniApp 端同步采用这些色阶。

`loading` 为 `true` 时按钮**同时被禁用**，`click` / `tap` 不再触发；Web 端悬停显示等待光标（`cursor-wait`）。Web 加载动画使用 `currentColor` 继承按钮实际前景色，随主题与 `ui` 覆盖变化；UniApp 实底仍为白色，其余风格跟随 `color`。新形状参数不改变加载动画颜色。

- Web 端动画尺寸为 `1.25em`，跟随当前字号自动缩放。
- UniApp 端动画尺寸按 `size` 取固定值（22 / 24 / 26 / 26 / 28 / 30 / 32）。
- 普通按钮的动画出现在前置位置并替换 `leading` 插槽；Web `circle` 或旧 `variant="circle"` 的动画替换主体内容，避免圆形内同时挤入图标和动画。
- 两种状态下 `trailing` 插槽都不渲染。

```vue
<script setup lang="ts">
const submitting = ref(false);

async function onSubmit() {
  submitting.value = true;
  try {
    await save();
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <RebornButton
    :loading="submitting"
    @click="onSubmit"
  >
    {{ submitting ? "保存中" : "保存" }}
  </RebornButton>
  <RebornButton disabled>不可用</RebornButton>
</template>
```

### 图标插槽

`leading` / `trailing` 分别渲染在主体内容前后。

```vue
<template>
  <RebornButton>
    <template #leading>
      <Icon name="lucide:mail" />
    </template>
    邮箱登录
  </RebornButton>

  <RebornButton variant="outlined">
    下一步
    <template #trailing>
      <Icon name="lucide:arrow-right" />
    </template>
  </RebornButton>
</template>
```

Web 端未显式设置尺寸的 `svg` 会被自动约束为 `size-4`（16px），因此多数图标库可以直接放入而无需额外调尺寸。

### 布局：块级与间隔

`gap` 为 `true` 时，紧邻在另一个 `.reborn-button` 之后的按钮会自动获得 8px 左边距，适合按钮组不想手写 `space-x` 的场景。

UniApp 端额外提供 `block`：为 `true` 时按钮占满整行（`flex w-full`），为 `false` 时为 `inline-flex`。

```vue
<template>
  <!-- 自动间隔 -->
  <RebornButton gap>上一步</RebornButton>
  <RebornButton gap>下一步</RebornButton>

  <!-- UniApp：整行按钮 -->
  <RebornButton
    block
    size="lg"
    >立即支付</RebornButton
  >
</template>
```

### 与表单组联动

按钮处于 `RebornForm` 内时会自动继承表单级配置：

- **尺寸**：两端均为显式控件 `size` > `Form` 的 `size` > 控件默认值。Web 不读取 `FormItem` 的尺寸；表单只为未显式设置尺寸的按钮提供默认值。
- **禁用**：UniApp 端 `Form` 的 `disabled` 会强制禁用组内按钮；Web 端按钮的禁用态只由自身 `disabled` / `loading` 决定。

```vue
<script setup lang="ts">
import { ref } from 'vue'

const form = ref({})
</script>

<template>
  <RebornForm :model-value="form" size="lg">
    <!-- 自动变为 lg 尺寸 -->
    <RebornButton form-type="submit">提交</RebornButton>
  </RebornForm>
</template>
```

::platform-only{platform="uniapp"}
### 小程序开放能力（UniApp）

UniApp 端在容器内叠了一个透明的原生 `button` 作为点击层，因此可以在保留自定义样式的同时完整代理小程序开放能力。传入 `openType` 后，回调经同名事件抛出。

```vue
<script setup lang="ts">
function onGetPhone(e: any) {
  // e.detail.code 交由服务端换取真实手机号
  console.log(e.detail.code);
}

function onError(e: any) {
  console.warn("开放能力调用失败", e.detail);
}
</script>

<template>
  <RebornButton
    open-type="getPhoneNumber"
    @getphonenumber="onGetPhone"
    @error="onError"
  >
    手机号快捷登录
  </RebornButton>
</template>
```

:::warning
各开放能力对具体小程序平台（微信 / QQ / 支付宝等）的支持范围、以及是否需要资质与用户授权，均以对应平台官方文档为准。组件只负责透传，不做能力降级。
:::
::

## API

### Props

::tabs{sync="platform"}

:::tabs-item{label="Web" icon="tabler:world"}

#### Web 端全部属性

| 属性名        | 类型                                                                                   | 默认值      | 描述                                                            |
| ------------- | -------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------- |
| `label`       | `string`                                                                               | -           | 按钮文本；提供默认插槽时被插槽内容覆盖。                        |
| `color`       | `'primary' \| 'secondary' \| 'success' \| 'info' \| 'warning' \| 'error' \| 'neutral'` | `'primary'` | 语义色。                                                        |
| `variant`     | `'filled' \| 'outlined' \| 'soft' \| 'subtle' \| 'text' \| 'round' \| 'circle'`        | `'filled'`  | 视觉风格；`round` / `circle` 取值仅为兼容旧写法。 |
| `round` | `boolean` | `false` | 胶囊形状，不改变视觉风格。 |
| `circle` | `boolean` | `false` | 固定等宽高的圆形，优先于 `round`。 |
| `size`        | `'sm' \| 'md' \| 'lg'`                                                                 | `'md'`      | 尺寸，高度取 `h-6` / `h-8` / `h-10`；显式设置时优先于所在表单的 `size`，未设置时跟随表单。 |
| `loading`     | `boolean`                                                                              | `false`     | 是否加载中；显示加载动画并同时禁用点击。                        |
| `disabled`    | `boolean`                                                                              | `false`     | 是否禁用。                                                      |
| `gap`         | `boolean`                                                                              | `false`     | 紧邻上一个按钮时自动添加 8px 左边距。                           |
| `ui`          | `ButtonUI`                                                                             | -           | 细粒度样式覆盖，值为 `ClassValue`；键位见「自定义样式（ui）」。 |
| `class`       | `ClassValue`                                                                           | -           | 追加到根元素的自定义类名，支持字符串、数组与条件对象。          |
| `borderStyle` | `'solid' \| 'dashed'`                                                                  | `'solid'`   | 边框线型；宽度固定 1px，仅对 `outlined` / `subtle` 生效。       |

:::

:::tabs-item{label="UniApp" icon="tabler:brand-wechat"}

#### UniApp 端全部属性

| 属性名                    | 类型                                                                                   | 默认值      | 描述                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `label`                   | `string`                                                                               | -           | 按钮文本；提供默认插槽时被插槽内容覆盖。                                                                             |
| `color`                   | `'primary' \| 'secondary' \| 'success' \| 'info' \| 'warning' \| 'error' \| 'neutral'` | `'primary'` | 语义色。                                                                                                             |
| `variant`                 | `'filled' \| 'outlined' \| 'soft' \| 'subtle' \| 'text' \| 'round' \| 'circle'`        | `'filled'`  | 视觉变体，含义见「颜色与变体」；`round` / `circle` 为形状变体。                                                      |
| `size`                    | `'xs' \| 'sm' \| 'default' \| 'md' \| 'lg' \| 'xl' \| '2xl'`                           | `'md'`      | 尺寸，七档 `rpx` 随屏宽缩放；显式设置时优先于所在表单的 `size`，未设置时跟随表单。                                                            |
| `loading`                 | `boolean`                                                                              | `false`     | 是否加载中；显示加载动画并同时禁用点击。                                                                             |
| `disabled`                | `boolean`                                                                              | `false`     | 是否禁用。                                                                                                           |
| `gap`                     | `boolean`                                                                              | `false`     | 紧邻上一个按钮时自动添加 8px 左边距。                                                                                |
| `ui`                      | `object`                                                                               | -           | 细粒度样式覆盖，键位见「自定义样式（ui）」。                                                                         |
| `customClass`             | `any`                                                                                  | -           | 追加到根节点的自定义类名（对应 Web 端 `class`）。                                                                    |
| `block`                   | `boolean`                                                                              | `false`     | 是否占满整行（`flex w-full`），否则为 `inline-flex`。                                                                |
| `fluid`                   | `boolean`                                                                              | `false`     | 预留的 flex-1 布局开关，当前版本尚未接入样式，暂无视觉效果。                                                         |
| `hoverClass`              | `string`                                                                               | -           | 按钮点击态样式类。                                                                                                   |
| `hoverStopPropagation`    | `boolean`                                                                              | -           | 是否阻止点击态冒泡。                                                                                                 |
| `hoverStartTime`          | `number`                                                                               | `20`        | 按住后出现点击态的延迟，单位毫秒。                                                                                   |
| `hoverStayTime`           | `number`                                                                               | `70`        | 松手后点击态保留时长，单位毫秒。                                                                                     |
| `formType`                | `'submit' \| 'reset'`                                                                  | -           | 表单提交类型，配合 form 组件使用。                                                                                   |
| `openType`                | `string`                                                                               | -           | 小程序开放能力类型（`contact` / `getPhoneNumber` / `openSetting` / `launchApp` / `chooseAvatar` 等），回调见 Emits。 |
| `lang`                    | `string`                                                                               | -           | 返回用户信息的语言。                                                                                                 |
| `sessionFrom`             | `string`                                                                               | -           | `openType="contact"` 时的会话来源。                                                                                  |
| `sendMessageTitle`        | `string`                                                                               | -           | `openType="contact"` 时的会话内消息卡片标题。                                                                        |
| `sendMessagePath`         | `string`                                                                               | -           | `openType="contact"` 时的会话内消息卡片路径。                                                                        |
| `sendMessageImg`          | `string`                                                                               | -           | `openType="contact"` 时的会话内消息卡片图片。                                                                        |
| `showMessageCard`         | `boolean`                                                                              | -           | `openType="contact"` 时是否显示会话内消息卡片。                                                                      |
| `appParameter`            | `string`                                                                               | -           | `openType="launchApp"` 时向 APP 传递的参数。                                                                         |
| `groupId`                 | `string`                                                                               | -           | 群 ID（QQ 开放能力）。                                                                                               |
| `guildId`                 | `string`                                                                               | -           | 频道 / 公会 ID（QQ 开放能力）。                                                                                      |
| `publicId`                | `string`                                                                               | -           | 公众号 ID（QQ 开放能力）。                                                                                           |
| `phoneNumberNoQuotaToast` | `boolean`                                                                              | -           | 获取手机号因额度不足失败时，是否弹出错误提示。                                                                       |
| `createliveactivity`      | `boolean`                                                                              | -           | 是否创建直播活动。                                                                                                   |

:::

::

### Emits

::tabs{sync="platform"}

:::tabs-item{label="Web" icon="tabler:world"}
| 事件名 | 回调参数 | 描述 |
| --- | --- | --- |
| `click` | `(e: Event)` | 点击时触发；`disabled` 或 `loading` 时不触发。为原生 click 透传。 |

Web 端只有这一个事件，开放能力相关回调是 UniApp 端独有的。
:::

:::tabs-item{label="UniApp" icon="tabler:brand-wechat"}
| 事件名 | 回调参数 | 描述 |
| --- | --- | --- |
| `click` | `(e: UniEvent)` | 点击时触发；`disabled` 或 `loading` 时不触发。 |
| `tap` | `(e: UniEvent)` | 与 `click` 同时派发，便于沿用 `@tap` 写法。 |
| `getphonenumber` | `(e: UniEvent)` | `openType="getPhoneNumber"`，`e.detail.code` 用于服务端换取手机号。 |
| `getrealtimephonenumber` | `(e: UniEvent)` | `openType="getRealtimePhoneNumber"`（微信）实时手机号验证回调。 |
| `getuserinfo` | `(e: UniEvent)` | `openType="getUserInfo"`，`e.detail` 含 `userInfo` 等。 |
| `contact` | `(e: UniEvent)` | `openType="contact"` 客服会话回调，`e.detail.path` / `query` 为消息参数。 |
| `opensetting` | `(e: UniEvent)` | `openType="openSetting"` 打开授权设置页后回调，`e.detail.authSetting` 为授权结果。 |
| `launchapp` | `(e: UniEvent)` | `openType="launchApp"` 打开 APP 成功时触发。 |
| `chooseavatar` | `(e: UniEvent)` | `openType="chooseAvatar"`（微信），`e.detail.avatarUrl` 为所选头像临时路径。 |
| `chooseaddress` | `(e: UniEvent)` | `openType="chooseAddress"`（QQ）选择收货地址后回调。 |
| `chooseinvoicetitle` | `(e: UniEvent)` | `openType="chooseInvoiceTitle"`（QQ）选择发票抬头后回调。 |
| `addgroupapp` | `(e: UniEvent)` | `openType="addGroupApp"`（QQ）添加群应用后回调。 |
| `subscribe` | `(e: UniEvent)` | `openType="subscribe"`（QQ）订阅号订阅结果回调。 |
| `login` | `(e: UniEvent)` | `openType="login"`（QQ）登录回调，`e.detail` 含登录 code。 |
| `agreeprivacyauthorization` | `(e: UniEvent)` | `openType="agreePrivacyAuthorization"`（微信）用户同意隐私协议后回调。 |
| `error` | `(e: UniEvent)` | 开放能力调用出错时触发，`e.detail` 含错误信息。 |
:::

::

### Slots

两端插槽名一致，仅作用域参数有差异。

::tabs{sync="platform"}

:::tabs-item{label="Web" icon="tabler:world"}
| 插槽名 | 作用域参数 | 描述 |
| --- | --- | --- |
| `default` | `{ ui }` | 按钮主体内容，优先于 `label` prop 渲染。 |
| `leading` | `{ ui }` | 前置内容，常放图标；`loading` 时被加载动画替代。 |
| `trailing` | `{ ui }` | 后置内容，常放图标；`loading` 时不渲染。`ui` 与 `leading` 相同是样式函数集合，图标类名取 `ui.trailingIcon()`。 |
:::

:::tabs-item{label="UniApp" icon="tabler:brand-wechat"}
| 插槽名 | 作用域参数 | 描述 |
| --- | --- | --- |
| `default` | `{ ui }` | 按钮主体内容，优先于 `label` prop 渲染。 |
| `leading` | `{ ui, loading }` | 前置内容，常放图标；`loading` 时被加载动画替代。 |
| `trailing` | `{ ui }` | 后置内容，常放图标；`loading` 时不渲染。 |
:::

::

作用域里的 `ui` 是样式函数集合，可用于让插槽内容复用按钮的内部类名，例如 `:class="ui.label()"`。

### 自定义样式（ui）

`ui` 按内部结构键覆盖对应节点的类名。两端 DOM 结构不同，可用键位也不同：

Web 的 `ButtonUI` 从组件目录的 `index.ts` 导出，各键接受 `ClassValue`。默认形状与行高均使用普通类，允许 `ui.base: 'rounded-lg'`、`ui.label: 'leading-6'` 继续覆盖；插槽中调用 `ui.label({ class: 'leading-7' })` 时，显式类名优先于 `ui.label` 覆盖。

::tabs{sync="platform"}

:::tabs-item{label="Web" icon="tabler:world"}
| 键名 | 说明 |
| --- | --- |
| `base` | 根元素。 |
| `label` | 文本节点，默认 `truncate leading-none`。**仅在使用 `label` prop 时渲染**，填充 default 插槽会替换掉该节点，`ui.label` 随之失效——需要保留该样式时在插槽里用作用域的 `:class="ui.label()"`。 |
| `leadingIcon` | 前置图标区域，同时是加载动画的容器。 |
| `leadingAvatar` | 前置头像区域。 |
| `leadingAvatarSize` | 前置头像尺寸。 |
| `trailingIcon` | 后置图标区域。 |
:::

:::tabs-item{label="UniApp" icon="tabler:brand-wechat"}
| 键名 | 说明 |
| --- | --- |
| `base` | 根元素。 |
| `inner` | 覆盖在根节点上的透明原生 `button` 点击层。 |
| `label` | 文本节点，默认 `truncate`。**仅在使用 `label` prop 时渲染**，填充 default 插槽会替换掉该节点，`ui.label` 随之失效——需要保留该样式时在插槽里用作用域的 `:class="ui.label()"`。 |
| `loading` | 加载动画容器。 |
:::

::

```vue
<template>
  <RebornButton :ui="{ base: 'shadow-lg', label: 'tracking-wide' }"> 自定义样式 </RebornButton>
</template>
```

### CSS 变量

Web 使用 Tailwind 原生尺寸刻度，UniApp 保留独立的 rpx 高度令牌，互不影响。

::tabs{sync="platform"}

:::tabs-item{label="Web" icon="tabler:world"}
不再定义按钮专属高度变量。原生尺寸刻度由 `app/assets/css/reborn-ui.css` 引入的 Tailwind `--spacing` 提供，默认 `0.25rem`；字号仍定义在 `app/assets/theme/typography.css`。

| `size` | 高度 | 圆形宽度 | 默认根字号 16px 时 |
| --- | --- | --- | --- |
| `sm` | `h-6` | `w-6` | `24px` |
| `md` | `h-8` | `w-8` | `32px` |
| `lg` | `h-10` | `w-10` | `40px` |

:::

:::tabs-item{label="UniApp" icon="tabler:brand-wechat"}
定义在 `packages/uniapp-project/src/styles/theme.css`，`rpx` 随屏宽缩放：

| 变量名                | 对应 `size`      | 值      |
| --------------------- | ---------------- | ------- |
| `--button-xs-height`  | `xs`             | `48rpx` |
| `--button-sm-height`  | `sm`             | `56rpx` |
| `--button-md-height`  | `md` / `default` | `64rpx` |
| `--button-lg-height`  | `lg`             | `76rpx` |
| `--button-xl-height`  | `xl`             | `86rpx` |
| `--button-2xl-height` | `2xl`            | `96rpx` |

`default` 档位不单独设变量，直接复用 `--button-md-height`。UniApp 主题变量挂载在 `:root, body, page` 上（避免 `:root` 在微信小程序下报错），覆盖时请对齐同一选择器。
:::

::

## 两端差异对照

| 维度         | Web                                                                                       | UniApp                                               |
| ------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 自定义类名   | `class`                                                                                   | `customClass`                                        |
| 默认品牌色 | `primary` 蓝色，`secondary` 薄荷绿 | `primary` 红色，`secondary` 灰色 |
| 尺寸档位     | `sm` / `md` / `lg`（3 档，Tailwind 原生尺寸刻度）                                         | `xs` ~ `2xl`（7 档，rpx）                            |
| 形状 | 独立 `round` / `circle` 布尔参数；旧变体兼容 | 仍为 `variant="round"` / `variant="circle"` |
| 直角圆角     | 所有 `size` 统一 4px（`rounded-sm`）                                                       | 随 `size` 取令牌 4 / 6 / 8rpx                        |
| 水平内边距   | 统一 `px-3`（默认根字号下 12px）                                                          | 随 `size` 递进 12 / 16 / 24rpx                       |
| 边框线型     | 支持 `borderStyle`                                                                        | 不支持，固定实线                                     |
| 块级布局     | 用 `class` 自行控制                                                                       | `block` prop                                         |
| `ui` 键位    | `base` / `label` / `leadingIcon` / `leadingAvatar` / `leadingAvatarSize` / `trailingIcon` | `base` / `inner` / `label` / `loading`               |
| 加载动画尺寸 | `1.25em`，跟随字号                                                                        | 按 `size` 取固定值                                   |
| 表单组禁用   | 仅自身 `disabled` / `loading` 生效                                                        | `Form` 级 `disabled` 会强制禁用                      |
| 点击态       | 由变体的 hover 样式内置                                                                   | `hoverClass` / `hoverStartTime` / `hoverStayTime`    |
| 开放能力     | 不支持                                                                                    | 完整代理 `openType` 及全部回调                       |

## 注意事项

- **Web 形状独立，旧变体保留兼容**。新参数只改变轮廓，`circle` 优先于 `round`；UniApp 仍使用形状变体。Web 端旧 `round` 与 `filled + round` 的禁用配色一致；旧 `circle` 为灰阶底色和灰阶 5 文字，`filled + circle` 则为对应色系第 3 阶底色和灰阶 1 文字，迁移时需确认视觉变化。
- **`loading` 隐含禁用**。加载中按钮不会派发 `click` / `tap`，无需再额外绑 `disabled`。
- **普通 `text` 变体不占固定高度**。Web 开启 `circle` 时则按 `size` 对应的原生刻度固定宽高。它用 `h-auto px-0` 覆盖了 `size` 的高度与水平内边距，与其他变体并排时基线不齐是预期行为；需要对齐请把它放进同一个 flex 容器并用 `items-center`。
- **`borderStyle` 只影响有边框的变体**。`filled` / `soft` / `text` 本身不渲染边框，传 `dashed` 不会有视觉变化。
- **开放能力仅小程序生效**。`openType` 系列 props 与 `getphonenumber`、`contact` 等事件在 H5 / APP 端无效，具体能力的平台支持范围以对应小程序平台文档为准。
- **UniApp 的点击层是独立元素**。原生 `button` 以透明层叠在根节点上（`ui.inner`），如果自定义样式改动了根节点的层叠上下文或 `overflow`，可能影响点击命中，请一并检查。
- **`fluid` 当前是预留 prop**。UniApp 端已声明但尚未接入样式，需要等宽填充请改用 `block` 或外层 flex 布局。
