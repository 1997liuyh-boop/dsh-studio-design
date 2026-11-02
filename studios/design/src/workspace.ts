/** 仅读取主视图已经持有的会话，不创建全局当前会话，也不打开其他历史。 */
export interface WorkspaceSessions {
  list: { getSnapshot(): { byId: Record<string, { cwd?: string; retainedBy: Readonly<Partial<Record<'mainView', number>>> }> } }
}

/** 多个主视图或未选择工作区时拒绝猜测项目，交由用户选择文件夹。 */
export function currentWorkspace(sessions: WorkspaceSessions): string {
  const rows = Object.values(sessions.list.getSnapshot().byId).filter(row => (row.retainedBy.mainView ?? 0) > 0)
  if (rows.length !== 1 || !rows[0].cwd) throw new Error('请先在 dsh 工作区打开项目会话，或使用“选择文件夹”')
  return rows[0].cwd
}
