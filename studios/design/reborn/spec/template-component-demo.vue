<script setup lang="ts">
import { DemoBlock, DemoNote, DemoSection, Icon, Playground } from "#components";
import { computed, ref, shallowRef } from "vue";
import { buttonBorderStyles, buttonColors, buttonSizes, buttonVariants } from "~/components/reborn/ui/reborn-button/reborn-button.config";
import RebornButton from "~/components/reborn/ui/reborn-button/RebornButton.vue";
import RebornCheckbox from "~/components/reborn/ui/reborn-checkbox/RebornCheckbox.vue";
import RebornForm from "~/components/reborn/ui/reborn-form/RebornForm.vue";

const colorOptions = buttonColors.map((c) => ({ label: c.charAt(0).toUpperCase() + c.slice(1), value: c }));
const variantOptions = buttonVariants.map((v) => ({ label: v.charAt(0).toUpperCase() + v.slice(1), value: v }));
const sizeOptions = buttonSizes.map((s) => ({ label: s.toUpperCase(), value: s as (typeof buttonSizes)[number] }));
const borderStyleOptions = buttonBorderStyles.map((b) => ({
  label: b === "solid" ? "实线 Solid" : "虚线 Dashed",
  value: b as (typeof buttonBorderStyles)[number],
}));

// ─── 交互演练场 ─────────────────────────────────────────────────

/** 演练场默认状态 */
const defaultState: Record<string, any> = {
  color: "primary",
  variant: "filled",
  size: "md",
  borderStyle: "solid",
  disabled: false,
  loading: false,
  round: false,
  circle: false,
};

const state = shallowRef<Record<string, any>>({ ...defaultState });

/** 点击计数，让预览区的交互「有回应」 */
const clickCount = shallowRef(0);
function onClick() {
  clickCount.value++;
}

/** 重置演练场配置 */
function resetState() {
  state.value = { ...defaultState };
  clickCount.value = 0;
}

/** 演练场控制面板配置 */
const controls: any = [
  {
    title: "基础属性",
    children: [
      {
        label: "配色方案",
        key: "color",
        component: "select" as const,
        defaultValue: "primary",
        props: { options: colorOptions },
      },
      {
        label: "风格变体",
        key: "variant",
        component: "select" as const,
        defaultValue: "filled",
        props: { options: variantOptions },
      },
      {
        label: "尺寸规格",
        key: "size",
        component: "select" as const,
        defaultValue: "md",
        props: { options: sizeOptions },
      },
      {
        label: "边框线型（对 outlined / subtle 生效）",
        key: "borderStyle",
        component: "select" as const,
        defaultValue: "solid",
        props: { options: borderStyleOptions },
      },
    ],
  },
  {
    title: "形状",
    children: [
      { label: "胶囊（round）", key: "round", component: "checkbox" as const, defaultValue: false },
      { label: "圆形（circle，优先于 round）", key: "circle", component: "checkbox" as const, defaultValue: false },
    ],
  },
  {
    title: "状态",
    children: [
      { label: "禁用状态", key: "disabled", component: "checkbox" as const, defaultValue: false },
      { label: "加载状态", key: "loading", component: "checkbox" as const, defaultValue: false },
    ],
  },
];

/** 演练场右上角展示的传参明细（按钮无 v-model，需手动拼接）：完整列出当前所有参数（含默认值） */
const buttonCode = computed(() => {
  const s = state.value;
  const props: string[] = [
    `color="${s.color}"`,
    `variant="${s.variant}"`,
    `size="${s.size}"`,
    `border-style="${s.borderStyle}"`,
    `:disabled="${s.disabled}"`,
    `:loading="${s.loading}"`,
    `:round="${s.round}"`,
    `:circle="${s.circle}"`,
  ];
  if (s.circle) props.push('aria-label="收藏"');
  const content = s.circle ? '<Icon name="lucide:star" />' : "按钮";
  return `<RebornButton\n  ${props.join("\n  ")}\n>\n  ${content}\n</RebornButton>`;
});

// ─── 场景演示状态 ───────────────────────────────────────────────

const gap = shallowRef(true);
/** 仅演示表单尺寸继承，无需定义字段。 */
const formModel = ref({});
/** 有边框的视觉风格。 */
const borderedVariants = ["outlined", "subtle"] as const;
</script>

<template>
  <div class="flex w-full flex-col">
    <Playground
      v-model="state"
      :controls="controls"
      :code="buttonCode"
      component-name="RebornButton"
      title="交互演练场"
      description="调节上方参数，实时查看按钮表现。"
    >
      <template #tag>
        <RebornButton size="sm" variant="soft" color="neutral" @click="resetState">
          <template #leading>
            <Icon name="lucide:rotate-ccw" size="12" />
          </template>
          重置配置
        </RebornButton>
      </template>

      <div class="flex w-full flex-col items-center gap-8">
        <div class="flex flex-wrap items-center justify-center gap-6">
          <RebornButton
            :color="state.color"
            :variant="state.variant"
            :size="state.size"
            :disabled="state.disabled"
            :loading="state.loading"
            :border-style="state.borderStyle"
            :round="state.round"
            :circle="state.circle"
            :aria-label="state.circle ? `收藏（已点击 ${clickCount} 次）` : undefined"
            @click="onClick"
          >
            <Icon v-if="state.circle" name="lucide:star" />
            <template v-else>点我交互 ({{ clickCount }})</template>
          </RebornButton>

          <RebornButton
            :color="state.color"
            variant="filled"
            circle
            aria-label="收藏"
            :size="state.size"
            :disabled="state.disabled"
            :loading="state.loading"
          >
            <Icon name="lucide:sparkles" />
          </RebornButton>

          <RebornButton
            :color="state.color"
            variant="outlined"
            :size="state.size"
            :border-style="state.borderStyle"
            :disabled="state.disabled"
            :loading="state.loading"
          >
            <template #leading>
              <Icon name="lucide:shopping-cart" />
            </template>
            带图标
          </RebornButton>
        </div>

        <DemoNote tone="dimmed" class="font-mono text-xs">
          Props: { color: '{{ state.color }}', variant: '{{ state.variant }}', size: '{{ state.size }}', borderStyle:
          '{{ state.borderStyle }}', round: {{ state.round }}, circle: {{ state.circle }} }
        </DemoNote>
      </div>
    </Playground>

    <DemoSection title="基础用法">
      <DemoBlock layout="row">
        <RebornButton label="确认提交" />
        <RebornButton>默认插槽文本</RebornButton>
      </DemoBlock>
    </DemoSection>

    <DemoSection title="颜色与变体">
      <DemoBlock layout="stack" class="gap-4">
        <div v-for="v in buttonVariants" :key="v" class="flex flex-wrap items-center gap-3">
          <p class="text-dimmed w-16 text-xs italic">{{ v }}</p>
          <RebornButton v-for="c in buttonColors" :key="c" :variant="v" :color="c" size="sm">
            {{ c }}
          </RebornButton>
        </div>
      </DemoBlock>

      <DemoBlock layout="stack" class="gap-6">
        <div class="text-default flex flex-wrap items-baseline gap-3 text-sm">
          <span>行内混排示例：</span>
          <RebornButton variant="text" color="primary">查看详情</RebornButton>
          <span>/</span>
          <RebornButton variant="text" color="error">删除</RebornButton>
          <span>/</span>
          <RebornButton variant="text" color="neutral">取消</RebornButton>
        </div>
      </DemoBlock>

      <DemoBlock layout="stack" class="gap-5">
        <div v-for="v in borderedVariants" :key="v" class="flex flex-col gap-3">
          <p class="text-muted text-xs font-medium">{{ v }}</p>
          <div v-for="bs in borderStyleOptions" :key="bs.value" class="flex flex-wrap items-center gap-3">
            <p class="text-dimmed w-20 text-xs italic">{{ bs.value }}</p>
            <RebornButton v-for="c in buttonColors" :key="c" :variant="v" :color="c" :border-style="bs.value" size="sm">
              {{ c }}
            </RebornButton>
          </div>
        </div>
      </DemoBlock>
    </DemoSection>

    <DemoSection title="尺寸">
      <DemoBlock layout="stack" class="gap-6">
        <div class="flex flex-wrap items-end gap-3">
          <RebornButton v-for="s in sizeOptions" :key="s.value" :size="s.value" color="primary">
            {{ s.label }}
          </RebornButton>
        </div>
        <div>
          <RebornButton
            v-for="s in sizeOptions"
            :key="s.value"
            :size="s.value"
            circle
            aria-label="收藏"
            color="secondary"
            gap
          >
            <Icon name="lucide:star" />
          </RebornButton>
        </div>
      </DemoBlock>
    </DemoSection>

    <DemoSection title="形状">
      <template #description>
        <code>round</code>
        只改变圆角；<code>circle</code>
        固定等宽高，二者同时开启时圆形优先，配色仍由
        <code>variant</code>
        决定。
      </template>
      <DemoBlock layout="stack">
        <div v-for="v in buttonVariants" :key="v" class="flex items-center gap-3">
          <span class="text-muted w-16 text-sm">{{ v }}</span>
          <RebornButton :variant="v" round>胶囊</RebornButton>
          <RebornButton :variant="v" circle aria-label="收藏"><Icon name="lucide:star" /></RebornButton>
          <RebornButton :variant="v" round circle aria-label="添加"><Icon name="lucide:plus" /></RebornButton>
          <RebornButton :variant="v" round disabled>禁用</RebornButton>
          <RebornButton :variant="v" circle disabled aria-label="不可收藏"><Icon name="lucide:star" /></RebornButton>
        </div>
      </DemoBlock>
      <DemoNote>
        新用法不改变风格的禁用配色；旧
        <code>variant="round"</code>
        /
        <code>variant="circle"</code>
        仍保留原样式。
      </DemoNote>
    </DemoSection>

    <DemoSection title="加载与禁用">
      <DemoBlock layout="row">
        <RebornButton loading>保存中</RebornButton>
        <RebornButton disabled>不可用</RebornButton>
        <RebornButton variant="outlined" circle loading aria-label="正在保存">
          <Icon name="lucide:check" />
        </RebornButton>
      </DemoBlock>
    </DemoSection>

    <DemoSection title="图标插槽">
      <DemoBlock layout="row">
        <RebornButton>
          <template #leading><Icon name="lucide:mail" /></template>
          邮箱登录
        </RebornButton>
        <RebornButton variant="outlined">
          下一步
          <template #trailing><Icon name="lucide:arrow-right" /></template>
        </RebornButton>
      </DemoBlock>
    </DemoSection>

    <DemoSection title="布局：块级与间隔">
      <DemoBlock layout="stack" class="gap-4">
        <RebornCheckbox v-model="gap" label="开启间隔" />
        <div class="flex flex-wrap items-center">
          <RebornButton color="primary" :gap="gap">确认提交</RebornButton>
          <RebornButton color="neutral" variant="outlined" :gap="gap">取消</RebornButton>
          <RebornButton color="error" variant="soft" :gap="gap">删除</RebornButton>
        </div>
      </DemoBlock>

      <DemoBlock layout="grid" class="sm:grid-cols-2 lg:grid-cols-2">
        <div class="flex flex-col items-center gap-3">
          <DemoNote tone="dimmed" class="text-xs">胶囊组</DemoNote>
          <div class="flex items-center">
            <RebornButton color="warning" class="w-[110px] rounded-l-full px-6">加入购物车</RebornButton>
            <RebornButton color="error" class="w-[110px] rounded-r-full px-6">立即购买</RebornButton>
          </div>
        </div>
        <div class="flex flex-col items-center gap-3">
          <DemoNote tone="dimmed" class="text-xs">垂直功能</DemoNote>
          <div class="flex">
            <RebornButton color="warning" variant="filled" class="h-auto w-16 flex-col gap-1 rounded-r-none py-3">
              <Icon name="lucide:share-2" size="18" />
              <span class="text-[10px]">分享</span>
            </RebornButton>
            <RebornButton color="secondary" variant="filled" class="h-auto w-16 flex-col gap-1 rounded-none! py-3">
              <Icon name="lucide:message-square" size="18" />
              <span class="text-[10px]">咨询</span>
            </RebornButton>
            <RebornButton color="error" variant="filled" class="h-auto w-16 flex-col gap-1 rounded-l-none py-3">
              <Icon name="lucide:heart" size="18" />
              <span class="text-[10px]">点赞</span>
            </RebornButton>
          </div>
        </div>
      </DemoBlock>
    </DemoSection>

    <DemoSection title="与表单组联动">
      <DemoBlock layout="row">
        <RebornForm :model-value="formModel" size="lg">
          <RebornButton size="sm" variant="outlined" circle aria-label="添加"><Icon name="lucide:plus" /></RebornButton>
        </RebornForm>
      </DemoBlock>
      <DemoNote>
        表单尺寸覆盖自身
        <code>size</code>，圆形按钮也跟随表单高度。
      </DemoNote>
    </DemoSection>
  </div>
</template>
