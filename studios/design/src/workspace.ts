/** 仅读取主视图已经持有的会话，不创建全局当前会话，也不打开其他历史。 */
export interface WorkspaceSessions {
  list: { getSnapshot(): { byId: Record<string, { cwd?: string; retainedBy: Readonly<Partial<Record<'mainView', number>>> }> }; subscribe?(listener: () => void): () => void }
}

/** 多个主视图或未选择工作区时拒绝猜测项目，交由用户选择文件夹。 */
export function currentWorkspace(sessions: WorkspaceSessions): string {
  return currentContext(sessions).root
}

/** 返回明确的主视图会话；多个工作区存在时仍只采用当前会话。 */
export function currentContext(sessions: WorkspaceSessions): { sessionId: string; root: string } {
  const rows = Object.entries(sessions.list.getSnapshot().byId).filter(([, row]) => (row.retainedBy.mainView ?? 0) > 0)
  if (rows.length !== 1 || !rows[0][1].cwd) throw new Error('请先在 dsh 工作区打开项目会话')
  return { sessionId: rows[0][0], root: rows[0][1].cwd }
}
