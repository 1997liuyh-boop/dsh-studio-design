/** 仅请求主窗口已有目录能力，不向工作室暴露 Electron。 */
export function pickDirectory(): Promise<string | null> {
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
    window.parent.postMessage({ type: 'dsh:design:directory-pick', requestId }, location.origin)
  })
}
