/** 仅请求主窗口已有目录能力，不向工作室暴露 Electron。 */
export function pickDirectory(kind: 'directory' | 'workspace' = 'directory'): Promise<string | null> {
  if (window.parent === window) return Promise.reject(new Error('请在 dsh 工作室中选择文件夹，或直接填写绝对路径'))
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('目录选择已超时，请重试')), 120000)
    const finish = (error?: Error, path: string | null = null) => {
      window.clearTimeout(timeout); window.removeEventListener('message', receive)
      if (error) reject(error); else resolve(path)
    }
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || ![location.origin, 'dsh-app://app'].includes(event.origin)) return
      const value = event.data
      if (value?.type !== 'dsh:design:directory-result' || value.requestId !== requestId) return
      if (typeof value.error === 'string') finish(new Error(value.error))
      else if (value.path === null || typeof value.path === 'string') finish(undefined, value.path)
    }
    window.addEventListener('message', receive)
    window.parent.postMessage({ type: 'dsh:design:directory-pick', requestId, kind }, location.origin)
  })
}

/** 请求主窗口正在显示的会话身份，不从旧项目配置推断。 */
export function workspaceContext(signal?: AbortSignal): Promise<{ sessionId: string; root: string } | null> {
  if (window.parent === window) return Promise.resolve(null)
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, context: { sessionId: string; root: string } | null = null) => {
      clearTimeout(timer); window.removeEventListener('message', receive); signal?.removeEventListener('abort', cancel)
      error ? reject(error) : resolve(context)
    }
    const cancel = () => finish(new Error('工作区读取已取消'))
    const timer = setTimeout(() => finish(new Error('主窗口工作区暂不可用，请刷新重试')), 5000)
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || ![location.origin, 'dsh-app://app'].includes(event.origin) || event.data?.type !== 'dsh:design:directory-result' || event.data.requestId !== requestId) return
      const value = event.data.context
      if (value === null) finish()
      else if (value && typeof value.sessionId === 'string' && typeof value.root === 'string') finish(undefined, value)
      else finish(new Error('主窗口工作区响应无效'))
    }
    window.addEventListener('message', receive); signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) { cancel(); return }
    window.parent.postMessage({ type: 'dsh:design:directory-pick', requestId, kind: 'context' }, location.origin)
  })
}
