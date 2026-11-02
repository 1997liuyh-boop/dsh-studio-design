/** 工作室只传递配置与组件摘要，模型凭据由 dsh 保管。 */
export interface Project {
  root: string
  name: string
  framework: string
  platform: 'web' | 'uniapp'
  packageManager: string
  dependencies: Record<string, string>
  scripts: Record<string, string>
  config: Record<string, unknown>
  configFiles: string[]
  components: string[]
  warnings: string[]
}
/** 设计节点和代码组件显式关联，variant 由用户或模型确认。 */
export interface Mapping {
  node: string
  component: string
  source: 'project' | 'reborn' | 'custom'
  variant: string
}
/** 每个项目保存自己的映射与真实 dsh 会话标识。 */
export interface Workspace {
  schemaVersion: 1
  revision: string
  root: string
  sessionId: string
  mappings: Mapping[]
  previewUrl: string
}
export interface Component {
  id: string
  title: string
  description: string
  platforms: string[]
}
export interface ConnectionSpec {
  command: string
  args: string[]
}
export interface Settings {
  schemaVersion: 1
  projectRoot: string
  rebornRoot: string
  rebornSource?: 'builtin' | 'local' | 'github'
  rebornRepository?: string
  rebornRef?: string
  rebornCommit?: string
  rebornCachedRepository?: string
  rebornKnowledge?: boolean
  mastergo: ConnectionSpec
  reborn: ConnectionSpec
}
export interface ConnectionStatus {
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  message: string
}
export interface Snapshot {
  settings: Settings
  project: Project | null
  workspace: Workspace | null
  components: Component[]
  connections: Record<'mastergo' | 'reborn', ConnectionStatus>
  preview?: PreviewState
  source?: { kind: string; root: string; commit: string; repository: string; knowledge?: 'repository' | 'builtin' }
}

/** 只关联本工作室创建的后台任务，不接管外部服务。 */
export interface PreviewState {
  state: 'idle' | 'starting' | 'ready' | 'running' | 'completed' | 'failed' | 'killed' | 'stopping'
  jobId: string
  url: string
  log: string
  command: string
}
