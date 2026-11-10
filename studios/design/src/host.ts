import type { IncomingMessage, ServerResponse } from 'node:http'
import type { McpFiber } from './connections.ts'
import type { participation } from './participation.ts'

/** 宿主工具运行时的嵌套调用入参：工作室用它在 design_workspace 内部读取 MasterGo，不绕过审批与策略。 */
export interface ToolCallInput {
  callId: string
  rootCallId?: string
  name: string
  arguments: unknown
  agent?: DesignAgent
  /** 外层执行令牌；PTC 模式下只有带 parent 的调用才能执行原生工具名。 */
  parent?: symbol
  /** 外层步骤的工具准入集，保持原对象与 Agent 作用域。 */
  toolSet?: object
  signal: AbortSignal
}
/** 宿主工具运行时的结果：成功带 value / content，失败带 error。 */
export interface ToolCallOutcome {
  isError: boolean
  value?: unknown
  content?: { type: string; text?: string }[]
  error?: { message: string; code?: string }
  additionalContexts?: readonly unknown[]
  concludesTurn?: true
}
/** 宿主公开执行入口接收原始调用批次；嵌套调用使用共享流水线。 */
export interface ToolBatchInput {
  calls: readonly { type: 'tool_call'; id: string; name: string; arguments: string }[]
  signal: AbortSignal
  agent?: DesignAgent
  toolSet?: object
}
export interface ToolBatchOutcome {
  results: readonly { callId: string; result: ToolCallOutcome }[]
  additionalContexts: readonly unknown[]
  concluded: boolean
}
/** 独立插件仅声明使用的宿主能力，不复制宿主服务实现。 */
export interface AgentContext {
  plugin(plugin: object, config: Record<string, unknown>): McpFiber
  effect(callback: () => (() => void | Promise<void>), label: string): void
  tools: { get(name: string, scope?: DesignAgent): object | undefined; execute?(input: ToolBatchInput): Promise<ToolBatchOutcome> }
}
export interface DesignAgent {
  session: { id: string; header: { cwd?: string }; requestHeader?(): { config: { provider?: string; model?: string } } | undefined }
  ctx: AgentContext
}
/** 工具执行上下文；callId / rootCallId / token 由宿主提供，嵌套调用时原样向下传。 */
export interface Execution {
  agent?: DesignAgent
  signal: AbortSignal
  callId: string
  rootCallId: string
  token: symbol
  toolSet?: object
  deferContext(context: unknown): void
  concludeTurn(): void
}
export interface DesignTool {
  name: string
  description: string
  parameters: object
  output: { schema: object; render(args: unknown, value: unknown): { type: 'text'; text: string }[] }
  execute(args: unknown, execution: Execution): Promise<string>
  presentCall(args: unknown): object
}
export interface Host extends AgentContext {
  get(name: string): unknown
  studioProjects: { register(page: { id: string; root: string; name: string; icon: string; description: string; tasks?: { id: string; label: string; description?: string; text: string }[]; handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> }): () => void }
  tools: AgentContext['tools'] & { register(tool: DesignTool): () => void }
  sessionProjections: { register(definition: typeof participation): () => void }
  systemPrompt: { section(section: { name: string; order: number; interpolate: false; text: string }): () => void }
}
