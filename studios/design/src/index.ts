import type { ConnectionSpec, Project, Workspace } from './types.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mastergoAdapter, mastergoCanvas, mastergoTarget, mastergoTargets } from './mastergo.ts'
import { syncInteractions } from './interactions.ts'
import { Store, settings } from './storage.ts'
import { catalog, inspectProject, object, readOptional, text } from './project.ts'
import { Connections } from './connections.ts'
import { AgentConnections } from './agentConnections.ts'
import { participation } from './participation.ts'
import { designPrompt, workspaceInstructions } from './prompt.ts'
import { Reviews, customAllowances, reviewPatterns } from './review.ts'
import { ManifestSeals } from './manifestSeal.ts'
import { locatePlaywright, playwrightMeasurer } from './measure.ts'
import { playwrightDriver } from './interact.ts'
import { installComponents, locateRegistry, type InstallReport } from './install.ts'
import { MANIFEST_PATH, manifestSummary, preRead, reusableManifest } from './reader.ts'
import { matchManifest, type PromptMapping } from './componentMap.ts'
import { loadComponentMap, recordUnmapped } from './componentMapStore.ts'
import type { Host, DesignAgent, AgentContext } from './host.ts'
import { nestedToolExecutor } from './toolExecution.ts'
import { syncSource, locateSource } from './source.ts'
import { Previews, type PreviewHost } from './preview.ts'

/** 清单原文，供来源凭据核对；文件不存在时为空串（核对必然不通过）。 */
const readManifestText = async (root: string): Promise<string> => (await readOptional(root, MANIFEST_PATH, 8_000_000)) ?? ''

/** 插件注册名与安装包一致。 */
export const name = 'dsh-studio-design'
/** 会话目录、工具和参与投影由宿主提供。 */
export const inject = ['studioProjects', 'tools', 'sessions', 'agents', 'sessionProjections', 'systemPrompt']
/** 构建时注入的 studio.json 声明；tasks 是输入框 @ 候选里的快捷任务。 */
declare const STUDIO_PROJECT: { name: string; icon: string; description: string; tasks?: { id: string; label: string; description?: string; text: string }[] }

/** 注册工作区设计工具与页面；任务始终使用执行会话的目录。 */
export async function apply(ctx: Host): Promise<void> {
  const store = new Store()
  const seals = new ManifestSeals()
  const reviews = new Reviews(seals)
  let config = await store.loadSettings(), closed = false
  const builtin = fileURLToPath(new URL('../reborn/', import.meta.url))
  // 几何与像素审计用的 Playwright 不随插件打包：从目标项目、插件目录、宿主工作目录或 DSH_HARNESS_ROOT 解析，找不到时审计阶段说明原因。
  // 审计时预览没起来：用项目自己的 dev / start / preview 脚本经 dsh Shell 与 Jobs 启动（宿主侧），等它报出本机地址。
  const startPreview = async (project: Project, sessionId: string, signal: AbortSignal): Promise<string | undefined> => {
    const script = ['dev', 'start', 'serve', 'preview'].find(name => Object.hasOwn(project.scripts, name))
    if (!script) return undefined
    try { await previews.start(project, sessionId, script) }
    catch (error) { return undefined }
    for (let attempt = 0; attempt < 45; attempt += 1) {
      signal.throwIfAborted()
      const state = await previews.snapshot(project.root)
      if (state.url) return state.url
      if (['failed', 'completed', 'killed'].includes(state.state)) return undefined
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    return undefined
  }
  const playwrightFor = (root: string) => locatePlaywright({ explicit: process.env.DSH_PLAYWRIGHT_MODULE, roots: [root, fileURLToPath(new URL('./', import.meta.url)), process.cwd(), process.env.DSH_HARNESS_ROOT ?? ''] })
  const measurerFor = async (root: string, signal: AbortSignal) => {
    const module = await playwrightFor(root)
    return module ? playwrightMeasurer({ module, signal }) : undefined
  }
  // 交互断言同样在宿主侧用 Playwright 执行，模型不必在沙箱里起浏览器。
  const driverFor = async (root: string, signal: AbortSignal) => {
    const module = await playwrightFor(root)
    return module ? playwrightDriver({ module, signal }) : undefined
  }
  const lifetime = new AbortController()
  const previews = new Previews({ get shell() { return ctx.get('shell') as PreviewHost['shell'] }, get jobs() { return ctx.get('jobs') as PreviewHost['jobs'] } })
  const start = (owner: AgentContext) => async (value: Record<string, unknown>) => {
    // 使用宿主同版本的 MCP 实现，保留 Agent 的工具作用域。
    const specifier = '@deepseek-ai/dsh-mcp-client'
    const plugin: object = await import(specifier)
    return owner.plugin(plugin, value)
  }
  const connections = new Connections(start(ctx), name => !!ctx.tools.get(name))
  const scoped = new AgentConnections(agent => start(agent.ctx), (agent, name) => !!ctx.tools.get(name, agent))
  let mutations: Promise<unknown> = Promise.resolve()
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = mutations.then(() => { if (closed) throw new Error('设计工作室正在卸载'); return operation() })
    mutations = task.catch(() => { /* 调用者接收错误，队列继续接受后续重试。 */ })
    return task
  }
  // 设计稿预读按会话串行，但不进入配置队列：一次预读可能持续十几分钟，不能挡住设置页与预览请求。
  const readers = new Map<DesignAgent, Promise<unknown>>()
  function serial<T>(agent: DesignAgent, operation: () => Promise<T>): Promise<T> {
    const task = (readers.get(agent) ?? Promise.resolve()).then(() => { if (closed) throw new Error('设计工作室正在卸载'); return operation() })
    readers.set(agent, task.catch(() => {}))
    return task
  }
  const codeRoot = () => config.rebornSource === 'local' || config.rebornSource === 'github' && config.rebornCommit ? config.rebornRoot : ''
  const sourceRoot = () => config.rebornSource === 'github' && config.rebornKnowledge === false ? '' : codeRoot()
  const source = () => ({ kind: codeRoot() ? config.rebornSource! : 'builtin', root: codeRoot() || builtin, knowledge: sourceRoot() ? 'repository' as const : 'builtin' as const, commit: config.rebornCommit || '', contentCommit: config.rebornContentCommit || '', repository: config.rebornCachedRepository || config.rebornRepository || '' })
  const builtinSpec = () => ({ command: process.execPath, args: [fileURLToPath(new URL('./reborn-mcp.js', import.meta.url)), '--kb-dir', join(sourceRoot() || builtin, 'knowledge'), '--spec-dir', join(builtin, 'spec')] })
  const connectReborn = async () => {
    if (connections.snapshot().reborn.state === 'connected') return
    await connections.connect('reborn', config.reborn.command ? config.reborn : builtinSpec(), builtin)
  }
  ctx.effect(() => async () => { closed = true; lifetime.abort(); await mutations; await Promise.all(readers.values()); await previews.dispose(); await scoped.dispose(); await connections.dispose() }, '设计工作室：结束在途操作并关闭连接')
  try { if (!config.reborn.command) await connectReborn() }
  catch (error) { /* Connections 保留失败状态，设置页可重试。 */ }

  function context(sessionId: unknown) {
    if (sessionId === undefined || sessionId === '') return null
    const id = text(sessionId, 256)
    const sessions = ctx.get('sessions') as { get(id: string): { header: { cwd?: string } } | undefined }
    const session = sessions.get(id)
    if (!session?.header.cwd) throw new Error('此会话没有工作区，请先在 dsh 打开项目会话')
    const agents = ctx.get('agents') as { get(id: string): DesignAgent | undefined }
    return { sessionId: id, root: session.header.cwd, agent: agents.get(id) }
  }
  const snapshot = async (sessionId?: unknown) => {
    const selected = context(sessionId)
    let project = null, projectError = ''
    if (selected) {
      try { project = await inspectProject(selected.root) }
      catch (error) { projectError = error instanceof Error ? error.message : '项目读取失败' }
    }
    return { context: selected ? { sessionId: selected.sessionId, root: selected.root } : null, settings: { ...config, mastergoToken: '' }, mastergoTokenSet: !!config.mastergoToken, mastergoCanvas: await mastergoCanvas(config.mastergo), project, projectError,
      workspace: project ? await store.workspace(project.root) : null,
      components: await catalog(join(sourceRoot() || builtin, 'knowledge')),
      connections: { ...connections.snapshot(), mastergo: selected?.agent ? scoped.peek(selected.agent)?.snapshot().mastergo ?? connections.snapshot().mastergo : connections.snapshot().mastergo },
      preview: project ? await previews.snapshot(project.root) : undefined, source: source() }
  }
  ctx.effect(() => ctx.sessionProjections.register(participation), '设计工作室：会话参与投影')
  ctx.effect(() => ctx.systemPrompt.section({ name: 'studio-design-workspace', order: 920, interpolate: false,
    text: workspaceInstructions }), '设计工作室：工作区调用指引')
  ctx.effect(() => ctx.tools.register({
    name: 'design_workspace', description: '准备当前会话的设计任务，读取实际工作区、组件映射并返回实施指引。rules 归纳项目设计规则，无需 MasterGo；read 只读选区；generate 实现用户需求（task 缺省即 generate，request 只给 MasterGo 链接也可）；optimize 重新通过 MCP 读取指定节点并优化已有实现；sync 仅用于明确授权的画布同步。自动准备当前会话的 MasterGo；请求含 layer_id 链接时由工作室按区块预读设计稿、导出素材并写入 docs/design/mastergo-manifest.json，再把清单交给模型；request 里可含同一文件的多条画板链接，第一条为默认态，其余为状态帧，差异写入 manifest.stateDeltas，交互规范同步到 docs/design/interactions.yaml。',
    parameters: { type: 'object', properties: { task: { type: 'string', enum: ['rules', 'read', 'generate', 'optimize', 'sync'] }, request: { type: 'string', maxLength: 8000, description: '用户需求原文；可含多条 MasterGo 链接（第一条默认态，其余状态画板）与「交互 <节点>：<触发> → <响应>」行' }, preRead: { type: 'boolean', description: '是否由工作室预读设计稿，默认 true；传 false 时模型自行按区块读取' } }, required: ['request'], additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(input, execution) {
      const args = object(input), task = args.task === undefined ? 'generate' : text(args.task, 32)
      if (task !== 'rules' && task !== 'read' && task !== 'generate' && task !== 'optimize' && task !== 'sync') throw new Error('未知设计任务')
      const target = mastergoTarget(text(args.request, 8000))
      // 第二条起的链接是同一文件的状态画板（如「首页/登录态」），逐帧预读后与默认态比较。
      const frameTargets = target ? mastergoTargets(text(args.request, 8000)).slice(1).filter(frame => frame.fileId === target.fileId && frame.nodeId && frame.nodeId !== target.nodeId) : []
      // 只给链接时补上固定需求，模型不必再追问；原文保留在后面供核对。
      const bare = text(args.request, 8000).trim()
      const request = target && bare.replace(/https:\/\/mastergo\.com\/file\/\S+/g, '').trim().length < 4 ? '按链接节点 1:1 还原为页面：优先复用项目组件与 Reborn 组件，素材用导出原图，完成后在设计稿基准宽度截图核对。链接：' + bare : bare
      type Prepared = { blocked: string } | { agent: DesignAgent; project: Project; workspace: Workspace; connection: Connections | undefined; canvas: Awaited<ReturnType<typeof mastergoCanvas>> | undefined; mismatch: string; imageInput: 'supported' | 'unsupported' | 'unknown' }
      const prepared = await enqueue<Prepared>(async () => {
        execution.signal.throwIfAborted()
        const agent = execution.agent
        if (!agent?.session.header.cwd) throw new Error('请先在 dsh 工作区打开项目会话，再 @设计工作室')
        const project = await inspectProject(agent.session.header.cwd)
        if (task === 'generate' || task === 'optimize') { reviews.reset(agent); reviews.allow(agent, customAllowances(request)) }
        const workspace = await store.workspace(project.root)
        const connection = task === 'rules' ? undefined : scoped.get(agent)
        const canvas = task === 'rules' ? undefined : await mastergoCanvas(config.mastergo)
        execution.signal.throwIfAborted()
        if (connection) {
          try {
            if (canvas?.state === 'offline') throw new Error(canvas.message)
            // 链接与激活画布不一致不再直接拒绝：Vibe 读取工具按链接里的 documentId 定位，目标文件在桌面端另一个标签页打开时同样能读；
            // 真正未打开时读取会返回 409 或超时，由预读或 instructions 要求模型停止并提示用户切换文件。
            if (mastergoAdapter(config.mastergo)?.service === 'magic' && !config.mastergoToken) throw new Error('请在设计工作室设置中填写 MasterGo 个人访问令牌，并确认团队文件权限')
            await connectReborn()
            execution.signal.throwIfAborted()
            if (connection.snapshot().mastergo.state !== 'connected') await connection.connect('mastergo', { ...config.mastergo, env: config.mastergoToken ? { MG_MCP_TOKEN: config.mastergoToken } : {} }, project.root)
          } catch (error) {
            execution.signal.throwIfAborted()
            return { blocked: JSON.stringify({ ready: false, root: project.root, target, canvas, issue: error instanceof Error ? error.message.replaceAll(config.mastergoToken || '\0', '[已隐藏]') : '设计稿连接失败', instructions: '尚未读取设计稿。停止页面生成、素材替换和画布修改，保留原文件。明确说明连接问题；不能使用想象或其他文档代替。修复连接后重试 design_workspace。' }) }
          }
        }
        const mismatch = canvas?.state === 'ready' && target && (target.fileId !== canvas.documentId || target.pageId && target.pageId !== canvas.pageId)
          ? '链接指向的文件或页面不是 MasterGo 当前激活画布（当前 ' + canvas.documentId + ' / ' + canvas.pageId + '）。读取按 documentId 定位；若返回未打开、409 或超时，停止并请用户在 MasterGo 切换到该文件和页面，不要改读当前选区。'
          : ''
        const selected = agent.session.requestHeader?.()?.config
        const llm = ctx.get('llm') as { resolveModelInfo(provider: string, model: string, signal: AbortSignal): Promise<{ inputModalities?: readonly string[] }> } | undefined
        let imageInput: 'supported' | 'unsupported' | 'unknown' = 'unknown'
        if (task !== 'rules' && llm && selected?.provider && selected.model) {
          const model = await llm.resolveModelInfo(selected.provider, selected.model, execution.signal)
          if (model.inputModalities) imageInput = model.inputModalities.includes('image') ? 'supported' : 'unsupported'
        }
        return { agent, project, workspace, connection, canvas, mismatch, imageInput }
      })
      if ('blocked' in prepared) return prepared.blocked
      const { agent, project, workspace, connection, canvas, mismatch, imageInput } = prepared
      // 预读：Vibe 连接就绪且链接带 layer_id 时，由工作室按区块读取并落盘；模型随后只读本地文件。
      let manifest: object | undefined, reused = false, preReadIssue = '', mapping: PromptMapping | undefined, interactions: object | undefined, installation: InstallReport | undefined
      // 没有链接时读取画布当前选区（工作室首页按钮与「读取当前选区」提示词走这条路），根节点 ID 由返回头部给出。
      const canPreRead = (task === 'generate' || task === 'optimize' || task === 'read') && args.preRead !== false && connection?.snapshot().mastergo.state === 'connected' && mastergoAdapter(config.mastergo)?.service === 'vibe' && canvas?.state === 'ready' && typeof ctx.tools.execute === 'function'
      if (canPreRead) {
        const signal = AbortSignal.any([execution.signal, lifetime.signal])
        const source = { fileId: target?.fileId ?? canvas.documentId ?? '', pageId: target?.pageId ?? canvas.pageId ?? '', nodeId: target?.nodeId || undefined }
        const outcome = await serial(agent, async () => {
          const frames = frameTargets.map(frame => ({ pageId: frame.pageId || source.pageId, nodeId: frame.nodeId }))
          const previous = await reusableManifest(project.root, source.nodeId, task === 'optimize' ? '重新读取 ' + request : request, source, frames.map(frame => frame.nodeId))
          // 只复用工作室自己写出的清单：模型手写或改过的清单内容与凭据对不上，直接重新预读覆盖它
          if (previous && await seals.verify(project.root, await readManifestText(project.root))) { reused = true; return previous }
          const result = await preRead({ execute: await nestedToolExecutor(ctx, execution), agent, rootCallId: execution.rootCallId ?? execution.callId, parent: execution.token, signal }, { root: project.root, target: source, readVariables: !mismatch, frames })
          if (!result.ok) { preReadIssue = result.issue; return undefined }
          await seals.seal(project.root)
          return result.manifest
        })
        execution.signal.throwIfAborted()
        if (outcome) {
          // 映射表：实例名与项目 docs/design/component-map.json 匹配，未命中的登记到实现清单；项目没有映射表时写出默认骨架。
          const known = new Set((await catalog(join(sourceRoot() || builtin, 'knowledge'))).map(component => component.id))
          const map = await loadComponentMap(project.root, { create: true, known })
          const result = matchManifest(map.rules, outcome)
          await recordUnmapped(project.root, result)
          mapping = { path: map.path, source: map.source, rules: map.rules, result }
          // 映射命中的组件（含伴随组件）由工作室在实现前装进项目，模型不再在沙箱里跑包管理器。
          if (task === 'generate' || task === 'optimize') {
            const required = [...new Set(result.matched.flatMap(hit => [hit.rule.component, ...(hit.rule.with ?? [])]))].filter(id => known.has(id))
            try { installation = await installComponents(project.root, required, { registry: await locateRegistry({ explicit: process.env.REBORN_REGISTRY_DIR || config.rebornRegistry, roots: [config.rebornRoot, builtin] }), cli: process.env.DSH_REBORN_CLI, signal: execution.signal }) }
            catch (error) { installation = { installed: [], skipped: [], failed: required.map(id => ({ id, reason: error instanceof Error ? error.message : String(error) })), npmDependencies: [], missingShared: [], method: 'none' } }
          }
          manifest = manifestSummary(outcome, reused, { path: map.path, source: map.source, created: map.created, warnings: map.warnings, total: result.total, matched: result.matched.map(hit => ({ name: hit.name, nodeIds: hit.nodeIds, component: hit.rule.component })), unmatched: result.unmatched, ignored: result.ignored.map(hit => hit.name) })
          // 交互规范：按区块、实例与状态帧补骨架，并把需求里的「交互 …：… → …」写回 docs/design/interactions.yaml。
          if (task === 'generate' || task === 'optimize') interactions = await syncInteractions(project.root, outcome, request)
        }
      }
      // 没有预读时也按项目映射表渲染提示词里的【组件】段（存在即用，不新建文件）。
      if (!mapping && task !== 'rules') mapping = await loadComponentMap(project.root)
      if (preReadIssue) return JSON.stringify({ ready: false, root: project.root, target, canvas, issue: preReadIssue, instructions: '设计稿未读到。停止页面生成和素材替换，保留原文件；把上述原因告诉用户，待其在 MasterGo 中打开目标文件并选中图层后重试 design_workspace。不能用想象或旧稿代替。' })
      const installNote = installation ? '\n\n【组件安装】工作室已按映射命中把缺失的 Reborn 组件装进项目（数据）：' + JSON.stringify(installation) + '。installed 为本次写入、skipped 为项目已有；failed 的组件按 get_install_command 由用户在沙箱外安装；npmDependencies 列出组件引用但 package.json 没有的包，先在清单「已知差异」记录并提示用户安装，不要自己运行包管理器；missingShared 是组件引用的共享文件（lib / composables），缺失时按 Reborn 文档补齐。' : ''
      const instructions = designPrompt(project, workspace, request, task, source(), connection?.snapshot().mastergo.tools, imageInput, manifest, mapping, interactions) + installNote + (mismatch ? '\n\n画布提示：' + mismatch : '')
      execution.signal.throwIfAborted()
      return JSON.stringify({ ready: true, sessionId: agent.session.id, root: project.root, target, canvas, canvasMismatch: mismatch || undefined,
        imageInput, manifest, interactions, installation, workflow: task === 'generate' || task === 'optimize' ? { version: 3, preset: 'mastergo-reborn', phases: [manifest ? 'manifest-ready' : 'read-design', ...(interactions ? ['interactions-spec'] : []), 'design_review:plan', 'implement', 'design_review:check', 'design_review:compare', 'design_review:interact', 'design_review:verify'] } : undefined, instructions })
    },
    presentCall(input) { const args = object(input); const labels: Record<string, string> = { rules: '生成设计规则', read: '读取设计稿', generate: '实现页面', optimize: '优化节点', sync: '同步画布' }; return { card: 'generic', title: '设计工作室 · ' + (labels[String(args.task)] ?? '准备工作区'), kind: 'read', rawInput: input } },
  }), '设计工作室：当前会话任务工具')

  ctx.effect(() => ctx.tools.register({
    name: 'design_review',
    description: '固定还原流程的检查：plan 登记节点语义、项目或 Reborn 组件、全部导出素材和应验证交互；check 核对实际组件与原图；compare 用浏览器在设计稿基准宽度实测模板里 data-design 节点的位置、尺寸、字号、颜色、圆角、描边并与预读规格表比对，再把区块截图与预览图做像素比对，输出按差异排序的清单（位置尺寸容差 2px，其余精确，字体族只提示）；interact 由工作室在宿主侧用浏览器按 docs/design/interactions.yaml 已填写条目执行交互（trigger 翻译为 点击 / 悬停 / 输入 / 按键 / 滚动，response 里的 出现 / 消失 / 文字 / aria 属性 / 路由 作断言），前后截图写到 docs/design/screenshots/，另截 390 宽窄屏整页图，报告写 docs/design/interaction-report.json；verify 登记证据，有 interact 报告时直接采用其结果与截图。check 与 verify 不修改项目，compare 只把报告与差异图写进 docs/design/compare。',
    parameters: { type: 'object', properties: {
      stage: { type: 'string', enum: ['plan', 'check', 'compare', 'interact', 'verify'] },
      url: { type: 'string', maxLength: 512, description: 'compare / interact：预览地址（本机回环地址）；缺省读实现清单「预览地址」行，再回退到工作室预览设置' },
      blocks: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 128 }, description: 'compare：只比对这些区块节点 ID' },
      requirements: { type: 'array', maxItems: 100, items: { type: 'object', properties: { node: { type: 'string', maxLength: 256 }, component: { type: 'string', maxLength: 128 }, file: { type: 'string', maxLength: 2048 }, source: { type: 'string', enum: ['project', 'reborn', 'custom'] }, pattern: { type: 'string', enum: [...reviewPatterns] }, evidence: { type: 'string', maxLength: 2048 } }, required: ['node', 'component', 'file'], additionalProperties: false } },
      assets: { type: 'array', maxItems: 200, items: { type: 'object', properties: { node: { type: 'string', maxLength: 256 }, exported: { type: 'string', maxLength: 2048 }, used: { type: 'string', maxLength: 2048 } }, required: ['node', 'exported', 'used'], additionalProperties: false } },
      interactions: { type: 'array', maxItems: 100, items: { type: 'object', properties: { node: { type: 'string', maxLength: 256 }, action: { type: 'string', maxLength: 512 }, expected: { type: 'string', maxLength: 1024 }, actual: { type: 'string', maxLength: 2048 }, passed: { type: 'boolean' }, evidence: { type: 'string', maxLength: 2048 } }, required: ['node', 'action', 'expected'], additionalProperties: false } },
      visuals: { type: 'array', maxItems: 20, items: { type: 'object', properties: { viewport: { type: 'string', maxLength: 128 }, evidence: { type: 'string', maxLength: 2048 }, reference: { type: 'string', maxLength: 2048 } }, required: ['viewport', 'evidence', 'reference'], additionalProperties: false } },
    }, required: ['stage'], additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(input, execution) {
      execution.signal.throwIfAborted()
      const agent = execution.agent
      if (!agent?.session.header.cwd) throw new Error('请先在当前工作区会话准备设计任务')
      const project = await inspectProject(agent.session.header.cwd), args = object(input)
      if (args.stage === 'plan' && Array.isArray(args.requirements)) {
        const known = new Set((await catalog(join(sourceRoot() || builtin, 'knowledge'))).map(component => component.id))
        for (const value of args.requirements) {
          const requirement = object(value)
          if ((requirement.source === undefined || requirement.source === 'reborn') && !known.has(String(requirement.component))) throw new Error('Reborn 知识库中不存在组件：' + String(requirement.component))
        }
      }
      const result = args.stage === 'plan' ? await reviews.plan(agent, project.root, args)
        : args.stage === 'check' ? await reviews.check(agent, project.root) : args.stage === 'verify' ? await reviews.verify(agent, project.root, args)
        : args.stage === 'compare' ? await reviews.compare(agent, project.root, args, { measurer: await measurerFor(project.root, execution.signal), workspaceUrl: (await store.workspace(project.root)).previewUrl || undefined, fallbackUrl: project.framework === 'Nuxt' ? 'http://localhost:3000/' : undefined, startPreview: () => startPreview(project, agent.session.id, execution.signal) })
        : args.stage === 'interact' ? await reviews.interact(agent, project.root, args, { open: await driverFor(project.root, execution.signal), signal: execution.signal, workspaceUrl: (await store.workspace(project.root)).previewUrl || undefined, fallbackUrl: project.framework === 'Nuxt' ? 'http://localhost:3000/' : undefined, startPreview: () => startPreview(project, agent.session.id, execution.signal) }) : null
      if (!result) throw new Error('未知检查阶段')
      execution.signal.throwIfAborted()
      return JSON.stringify(result)
    },
    presentCall(input) { const args = object(input); return { card: 'generic', title: '设计工作室 · ' + (args.stage === 'plan' ? '登记还原计划' : args.stage === 'verify' ? '登记交互与视觉证据' : args.stage === 'compare' ? '几何与像素审计' : args.stage === 'interact' ? '执行交互断言' : '检查组件与素材'), kind: 'read', rawInput: input } },
  }), '设计工作室：还原检查工具')

  const dispatch = async (input: Record<string, unknown>) => {
    if (input.action === 'configure') {
      const next = settings(input.settings)
      if (!next.mastergoToken && input.clearMastergoToken !== true) next.mastergoToken = config.mastergoToken
      // 旧项目目录保留在文件中，任务与页面不再使用它选择工作区。
      next.projectRoot = config.projectRoot
      if (next.rebornSource === 'local') {
        const local = await locateSource(next.rebornRoot)
        next.rebornRoot = local.root; next.rebornContentCommit = local.contentCommit
        next.rebornCommit = ''; next.rebornCachedRepository = ''; next.rebornKnowledge = true
      }
      if (next.rebornSource === 'github') {
        next.rebornRoot = config.rebornSource === 'github' ? config.rebornRoot : ''
        next.rebornCommit = config.rebornSource === 'github' ? config.rebornCommit : ''
        next.rebornCachedRepository = config.rebornCachedRepository || config.rebornRepository
        next.rebornKnowledge = config.rebornSource === 'github' ? config.rebornKnowledge : false
        next.rebornContentCommit = config.rebornSource === 'github' ? config.rebornContentCommit : ''
      }
      const mastergoChanged = JSON.stringify([next.mastergo, next.mastergoToken]) !== JSON.stringify([config.mastergo, config.mastergoToken])
      const rebornChanged = JSON.stringify([next.reborn, next.rebornRoot, next.rebornSource]) !== JSON.stringify([config.reborn, config.rebornRoot, config.rebornSource])
      await store.saveSettings(next)
      config = next
      if (mastergoChanged) await scoped.reset()
      if (rebornChanged) await connections.disconnect('reborn')
      if (!config.reborn.command) await connectReborn()
    } else if (input.action === 'sync-source') {
      if (config.rebornSource !== 'github') throw new Error('请先选择 GitHub 资料来源')
      const fetched = await syncSource(join(store.dir, 'sources'), config.rebornRepository || '', config.rebornRef || 'main', lifetime.signal)
      if (closed) throw new Error('工作室已关闭')
      const next = { ...config, rebornRoot: fetched.root, rebornCommit: fetched.commit, rebornContentCommit: fetched.contentCommit, rebornCachedRepository: config.rebornRepository, rebornKnowledge: fetched.knowledge }
      await store.saveSettings(next)
      await connections.disconnect('reborn')
      config = next
      await connectReborn()
    } else if (input.action === 'diagnose') {
      const selected = context(input.sessionId)
      if (!selected) throw new Error('请先打开项目会话')
      if (!selected.agent) return snapshot(input.sessionId)
      const spec: ConnectionSpec = { ...config.mastergo, env: config.mastergoToken ? { MG_MCP_TOKEN: config.mastergoToken } : {} }
      await scoped.get(selected.agent).connect('mastergo', spec, selected.root)
    } else if (input.action === 'connect') {
      if (input.target !== 'reborn') throw new Error('MasterGo 会在当前会话发起设计任务时自动连接')
      await connections.disconnect('reborn'); await connectReborn()
    } else if (input.action === 'preview-start' || input.action === 'preview-stop' || input.action === 'save-workspace') {
      const selected = context(input.sessionId)
      if (!selected) throw new Error('请先在 dsh 工作区打开项目会话')
      const project = await inspectProject(selected.root)
      if (input.action === 'preview-start') await previews.start(project, selected.sessionId, text(input.script, 128))
      else if (input.action === 'preview-stop') await previews.stop(project.root)
      else await store.saveWorkspace(project.root, input.workspace)
    } else if (input.action !== 'snapshot' && input.action !== 'refresh') throw new Error('未知工作室操作')
    return snapshot(input.sessionId)
  }
  const send = (res: ServerResponse, status: number, value: object) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    res.end(JSON.stringify(value))
  }
  ctx.effect(() => ctx.studioProjects.register({ id: 'design', ...STUDIO_PROJECT, root: fileURLToPath(new URL('../static/', import.meta.url)), async handle(req: IncomingMessage, res, path) {
    if (path !== 'api') return false
    try {
      if (req.method === 'GET') { send(res, 200, await snapshot()); return true }
      if (req.method !== 'POST') { send(res, 405, { error: '仅支持 GET 与 POST' }); return true }
      if (req.headers['sec-fetch-site'] === 'cross-site' || req.headers['content-type']?.split(';')[0] !== 'application/json') { send(res, 403, { error: '请求来源或格式无效' }); return true }
      let size = 0
      const chunks: Buffer[] = []
      for await (const chunk of req) { size += chunk.length; if (size > 256_000) { send(res, 413, { error: '配置内容过大' }); return true }; chunks.push(chunk) }
      const input = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      text(input.action, 64)
      send(res, 200, await enqueue(() => dispatch(input)))
    } catch (error) { send(res, 400, { error: error instanceof Error ? error.message : '工作室操作失败，请查看 dsh 日志' }) }
    return true
  } }), '设计工作室：登记独立页面')
}
