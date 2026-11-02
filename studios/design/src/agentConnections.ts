import { Connections, type StartMcp } from './connections.ts'
import type { DesignAgent } from './host.ts'

/** 每个会话的 MasterGo 子插件注册在该 Agent 内，目录不会受页面切换影响。 */
export class AgentConnections {
  private entries = new Map<DesignAgent, Connections>()
  private closed = false
  constructor(private start: (agent: DesignAgent) => StartMcp, private hasTool: (agent: DesignAgent, name: string) => boolean) {}
  get(agent: DesignAgent): Connections {
    if (this.closed) throw new Error('设计工作室正在卸载')
    const previous = this.entries.get(agent)
    if (previous) return previous
    const connection = new Connections(this.start(agent), name => this.hasTool(agent, name))
    agent.ctx.effect(() => async () => { this.entries.delete(agent); await connection.dispose() }, '设计工作室：释放会话连接')
    this.entries.set(agent, connection)
    return connection
  }
  peek(agent: DesignAgent): Connections | undefined { return this.entries.get(agent) }
  async reset(): Promise<void> {
    const entries = [...this.entries.values()]
    this.entries.clear()
    await Promise.all(entries.map(value => value.dispose()))
  }
  async dispose(): Promise<void> { this.closed = true; await this.reset() }
}
