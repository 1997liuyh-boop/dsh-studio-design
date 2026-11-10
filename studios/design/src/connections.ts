import type { ConnectionSpec, ConnectionStatus } from './types.ts'

/** Cordis 子插件拥有 MCP 传输；工作室不实现自己的 JSON-RPC。 */
export interface McpFiber { await(): Promise<unknown>; dispose(): Promise<unknown> }
export type StartMcp = (config: Record<string, unknown>) => Promise<McpFiber>
const mastergoReaders = ['get_frontend_code', 'get_selection_node', 'get_selection_code', 'mcp_getDsl', 'mcp_getD2c']
const mastergoTools = [...mastergoReaders, 'get_screenshot', 'get_selection_image', 'get_variables', 'agent_sync_design']
const toolName = (name: string, tool: string) => 'mcp__design_' + name + '__' + tool
/**
 * 工具调用超时：MasterGo 读取整页或大区块时桌面端解析常超过 60 秒（1920×5989 的首页节点实测 1–3 分钟），
 * 过早超时会让模型反复整页重试；Reborn 只读本地知识库，保持 60 秒。
 */
export const toolCallTimeouts = { mastergo: 180_000, reborn: 60_000 } as const

/** 每条连接串行变更，断线后根据真实工具是否存在显示状态。 */
export class Connections {
  private fibers = new Map<string, McpFiber>()
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  private pending = new Set<McpFiber>()
  private statuses: Record<'mastergo' | 'reborn', ConnectionStatus> = {
    mastergo: { state: 'disconnected', message: '请运行 MasterGo 桌面端并打开设计文档' },
    reborn: { state: 'disconnected', message: '连接后可查询真实参数与示例' },
  }
  constructor(private start: StartMcp, private hasTool: (name: string) => boolean) {}
  /** 已完成握手后仍检查工具是否在线。 */
  snapshot(): typeof this.statuses {
    return Object.fromEntries(Object.entries(this.statuses).map(([name, status]) => [name, status.state === 'connected' && !status.tools?.some(tool => (name === 'reborn' || mastergoReaders.includes(tool)) && this.hasTool(toolName(name, tool))) ? { state: 'error', message: 'MCP 已断开，请重新连接' } : { ...status }])) as typeof this.statuses
  }
  /** 显式连接；失败时释放半启动子插件并保留可重试的错误。 */
  connect(name: 'mastergo' | 'reborn', spec: ConnectionSpec, cwd: string): Promise<void> {
    const task = this.queue.then(async () => {
      if (this.closed) throw new Error('设计工作室已卸载')
      await this.disconnectOne(name)
      if (!spec.command) throw new Error('MCP 启动命令为空')
      this.statuses[name] = { state: 'connecting', message: '正在连接' }
      let fiber: McpFiber | undefined
      try {
        fiber = await this.start({ serverName: 'design_' + name, transport: 'stdio', ...spec, cwd, env: spec.env ?? {}, toolCallTimeoutMs: toolCallTimeouts[name], failOnStartupError: true, reconnect: { enabled: false, initialDelayMs: 1000, maxDelayMs: 30000, maxAttempts: 3 } })
        this.pending.add(fiber)
        if (this.closed) throw new Error('设计工作室已卸载')
        await fiber.await()
        if (this.closed) throw new Error('设计工作室已卸载')
        const tools = (name === 'reborn' ? ['get_component'] : mastergoTools).filter(tool => this.hasTool(toolName(name, tool)))
        if (!tools.some(tool => name === 'reborn' || mastergoReaders.includes(tool))) throw new Error('MCP 未提供设计读取工具，请检查适配器的工具列表后重连')
        this.fibers.set(name, fiber)
        this.statuses[name] = { state: 'connected', message: '工具已就绪', tools }
      } catch (error) {
        if (fiber) await fiber.dispose()
        this.statuses[name] = { state: 'error', message: '连接失败，请检查启动命令、网络及桌面端文档后重连' }
        throw error
      } finally { if (fiber) this.pending.delete(fiber) }
    })
    this.queue = task.catch(() => {})
    return task
  }
  private async disconnectOne(name: 'mastergo' | 'reborn'): Promise<void> {
    const fiber = this.fibers.get(name)
    if (fiber) { await fiber.dispose(); this.fibers.delete(name) }
    this.statuses[name] = { state: 'disconnected', message: '已断开' }
  }
  /** 项目切换仅释放 MasterGo；省略名称时释放全部连接。 */
  async disconnect(name?: 'mastergo' | 'reborn'): Promise<void> {
    const task = this.queue.then(async () => { if (name) await this.disconnectOne(name); else { await this.disconnectOne('mastergo'); await this.disconnectOne('reborn') } })
    this.queue = task.catch(() => {})
    await task
  }
  /** 卸载后拒绝新连接。 */
  async dispose(): Promise<void> {
    this.closed = true
    await Promise.all([...this.pending].map(fiber => fiber.dispose()))
    await this.disconnect()
  }
}
