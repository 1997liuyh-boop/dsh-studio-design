function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('会话响应无效')
  return value as Record<string, unknown>
}

/** 浏览器端 RPC 保持与 dsh 主窗口相同的会话协议。 */
export async function rpc(method: string, request: object, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const rpcId = crypto.randomUUID()
  const response = await fetch('/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: { request } } }), signal })
  if (!response.ok) throw new Error('dsh 请求失败：' + response.status)
  const envelope = object(await response.json()), result = object(envelope.result)
  if (envelope.rpcId !== rpcId || result.ok !== true) throw new Error('dsh 会话请求未完成，请查看主窗口')
  return object(result.value)
}
/** 按 requestId 关联本次回合，忽略旧记录与其他窗口的消息。 */
export class TurnReader {
  private turn?: number
  private target?: number
  private attempt?: string
  private text = ''
  constructor(private requestId: string, private publish: (text: string) => void) {}
  /** 返回 true 表示本次回合已确认完成；失败和中断以真实事件为准。 */
  frame(input: unknown): boolean {
    const frame = object(input)
    if (frame.type === 'event') {
      const event = object(frame.event), data = object(event.data)
      if (event.type === 'turn/start' && typeof data.turn === 'number') this.turn = data.turn
      if (event.type === 'user/message' && object(data.source).rpcId === this.requestId) this.target = this.turn
      if (this.target === undefined || data.turn !== this.target) return false
      if (event.type === 'assistant/message') {
        const content = object(data.message).content
        if (Array.isArray(content)) { this.text = content.map(item => { const block = object(item); return block.type === 'text' ? String(block.text) : '' }).filter(Boolean).join('\n'); this.publish(this.text) }
      }
      if (event.type === 'turn/end') {
        if (object(data.reason).kind !== 'completed') throw new Error('任务已停止或失败，请在 dsh 会话查看详情')
        return true
      }
    } else if (frame.type === 'assistant-stream') {
      const stream = object(frame.frame)
      if (stream.type === 'start' && this.target !== undefined && stream.turn === this.target) { this.attempt = String(stream.attemptId); this.text = '' }
      if (!this.attempt || stream.attemptId !== this.attempt) return false
      if (stream.type === 'chunk') {
        const chunk = object(stream.chunk)
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') { this.text += chunk.text; this.publish(this.text) }
      }
      if (stream.type === 'end' && object(stream.outcome).kind === 'abandoned') { this.text = ''; this.publish('本次生成已放弃，等待后续尝试…') }
    }
    return false
  }
}
/** 标准会话执行任务；流断开时明确标记结果未知，不自动重发。 */
export async function runSession(sessionId: string, prompt: string, publish: (text: string) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch('/.dsh/remote-stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId }, assistantStream: true } } } }), signal })
  if (!response.ok || !response.body) throw new Error('dsh 会话流不可用，请在 Windows 桌面端打开此工作室')
  const reader = response.body.getReader()
  try {
    const requestId = crypto.randomUUID(), turn = new TurnReader(requestId, publish)
    await rpc('session/prompt', { sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: prompt }] }, signal)
    let pending = ''
    const decoder = new TextDecoder()
    for (;;) {
      const chunk = await reader.read()
      pending += decoder.decode(chunk.value, { stream: !chunk.done })
      if (pending.length > 2_000_000) throw new Error('会话数据过大，请在主窗口继续查看')
      const lines = pending.split('\n'); pending = lines.pop() ?? ''
      for (const line of lines) if (line.trim() && turn.frame(JSON.parse(line))) return
      if (chunk.done) throw new Error('会话连接已断开，任务结果未知。请在主窗口确认，避免重复生成')
    }
  } finally { await reader.cancel().catch(error => console.debug('设计会话流已关闭', error)) }
}
