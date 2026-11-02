import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Store, settings } from './storage.ts'
import { catalog, inspectProject, object, text } from './project.ts'
import { Connections, type McpFiber } from './connections.ts'
import type { Project } from './types.ts'
import { syncSource, validateSource } from './source.ts'
import { Previews, type PreviewHost } from './preview.ts'

/** 插件注册名与安装包一致。 */
export const name = 'dsh-studio-design'
/** 连接和页面都由宿主既有服务提供。 */
export const inject = ['studioProjects', 'tools']
declare const STUDIO_PROJECT: { name: string; icon: string; description: string }
interface Host {
  get(name: string): unknown
  studioProjects: { register(page: { id: string; root: string; name: string; icon: string; description: string; handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> }): () => void }
  tools: { get(name: string): object | undefined }
  plugin(plugin: object, config: Record<string, unknown>): McpFiber
  effect(callback: () => (() => void | Promise<void>), label: string): void
}

/** 注册独立页面与所有者认证后的 API，卸载时释放全部 MCP 子插件。 */
export async function apply(ctx: Host): Promise<void> {
  const store = new Store()
  let config = await store.loadSettings()
  let project: Project | null = null
  let projectError = ''
  if (config.projectRoot) {
    try { project = await inspectProject(config.projectRoot) }
    catch (error) { projectError = error instanceof Error ? error.message : '项目读取失败' }
  }
  const builtin = fileURLToPath(new URL('../reborn/', import.meta.url))
  const lifetime = new AbortController()
  const previews = new Previews({ get shell() { return ctx.get('shell') as PreviewHost['shell'] }, get jobs() { return ctx.get('jobs') as PreviewHost['jobs'] } })
  const connections = new Connections(async value => {
    // 由宿主解析同版本 MCP 插件，避免在工作室复制传输实现。
    const specifier = '@deepseek-ai/dsh-mcp-client'
    const plugin: object = await import(specifier)
    return ctx.plugin(plugin, value)
  }, name => !!ctx.tools.get(name))
  let mutations: Promise<unknown> = Promise.resolve()
  let closed = false
  const codeRoot = () => config.rebornSource === 'local' || config.rebornSource === 'github' && config.rebornCommit ? config.rebornRoot : ''
  const sourceRoot = () => config.rebornSource === 'github' && config.rebornKnowledge === false ? '' : codeRoot()
  const builtinSpec = () => ({ command: process.execPath, args: [fileURLToPath(new URL('./reborn-mcp.js', import.meta.url)), '--kb-dir', join(sourceRoot() || builtin, 'knowledge'), '--spec-dir', join(builtin, 'spec')] })
  const connectBuiltin = async () => {
    if (config.reborn.command || connections.snapshot().reborn.state === 'connected') return
    try { await connections.connect('reborn', builtinSpec(), builtin) }
    catch (error) { /* Connections 保留失败状态，页面仍可打开并重试。 */ }
  }
  ctx.effect(() => async () => { closed = true; lifetime.abort(); await mutations; await previews.dispose(); await connections.dispose() }, '设计工作室：结束在途操作并关闭 MCP 连接')
  await connectBuiltin()
  const snapshot = async () => ({ settings: config, project, projectError, workspace: project ? await store.workspace(project.root) : null, components: await catalog(join(sourceRoot() || builtin, 'knowledge')), connections: connections.snapshot(), preview: project ? await previews.snapshot(project.root) : undefined, source: { kind: codeRoot() ? config.rebornSource : 'builtin', root: codeRoot() || builtin, knowledge: sourceRoot() ? 'repository' : 'builtin', commit: config.rebornCommit || '', repository: config.rebornCachedRepository || config.rebornRepository || '' } })
  const dispatch = async (input: Record<string, unknown>) => {
    if (closed) throw new Error('设计工作室正在卸载')
    if (input.action === 'configure') {
      const next = settings(input.settings)
      const inspected = next.projectRoot ? await inspectProject(next.projectRoot) : null
      next.projectRoot = inspected?.root ?? ''
      if (next.rebornSource === 'local') await validateSource(next.rebornRoot)
      if (next.rebornSource === 'github') {
        // 待获取的地址与已经验证的缓存分别保存，下载失败时保留可用版本。
        next.rebornRoot = config.rebornSource === 'github' ? config.rebornRoot : ''
        next.rebornCommit = config.rebornSource === 'github' ? config.rebornCommit : ''
        next.rebornCachedRepository = config.rebornCachedRepository || config.rebornRepository
        next.rebornKnowledge = config.rebornSource === 'github' ? config.rebornKnowledge : false
      }
      if (JSON.stringify([next.mastergo, next.reborn, next.rebornRoot, next.rebornSource]) !== JSON.stringify([config.mastergo, config.reborn, config.rebornRoot, config.rebornSource])) await connections.disconnect()
      await store.saveSettings(next)
      config = next; project = inspected; projectError = ''
      await connectBuiltin()
    } else if (input.action === 'sync-source') {
      if (config.rebornSource !== 'github') throw new Error('请先选择 GitHub 资料来源')
      const source = await syncSource(join(store.dir, 'sources'), config.rebornRepository || '', config.rebornRef || 'main', lifetime.signal)
      if (closed) throw new Error('工作室已关闭')
      const next = { ...config, rebornRoot: source.root, rebornCommit: source.commit, rebornCachedRepository: config.rebornRepository, rebornKnowledge: source.knowledge }
      await store.saveSettings(next)
      await connections.disconnect()
      config = next
      await connectBuiltin()
    } else if (input.action === 'connect') {
      const target = input.target
      if (target !== 'mastergo' && target !== 'reborn') throw new Error('未知连接')
      const spec = target === 'reborn' && !config.reborn.command ? builtinSpec() : config[target]
      await connections.connect(target, spec, builtin)
    } else if (input.action === 'preview-start') {
      if (!project) throw new Error('请先读取项目')
      const workspace = await store.workspace(project.root)
      await previews.start(project, workspace.sessionId, text(input.script, 128))
    } else if (input.action === 'preview-stop') {
      if (project) await previews.stop(project.root)
    } else if (input.action === 'disconnect') {
      await connections.disconnect()
    } else if (input.action === 'save-workspace') {
      if (!project) throw new Error('请先读取项目')
      await store.saveWorkspace(project.root, input.workspace)
    } else if (input.action === 'refresh') {
      if (config.projectRoot) project = await inspectProject(config.projectRoot)
    } else throw new Error('未知工作室操作')
    return snapshot()
  }
  const send = (res: ServerResponse, status: number, value: object) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    res.end(JSON.stringify(value))
  }
  ctx.effect(() => ctx.studioProjects.register({ id: 'design', ...STUDIO_PROJECT, root: fileURLToPath(new URL('../static/', import.meta.url)), async handle(req, res, path) {
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
      const task = mutations.then(() => dispatch(input))
      mutations = task.catch(() => {})
      send(res, 200, await task)
    } catch (error) { send(res, 400, { error: error instanceof Error ? error.message : '工作室操作失败，请查看 dsh 日志' }) }
    return true
  } }), '设计工作室：登记独立页面')
}
