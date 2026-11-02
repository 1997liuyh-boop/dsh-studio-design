<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Mapping, Snapshot } from './types.ts'
import { designPrompt } from './prompt.ts'
import { rpc, runSession } from './session.ts'

const state = ref<Snapshot | null>(null)
const root = ref(''), rebornRoot = ref(''), keyword = ref(''), request = ref(''), output = ref('')
const status = ref(''), error = ref(''), busy = ref(false), running = ref(false)
const mappingRows = ref<Mapping[]>([]), preview = ref(''), renderedPreview = ref('')
const mastergoCommand = ref('npx'), mastergoArgs = ref('[]'), rebornCommand = ref(''), rebornArgs = ref('[]')
const connections = ['mastergo', 'reborn'] as const
const labels = { mastergo: 'MasterGo', reborn: 'Reborn UI' }
const sourceLabels = { project: '项目已有', reborn: 'Reborn', custom: '自定义' }
const sourceOptions = ['project', 'reborn', 'custom'] as const
const candidates = computed(() => state.value?.components.filter(item => item.platforms.includes('web') && [item.id, item.title, item.description].join(' ').toLowerCase().includes(keyword.value.toLowerCase())).slice(0, 16) ?? [])
const configured = computed(() => !!state.value?.project)
const connected = computed(() => connections.every(name => state.value?.connections[name].state === 'connected'))
let controller: AbortController | undefined

async function api(input?: object): Promise<Snapshot> {
  const response = await fetch('/studio-projects/design/api', input ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(120_000) } : { signal: AbortSignal.timeout(15_000) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? '工作室请求失败')
  return result
}
function receive(value: Snapshot) {
  state.value = value
  root.value = value.settings.projectRoot; rebornRoot.value = value.settings.rebornRoot
  mastergoCommand.value = value.settings.mastergo.command; mastergoArgs.value = JSON.stringify(value.settings.mastergo.args)
  rebornCommand.value = value.settings.reborn.command; rebornArgs.value = JSON.stringify(value.settings.reborn.args)
  mappingRows.value = structuredClone(value.workspace?.mappings ?? [])
  preview.value = value.workspace?.previewUrl ?? ''
}
async function perform(action: () => Promise<void>) {
  if (busy.value || running.value) return
  busy.value = true; error.value = ''; status.value = ''
  try { await action() }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : '操作未完成，请重试'
    try { state.value = await api() }
    catch (refreshError) { console.debug('工作室状态暂时无法刷新', refreshError) }
  }
  finally { busy.value = false }
}
function configure() {
  void perform(async () => {
    if (!state.value) return
    receive(await api({ action: 'configure', settings: { schemaVersion: 1, projectRoot: root.value, rebornRoot: rebornRoot.value, mastergo: { command: mastergoCommand.value, args: JSON.parse(mastergoArgs.value) }, reborn: { command: rebornCommand.value, args: JSON.parse(rebornArgs.value) } } }))
    status.value = '项目已读取，配置已保存。请连接所需工具。'
  })
}
function connect(target: 'mastergo' | 'reborn') { void perform(async () => { state.value = await api({ action: 'connect', target }); status.value = labels[target] + ' 工具已就绪' }) }
async function saveWorkspace() {
  if (!state.value?.workspace) throw new Error('请先读取项目')
  state.value = await api({ action: 'save-workspace', workspace: { ...state.value.workspace, mappings: mappingRows.value, previewUrl: preview.value } })
}
function addMapping(component = '', source: Mapping['source'] = 'reborn') {
  mappingRows.value.push({ node: '', component, source, variant: '' })
}
async function generate(kind: 'generate' | 'sync') {
  if (busy.value || running.value) return
  error.value = ''; status.value = ''; output.value = ''
  running.value = true
  const current = new AbortController(); controller = current
  try {
    if (!state.value?.project || !state.value.workspace) throw new Error('请先读取项目')
    state.value = await api()
    if (!connected.value) throw new Error('请先连接 MasterGo 与 Reborn UI')
    await saveWorkspace()
    const workspace = state.value.workspace!
    const prompt = designPrompt(state.value.project!, workspace, request.value, kind)
    if (!workspace.sessionId) {
      const session = await rpc('session/create', { cwd: state.value.project!.root }, current.signal)
      if (typeof session.sessionId !== 'string') throw new Error('dsh 未返回会话标识')
      workspace.sessionId = session.sessionId
      await saveWorkspace()
      await rpc('session/rename', { sessionId: session.sessionId, title: '设计 · ' + state.value.project!.name }, current.signal)
    }
    status.value = '任务已交给 dsh。可在主窗口与悬浮球查看同一会话。'
    await runSession(workspace.sessionId, prompt, text => { output.value = text }, current.signal)
    status.value = '本次回合已结束；代码与检查结果请查看下方回复及 dsh 会话。'
  } catch (cause) { error.value = current.signal.aborted ? '已断开本次监听，请在 dsh 会话确认任务状态' : cause instanceof Error ? cause.message : '生成未完成' }
  finally { running.value = false; controller = undefined }
}
async function stop() {
  const sessionId = state.value?.workspace?.sessionId
  if (!sessionId) return
  try { await rpc('session/cancel', { sessionId }); controller?.abort(); status.value = '已请求停止，请查看会话状态' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '停止请求失败，请在主窗口停止' }
}
function openPreview() {
  void perform(async () => { await saveWorkspace(); renderedPreview.value = state.value?.workspace?.previewUrl ?? ''; status.value = '预览地址已保存' })
}
onMounted(() => { void perform(async () => { const value = await api(); receive(value); const issue = (value as Snapshot & { projectError?: string }).projectError; if (issue) error.value = issue }) })
onUnmounted(() => controller?.abort())
</script>

<template>
  <main class="min-h-screen bg-canvas px-4 py-6 font-sans text-sm text-ink sm:px-8">
    <div class="mx-auto max-w-6xl space-y-6">
      <header class="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-5">
        <div><p class="mb-1 text-xs tracking-widest text-accent">DESIGN / BUILD</p><h1 class="text-2xl font-semibold tracking-tight">设计工作室</h1><p class="mt-2 text-muted">从 MasterGo 选区到项目页面，优先使用已有组件与 Reborn UI。</p></div>
        <button class="rounded-lg border border-line bg-panel px-3 py-2 hover:border-accent disabled:opacity-40" :disabled="busy || running" @click="perform(async () => receive(await api({ action: 'refresh' })))">刷新配置</button>
      </header>
      <p v-if="busy" role="status" class="text-accent">正在处理，请稍候…</p>
      <p v-if="error" role="alert" class="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{{ error }}</p>
      <p v-if="status" role="status" class="text-muted">{{ status }}</p>
      <section aria-labelledby="project-title" class="rounded-xl border border-line bg-panel p-5">
        <div class="mb-5 flex items-baseline gap-3"><span class="text-xs text-accent">01</span><h2 id="project-title" class="text-base font-semibold">项目与连接</h2></div>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end"><label class="flex-1 space-y-2"><span class="block text-muted">Vue / Nuxt 项目目录</span><input v-model="root" aria-label="项目目录" placeholder="项目文件夹的绝对路径" :disabled="busy || running" class="w-full rounded-lg border border-line bg-canvas px-3 py-2 outline-none focus:border-accent"></label><button :disabled="busy || running || !root.trim()" class="rounded-lg bg-accent px-4 py-2 text-white hover:brightness-110 disabled:opacity-40" @click="configure">读取并保存</button></div>
        <div v-if="state?.project" class="mt-4 space-y-2"><p><strong>{{ state.project.name }}</strong> <span class="ml-3 text-muted">{{ state.project.framework }} · {{ state.project.packageManager }} · {{ state.project.components.length }} 个已有组件</span></p><p class="break-words text-xs text-muted">配置：{{ state.project.configFiles.join('、') || 'package.json' }}</p><p v-for="warning in state.project.warnings" :key="warning" class="text-amber-800">{{ warning }}</p></div>
        <div class="mt-5 grid gap-3 md:grid-cols-2"><div v-for="name in connections" :key="name" class="flex items-center gap-3 rounded-lg border border-line p-3"><span class="h-2 w-2 shrink-0 rounded-full" :class="state?.connections[name].state === 'connected' ? 'bg-emerald-500' : 'bg-slate-300'"></span><div class="min-w-0 flex-1"><p class="font-medium">{{ labels[name] }}</p><p class="text-xs text-muted">{{ state?.connections[name].message || '尚未连接' }}</p></div><button :disabled="busy || running || !configured" class="rounded-md border border-line px-3 py-1.5 hover:bg-canvas disabled:opacity-40" @click="connect(name)">{{ state?.connections[name].state === 'connected' ? '重连' : '连接' }}</button></div></div>
        <details class="mt-4 text-muted"><summary class="cursor-pointer py-1">高级连接配置</summary><div class="mt-3 grid gap-4 sm:grid-cols-2"><label class="space-y-1">MasterGo 命令<input v-model="mastergoCommand" :disabled="busy || running" class="w-full rounded border border-line p-2"></label><label class="space-y-1">MasterGo 参数（JSON 数组）<input v-model="mastergoArgs" :disabled="busy || running" class="w-full rounded border border-line p-2"></label><label class="space-y-1">Reborn 命令（留空使用内置 MCP）<input v-model="rebornCommand" :disabled="busy || running" class="w-full rounded border border-line p-2"></label><label class="space-y-1">Reborn 参数（JSON 数组）<input v-model="rebornArgs" :disabled="busy || running" class="w-full rounded border border-line p-2"></label><label class="space-y-1 sm:col-span-2">Reborn 源码目录（可选，留空使用固定知识库）<input v-model="rebornRoot" :disabled="busy || running" class="w-full rounded border border-line p-2"></label><p class="text-xs sm:col-span-2">MasterGo 需要桌面端打开文档。修改后点击“读取并保存”，再连接。自定义命令将在本机运行。</p></div></details>
      </section>
      <section aria-labelledby="mapping-title" class="rounded-xl border border-line bg-panel p-5">
        <div class="mb-5 flex items-baseline gap-3"><span class="text-xs text-accent">02</span><h2 id="mapping-title" class="text-base font-semibold">设计与组件</h2><span class="ml-auto text-xs text-muted">项目已有 → Reborn → 自定义</span></div>
        <label class="block"><span class="sr-only">搜索组件</span><input v-model="keyword" placeholder="搜索 Reborn 组件，例如：按钮、表单、导航" class="w-full rounded-lg border border-line bg-canvas px-3 py-2 outline-none focus:border-accent"></label>
        <div class="mt-3 flex max-h-44 flex-wrap gap-2 overflow-y-auto"><button v-for="item in candidates" :key="item.id" :title="item.description" :disabled="busy || running" class="rounded-full border border-line px-3 py-1.5 text-xs hover:border-accent disabled:opacity-40" @click="addMapping(item.id)">{{ item.title }}</button><p v-if="!candidates.length" class="text-muted">没有匹配的 Web 组件</p></div>
        <details v-if="state?.project?.components.length" class="mt-4"><summary class="cursor-pointer text-muted">项目已有组件</summary><div class="mt-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto"><button v-for="item in state.project.components" :key="item" :disabled="busy || running" class="rounded border border-line px-2 py-1 text-xs hover:border-accent" @click="addMapping(item, 'project')">{{ item }}</button></div></details>
        <div class="mt-5 space-y-3"><div v-for="(row, index) in mappingRows" :key="index" class="grid gap-2 rounded-lg bg-canvas p-3 sm:grid-cols-[1fr_120px_1fr_1fr_auto]"><input v-model="row.node" :disabled="busy || running" :aria-label="'设计节点 ' + (index + 1)" placeholder="设计节点 / 组件名称" class="min-w-0 rounded border border-line bg-panel p-2"><select v-model="row.source" :disabled="busy || running" :aria-label="'组件来源 ' + (index + 1)" class="rounded border border-line bg-panel p-2"><option v-for="source in sourceOptions" :key="source" :value="source">{{ sourceLabels[source] }}</option></select><input v-model="row.component" :disabled="busy || running" :aria-label="'代码组件 ' + (index + 1)" placeholder="代码组件" class="min-w-0 rounded border border-line bg-panel p-2"><input v-model="row.variant" :disabled="busy || running" :aria-label="'变体 ' + (index + 1)" placeholder="变体 / 参数说明" class="min-w-0 rounded border border-line bg-panel p-2"><button :disabled="busy || running" class="px-2 text-muted hover:text-red-700" :aria-label="'移除映射 ' + (index + 1)" @click="mappingRows.splice(index, 1)">移除</button></div></div>
        <div class="mt-4 flex gap-3"><button :disabled="busy || running" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="addMapping('', 'custom')">添加映射</button><button :disabled="busy || running || !configured" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="perform(async () => { await saveWorkspace(); status = '组件映射已保存' })">保存映射</button></div>
      </section>
      <section aria-labelledby="code-title" class="rounded-xl border border-line bg-panel p-5">
        <div class="mb-5 flex items-baseline gap-3"><span class="text-xs text-accent">03</span><h2 id="code-title" class="text-base font-semibold">代码与预览</h2></div>
        <label class="block"><span class="mb-2 block text-muted">先在 MasterGo 中选择页面，再填写本次需求</span><textarea v-model="request" :disabled="running" rows="4" placeholder="例如：按当前选区实现设置页，复用项目布局和 Reborn 表单组件，保留已有保存逻辑。" class="w-full resize-y rounded-lg border border-line bg-canvas p-3 outline-none focus:border-accent"></textarea></label>
        <div class="mt-3 flex flex-wrap items-center gap-3"><button :disabled="busy || running || !configured || !request.trim()" class="rounded-lg bg-accent px-4 py-2 text-white hover:brightness-110 disabled:opacity-40" @click="generate('generate')">{{ running ? 'dsh 正在处理…' : '交给 dsh 实现' }}</button><button v-if="running" class="rounded-lg border border-line px-3 py-2" @click="stop">停止任务</button><details v-else class="text-muted"><summary class="cursor-pointer">更多</summary><button :disabled="busy || !request.trim()" class="mt-2 rounded border border-line p-2 disabled:opacity-40" @click="generate('sync')">请求将静态预览同步到当前画布</button></details></div>
        <p v-if="state?.workspace?.sessionId" class="mt-3 break-all text-xs text-muted">dsh 会话：{{ state.workspace.sessionId }} · 使用主程序配置的模型，可在主窗口切换模型和查看工具操作。</p>
        <pre v-if="output" aria-label="dsh 回复" class="mt-5 max-h-[28rem] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-canvas p-4 font-sans leading-7">{{ output }}</pre>
        <div class="mt-6 flex flex-col gap-2 sm:flex-row sm:items-end"><label class="flex-1"><span class="mb-2 block text-muted">本机预览地址</span><input v-model="preview" placeholder="http://127.0.0.1:5173" :disabled="busy || running" class="w-full rounded-lg border border-line bg-canvas px-3 py-2"></label><button :disabled="busy || running || !configured" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="openPreview">保存并预览</button></div>
        <p class="mt-2 text-xs text-muted">先由 dsh 会话或您运行项目的 dev / preview 脚本，再填写实际地址。预览在隔离框架中运行，登录等功能可能受限。</p>
        <iframe v-if="renderedPreview" :src="renderedPreview" title="项目隔离预览" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" class="mt-4 h-[32rem] w-full rounded-lg border border-line bg-white"></iframe>
      </section>
      <footer class="pb-4 text-xs text-muted">MasterGo Vibe MCP × Reborn UI · Vue Web 首版 · 配置与映射保存在本机，源码目录由您指定。</footer>
    </div>
  </main>
</template>
