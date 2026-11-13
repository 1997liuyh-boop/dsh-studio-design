import type { ConnectionSpec, SetupTest, SetupTarget } from './types.ts'
import { mastergoAdapter, mastergoCanvas } from './mastergo.ts'

/**
 * 配置流程里各步骤的「测试连接」。只读探测，不改设置：
 * - 设计稿读取：Vibe 探测本机画布状态；Magic 用个人访问令牌请求一次 MasterGo MCP 接口，401 即令牌无效或权限不足；
 *   有项目会话时再真正启动适配器并核对读取工具（由调用方传入 connect）。
 * - 组件知识库与项目工作区由调用方完成具体动作，这里只负责把结果整理成卡片上的提示。
 */

/** Magic 令牌校验：随便请求一个不存在的节点，401 表示令牌缺失、无效或没有团队版席位，其余状态说明令牌被接受。 */
export async function checkMagicToken(address: string, token: string, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; message: string }> {
  if (!token) return { ok: false, message: '还没有填写个人访问令牌（MasterGo 个人设置 → 安全设置 → 个人访问令牌）' }
  const origin = new URL(address.trim()).origin
  let response: Response
  try { response = await fetcher(origin + '/mcp/meta?fileId=1&layerId=1:1', { headers: { Accept: 'application/json', 'X-MG-UserAccessToken': token }, signal: AbortSignal.timeout(15_000), redirect: 'error' }) }
  catch (error) { return { ok: false, message: '无法访问 ' + origin + '：' + (error instanceof Error ? error.message : String(error)) } }
  if (response.status === 401 || response.status === 403) {
    let message = ''
    try { message = String((await response.json() as { message?: unknown }).message ?? '') } catch { /* 返回体不是 JSON 时用通用说明 */ }
    return { ok: false, message: (message.replace(/^[^\p{L}\p{N}]+/u, '') || '令牌无效') + '（HTTP ' + response.status + '）' }
  }
  await response.body?.cancel()
  return { ok: true, message: '令牌有效，可读取有权限的团队文件' }
}

/**
 * 设计稿读取步骤的测试。
 * @param spec 当前保存的 MasterGo 连接。
 * @param token 已保存的 Magic 令牌（Vibe 不需要）。
 * @param connect 有项目会话时启动适配器并返回读取工具；没有会话时为 undefined，只做网络探测。
 */
export async function testMastergo(spec: ConnectionSpec, token: string, connect?: () => Promise<string[]>, fetcher: typeof fetch = fetch): Promise<SetupTest> {
  const adapter = mastergoAdapter(spec)
  const at = new Date().toISOString()
  let base: { ok: boolean; message: string }
  if (adapter?.service === 'magic') base = await checkMagicToken(adapter.address, token, fetcher)
  else if (adapter?.service === 'vibe') {
    const canvas = await mastergoCanvas(spec)
    base = canvas.state === 'ready' ? { ok: true, message: '画布已连接' + (canvas.documentId ? ' · 文件 ' + canvas.documentId : '') } : { ok: false, message: canvas.message }
  } else base = connect ? { ok: true, message: '自定义命令' } : { ok: false, message: '自定义命令需要在项目会话里测试：先在 dsh 打开项目会话再点测试' }
  if (!base.ok || !connect) return { target: 'mastergo', ok: base.ok, message: base.message + (base.ok && !connect ? '（未打开项目会话，未启动适配器）' : ''), at }
  try {
    const tools = await connect()
    return { target: 'mastergo', ok: true, message: base.message + ' · 适配器已启动，读取工具 ' + tools.length + ' 个', at }
  } catch (error) {
    return { target: 'mastergo', ok: false, message: base.message + '，但适配器启动失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 200), at }
  }
}

/** 把任意步骤的执行结果包装成卡片提示。 */
export async function runTest(target: SetupTarget, action: () => Promise<string>): Promise<SetupTest> {
  const at = new Date().toISOString()
  try { return { target, ok: true, message: await action(), at } }
  catch (error) { return { target, ok: false, message: (error instanceof Error ? error.message : String(error)).slice(0, 300), at } }
}
