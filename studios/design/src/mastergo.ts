import type { ConnectionSpec, Snapshot } from './types.ts'

/** 本机画布与远程团队文件采用各自的官方适配器。令牌仅通过进程环境传递。 */
export function mastergoSpec(address: string, version: string, service: 'vibe' | 'magic' = 'vibe'): ConnectionSpec {
  const url = new URL(address.trim())
  if (service === 'vibe' && (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Vibe 服务地址应为本机 HTTP 地址，例如 http://127.0.0.1:30678')
  if (service === 'magic' && (url.protocol !== 'https:' || url.hostname !== 'mastergo.com')) throw new Error('Magic 服务地址应为 https://mastergo.com')
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('服务地址只能填写来源地址，不含路径或凭据')
  if (!/^(?:latest|\d+\.\d+\.\d+(?:-[\w.-]+)?)$/.test(version)) throw new Error('适配器版本应为完整版本号或 latest')
  return { command: 'npx', args: ['-y', '@mastergo/' + service + '-mcp@' + version, '--url=' + url.origin] }
}

/** 额外参数留在自定义模式，避免表单改写用户命令。 */
export function mastergoForm(spec: ConnectionSpec): { mode: 'visual' | 'custom'; service: 'vibe' | 'magic'; address: string; version: string } {
  const fallback = { mode: 'custom' as const, service: 'vibe' as const, address: 'http://127.0.0.1:30678', version: 'latest' }
  if (!['npx', 'npx.cmd'].includes(spec.command) || spec.args.length !== 3 || spec.args[0] !== '-y') return fallback
  const match = spec.args[1].match(/^@mastergo\/(vibe|magic)-mcp@(.+)$/)
  if (!match || !spec.args[2].startsWith('--url=')) return fallback
  const service = match[1] === 'magic' ? 'magic' : 'vibe', version = match[2], address = spec.args[2].slice(6)
  try { mastergoSpec(address, version, service); return { mode: 'visual', service, address, version } }
  catch (error) { return fallback /* 不损坏无法由表单表示的配置。 */ }
}

/** 只读取本机状态中的画布标识，不向页面或模型暴露服务令牌。 */
export async function mastergoCanvas(spec: ConnectionSpec): Promise<NonNullable<Snapshot['mastergoCanvas']>> {
  const form = mastergoForm(spec)
  if (form.mode === 'custom') return { state: 'unavailable', message: '自定义连接：请通过实际设计读取工具验证文档' }
  if (form.service === 'magic') return { state: 'remote', message: 'Magic 读取远程团队文件，需要个人访问令牌和文件权限' }
  try {
    const response = await fetch(form.address + '/api/status', { signal: AbortSignal.timeout(2500), redirect: 'error' })
    if (!response.ok) throw new Error('status ' + response.status)
    const value = await response.json() as Record<string, unknown>
    const documentId = typeof value.documentId === 'string' ? value.documentId : ''
    const pageId = typeof value.documentPageId === 'string' ? value.documentPageId : ''
    return Number(value.wsClientNum) > 0 && documentId ? { state: 'ready', message: '画布已连接', documentId, pageId }
      : { state: 'offline', message: '服务已启动，画布未连接。请在 MasterGo 打开设计文件并开启该文件的 MCP' }
  } catch (error) { return { state: 'offline', message: '无法连接本机 MasterGo，请检查桌面端 MCP 地址和端口' } }
}

/** 从用户明确指定的 MasterGo 链接读取目标，不用当前选区替换它。 */
export function mastergoTarget(request: string): { fileId: string; pageId: string; nodeId: string } | null {
  const link = request.match(/https:\/\/mastergo\.com\/file\/\d+[^\s<>]*/)?.[0]
  if (!link) return null
  const url = new URL(link.replace(/&amp;/g, '&'))
  return { fileId: url.pathname.split('/')[2], pageId: url.searchParams.get('page_id') || '', nodeId: url.searchParams.get('layer_id') || '' }
}

/** 请求里的全部 MasterGo 链接（去重、保持顺序）：第一条是基础帧，其余是同一文件的状态画板。 */
export function mastergoTargets(request: string): { fileId: string; pageId: string; nodeId: string }[] {
  const seen = new Set<string>(), targets: { fileId: string; pageId: string; nodeId: string }[] = []
  for (const match of request.matchAll(/https:\/\/mastergo\.com\/file\/\d+[^\s<>]*/g)) {
    const target = mastergoTarget(match[0])
    if (!target) continue
    const key = target.fileId + '/' + target.pageId + '/' + target.nodeId
    if (!seen.has(key)) { seen.add(key); targets.push(target) }
  }
  return targets
}
