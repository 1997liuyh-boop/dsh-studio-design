<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Snapshot } from './types.ts'
import { rpc } from './session.ts'
import { pickDirectory, workspaceContext } from './picker.ts'
import { mastergoForm, mastergoSpec } from './mastergo.ts'
import { builtInPrompts, designTaskRequest } from './prompt.ts'

const state = ref<Snapshot | null>(null), selected = ref<{ sessionId: string; root: string } | null>(null)
const busy = ref(false), settingsOpen = ref(false), error = ref(''), status = ref('')
const nodeLink = ref(''), promptsOpen = ref(false), promptId = ref('generate')
const prompts = builtInPrompts()
const selectedPrompt = computed(() => prompts.find(item => item.id === promptId.value) ?? prompts[0]!)
const rebornSource = ref('builtin'), rebornRoot = ref(''), repository = ref(''), sourceRef = ref('')
const mastergoService = ref<'vibe' | 'magic'>('vibe'), mastergoToken = ref('')
const mastergoMode = ref('visual'), mastergoAddress = ref(''), mastergoVersion = ref('')
const mastergoCommand = ref(''), mastergoArgs = ref('[]'), rebornCommand = ref(''), rebornArgs = ref('[]')
const script = ref(''), preview = ref(''), renderedPreview = ref(''), showLogs = ref(false)
const previewDirty = ref(false)
const scripts = computed(() => Object.entries(state.value?.project?.scripts ?? {}))
const configured = computed(() => !!selected.value && state.value?.context?.sessionId === selected.value.sessionId && !!state.value.project)
const previewActive = computed(() => ['starting', 'running', 'ready', 'stopping'].includes(state.value?.preview?.state ?? ''))
const previewLabels = { idle: '尚未启动', starting: '正在启动', running: '等待服务地址', ready: '预览已就绪', completed: '服务已退出', failed: '启动失败，请查看日志', killed: '服务已停止', stopping: '正在停止' }
const sourceLabel = computed(() => state.value?.source?.knowledge === 'builtin' ? '内置' : state.value?.source?.kind === 'github' ? 'GitHub' : state.value?.source?.kind === 'local' ? '本地' : '内置')
const lifetime = new AbortController()
let mounted = false, polling = false, initialized = false, timer: ReturnType<typeof setInterval> | undefined
let refreshedAt = 0

async function api(input: object = { action: 'snapshot' }, sessionId = selected.value?.sessionId): Promise<Snapshot> {
  const response = await fetch('/studio-projects/design/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, sessionId }), signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(120_000)]) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? '工作室请求失败，请重试')
  return value
}
function receive(value: Snapshot, settings = false) {
  if (!mounted || (value.context?.sessionId ?? '') !== (selected.value?.sessionId ?? '')) return
  state.value = value
  if (settings || !initialized) {
    const config = value.settings, form = mastergoForm(config.mastergo)
    rebornSource.value = config.rebornSource ?? 'builtin'; rebornRoot.value = config.rebornRoot
    repository.value = config.rebornRepository ?? ''; sourceRef.value = config.rebornRef ?? 'main'
    mastergoService.value = form.service; mastergoToken.value = ''; mastergoMode.value = form.mode; mastergoAddress.value = form.address; mastergoVersion.value = form.version
    mastergoCommand.value = config.mastergo.command; mastergoArgs.value = JSON.stringify(config.mastergo.args)
    rebornCommand.value = config.reborn.command; rebornArgs.value = JSON.stringify(config.reborn.args)
    initialized = true
  }
  const available = Object.keys(value.project?.scripts ?? {})
  if (!available.includes(script.value)) script.value = available.includes('dev') ? 'dev' : available.includes('preview') ? 'preview' : available[0] ?? ''
  if (value.preview?.state === 'ready' && value.preview.url) renderedPreview.value = value.preview.url
  if (!previewDirty.value) preview.value = value.workspace?.previewUrl || value.preview?.url || ''
}
async function refresh(force = true) {
  const context = await workspaceContext(lifetime.signal)
  if (!mounted) return
  if (context?.sessionId !== selected.value?.sessionId || context?.root !== selected.value?.root) {
    selected.value = context; state.value = null; renderedPreview.value = ''; preview.value = ''; nodeLink.value = ''; previewDirty.value = false; error.value = ''; status.value = ''
    refreshedAt = 0
  }
  if (!force && !previewActive.value && Date.now() - refreshedAt < 10_000) return
  receive(await api())
  refreshedAt = Date.now()
}
async function perform(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; status.value = ''
  const owner = selected.value?.sessionId
  try { await action() }
  catch (cause) { if (mounted && owner === selected.value?.sessionId) error.value = cause instanceof Error ? cause.message : '操作未完成，请重试' }
  finally { busy.value = false }
}
async function saveSettings() {
  if (!state.value) return
  const next = { ...state.value.settings, rebornSource: rebornSource.value, rebornRoot: rebornRoot.value, rebornRepository: repository.value, rebornRef: sourceRef.value,
    mastergo: mastergoMode.value === 'visual' ? mastergoSpec(mastergoAddress.value, mastergoVersion.value, mastergoService.value) : { command: mastergoCommand.value, args: JSON.parse(mastergoArgs.value) },
    mastergoToken: mastergoToken.value, reborn: { command: rebornCommand.value, args: JSON.parse(rebornArgs.value) } }
  receive(await api({ action: 'configure', settings: next }), true)
  if (next.rebornSource === 'github') receive(await api({ action: 'sync-source' }), true)
  status.value = '设置已保存'
}
function changeMastergo() { mastergoAddress.value = mastergoService.value === 'magic' ? 'https://mastergo.com' : 'http://127.0.0.1:30678'; mastergoVersion.value = 'latest' }
function diagnoseMastergo() { void perform(async () => { await saveSettings(); receive(await api({ action: 'diagnose' })); status.value = '连接检测完成，请查看画布状态' }) }
function publishedKnowledge() { repository.value = 'https://github.com/1997liuyh-boop/dsh-studio-design'; sourceRef.value = 'knowledge'; rebornSource.value = 'github' }
function updateKnowledge() { void perform(async () => { receive(await api(state.value?.source?.kind === 'github' ? { action: 'sync-source' } : { action: 'connect', target: 'reborn' }), true); status.value = '组件资料已就绪' }) }
function chooseKnowledge() { void perform(async () => { const path = await pickDirectory(); if (path) rebornRoot.value = path }) }
function submitTask(kind: 'rules' | 'read' | 'generate' | 'optimize') {
  void perform(async () => {
    const origin = await workspaceContext(lifetime.signal)
    if (!origin || origin.sessionId !== selected.value?.sessionId) { await refresh(); throw new Error('工作区已切换，请确认当前项目后重试') }
    const request = designTaskRequest(kind, kind === 'rules' ? '' : nodeLink.value)
    try { await rpc('session/prompt', { sessionId: origin.sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '@工作室:design ' + request }] }, lifetime.signal) }
    catch (cause) { throw new Error('任务提交结果未确认，请先查看当前 dsh 会话，避免重复发送', { cause }) }
    if (origin.sessionId === selected.value?.sessionId) status.value = '已发送到当前 dsh 会话，可在聊天中继续补充需求并查看进度'
  })
}
function copyPrompt() { void perform(async () => { await navigator.clipboard.writeText(selectedPrompt.value.content); status.value = '内置提示词已复制' }) }
function previewAction(action: 'preview-start' | 'preview-stop') { void perform(async () => { receive(await api({ action, script: script.value })); showLogs.value = true }) }
function openPreview() { void perform(async () => { if (!state.value?.workspace) throw new Error('请先打开项目会话'); receive(await api({ action: 'save-workspace', workspace: { ...state.value.workspace, previewUrl: preview.value } })); previewDirty.value = false; renderedPreview.value = state.value?.workspace?.previewUrl ?? '' }) }
onMounted(() => {
  mounted = true
  void perform(refresh)
  timer = setInterval(async () => {
    if (polling || busy.value) return
    polling = true
    try { await refresh(false) } catch (cause) { if (mounted) error.value = cause instanceof Error ? cause.message : '工作区暂不可用，请刷新' }
    finally { polling = false }
  }, 2000)
})
onUnmounted(() => { mounted = false; clearInterval(timer); lifetime.abort() })
</script>

<template>
  <main class="min-h-screen bg-canvas px-4 py-6 font-sans text-sm text-ink sm:px-8">
    <div class="mx-auto max-w-4xl space-y-5">
      <header class="flex items-start justify-between gap-4 border-b border-line pb-5">
        <div><h1 class="text-2xl font-medium tracking-tight">设计工作室</h1><p class="mt-2 text-muted">在项目会话中 @设计工作室，即可开始设计与开发。</p></div>
        <div class="flex shrink-0 flex-wrap justify-end gap-2"><button class="rounded-lg border border-line bg-panel px-3 py-2 hover:border-accent" :aria-expanded="promptsOpen" aria-controls="built-in-prompts" @click="promptsOpen = !promptsOpen">内置提示词</button><button class="rounded-lg border border-line bg-panel px-3 py-2 hover:border-accent" :aria-expanded="settingsOpen" @click="settingsOpen = !settingsOpen">{{ settingsOpen ? '收起设置' : '设置' }}</button></div>
      </header>
      <p v-if="busy" role="status" class="text-accent">正在处理…</p>
      <p v-if="error" role="alert" class="rounded-lg border border-line bg-panel p-3">{{ error }}</p>
      <p v-if="status" role="status" class="text-muted">{{ status }}</p>
      <section aria-labelledby="workspace-title" class="rounded-xl border border-line bg-panel p-5">
        <p id="workspace-title" class="mb-2 text-xs text-muted">当前工作区</p>
        <template v-if="selected"><h2 class="text-base font-medium">{{ state?.project?.name || selected.root.split(/[\\/]/).pop() }}</h2><p class="mt-1 break-all text-xs text-muted">{{ state?.context?.root || selected.root }}</p><p v-if="state?.projectError" class="mt-3 text-muted">{{ state.projectError }}</p><p class="mt-3 text-xs text-muted">跟随当前 dsh 会话。切换工作区后自动更新，已提交任务仍在原会话执行。</p></template>
        <p v-else class="text-muted">先在左侧工作区打开项目会话，再 @设计工作室。</p>
        <label class="mt-5 block text-xs text-muted">MasterGo 节点链接<input v-model="nodeLink" :disabled="busy" placeholder="留空使用 MasterGo 当前选区" class="mt-2 w-full min-w-0 rounded-lg border border-line bg-canvas p-3 text-sm text-ink"></label>
        <div class="mt-4 flex flex-wrap gap-3"><button :disabled="busy || !configured" class="rounded-lg bg-accent px-4 py-2 text-white hover:brightness-110 disabled:opacity-40" @click="submitTask('generate')">实现设计稿</button><button :disabled="busy || !configured" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="submitTask('optimize')">优化对应节点</button><button :disabled="busy || !configured" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="submitTask('read')">查看节点</button><button :disabled="busy || !configured" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="submitTask('rules')">生成设计规则</button></div>
        <p class="mt-4 text-xs text-muted">自定义需求直接在聊天中输入，例如：@设计工作室 按当前项目规范实现设置页。</p>
      </section>
      <section v-if="promptsOpen" id="built-in-prompts" class="min-w-0 space-y-4 rounded-xl border border-line bg-panel p-5" aria-label="内置提示词">
        <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-base font-medium">内置提示词</h2><button :disabled="busy" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="copyPrompt">复制提示词</button></div>
        <p class="text-xs leading-5 text-muted">这里展示工作室实际使用的模板。任务执行时会填入当前项目、设计节点和模型能力；本页只读。</p>
        <label class="block text-xs text-muted">任务类型<select v-model="promptId" class="mt-2 w-full rounded-lg border border-line bg-canvas p-2 text-sm text-ink"><option v-for="item in prompts" :key="item.id" :value="item.id">{{ item.title }}</option></select></label>
        <pre tabindex="0" aria-label="提示词内容" class="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-canvas p-4 font-mono text-xs leading-6">{{ selectedPrompt.content }}</pre>
      </section>
      <section class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-5 py-4" aria-label="组件与设计稿">
        <div class="space-y-1"><p>Reborn UI <span class="ml-2 text-xs text-muted">{{ sourceLabel }} · {{ state?.components.length ?? 0 }} 个组件</span></p><p class="text-xs text-muted">{{ state?.connections.reborn.state === 'connected' ? '组件资料已就绪' : state?.connections.reborn.message || '正在读取组件资料' }} · MCP {{ state?.connections.mastergo.state === 'connected' ? '工具已连接' : '任务开始时连接' }}</p></div>
        <p class="basis-full text-xs text-muted">{{ state?.mastergoCanvas?.message }}</p><button :disabled="busy" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="updateKnowledge">更新资料</button>
      </section>
      <section v-if="settingsOpen" class="space-y-5 rounded-xl border border-line bg-panel p-5" aria-label="设计工作室设置">
        <h2 class="text-base font-medium">设置</h2>
        <div class="space-y-3"><h3 class="font-medium">MasterGo</h3>
          <label class="block">读取方式<select v-model="mastergoService" :disabled="busy || mastergoMode === 'custom'" @change="changeMastergo" class="ml-3 rounded-lg border border-line bg-panel px-3 py-2"><option value="vibe">Vibe MCP · 本机画布</option><option value="magic">Magic MCP · 远程团队文件</option></select></label>
          <p class="text-xs text-muted">{{ mastergoService === 'vibe' ? '在 MasterGo 桌面端打开目标文件，并开启文件内 MCP；无需令牌。' : '从个人设置 → 安全设置获取访问令牌；需要有权限的团队文件。' }}</p>
          <label class="block">服务地址<input v-model="mastergoAddress" aria-label="MasterGo 服务地址" :disabled="busy || mastergoMode === 'custom'" class="mt-2 w-full rounded-lg border border-line bg-canvas px-3 py-2"></label>
          <label v-if="mastergoService === 'magic'" class="block">个人访问令牌<input v-model="mastergoToken" type="password" autocomplete="off" :placeholder="state?.mastergoTokenSet ? '已保存，留空保留原令牌' : '填写 MG_MCP_TOKEN'" :disabled="busy" class="mt-2 w-full rounded-lg border border-line bg-canvas px-3 py-2"><span class="mt-2 block text-xs text-muted">仅保存在本机，不进入会话或命令参数。</span></label>
          <p class="text-xs text-muted">{{ state?.mastergoCanvas?.message }}<span v-if="state?.mastergoCanvas?.documentId"> · 文件 {{ state.mastergoCanvas.documentId }}</span></p>
          <button :disabled="busy || !configured" class="rounded-lg border border-line px-3 py-2 disabled:opacity-40" @click="diagnoseMastergo">保存并检测连接</button>
        </div>
        <div class="space-y-3 border-t border-line pt-5"><h3 class="font-medium">Reborn 组件知识库</h3><label class="block">来源<select v-model="rebornSource" :disabled="busy" class="ml-3 rounded-lg border border-line bg-panel px-3 py-2"><option value="builtin">内置</option><option value="github">GitHub</option><option value="local">本地</option></select></label>
          <div v-if="rebornSource === 'github'" class="space-y-3"><button :disabled="busy" class="text-accent underline" @click="publishedKnowledge">使用最新完整知识库</button><label class="block">仓库链接<input v-model="repository" :disabled="busy" class="mt-2 w-full rounded-lg border border-line bg-canvas p-2"></label><label class="block">分支或版本<input v-model="sourceRef" :disabled="busy" class="mt-2 w-full rounded-lg border border-line bg-canvas p-2"></label><p class="text-xs text-muted">从 GitHub 获取组件资料，保存后更新。</p></div>
          <div v-if="rebornSource === 'local'" class="flex flex-wrap gap-2"><input v-model="rebornRoot" aria-label="本地知识库目录" :disabled="busy" placeholder="知识库文件夹" class="min-w-0 flex-1 rounded-lg border border-line bg-canvas p-2"><button :disabled="busy" class="rounded-lg border border-line px-3 py-2" @click="chooseKnowledge">选择文件夹</button></div>
          <details class="text-xs text-muted"><summary class="cursor-pointer">版本详情</summary><dl class="mt-3 space-y-2 break-all"><dt>资料来源</dt><dd>{{ state?.source?.repository || '插件内置' }}</dd><dt>缓存版本</dt><dd>{{ state?.source?.commit || '随插件发布' }}</dd><dt>Reborn 源码版本</dt><dd>{{ state?.source?.contentCommit || '随插件发布' }}</dd></dl></details>
        </div>
        <details class="border-t border-line pt-4 text-muted"><summary class="cursor-pointer">高级设置</summary><div class="mt-4 space-y-3"><label class="block">MasterGo 连接方式<select v-model="mastergoMode" :disabled="busy" class="ml-3 rounded border border-line bg-panel p-2"><option value="visual">可视化配置</option><option value="custom">自定义命令</option></select></label><label v-if="mastergoMode === 'visual'" class="block">适配器版本<input v-model="mastergoVersion" :disabled="busy" class="mt-2 w-full rounded border border-line bg-canvas p-2"></label><template v-else><label class="block">MasterGo 命令<input v-model="mastergoCommand" :disabled="busy" class="mt-2 w-full rounded border border-line bg-canvas p-2"></label><label class="block">MasterGo 参数（JSON 数组）<input v-model="mastergoArgs" :disabled="busy" class="mt-2 w-full rounded border border-line bg-canvas p-2"></label></template><label class="block">Reborn 命令（留空使用内置服务）<input v-model="rebornCommand" :disabled="busy" class="mt-2 w-full rounded border border-line bg-canvas p-2"></label><label v-if="rebornCommand.trim()" class="block">Reborn 参数（JSON 数组）<input v-model="rebornArgs" :disabled="busy" class="mt-2 w-full rounded border border-line bg-canvas p-2"></label><p class="text-xs">--kb-dir 指定 knowledge 目录，--spec-dir 指定规范目录。内置服务自动设置，无需 Token 或端口。</p></div></details>
        <button :disabled="busy" class="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-40" @click="perform(saveSettings)">{{ rebornSource === 'github' ? '保存并更新' : '保存设置' }}</button>
      </section>
      <details class="rounded-xl border border-line bg-panel p-5">
        <summary class="cursor-pointer font-medium">项目预览<span class="ml-3 text-xs font-normal text-muted">{{ previewLabels[state?.preview?.state ?? 'idle'] }}</span></summary>
        <div class="mt-4 space-y-4"><div class="flex flex-wrap gap-3"><label class="min-w-0 flex-1"><span class="sr-only">项目启动脚本</span><select v-model="script" :disabled="busy || previewActive" class="w-full rounded-lg border border-line bg-canvas p-2"><option v-for="entry in scripts" :key="entry[0]" :value="entry[0]">{{ entry[0] }} · {{ entry[1] }}</option></select></label><button :disabled="busy || !configured || !script || previewActive" class="rounded-lg border border-line px-3 py-2 disabled:opacity-40" @click="previewAction('preview-start')">启动预览</button><button :disabled="busy || !previewActive" class="rounded-lg border border-line px-3 py-2 disabled:opacity-40" @click="previewAction('preview-stop')">停止服务</button></div><div class="flex flex-wrap gap-3"><input v-model="preview" aria-label="本机预览地址" :disabled="busy" @input="previewDirty = true" placeholder="http://127.0.0.1:5173" class="min-w-0 flex-1 rounded-lg border border-line bg-canvas p-2"><button :disabled="busy || !configured" class="rounded-lg border border-line px-3 py-2 disabled:opacity-40" @click="openPreview">打开预览</button></div><button class="text-xs text-muted underline" @click="showLogs = !showLogs">{{ showLogs ? '收起日志' : '查看日志' }}</button><pre v-if="showLogs" class="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-canvas p-3 text-xs">{{ state?.preview?.log || '暂无日志' }}</pre><iframe v-if="renderedPreview" :src="renderedPreview" title="项目隔离预览" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" class="h-[32rem] w-full rounded-lg border border-line bg-white"></iframe></div>
      </details>
    </div>
  </main>
</template>
