/** 设计工作室卡片与受限的目录选择桥接。 */
import { apply as applyCard } from '../../../packages/sdk/client.tsx'
import { currentContext, currentWorkspace, type WorkspaceSessions } from './workspace.ts'
import type { Participation } from './participation.ts'
declare const DESIGN_CLIENT_CSS: string
declare const STUDIO_PROJECT: { name: string; icon: string }
interface BadgeProps { useProjection(key: string): Participation | undefined; label: string }
interface RowProps {
  sessionId: string; label: string; icon: string
  useSessions<T>(selector: (state: { byId: Record<string, { projectionValues?: { studioDesign?: Participation } }> }) => T): T
}
type DesignClient = Parameters<typeof applyCard>[0] & {
  sessions: WorkspaceSessions
  slots: { register(options: { name: string; id: string; order: number; inject(): { label: string } }, component: typeof StudioBadge): () => void }
  & { register(options: { name: string; id: string; order: number; inject(): { label: string; icon: string } }, component: typeof StudioRowMark | typeof StudioRowHover): () => void }
}
/** 只显示已进入会话日志的参与关系，不将它作为运行状态。 */
function StudioBadge({ useProjection, label }: BadgeProps) {
  const state = useProjection('studioDesign')
  return state?.mentioned ? <span data-studio-participant="design" className="sd:rounded-md sd:border sd:border-(--dsw-alias-border-primary,#e2e6ed) sd:px-2 sd:py-1 sd:text-xs sd:text-(--dsw-alias-label-secondary,#636e7d)" title={label}>{label}</span> : null
}
/** 侧边栏仅读取列表已有投影，不为显示标记打开历史会话。 */
function StudioRowMark({ sessionId, useSessions, label, icon }: RowProps) {
  const included = useSessions(state => state.byId[sessionId]?.projectionValues?.studioDesign?.mentioned === true)
  return included ? <span data-studio-row="design" title={label} className="sd:inline-flex sd:items-center sd:text-xs">{icon}</span> : null
}
/** 悬停卡片中的名称沿用同一会话的宿主投影。 */
function StudioRowHover({ sessionId, useSessions, label }: RowProps) {
  const included = useSessions(state => state.byId[sessionId]?.projectionValues?.studioDesign?.mentioned === true)
  return included ? <span className="sd:text-xs">{label}</span> : null
}
export const inject = ['slots', 'sessions']

/** 只为当前可见的设计工作室页面请求宿主目录选择。 */
export function apply(ctx: DesignClient): void {
  applyCard(ctx)
  const sessions = ctx.sessions
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = DESIGN_CLIENT_CSS; document.head.appendChild(style); return () => style.remove() }, '设计工作室：参与标记样式')
  // 独立插件的附加插槽遵循宿主标准投影钩子，不自行读取会话日志。
  const slots = ctx.slots
  slots.inject('conversation.session.header.actions', () => slots.register({ name: 'conversation.session.header.actions', id: 'studio-design-participation', order: 120, inject: () => ({ label: STUDIO_PROJECT.name }) }, StudioBadge), '设计工作室：参与标记')
  for (const [name, component] of [['sidebar.session.row.leading', StudioRowMark], ['sidebar.session.row.hover', StudioRowHover]] as const) {
    slots.inject(name, () => slots.register({ name, id: 'studio-design-participation', order: 30, inject: () => ({ label: STUDIO_PROJECT.name, icon: STUDIO_PROJECT.icon }) }, component), '设计工作室：工作区会话标记')
  }
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
        if (event.data.kind === 'context') {
          let context = null
          try { context = currentContext(sessions) } catch (error) { /* 空工作区不沿用之前的项目。 */ }
          source.postMessage({ type: 'dsh:design:directory-result', requestId, context }, event.origin)
          return
        }
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
