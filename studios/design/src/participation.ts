import z from 'zod'

/** 参与标记只来自已提交的消息或工具调用，选择候选词不会激活。 */
export interface Participation { mentioned: boolean }
interface Event { type: string; data: { source?: { kind: string }; content?: { type: string; text?: string }[]; name?: string } }
const schema = z.object({ mentioned: z.boolean() }).strict()

/** 由宿主投影驱动，历史恢复和切换会话时保持一致。 */
export const participation = {
  key: 'studioDesign', stateVersion: 1, stateSchema: schema,
  init: (): Participation => ({ mentioned: false }),
  apply(state: Participation, event: Event): Participation {
    if (state.mentioned) return state
    const selected = event.type === 'user/message' && event.data.source?.kind === 'user' && event.data.content?.some(block => block.type === 'text' && /@(?:工作室:design\b|设计工作室)/u.test(block.text ?? ''))
    const invoked = ['tool/call', 'tool/ptc-dispatch-start'].includes(event.type) && event.data.name === 'design_workspace'
    return selected || invoked ? { mentioned: true } : state
  },
  wire: { viewSchema: schema, view: (state: Participation) => state },
}
