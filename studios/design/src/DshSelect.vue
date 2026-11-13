<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { DshSelectOption } from './types.ts'

/**
 * 与 dsh「设置 → 通用设置 → 语言」一致的下拉：触发按钮显示当前项与下箭头，
 * 点开后是浮层菜单（内边距 4、行高 34、字号 13、悬停底色、当前项右侧对勾），
 * 颜色优先取 dsh 的 --dsw-* 变量，独立打开页面时用同色系的回退值。
 * 支持方向键、Enter、Esc 与点击外部关闭。样式在 style.css（构建只编译 SFC 的脚本与模板）。
 */

interface Props {
  /** 全部选项 */
  options: DshSelectOption[]
  /** 是否禁用 */
  disabled?: boolean
  /** 读屏用的名称（没有可见标签时必填） */
  ariaLabel?: string
  /** 没有匹配当前值时触发按钮显示的文字 */
  placeholder?: string
}

const props = withDefaults(defineProps<Props>(), { disabled: false, ariaLabel: undefined, placeholder: '请选择' })
/** 当前选中的值 */
const model = defineModel<string>({ required: true })
const emit = defineEmits<{ change: [value: string] }>()

const open = ref(false), active = ref(-1)
const root = ref<HTMLElement | null>(null), trigger = ref<HTMLButtonElement | null>(null)
const id = 'dsh-select-' + Math.random().toString(36).slice(2, 8)
const current = computed(() => props.options.find(option => option.value === model.value))

function show() {
  if (props.disabled) return
  open.value = true
  active.value = Math.max(0, props.options.findIndex(option => option.value === model.value))
  void nextTick(() => root.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }))
}
function hide(focus = true) {
  open.value = false
  if (focus) trigger.value?.focus()
}
function choose(option: DshSelectOption) {
  if (option.value !== model.value) { model.value = option.value; emit('change', option.value) }
  hide()
}
function onKeydown(event: KeyboardEvent) {
  if (props.disabled) return
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show() }
    return
  }
  if (event.key === 'Escape') { event.preventDefault(); hide() }
  else if (event.key === 'ArrowDown') { event.preventDefault(); active.value = (active.value + 1) % props.options.length }
  else if (event.key === 'ArrowUp') { event.preventDefault(); active.value = (active.value - 1 + props.options.length) % props.options.length }
  else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); const option = props.options[active.value]; if (option) choose(option) }
  else if (event.key === 'Tab') hide(false)
}
function onOutside(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) hide(false)
}
watch(open, value => {
  if (value) document.addEventListener('pointerdown', onOutside, true)
  else document.removeEventListener('pointerdown', onOutside, true)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))
</script>

<template>
  <div ref="root" class="dsh-select relative inline-flex min-w-0">
    <button
      ref="trigger"
      type="button"
      class="dsh-select-trigger"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="id"
      :aria-label="ariaLabel"
      @click="open ? hide() : show()"
      @keydown="onKeydown"
    >
      <span class="min-w-0 flex-1 truncate text-left">{{ current?.label ?? placeholder }}</span>
      <svg class="dsh-select-chevron" :class="open && 'rotate-180'" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    <div v-if="open" :id="id" role="listbox" :aria-label="ariaLabel" class="dsh-select-list" @keydown="onKeydown">
      <button
        v-for="(option, index) in options"
        :key="option.value"
        type="button"
        role="option"
        class="dsh-select-item"
        :aria-selected="option.value === model"
        :data-active="index === active"
        @mouseenter="active = index"
        @click="choose(option)"
      >
        <span class="min-w-0 flex-1">
          <span class="block truncate">{{ option.label }}</span>
          <span v-if="option.description" class="dsh-select-description">{{ option.description }}</span>
        </span>
        <svg v-if="option.value === model" class="dsh-select-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
    </div>
  </div>
</template>
