import type { ConnectionSpec } from './types.ts'

/** 可视化连接只访问本机 MasterGo；自定义命令继续保留原始参数。 */
export function mastergoSpec(address: string, version: string): ConnectionSpec {
  const url = new URL(address.trim())
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('MasterGo 服务地址应为本机 HTTP 地址，例如 http://127.0.0.1:30678')
  if (!/^(?:latest|\d+\.\d+\.\d+(?:-[\w.-]+)?)$/.test(version)) throw new Error('适配器版本应为完整版本号或 latest')
  return { command: 'npx', args: ['-y', '@mastergo/vibe-mcp@' + version, '--url=' + url.origin] }
}

/** 旧版标准命令可直接显示为表单，额外参数必须保留在自定义模式。 */
export function mastergoForm(spec: ConnectionSpec): { mode: 'visual' | 'custom'; address: string; version: string } {
  const fallback = { mode: 'custom' as const, address: 'http://127.0.0.1:30678', version: '1.0.32' }
  if (!['npx', 'npx.cmd'].includes(spec.command) || spec.args.length !== 3 || spec.args[0] !== '-y') return fallback
  const version = spec.args[1].match(/^@mastergo\/vibe-mcp@(.+)$/)?.[1]
  if (!version || !spec.args[2].startsWith('--url=')) return fallback
  const address = spec.args[2].slice(6)
  try { mastergoSpec(address, version); return { mode: 'visual', address, version } }
  catch (error) { return fallback /* 保留不能由可视化表单完整表示的旧配置。 */ }
}
