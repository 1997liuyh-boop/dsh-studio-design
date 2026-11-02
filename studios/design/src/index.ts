import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Store, settings } from './storage.ts'
import { catalog, inspectProject, object, text } from './project.ts'
import { Connections } from './connections.ts'
import { AgentConnections } from './agentConnections.ts'
import { participation } from './participation.ts'
import { designPrompt } from './prompt.ts'
import type { Host, DesignAgent, AgentContext } from './host.ts'
import { syncSource, locateSource } from './source.ts'
import { Previews, type PreviewHost } from './preview.ts'

/** 插件注册名与安装包一致。 */
export const name = 'dsh-studio-design'
/** 会话目录、工具和参与投影由宿主提供。 */
export const inject = ['studioProjects', 'tools', 'sessions', 'agents', 'sessionProjections', 'systemPrompt']
declare const STUDIO_PROJECT: { name: string; icon: string; description: string }

/** 注册工作区设计工具与页面；任务始终使用执行会话的目录。 */
export async function apply(ctx: Host): Promise<void> {
  const store = new Store()
  let config = await store.loadSettings(), closed = false
  const builtin = fileURLToPath(new URL('../reborn/', import.meta.url))
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
  const codeRoot = () => config.rebornSource === 'local' || config.rebornSource === 'github' && config.rebornCommit ? config.rebornRoot : ''
  const sourceRoot = () => config.rebornSource === 'github' && config.rebornKnowledge === false ? '' : codeRoot()
  const source = () => ({ kind: codeRoot() ? config.rebornSource! : 'builtin', root: codeRoot() || builtin, knowledge: sourceRoot() ? 'repository' as const : 'builtin' as const, commit: config.rebornCommit || '', contentCommit: config.rebornContentCommit || '', repository: config.rebornCachedRepository || config.rebornRepository || '' })
  const builtinSpec = () => ({ command: process.execPath, args: [fileURLToPath(new URL('./reborn-mcp.js', import.meta.url)), '--kb-dir', join(sourceRoot() || builtin, 'knowledge'), '--spec-dir', join(builtin, 'spec')] })
  const connectReborn = async () => {
    if (connections.snapshot().reborn.state === 'connected') return
    await connections.connect('reborn', config.reborn.command ? config.reborn : builtinSpec(), builtin)
  }
  ctx.effect(() => async () => { closed = true; lifetime.abort(); await mutations; await previews.dispose(); await scoped.dispose(); await connections.dispose() }, '设计工作室：结束在途操作并关闭连接')
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
    return { context: selected ? { sessionId: selected.sessionId, root: selected.root } : null, settings: config, project, projectError,
      workspace: project ? await store.workspace(project.root) : null,
      components: await catalog(join(sourceRoot() || builtin, 'knowledge')),
      connections: { ...connections.snapshot(), mastergo: selected?.agent ? scoped.peek(selected.agent)?.snapshot().mastergo ?? connections.snapshot().mastergo : connections.snapshot().mastergo },
      preview: project ? await previews.snapshot(project.root) : undefined, source: source() }
  }
  ctx.effect(() => ctx.sessionProjections.register(participation), '设计工作室：会话参与投影')
  ctx.effect(() => ctx.systemPrompt.section({ name: 'studio-design-workspace', order: 920, interpolate: false,
    text: '用户通过 @工作室:design 或 @设计工作室 指定设计工作室。设计、实现页面、读取 MasterGo、生成项目设计规则时，先调用 design_workspace，task 分别为 generate、read、rules（仅明确要求写回画布时使用 sync），request 保留用户需求。该工具返回当前执行会话的真实工作区和所需规则；按返回资料继续在当前会话操作，无需让用户在工作室重新选择目录或创建会话。多个工作区独立，不借用设置中的旧项目目录或其他会话的 MCP。没有工作区时请用户在 dsh 工作区中打开项目。打开设置或查看预览仍可使用 studio 工具。' }), '设计工作室：工作区调用指引')
  ctx.effect(() => ctx.tools.register({
    name: 'design_workspace', description: '准备当前会话的设计任务，读取实际工作区、组件映射并返回实施指引。rules 归纳项目设计规则，无需 MasterGo；read 只读选区；generate 实现用户需求；sync 仅用于明确授权的画布同步。自动准备当前会话的 MasterGo，保持主聊天与悬浮球使用同一历史。',
    parameters: { type: 'object', properties: { task: { type: 'string', enum: ['rules', 'read', 'generate', 'sync'] }, request: { type: 'string', maxLength: 8000 } }, required: ['task', 'request'], additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(input, execution) {
      return enqueue(async () => {
        execution.signal.throwIfAborted()
        const args = object(input), task = text(args.task, 32), request = text(args.request, 8000)
        if (task !== 'rules' && task !== 'read' && task !== 'generate' && task !== 'sync') throw new Error('未知设计任务')
        const agent = execution.agent
        if (!agent?.session.header.cwd) throw new Error('请先在 dsh 工作区打开项目会话，再 @设计工作室')
        const project = await inspectProject(agent.session.header.cwd)
        const workspace = await store.workspace(project.root)
        const instructions = designPrompt(project, workspace, request, task, source())
        execution.signal.throwIfAborted()
        if (task !== 'rules') {
          await connectReborn()
          execution.signal.throwIfAborted()
          const connection = scoped.get(agent)
          if (connection.snapshot().mastergo.state !== 'connected') await connection.connect('mastergo', config.mastergo, project.root)
        }
        execution.signal.throwIfAborted()
        return JSON.stringify({ sessionId: agent.session.id, root: project.root, instructions })
      })
    },
    presentCall(input) { const args = object(input); const labels: Record<string, string> = { rules: '生成设计规则', read: '读取设计稿', generate: '实现页面', sync: '同步画布' }; return { card: 'generic', title: '设计工作室 · ' + (labels[String(args.task)] ?? '准备工作区'), kind: 'read', rawInput: input } },
  }), '设计工作室：当前会话任务工具')

  const dispatch = async (input: Record<string, unknown>) => {
    if (input.action === 'configure') {
      const next = settings(input.settings)
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
      const mastergoChanged = JSON.stringify(next.mastergo) !== JSON.stringify(config.mastergo)
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
