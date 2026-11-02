import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { object, text } from './project.ts'
import type { Mapping, Settings, Workspace } from './types.ts'

/** 默认连接使用已锁定的 MasterGo 包及随插件分发的 Reborn MCP。 */
export function defaults(): Settings {
  return { schemaVersion: 1, projectRoot: '', rebornRoot: '', rebornSource: 'builtin', rebornRepository: 'https://github.com/1997liuyh-boop/Reborn-UI', rebornRef: 'main', rebornCommit: '', mastergo: { command: 'npx', args: ['-y', '@mastergo/vibe-mcp@1.0.32', '--url=http://127.0.0.1:30678'] }, reborn: { command: '', args: [] } }
}
/** 校验可持久化配置；命令按参数数组传给官方传输层。 */
export function settings(input: unknown): Settings {
  const value = object(input)
  if (value.schemaVersion !== 1) throw new Error('工作室配置版本不受支持')
  const connection = (input: unknown) => {
    const value = object(input)
    if (!Array.isArray(value.args) || value.args.length > 32) throw new Error('MCP 参数必须是 JSON 数组')
    return { command: text(value.command, 2048), args: value.args.map(item => text(item, 4096)) }
  }
  const rebornRoot = text(value.rebornRoot)
  const source = value.rebornSource ?? (rebornRoot ? 'local' : 'builtin')
  if (source !== 'builtin' && source !== 'local' && source !== 'github') throw new Error('未知 Reborn 资料来源')
  if (value.rebornKnowledge !== undefined && typeof value.rebornKnowledge !== 'boolean') throw new Error('Reborn 资料状态无效')
  return { schemaVersion: 1, projectRoot: text(value.projectRoot), rebornRoot, rebornSource: source, rebornRepository: text(value.rebornRepository ?? defaults().rebornRepository), rebornRef: text(value.rebornRef ?? 'main', 256), rebornCommit: text(value.rebornCommit ?? '', 64), rebornContentCommit: text(value.rebornContentCommit ?? '', 64), rebornCachedRepository: text(value.rebornCachedRepository ?? ''), rebornKnowledge: value.rebornKnowledge !== false, mastergo: connection(value.mastergo), reborn: connection(value.reborn) }
}
/** 预览只接受本机服务，隔离 iframe 不获得宿主同源权限。 */
export function previewUrl(input: unknown): string {
  const value = text(input, 2048)
  if (!value) return ''
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('预览地址仅支持本机 HTTP 服务')
  return url.href
}
/** 只保存显式映射，不把名称相近的组件自动当成相同组件。 */
export function mappings(input: unknown): Mapping[] {
  if (!Array.isArray(input) || input.length > 500) throw new Error('组件映射数量无效')
  const seen = new Set<string>()
  return input.map(item => {
    const row = object(item), node = text(row.node, 256).trim(), component = text(row.component, 512).trim()
    if (!node || !component || seen.has(node)) throw new Error('设计节点不能为空或重复，代码组件不能为空')
    seen.add(node)
    if (row.source !== 'project' && row.source !== 'reborn' && row.source !== 'custom') throw new Error('组件来源无效')
    return { node, component, source: row.source, variant: text(row.variant, 2000) }
  })
}

/** 文件存储按真实项目路径分区；进程内串行和 revision 防止多窗口覆盖。 */
export class Store {
  private queue = Promise.resolve()
  constructor(readonly dir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'studio/design')) {}
  private async read(name: string): Promise<unknown | null> {
    try { return JSON.parse(await readFile(join(this.dir, name), 'utf8')) }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error }
  }
  private async write(name: string, value: object): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const temp = join(this.dir, randomUUID() + '.tmp')
    try {
      await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      await rename(temp, join(this.dir, name))
    } finally { await rm(temp, { force: true }) }
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action)
    this.queue = result.then(() => {}, () => {})
    return result
  }
  /** 读取本地配置，损坏时报告错误而非覆盖。 */
  async loadSettings(): Promise<Settings> { const value = await this.read('settings.json'); return value === null ? defaults() : settings(value) }
  /** 保存配置并等待原子替换完成。 */
  saveSettings(value: Settings): Promise<void> { return this.serial(() => this.write('settings.json', settings(value))) }
  private key(root: string): string { return createHash('sha256').update(root).digest('hex') + '.json' }
  /** 校验磁盘上的映射、版本和会话标识。 */
  async workspace(root: string): Promise<Workspace> {
    const input = await this.read(this.key(root))
    if (input === null) return { schemaVersion: 1, root, revision: '', sessionId: '', mappings: [], previewUrl: '' }
    const value = object(input)
    if (value.schemaVersion !== 1 || value.root !== root) throw new Error('项目记录版本或目录不匹配')
    return { schemaVersion: 1, root, revision: text(value.revision, 64), sessionId: text(value.sessionId, 128), mappings: mappings(value.mappings), previewUrl: previewUrl(value.previewUrl) }
  }
  /** 拒绝旧版本保存，避免主窗口与其他窗口互相覆盖映射。 */
  saveWorkspace(root: string, input: unknown): Promise<Workspace> {
    return this.serial(async () => {
      const value = object(input), current = await this.workspace(root)
      if (value.revision !== current.revision) throw new Error('项目记录已更新，请刷新后再保存')
      const next: Workspace = { schemaVersion: 1, root, revision: randomUUID(), sessionId: text(value.sessionId, 128), mappings: mappings(value.mappings), previewUrl: previewUrl(value.previewUrl) }
      await this.write(this.key(root), next)
      return next
    })
  }
}
