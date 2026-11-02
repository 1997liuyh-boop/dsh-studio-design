<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Mapping, Snapshot } from './types.ts'
import { designPrompt } from './prompt.ts'
import { rpc, runSession } from './session.ts'
import { pickDirectory } from './picker.ts'
import { mastergoForm, mastergoSpec } from './mastergo.ts'

const state = ref<Snapshot | null>(null)
const root = ref(''), rebornRoot = ref(''), keyword = ref(''), request = ref(''), output = ref('')
const status = ref(''), error = ref(''), busy = ref(false), running = ref(false)
const mappingRows = ref<Mapping[]>([]), preview = ref(''), renderedPreview = ref('')
const mastergoCommand = ref('npx'), mastergoArgs = ref('[]'), rebornCommand = ref(''), rebornArgs = ref('[]')
const rebornSource = ref('builtin'), repository = ref('https://github.com/1997liuyh-boop/Reborn-UI'), sourceRef = ref('main')
const script = ref(''), showLogs = ref(false)
const mastergoMode = ref('visual'), mastergoAddress = ref('http://127.0.0.1:30678'), mastergoVersion = ref('1.0.32')
const scripts = computed(() => Object.entries(state.value?.project?.scripts ?? {}))
const previewActive = computed(() => ['starting', 'running', 'ready', 'stopping'].includes(state.value?.preview?.state ?? ''))
const previewLabels = { idle: '尚未启动', starting: '正在启动', running: '进程运行中，等待地址', ready: '预览已就绪', completed: '服务已退出', failed: '启动失败，请查看日志', killed: '服务已停止', stopping: '正在停止' }
const connections = ['mastergo', 'reborn'] as const
const labels = { mastergo: 'MasterGo', reborn: 'Reborn UI' }
const sourceLabels = { project: '项目已有', reborn: 'Reborn', custom: '自定义' }
const sourceOptions = ['project', 'reborn', 'custom'] as const
const candidates = computed(() => state.value?.components.filter(item => item.platforms.includes('web') && [item.id, item.title, item.description].join(' ').toLowerCase().includes(keyword.value.toLowerCase())).slice(0, 16) ?? [])
const configured = computed(() => !!state.value?.project && root.value === state.value.settings.projectRoot)
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
  const form = mastergoForm(value.settings.mastergo)
  mastergoMode.value = form.mode; mastergoAddress.value = form.address; mastergoVersion.value = form.version
  mastergoCommand.value = value.settings.mastergo.command; mastergoArgs.value = JSON.stringify(value.settings.mastergo.args)
  rebornCommand.value = value.settings.reborn.command; rebornArgs.value = JSON.stringify(value.settings.reborn.args)
  rebornSource.value = value.settings.rebornSource ?? (value.settings.rebornRoot ? 'local' : 'builtin')
  repository.value = value.settings.rebornRepository ?? 'https://github.com/1997liuyh-boop/Reborn-UI'; sourceRef.value = value.settings.rebornRef ?? 'main'
  mappingRows.value = structuredClone(value.workspace?.mappings ?? [])
  preview.value = value.workspace?.previewUrl ?? ''
  const available = Object.keys(value.project?.scripts ?? {})
  if (!available.includes(script.value)) script.value = available.includes('dev') ? 'dev' : available.includes('preview') ? 'preview' : available[0] ?? ''
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
async function saveConfiguration() {
    if (!state.value) return
    receive(await api({ action: 'configure', settings: { ...state.value.settings, schemaVersion: 1, projectRoot: root.value, rebornRoot: rebornRoot.value, rebornSource: rebornSource.value, rebornRepository: repository.value, rebornRef: sourceRef.value, mastergo: mastergoMode.value === 'visual' ? mastergoSpec(mastergoAddress.value, mastergoVersion.value) : { command: mastergoCommand.value, args: JSON.parse(mastergoArgs.value) }, reborn: { command: rebornCommand.value, args: JSON.parse(rebornArgs.value) } } }))
    status.value = '配置已保存，内置 Reborn 会自动准备。使用设计稿前请连接 MasterGo。'
}
function configure() { void perform(saveConfiguration) }
function chooseDirectory(target: 'project' | 'reborn') { void perform(async () => { const path = await pickDirectory(); if (path === null) return; if (target === 'project') root.value = path; else rebornRoot.value = path; await saveConfiguration() }) }
function useWorkspace() { void perform(async () => { const path = await pickDirectory('workspace'); if (!path) return; root.value = path; await saveConfiguration(); status.value = '已读取当前主会话的项目目录，请确认下方路径。切换工作区后可再次同步。' }) }
function usePublishedKnowledge() { repository.value = 'https://github.com/1997liuyh-boop/dsh-studio-design'; sourceRef.value = 'knowledge'; rebornSource.value = 'github' }
function syncSource() { void perform(async () => { await saveConfiguration(); receive(await api({ action: 'sync-source' })); status.value = 'GitHub 源码已缓存并固定版本，组件资料来源见下方' }) }
function connect(target: 'mastergo' | 'reborn') { void perform(async () => { state.value = await api({ action: 'connect', target }); status.value = labels[target] + ' 工具已就绪' }) }
async function saveWorkspace() {
  if (!state.value?.workspace) throw new Error('请先读取项目')
  state.value = await api({ action: 'save-workspace', workspace: { ...state.value.workspace, mappings: mappingRows.value, previewUrl: preview.value } })
}
function addMapping(component = '', source: Mapping['source'] = 'reborn') {
  mappingRows.value.push({ node: '', component, source, variant: '' })
}
async function generate(kind: 'generate' | 'sync' | 'read' | 'rules') {
  if (busy.value || running.value) return
  error.value = ''; status.value = ''; output.value = ''
  running.value = true
  const current = new AbortController(); controller = current
  try {
    if (!state.value?.project || !state.value.workspace) throw new Error('请先读取项目')
    const selectedRoot = state.value.project.root
    state.value = await api()
    if (state.value.project?.root !== selectedRoot || root.value !== state.value.settings.projectRoot) throw new Error('项目目录已变更，请读取并确认后重试')
    if (kind !== 'rules' && !connected.value) throw new Error('请先连接 MasterGo 与 Reborn UI')
    await saveWorkspace()
    const workspace = state.value.workspace!
    const prompt = designPrompt(state.value.project!, workspace, kind === 'read' ? '读取当前 MasterGo 选区，展示文档、节点和主题摘要，说明与已有组件的对应关系' : request.value, kind, state.value.source)
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
async function ensureSession(): Promise<string> {
  if (!state.value?.project || !state.value.workspace) throw new Error('请先选择项目')
  const session = await rpc('session/create', { cwd: state.value.project.root, ...(state.value.workspace.sessionId ? { sessionId: state.value.workspace.sessionId } : {}) })
  if (typeof session.sessionId !== 'string') throw new Error('dsh 未返回会话标识')
  if (!state.value.workspace.sessionId) {
    state.value.workspace.sessionId = session.sessionId
    await saveWorkspace()
    await rpc('session/rename', { sessionId: session.sessionId, title: '设计 · ' + state.value.project!.name })
  }
  return state.value.workspace!.sessionId
}
function startPreview() { void perform(async () => { await ensureSession(); state.value = await api({ action: 'preview-start', script: script.value }); showLogs.value = true; status.value = '已登记项目预览任务，等待真实服务地址' }) }
function stopPreview() { void perform(async () => { state.value = await api({ action: 'preview-stop' }); status.value = '已请求停止本项目的预览任务' }) }
async function stop() {
  const sessionId = state.value?.workspace?.sessionId
  if (!sessionId) return
  try { await rpc('session/cancel', { sessionId }); controller?.abort(); status.value = '已请求停止，请查看会话状态' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '停止请求失败，请在主窗口停止' }
}
function openPreview() {
  void perform(async () => { await saveWorkspace(); renderedPreview.value = state.value?.workspace?.previewUrl ?? ''; status.value = '预览地址已保存' })
}
let timer: ReturnType<typeof setInterval> | undefined, polling = false, mounted = false
onMounted(() => {
  mounted = true
  void perform(async () => { const value = await api(); receive(value); const issue = (value as Snapshot & { projectError?: string }).projectError; if (issue) error.value = issue })
  timer = setInterval(async () => {
    if (!mounted || polling || busy.value || running.value || !previewActive.value) return
    polling = true
    try {
      const value = await api()
      if (!mounted) return
      state.value = value
      if (value.preview?.state === 'ready' && value.preview.url) { preview.value = value.preview.url; renderedPreview.value = value.preview.url }
    } catch (cause) { if (mounted) error.value = cause instanceof Error ? cause.message : '预览状态暂不可用，请刷新检查' }
    finally { polling = false }
  }, 1500)
})
onUnmounted(() => { mounted = false; clearInterval(timer); controller?.abort() })
</script>

<template>
  <main class="min-h-screen bg-canvas px-4 py-6 font-sans text-sm text-ink sm:px-8">
    <div class="mx-auto max-w-6xl space-y-6">
      <header class="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-5">
        <div><p class="mb-1 text-xs tracking-widest text-accent">DESIGN / BUILD</p><h1 class="text-2xl font-medium tracking-tight">设计工作室</h1><p class="mt-2 text-muted">从 MasterGo 选区到项目页面，优先使用已有组件与 Reborn UI。</p></div>
        <button class="rounded-lg border border-line bg-panel px-3 py-2 hover:border-accent disabled:opacity-40" :disabled="busy || running" @click="perform(async () => receive(await api({ action: 'refresh' })))">刷新配置</button>
      </header>
      <p v-if="busy" role="status" class="text-accent">正在处理，请稍候…</p>
      <p v-if="error" role="alert" class="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{{ error }}</p>
      <p v-if="status" role="status" class="text-muted">{{ status }}</p>
      <section aria-labelledby="project-title" class="rounded-xl border border-line bg-panel p-5">
        <div class="mb-5 flex items-baseline gap-3"><span class="text-xs text-accent">01</span><h2 id="project-title" class="text-base font-medium">项目与连接</h2></div>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end"><label class="flex-1 space-y-2"><span class="block text-muted">Vue / Nuxt 项目目录</span><input v-model="root" aria-label="项目目录" placeholder="项目文件夹的绝对路径" :disabled="busy || running" class="w-full rounded-lg border border-line bg-canvas px-3 py-2 outline-none focus:border-accent"></label><button :disabled="busy || running" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="chooseDirectory('project')">选择文件夹</button><button :disabled="busy || running" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="useWorkspace">使用当前工作区</button><button :disabled="busy || running" class="rounded-lg bg-accent px-4 py-2 text-white hover:brightness-110 disabled:opacity-40" @click="configure">读取并保存</button></div>
        <div v-if="state?.project" class="mt-4 space-y-2"><p><strong>{{ state.project.name }}</strong> <span class="ml-3 text-muted">{{ state.project.framework }} · {{ state.project.packageManager }} · {{ state.project.components.length }} 个已有组件</span></p><p class="break-words text-xs text-muted">配置：{{ state.project.configFiles.join('、') || 'package.json' }}</p><p v-for="warning in state.project.warnings" :key="warning" class="text-amber-800">{{ warning }}</p></div>
        <div class="mt-5 grid gap-3 md:grid-cols-2"><div v-for="name in connections" :key="name" class="flex items-center gap-3 rounded-lg border border-line p-3"><span class="h-2 w-2 shrink-0 rounded-full" :class="state?.connections[name].state === 'connected' ? 'bg-emerald-500' : 'bg-slate-300'"></span><div class="min-w-0 flex-1"><p class="font-medium">{{ labels[name] }}</p><p class="text-xs text-muted">{{ state?.connections[name].message || '尚未连接' }}</p></div><button :disabled="busy || running" class="rounded-md border border-line px-3 py-1.5 hover:bg-canvas disabled:opacity-40" @click="connect(name)">{{ state?.connections[name].state === 'connected' ? '重连' : '连接' }}</button></div></div>
        <details class="mt-4 text-muted">
          <summary class="cursor-pointer py-1">Reborn 组件知识库 · {{ state?.source?.kind === 'github' ? 'GitHub 缓存' : state?.source?.kind === 'local' ? '本地知识库' : '内置快照' }}</summary>
          <div class="mt-3 space-y-3">
            <label class="block">知识库来源<select v-model="rebornSource" :disabled="busy || running" class="ml-2 rounded border border-line bg-panel p-2"><option value="builtin">内置完整快照</option><option value="github">GitHub 链接</option><option value="local">本地知识库</option></select></label>
            <div v-if="rebornSource === 'github'" class="space-y-3">
              <label class="block">GitHub 仓库链接<input v-model="repository" :disabled="busy || running" class="mt-1 w-full rounded border border-line bg-canvas p-2"></label>
              <label class="block">分支 / 标签 / 提交<input v-model="sourceRef" :disabled="busy || running" class="mt-1 w-full rounded border border-line bg-canvas p-2"></label>
              <div class="flex flex-wrap gap-3"><button :disabled="busy || running" class="rounded border border-line px-3 py-2 disabled:opacity-40" @click="usePublishedKnowledge">使用完整 GitHub 知识库</button><button :disabled="busy || running" class="rounded border border-line px-3 py-2 disabled:opacity-40" @click="syncSource">获取并固定版本</button></div>
              <p class="text-xs">Reborn 源码仓库通常不含生成资料。完整知识库由云端从源码构建，发布在设计工作室仓库的 knowledge 分支；本机只读取资料，不执行下载仓库的脚本。</p>
              <p class="break-all text-xs">当前缓存：{{ state?.source?.repository }} · {{ state?.settings.rebornCommit || '尚未获取' }}</p>
            </div>
            <div v-if="rebornSource === 'local'" class="space-y-2"><div class="flex flex-wrap gap-2"><input v-model="rebornRoot" aria-label="Reborn 本地目录" placeholder="源码根、完整知识包或 knowledge 目录" :disabled="busy || running" class="min-w-0 flex-1 rounded border border-line bg-canvas p-2"><button :disabled="busy || running" class="rounded border border-line px-3 py-2" @click="chooseDirectory('reborn')">选择知识库</button></div><p class="text-xs">支持已生成的源码根、MCP 分发目录、解压后的完整知识包和 knowledge 文件夹。</p></div>
            <p class="text-xs">来源切换后点击“读取并保存”。当前参数资料：{{ state?.source?.knowledge === 'repository' ? '所选来源的完整知识库' : '插件内置完整快照' }} · {{ state?.components.length ?? 0 }} 个组件。</p>
            <p v-if="state?.source?.contentCommit" class="break-all text-xs">对应 Reborn 源码版本：{{ state.source.contentCommit }}</p>
            <p v-if="state?.source?.kind === 'github' && state.source.knowledge !== 'repository'" class="text-xs text-muted">此仓库未生成完整知识库，查询继续使用内置快照。可切换上方“完整 GitHub 知识库”，或下载云端打包产物后选择本地目录。</p>
          </div>
        </details>
        <details class="mt-4 text-muted">
          <summary class="cursor-pointer py-1">MasterGo 可视化配置</summary>
          <div class="mt-3 space-y-3">
            <p class="text-xs">在 MasterGo 桌面端打开设计文档，开启 Vibe MCP，复制其服务地址；无需 Token。设计资料写入当前项目的 .mastergo 目录，切换项目后需重新连接。</p>
            <label class="block">连接方式<select v-model="mastergoMode" :disabled="busy || running" class="ml-2 rounded border border-line bg-panel p-2"><option value="visual">本机桌面服务</option><option value="custom">自定义命令（高级）</option></select></label>
            <div v-if="mastergoMode === 'visual'" class="grid gap-3 sm:grid-cols-2"><label>桌面服务地址<input v-model="mastergoAddress" aria-label="MasterGo 服务地址" placeholder="http://127.0.0.1:30678" :disabled="busy || running" class="mt-1 w-full rounded border border-line bg-canvas p-2"></label><label>适配器版本<input v-model="mastergoVersion" aria-label="MasterGo 适配器版本" placeholder="1.0.32 或 latest" :disabled="busy || running" class="mt-1 w-full rounded border border-line bg-canvas p-2"></label></div>
            <div v-else class="grid gap-3 sm:grid-cols-2"><label>启动命令<input v-model="mastergoCommand" :disabled="busy || running" class="mt-1 w-full rounded border border-line bg-canvas p-2"></label><label>启动参数（JSON 数组）<input v-model="mastergoArgs" :disabled="busy || running" class="mt-1 w-full rounded border border-line bg-canvas p-2"></label></div>
            <button :disabled="busy || running" class="rounded border border-line px-3 py-2 disabled:opacity-40" @click="configure">保存连接配置</button>
          </div>
        </details>
        <details class="mt-4 text-muted">
          <summary class="cursor-pointer py-1">Reborn MCP 启动参数（高级）</summary>
          <div class="mt-3 space-y-3 text-xs">
            <p>内置模式自动设置资料路径，通过 stdio 通信，无需端口、Token 或模型参数。组件 Props 请通过组件查询获取。</p>
            <dl class="grid gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]"><dt class="font-mono">--kb-dir &lt;目录&gt;</dt><dd>知识库目录，包含 index.json、components/；环境变量 REBORN_KB_DIR</dd><dt class="font-mono">--spec-dir &lt;目录&gt;</dt><dd>打包后的写作规范目录；环境变量 REBORN_SPEC_DIR</dd></dl>
            <label class="block">自定义启动命令（留空使用内置 MCP）<input v-model="rebornCommand" :disabled="busy || running" class="mt-1 w-full rounded border border-line bg-canvas p-2"></label>
            <label v-if="rebornCommand.trim()" class="block">启动参数（JSON 数组）<input v-model="rebornArgs" :disabled="busy || running" class="mt-1 w-full rounded border border-line bg-canvas p-2"><span class="mt-1 block">例如：[&quot;D:/reborn/mcp.js&quot;, &quot;--kb-dir&quot;, &quot;D:/reborn/knowledge&quot;, &quot;--spec-dir&quot;, &quot;D:/reborn/spec&quot;]</span></label>
            <p>高级命令将在本机运行。修改后保存，再点击 Reborn UI 的连接。</p>
          </div>
        </details>
      </section>
      <details class="rounded-xl border border-line bg-panel p-5">
        <summary class="cursor-pointer text-base font-medium">组件选择与映射（高级）<span class="ml-3 text-xs text-muted">项目已有 → Reborn → 自定义</span></summary>
        <label class="block"><span class="sr-only">搜索组件</span><input v-model="keyword" placeholder="搜索 Reborn 组件，例如：按钮、表单、导航" class="w-full rounded-lg border border-line bg-canvas px-3 py-2 outline-none focus:border-accent"></label>
        <div class="mt-3 flex max-h-44 flex-wrap gap-2 overflow-y-auto"><button v-for="item in candidates" :key="item.id" :title="item.description" :disabled="busy || running" class="rounded-full border border-line px-3 py-1.5 text-xs hover:border-accent disabled:opacity-40" @click="addMapping(item.id)">{{ item.title }}</button><p v-if="!candidates.length" class="text-muted">没有匹配的 Web 组件</p></div>
        <details v-if="state?.project?.components.length" class="mt-4"><summary class="cursor-pointer text-muted">项目已有组件</summary><div class="mt-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto"><button v-for="item in state.project.components" :key="item" :disabled="busy || running" class="rounded border border-line px-2 py-1 text-xs hover:border-accent" @click="addMapping(item, 'project')">{{ item }}</button></div></details>
        <div class="mt-5 space-y-3"><div v-for="(row, index) in mappingRows" :key="index" class="grid gap-2 rounded-lg bg-canvas p-3 sm:grid-cols-[1fr_120px_1fr_1fr_auto]"><input v-model="row.node" :disabled="busy || running" :aria-label="'设计节点 ' + (index + 1)" placeholder="设计节点 / 组件名称" class="min-w-0 rounded border border-line bg-panel p-2"><select v-model="row.source" :disabled="busy || running" :aria-label="'组件来源 ' + (index + 1)" class="rounded border border-line bg-panel p-2"><option v-for="source in sourceOptions" :key="source" :value="source">{{ sourceLabels[source] }}</option></select><input v-model="row.component" :disabled="busy || running" :aria-label="'代码组件 ' + (index + 1)" placeholder="代码组件" class="min-w-0 rounded border border-line bg-panel p-2"><input v-model="row.variant" :disabled="busy || running" :aria-label="'变体 ' + (index + 1)" placeholder="变体 / 参数说明" class="min-w-0 rounded border border-line bg-panel p-2"><button :disabled="busy || running" class="px-2 text-muted hover:text-red-700" :aria-label="'移除映射 ' + (index + 1)" @click="mappingRows.splice(index, 1)">移除</button></div></div>
        <div class="mt-4 flex gap-3"><button :disabled="busy || running" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="addMapping('', 'custom')">添加映射</button><button :disabled="busy || running || !configured" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="perform(async () => { await saveWorkspace(); status = '组件映射已保存' })">保存映射</button></div>
      </details>
      <section aria-labelledby="code-title" class="rounded-xl border border-line bg-panel p-5">
        <div class="mb-5 flex items-baseline gap-3"><span class="text-xs text-accent">02</span><h2 id="code-title" class="text-base font-medium">实现与预览</h2></div>
        <div class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line p-3"><button :disabled="busy || running || !configured" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="generate('rules')">生成项目设计规则</button><p class="flex-1 text-xs text-muted">从现有代码归纳 docs/design-rules.md，并在 AGENTS.md 添加引用；保留已有规范，无需连接 MasterGo。</p></div>
        <p class="mb-4 text-xs text-muted">也可在工作区会话输入：@设计工作室 按当前项目规范实现选中的设计稿。请确认此处目录与会话工作区一致。</p>
        <label class="block"><span class="mb-2 block text-muted">先在 MasterGo 中选择页面，再填写本次需求</span><textarea v-model="request" :disabled="running" rows="4" placeholder="例如：按当前选区实现设置页，复用项目布局和 Reborn 表单组件，保留已有保存逻辑。" class="w-full resize-y rounded-lg border border-line bg-canvas p-3 outline-none focus:border-accent"></textarea></label>
        <div class="mt-3 flex flex-wrap items-center gap-3"><button :disabled="busy || running || !configured" class="rounded-lg border border-line px-3 py-2 disabled:opacity-40" @click="generate('read')">读取当前选区</button><button :disabled="busy || running || !configured || !request.trim()" class="rounded-lg bg-accent px-4 py-2 text-white hover:brightness-110 disabled:opacity-40" @click="generate('generate')">{{ running ? 'dsh 正在处理…' : '交给 dsh 实现' }}</button><button v-if="running" class="rounded-lg border border-line px-3 py-2" @click="stop">停止任务</button><details v-else class="text-muted"><summary class="cursor-pointer">更多</summary><button :disabled="busy || !request.trim()" class="mt-2 rounded border border-line p-2 disabled:opacity-40" @click="generate('sync')">请求将静态预览同步到当前画布</button></details></div>
        <p v-if="state?.workspace?.sessionId" class="mt-3 break-all text-xs text-muted">dsh 会话：{{ state.workspace.sessionId }} · 使用主程序配置的模型，可在主窗口切换模型和查看工具操作。</p>
        <pre v-if="output" aria-label="dsh 回复" class="mt-5 max-h-[28rem] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-canvas p-4 font-sans leading-7">{{ output }}</pre>
        <div class="mt-5 space-y-3 rounded-lg border border-line p-3"><label class="block text-muted">项目启动脚本<select v-model="script" :disabled="busy || running || previewActive" class="mt-2 w-full rounded border border-line bg-canvas p-2"><option v-for="entry in scripts" :key="entry[0]" :value="entry[0]">{{ entry[0] }} · {{ entry[1] }}</option></select></label><div class="flex flex-wrap items-center gap-3"><button :disabled="busy || running || !configured || !script || previewActive" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="startPreview">启动预览</button><button :disabled="busy || running || !previewActive" class="rounded-lg border border-line px-3 py-2 disabled:opacity-40" @click="stopPreview">停止服务</button><button class="text-muted underline" @click="showLogs = !showLogs">{{ showLogs ? '收起日志' : '查看日志' }}</button><span role="status" class="text-xs text-muted">{{ previewLabels[state?.preview?.state ?? 'idle'] }}</span></div><p v-if="state?.preview?.jobId" class="break-all text-xs text-muted">dsh 后台任务：{{ state.preview.jobId }} · {{ state.preview.command }}</p><pre v-if="showLogs" class="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-canvas p-3 text-xs">{{ state?.preview?.log || '暂无日志' }}</pre><p v-if="!scripts.length" class="text-xs text-muted">项目没有启动脚本，请先让 dsh 检查 package.json。</p></div>
        <div class="mt-6 flex flex-col gap-2 sm:flex-row sm:items-end"><label class="flex-1"><span class="mb-2 block text-muted">本机预览地址</span><input v-model="preview" placeholder="http://127.0.0.1:5173" :disabled="busy || running" class="w-full rounded-lg border border-line bg-canvas px-3 py-2"></label><button :disabled="busy || running || !configured" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="openPreview">保存并预览</button></div>
        <p class="mt-2 text-xs text-muted">启动后会从本项目日志确认真实地址，也可手动填写已运行的服务。停止按钮只处理本工作室创建的任务。预览在隔离框架中运行，登录等功能可能受限。</p>
        <iframe v-if="renderedPreview" :src="renderedPreview" title="项目隔离预览" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" class="mt-4 h-[32rem] w-full rounded-lg border border-line bg-white"></iframe>
      </section>
      <footer class="pb-4 text-xs text-muted">MasterGo Vibe MCP × Reborn UI · Vue Web 首版 · 配置与映射保存在本机，源码目录由您指定。</footer>
    </div>
  </main>
</template>
