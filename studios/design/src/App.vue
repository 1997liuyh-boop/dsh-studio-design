<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { DshSelectOption, SetupTarget, SetupTest, Snapshot } from './types.ts'
import { rpc } from './session.ts'
import { pickDirectory, workspaceContext } from './picker.ts'
import { mastergoAdapter, mastergoForm, mastergoSpec } from './mastergo.ts'
import { builtInPrompts, designTaskRequest, designTasks } from './prompt.ts'
import DshSelect from './DshSelect.vue'

/** GitHub 来源的默认地址：设计工作室每次发布都会把完整知识库同步到这个仓库的 knowledge 分支。 */
const PUBLISHED_REPOSITORY = 'https://github.com/1997liuyh-boop/dsh-studio-design'
const PUBLISHED_REF = 'knowledge'
const MAGIC_DOC = 'https://mastergo.com/help/ai-features/magic-mcp.html'

const state = ref<Snapshot | null>(null), selected = ref<{ sessionId: string; root: string } | null>(null)
const busy = ref(false), settingsOpen = ref(true), error = ref(''), status = ref('')
const testing = ref<SetupTarget | ''>('')
const nodeLink = ref(''), promptsOpen = ref(false), promptId = ref('generate')
const prompts = builtInPrompts()
const tasks = designTasks()
const selectedPrompt = computed(() => prompts.find(item => item.id === promptId.value) ?? prompts[0]!)
const promptOptions = computed<DshSelectOption[]>(() => prompts.map(item => ({ value: item.id, label: item.title })))
const rebornSource = ref('builtin'), rebornRoot = ref(''), repository = ref(''), sourceRef = ref('')
/** 读取方式：Vibe（本机画布）、Magic（远程团队文件）或自定义命令。 */
const readMethod = ref<'vibe' | 'magic' | 'custom'>('vibe'), mastergoToken = ref('')
const mastergoAddress = ref(''), mastergoVersion = ref('')
const mastergoCommand = ref(''), mastergoArgs = ref('[]'), rebornCommand = ref(''), rebornArgs = ref('[]')
const script = ref(''), preview = ref(''), renderedPreview = ref(''), showLogs = ref(false)
const previewDirty = ref(false)
const scripts = computed(() => Object.entries(state.value?.project?.scripts ?? {}))
const scriptOptions = computed<DshSelectOption[]>(() => scripts.value.map(([name, command]) => ({ value: name, label: name, description: command })))
const configured = computed(() => !!selected.value && state.value?.context?.sessionId === selected.value.sessionId && !!state.value.project)
const previewActive = computed(() => ['starting', 'running', 'ready', 'stopping'].includes(state.value?.preview?.state ?? ''))
const previewLabels = { idle: '尚未启动', starting: '正在启动', running: '等待服务地址', ready: '预览已就绪', completed: '服务已退出', failed: '启动失败，请查看日志', killed: '服务已停止', stopping: '正在停止' }

const readOptions: DshSelectOption[] = [
  { value: 'vibe', label: 'Vibe MCP · 本机画布', description: '在 MasterGo 桌面端打开文件并开启文件内 MCP，无需令牌' },
  { value: 'magic', label: 'Magic MCP · 远程团队文件', description: '用个人访问令牌读取团队文件，需团队版及以上席位' },
  { value: 'custom', label: '自定义命令', description: '自己填写适配器的启动命令与参数' },
]
const sourceOptions: DshSelectOption[] = [
  { value: 'builtin', label: '内置 · 随插件发布', description: '离线可用，版本跟随当前安装的设计工作室' },
  { value: 'github', label: 'GitHub · 最新发布', description: '获取设计工作室最新发布的完整知识库，不用重装插件' },
  { value: 'local', label: '本地目录', description: '选择本机已生成的 Reborn 知识库' },
]
/** 自定义命令被识别成哪个官方适配器（直接用 node 启动 vibe-mcp 等写法）。 */
const detected = computed(() => {
  if (readMethod.value !== 'custom') return null
  try { return mastergoAdapter({ command: mastergoCommand.value, args: JSON.parse(mastergoArgs.value) }) } catch { return null }
})
const tests = computed(() => state.value?.tests ?? {})
/** 流程图上的四个节点：前三个是配置步骤，最后一个是发起任务。 */
const steps = computed(() => [
  { id: 'mastergo' as const, title: '设计稿读取', summary: readOptions.find(item => item.value === readMethod.value)?.label ?? '' },
  { id: 'reborn' as const, title: '组件知识库', summary: sourceOptions.find(item => item.value === rebornSource.value)?.label ?? '' },
  { id: 'project' as const, title: '项目工作区', summary: state.value?.project?.name || selected.value?.root.split(/[\\/]/).pop() || '未打开项目会话' },
])
function badge(test: SetupTest | undefined, target: SetupTarget) {
  if (testing.value === target) return { tone: 'running', text: '测试中' }
  if (!test) return { tone: 'idle', text: '未测试' }
  return test.ok ? { tone: 'ok', text: '成功' } : { tone: 'fail', text: '失败' }
}
const allPassed = computed(() => steps.value.every(step => tests.value[step.id]?.ok))
const lifetime = new AbortController()
let mounted = false, polling = false, initialized = false, timer: ReturnType<typeof setInterval> | undefined
let refreshedAt = 0

async function api(input: object = { action: 'snapshot' }, sessionId = selected.value?.sessionId): Promise<Snapshot> {
  const response = await fetch('/studio-projects/design/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, sessionId }), signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(180_000)]) })
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
    if (rebornSource.value === 'github') usePublishedWhenUnbuilt()
    readMethod.value = form.mode === 'custom' ? 'custom' : form.service; mastergoToken.value = ''; mastergoAddress.value = form.address; mastergoVersion.value = form.version
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
/** Reborn-UI 源码仓库没有生成后的知识库，GitHub 来源默认改成设计工作室发布的 knowledge 分支。 */
function usePublishedWhenUnbuilt() {
  if (!repository.value.trim() || /\/Reborn-UI\/?$/i.test(repository.value.trim())) { repository.value = PUBLISHED_REPOSITORY; sourceRef.value = PUBLISHED_REF }
}
function changeSource(value: string) { if (value === 'github') usePublishedWhenUnbuilt() }
function changeReadMethod(value: string) {
  if (value === 'custom') {
    // 从当前表单生成一份可编辑的命令，便于在官方写法上改动。
    try { const spec = mastergoSpec(mastergoAddress.value || 'http://127.0.0.1:30678', mastergoVersion.value || 'latest', 'vibe'); if (!mastergoCommand.value || mastergoCommand.value === 'npx') { mastergoCommand.value = spec.command; mastergoArgs.value = JSON.stringify(spec.args) } } catch { /* 地址无效时保留原命令 */ }
    return
  }
  mastergoAddress.value = value === 'magic' ? 'https://mastergo.com' : 'http://127.0.0.1:30678'
  mastergoVersion.value = 'latest'
}
function parseArgs(raw: string, label: string): string[] {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error(label + '需要 JSON 数组，例如 ["-y", "@mastergo/vibe-mcp@latest"]') }
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(label + '需要字符串数组')
  return value
}
async function saveSettings() {
  if (!state.value) return
  const mastergo = readMethod.value === 'custom' ? { command: mastergoCommand.value.trim(), args: parseArgs(mastergoArgs.value, 'MasterGo 参数') } : mastergoSpec(mastergoAddress.value, mastergoVersion.value || 'latest', readMethod.value)
  const next = { ...state.value.settings, rebornSource: rebornSource.value, rebornRoot: rebornRoot.value, rebornRepository: repository.value, rebornRef: sourceRef.value,
    mastergo, mastergoToken: mastergoToken.value, reborn: { command: rebornCommand.value, args: parseArgs(rebornArgs.value, 'Reborn 参数') } }
  receive(await api({ action: 'configure', settings: next }), true)
  mastergoToken.value = ''
}
/** 保存当前表单后测试某一步，结果显示在该步骤卡片与流程图节点上。 */
function testStep(target: SetupTarget) {
  void perform(async () => {
    testing.value = target
    try {
      if (target !== 'project') await saveSettings()
      receive(await api({ action: 'test', target }), true)
      const result = state.value?.tests?.[target]
      status.value = result ? (result.ok ? '测试通过：' : '测试失败：') + result.message : ''
    } finally { testing.value = '' }
  })
}
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
function focusStep(id: string) { if (!settingsOpen.value && id !== 'task') settingsOpen.value = true; requestAnimationFrame(() => document.getElementById('step-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }
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
        <div><h1 class="text-2xl font-medium tracking-tight">设计工作室</h1><p class="mt-2 text-muted">按流程配置一次，之后在项目会话里输入 <code class="rounded bg-panel px-1">@设计工作室:实现设计稿 链接或需求</code> 即可开始。</p></div>
        <div class="flex shrink-0 flex-wrap justify-end gap-2"><button class="rounded-lg border border-line bg-panel px-3 py-2 hover:border-accent" :aria-expanded="promptsOpen" aria-controls="built-in-prompts" @click="promptsOpen = !promptsOpen">内置提示词</button><button class="rounded-lg border border-line bg-panel px-3 py-2 hover:border-accent" :aria-expanded="settingsOpen" aria-controls="setup-steps" @click="settingsOpen = !settingsOpen">{{ settingsOpen ? '收起配置' : '展开配置' }}</button></div>
      </header>
      <p v-if="busy" role="status" class="text-accent">{{ testing ? '正在测试连接…' : '正在处理…' }}</p>
      <p v-if="error" role="alert" class="rounded-lg border border-[#f3c4c4] bg-[#fff5f5] p-3 text-[#b42318]">{{ error }}</p>
      <p v-if="status" role="status" class="text-muted">{{ status }}</p>

      <!-- 流程图总览：三个配置步骤 → 发起任务，节点上显示最近一次测试结果，点击跳到对应步骤 -->
      <nav aria-label="配置流程" class="rounded-xl border border-line bg-panel p-4">
        <ol class="flex flex-wrap items-stretch gap-2">
          <template v-for="(step, index) in steps" :key="step.id">
            <li class="min-w-[150px] flex-1">
              <button type="button" class="flow-node" :data-tone="badge(tests[step.id], step.id).tone" @click="focusStep(step.id)">
                <span class="flow-index">{{ index + 1 }}</span>
                <span class="min-w-0 flex-1 text-left"><span class="block font-medium">{{ step.title }}</span><span class="block truncate text-xs text-muted">{{ step.summary }}</span></span>
                <span class="flow-badge" :data-tone="badge(tests[step.id], step.id).tone">{{ badge(tests[step.id], step.id).text }}</span>
              </button>
            </li>
            <li aria-hidden="true" class="flow-arrow">→</li>
          </template>
          <li class="min-w-[150px] flex-1">
            <button type="button" class="flow-node" :data-tone="allPassed ? 'ok' : 'idle'" @click="focusStep('task')">
              <span class="flow-index">4</span>
              <span class="min-w-0 flex-1 text-left"><span class="block font-medium">发起任务</span><span class="block truncate text-xs text-muted">{{ allPassed ? '可以开始' : '前三步测试通过后开始' }}</span></span>
            </button>
          </li>
        </ol>
      </nav>

      <section v-if="settingsOpen" id="setup-steps" aria-label="配置步骤" class="flow-steps">
        <!-- 第 1 步：设计稿读取 -->
        <article id="step-mastergo" class="flow-step" :data-tone="badge(tests.mastergo, 'mastergo').tone">
          <span class="flow-index flow-step-index">1</span>
          <div class="flow-card">
            <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-base font-medium">设计稿读取 · MasterGo</h2><span class="flow-badge" :data-tone="badge(tests.mastergo, 'mastergo').tone">{{ badge(tests.mastergo, 'mastergo').text }}</span></div>
            <div class="mt-4 space-y-3">
              <div class="flex flex-wrap items-center gap-3"><span id="read-method-label" class="w-20 shrink-0 text-muted">读取方式</span><DshSelect v-model="readMethod" :options="readOptions" :disabled="busy" aria-label="读取方式" @change="changeReadMethod" /></div>
              <template v-if="readMethod === 'vibe'">
                <p class="text-xs text-muted">在 MasterGo 桌面端打开目标文件，并在文件内开启 MCP；无需令牌。</p>
                <label class="block">服务地址<input v-model="mastergoAddress" :disabled="busy" class="field" placeholder="http://127.0.0.1:30678"></label>
                <label class="block">适配器版本<input v-model="mastergoVersion" :disabled="busy" class="field" placeholder="latest"></label>
              </template>
              <template v-else-if="readMethod === 'magic'">
                <p class="text-xs leading-5 text-muted">读取有权限的团队文件，不需要打开桌面端。需要 MasterGo 团队版及以上的编辑或研发席位。<a :href="MAGIC_DOC" target="_blank" rel="noreferrer" class="text-accent underline">Magic MCP 说明</a></p>
                <label class="block">服务地址<input v-model="mastergoAddress" :disabled="busy" class="field" placeholder="https://mastergo.com"></label>
                <label class="block">个人访问令牌<input v-model="mastergoToken" type="password" autocomplete="off" :placeholder="state?.mastergoTokenSet ? '已保存，留空保留原令牌' : '粘贴个人访问令牌'" :disabled="busy" class="field">
                  <span class="mt-2 block text-xs leading-5 text-muted">获取：登录 mastergo.com → 个人设置 → 安全设置 → 个人访问令牌 → 生成令牌。令牌只保存在本机，以环境变量传给适配器，不进入会话或命令参数。</span></label>
              </template>
              <template v-else>
                <p class="text-xs text-muted">{{ detected ? '已识别为 ' + (detected.service === 'vibe' ? 'Vibe 本机适配器' : 'Magic 远程适配器') + '（' + detected.address + '），画布探测与预读照常可用。' : '自定义命令不做画布探测，测试时会在当前项目会话里启动它并核对读取工具。' }}</p>
                <label class="block">命令<input v-model="mastergoCommand" :disabled="busy" class="field" placeholder="npx"></label>
                <label class="block">参数（JSON 数组）<input v-model="mastergoArgs" :disabled="busy" class="field"></label>
                <label v-if="detected?.service === 'magic'" class="block">个人访问令牌<input v-model="mastergoToken" type="password" autocomplete="off" :placeholder="state?.mastergoTokenSet ? '已保存，留空保留原令牌' : '粘贴个人访问令牌'" :disabled="busy" class="field"></label>
              </template>
              <div class="flex flex-wrap items-center gap-3"><button :disabled="busy" class="rounded-lg bg-accent px-4 py-2 text-white hover:brightness-110 disabled:opacity-40" @click="testStep('mastergo')">保存并测试连接</button><span v-if="state?.mastergoCanvas?.message && readMethod !== 'magic'" class="text-xs text-muted">{{ state.mastergoCanvas.message }}<template v-if="state.mastergoCanvas.documentId"> · 文件 {{ state.mastergoCanvas.documentId }}</template></span></div>
              <p v-if="tests.mastergo" class="flow-result" :data-tone="tests.mastergo.ok ? 'ok' : 'fail'">{{ tests.mastergo.ok ? '✓' : '✕' }} {{ tests.mastergo.message }}</p>
            </div>
          </div>
        </article>

        <!-- 第 2 步：组件知识库 -->
        <article id="step-reborn" class="flow-step" :data-tone="badge(tests.reborn, 'reborn').tone">
          <span class="flow-index flow-step-index">2</span>
          <div class="flow-card">
            <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-base font-medium">组件知识库 · Reborn UI</h2><span class="flow-badge" :data-tone="badge(tests.reborn, 'reborn').tone">{{ badge(tests.reborn, 'reborn').text }}</span></div>
            <div class="mt-4 space-y-3">
              <div class="flex flex-wrap items-center gap-3"><span class="w-20 shrink-0 text-muted">来源</span><DshSelect v-model="rebornSource" :options="sourceOptions" :disabled="busy" aria-label="知识库来源" @change="changeSource" /></div>
              <p class="text-xs text-muted">当前 {{ state?.components.length ?? 0 }} 个组件 · {{ state?.connections.reborn.state === 'connected' ? 'Reborn MCP 已连接' : state?.connections.reborn.message || '正在读取组件资料' }}</p>
              <div v-if="rebornSource === 'github'" class="space-y-3">
                <p class="text-xs leading-5 text-muted">默认从设计工作室仓库的 knowledge 分支获取：每次发布都会把最新的 Reborn 知识库同步过去，测试时自动拉取并固定版本。Reborn-UI 源码仓库本身不含生成后的知识库，不能直接使用。</p>
                <label class="block">仓库链接<input v-model="repository" :disabled="busy" class="field"></label>
                <label class="block">分支或版本<input v-model="sourceRef" :disabled="busy" class="field"></label>
                <button type="button" :disabled="busy" class="text-xs text-accent underline" @click="repository = PUBLISHED_REPOSITORY; sourceRef = PUBLISHED_REF">恢复默认地址</button>
              </div>
              <div v-if="rebornSource === 'local'" class="flex flex-wrap gap-2"><input v-model="rebornRoot" aria-label="本地知识库目录" :disabled="busy" placeholder="知识库文件夹" class="field mt-0 min-w-0 flex-1"><button :disabled="busy" class="rounded-lg border border-line px-3 py-2" @click="chooseKnowledge">选择文件夹</button></div>
              <details class="text-xs text-muted"><summary class="cursor-pointer">版本与高级设置</summary>
                <dl class="mt-3 space-y-2 break-all"><dt>资料来源</dt><dd>{{ state?.source?.repository || '插件内置' }}</dd><dt>缓存版本</dt><dd>{{ state?.source?.commit || '随插件发布' }}</dd><dt>Reborn 源码版本</dt><dd>{{ state?.source?.contentCommit || '随插件发布' }}</dd></dl>
                <label class="mt-3 block">Reborn 命令（留空使用内置服务）<input v-model="rebornCommand" :disabled="busy" class="field"></label>
                <label v-if="rebornCommand.trim()" class="block">Reborn 参数（JSON 数组）<input v-model="rebornArgs" :disabled="busy" class="field"></label>
                <p class="mt-2">--kb-dir 指定 knowledge 目录，--spec-dir 指定规范目录。内置服务自动设置，无需 Token 或端口。</p>
              </details>
              <button :disabled="busy" class="rounded-lg bg-accent px-4 py-2 text-white hover:brightness-110 disabled:opacity-40" @click="testStep('reborn')">{{ rebornSource === 'github' ? '保存、拉取并测试' : '保存并测试连接' }}</button>
              <p v-if="tests.reborn" class="flow-result" :data-tone="tests.reborn.ok ? 'ok' : 'fail'">{{ tests.reborn.ok ? '✓' : '✕' }} {{ tests.reborn.message }}</p>
            </div>
          </div>
        </article>

        <!-- 第 3 步：项目工作区 -->
        <article id="step-project" class="flow-step" :data-tone="badge(tests.project, 'project').tone">
          <span class="flow-index flow-step-index">3</span>
          <div class="flow-card">
            <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-base font-medium">项目工作区</h2><span class="flow-badge" :data-tone="badge(tests.project, 'project').tone">{{ badge(tests.project, 'project').text }}</span></div>
            <div class="mt-4 space-y-3">
              <template v-if="selected"><p class="font-medium">{{ state?.project?.name || selected.root.split(/[\\/]/).pop() }}</p><p class="break-all text-xs text-muted">{{ state?.context?.root || selected.root }}</p><p v-if="state?.projectError" class="text-[#b42318]">{{ state.projectError }}</p><p class="text-xs text-muted">跟随当前 dsh 会话。切换工作区后自动更新，已提交任务仍在原会话执行。</p></template>
              <p v-else class="text-muted">先在 dsh 左侧工作区打开项目会话。</p>
              <button :disabled="busy" class="rounded-lg bg-accent px-4 py-2 text-white hover:brightness-110 disabled:opacity-40" @click="testStep('project')">检测项目</button>
              <p v-if="tests.project" class="flow-result" :data-tone="tests.project.ok ? 'ok' : 'fail'">{{ tests.project.ok ? '✓' : '✕' }} {{ tests.project.message }}</p>
            </div>
          </div>
        </article>
      </section>

      <!-- 第 4 步：发起任务 -->
      <section id="step-task" aria-labelledby="task-title" class="rounded-xl border border-line bg-panel p-5">
        <div class="flex flex-wrap items-center justify-between gap-2"><h2 id="task-title" class="text-base font-medium"><span class="flow-index mr-2 inline-flex">4</span>发起任务</h2><span v-if="!allPassed" class="text-xs text-muted">建议先完成前三步的测试</span></div>
        <label class="mt-4 block text-xs text-muted">MasterGo 节点链接<input v-model="nodeLink" :disabled="busy" placeholder="留空使用 MasterGo 当前选区" class="field text-sm text-ink"></label>
        <div class="mt-4 flex flex-wrap gap-3"><button :disabled="busy || !configured" class="rounded-lg bg-accent px-4 py-2 text-white hover:brightness-110 disabled:opacity-40" @click="submitTask('generate')">实现设计稿</button><button :disabled="busy || !configured" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="submitTask('optimize')">优化对应节点</button><button :disabled="busy || !configured" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="submitTask('read')">查看节点</button><button :disabled="busy || !configured" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="submitTask('rules')">生成设计规则</button></div>
        <div class="mt-4 rounded-lg bg-canvas p-3 text-xs leading-6 text-muted">
          <p>在聊天里直接输入，工作室会把任务类型换成对应的内置提示词，后面的内容作为你的需求：</p>
          <ul class="mt-1 space-y-0.5"><li v-for="task in tasks" :key="task.id"><code class="text-ink">@设计工作室:{{ task.label }}</code> <span>{{ task.description }}</span></li></ul>
          <p class="mt-1">例如：<code class="text-ink">@设计工作室:实现设计稿 https://mastergo.com/file/…?layer_id=… 用项目已有的头部组件</code></p>
        </div>
      </section>

      <section v-if="promptsOpen" id="built-in-prompts" class="min-w-0 space-y-4 rounded-xl border border-line bg-panel p-5" aria-label="内置提示词">
        <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-base font-medium">内置提示词</h2><button :disabled="busy" class="rounded-lg border border-line px-3 py-2 hover:bg-canvas disabled:opacity-40" @click="copyPrompt">复制提示词</button></div>
        <p class="text-xs leading-5 text-muted">这里展示工作室实际使用的模板。任务执行时会填入当前项目、设计节点和模型能力；本页只读。</p>
        <div class="flex flex-wrap items-center gap-3"><span class="text-xs text-muted">任务类型</span><DshSelect v-model="promptId" :options="promptOptions" aria-label="任务类型" /></div>
        <pre tabindex="0" aria-label="提示词内容" class="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-canvas p-4 font-mono text-xs leading-6">{{ selectedPrompt.content }}</pre>
      </section>

      <details class="rounded-xl border border-line bg-panel p-5">
        <summary class="cursor-pointer font-medium">项目预览<span class="ml-3 text-xs font-normal text-muted">{{ previewLabels[state?.preview?.state ?? 'idle'] }}</span></summary>
        <div class="mt-4 space-y-4"><div class="flex flex-wrap items-center gap-3"><DshSelect v-model="script" :options="scriptOptions" :disabled="busy || previewActive" aria-label="项目启动脚本" placeholder="没有可用脚本" class="min-w-0 flex-1" /><button :disabled="busy || !configured || !script || previewActive" class="rounded-lg border border-line px-3 py-2 disabled:opacity-40" @click="previewAction('preview-start')">启动预览</button><button :disabled="busy || !previewActive" class="rounded-lg border border-line px-3 py-2 disabled:opacity-40" @click="previewAction('preview-stop')">停止服务</button></div><div class="flex flex-wrap gap-3"><input v-model="preview" aria-label="本机预览地址" :disabled="busy" @input="previewDirty = true" placeholder="http://127.0.0.1:5173" class="field mt-0 min-w-0 flex-1"><button :disabled="busy || !configured" class="rounded-lg border border-line px-3 py-2 disabled:opacity-40" @click="openPreview">打开预览</button></div><button class="text-xs text-muted underline" @click="showLogs = !showLogs">{{ showLogs ? '收起日志' : '查看日志' }}</button><pre v-if="showLogs" class="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-canvas p-3 text-xs">{{ state?.preview?.log || '暂无日志' }}</pre><iframe v-if="renderedPreview" :src="renderedPreview" title="项目隔离预览" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" class="h-[32rem] w-full rounded-lg border border-line bg-white"></iframe></div>
      </details>
    </div>
  </main>
</template>
