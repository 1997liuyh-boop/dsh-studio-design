import type { IncomingMessage, ServerResponse } from 'node:http'
import type { McpFiber } from './connections.ts'
import type { participation } from './participation.ts'

/** 独立插件仅声明使用的宿主能力，不复制宿主服务实现。 */
export interface AgentContext {
  plugin(plugin: object, config: Record<string, unknown>): McpFiber
  effect(callback: () => (() => void | Promise<void>), label: string): void
  tools: { get(name: string, scope?: DesignAgent): object | undefined }
}
export interface DesignAgent {
  session: { id: string; header: { cwd?: string } }
  ctx: AgentContext
}
export interface Execution { agent?: DesignAgent; signal: AbortSignal }
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
  studioProjects: { register(page: { id: string; root: string; name: string; icon: string; description: string; handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> }): () => void }
  tools: AgentContext['tools'] & { register(tool: DesignTool): () => void }
  sessionProjections: { register(definition: typeof participation): () => void }
  systemPrompt: { section(section: { name: string; order: number; interpolate: false; text: string }): () => void }
}
