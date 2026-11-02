/** 设计工作室卡片与受限的目录选择桥接。 */
import { apply as applyCard } from '../../../packages/sdk/client.tsx'
import { currentWorkspace, type WorkspaceSessions } from './workspace.ts'
export const inject = ['slots', 'sessions']

/** 只为当前可见的设计工作室页面请求宿主目录选择。 */
export function apply(ctx: Parameters<typeof applyCard>[0] & { sessions: WorkspaceSessions }): void {
  applyCard(ctx)
  const sessions = ctx.sessions
  ctx.effect(() => {
    let active = true, pending = false
    const receive = async (event: MessageEvent) => {
      if (!active || pending || event.origin !== location.origin || event.data?.type !== 'dsh:design:directory-pick' || typeof event.data.requestId !== 'string' || event.data.requestId.length > 64) return
      const frame = [...document.querySelectorAll('iframe')].find(item => item.contentWindow === event.source && new URL(item.src, location.href).pathname.replace(/\/$/, '') === '/studio-projects/design' && item.getClientRects().length > 0)
      if (!frame?.contentWindow) return
      const source = frame.contentWindow, requestId = event.data.requestId
      pending = true
      try {
        const native = (window as Window & { __DSH_DIRECTORY_PICKER__?: { pick(): Promise<string | null> } }).__DSH_DIRECTORY_PICKER__
        let path: string | null
        if (event.data.kind === 'workspace') path = currentWorkspace(sessions)
        else if (native) path = await native.pick()
        else {
          const rpcId = crypto.randomUUID()
          const response = await fetch('/api/directoryPicker/pick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId, method: 'directoryPicker/pick', payload: { args: {} } }) })
          const result = await response.json()
          if (!response.ok || result.rpcId !== rpcId || !result.result?.ok) throw new Error('此宿主暂不支持弹出目录选择，请填写绝对路径')
          path = result.result.value
        }
        if (active && frame.isConnected && frame.contentWindow === source) source.postMessage({ type: 'dsh:design:directory-result', requestId, path }, event.origin)
      } catch (error) {
        if (active && frame.isConnected) source.postMessage({ type: 'dsh:design:directory-result', requestId, error: error instanceof Error ? error.message : '目录选择失败' }, event.origin)
      } finally { pending = false }
    }
    window.addEventListener('message', receive)
    return () => { active = false; window.removeEventListener('message', receive) }
  }, '设计工作室：目录选择桥接')
}
