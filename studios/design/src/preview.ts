/** 通过 dsh 既有 Shell 和 Jobs 管理预览进程，不在页面运行命令。 */
import type { Project, PreviewState } from './types.ts'

interface OutputRead { text: string; nextOffset: number; lossy: boolean }
interface Execution {
  status: string
  exitCode: number | null
  done: Promise<void>
  kill(): boolean
  observed: { stdout: { readFrom(offset: number): OutputRead }; stderr: { readFrom(offset: number): OutputRead } }
}
/** 与宿主公开能力对应的窄调用接口。 */
export interface PreviewHost {
  shell?: { resolve(input: object): object; execute(spec: object): Promise<Execution> }
  jobs?: {
    start(spec: { kind: 'bash'; label: string; owner: string; output: { channel: 'stdout' | 'stderr'; read(offset: number): OutputRead }[]; run(): { cancel(): void; done: Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string }> } }): string
    get(id: string, owner: string): { status: string }
    kill(id: string, owner: string, reason: string): string
  }
}
interface Running { owner: string; jobId: string; command: string; execution?: Execution; controller: AbortController; done: Promise<unknown>; error: string }

/** 本工作室创建的任务按真实项目隔离，关闭页面不创建第二个进程。 */
export class Previews {
  private entries = new Map<string, Running>()
  constructor(private host: PreviewHost) {}
  /** 返回当前项目进程、真实输出和从自身日志取得的本机地址。 */
  async snapshot(root: string): Promise<PreviewState> {
    const entry = this.entries.get(root)
    if (!entry || !this.host.jobs) return { state: 'idle', jobId: '', command: '', url: '', log: '' }
    const execution = entry.execution
    const log = [entry.error, execution?.observed.stdout.readFrom(0).text, execution?.observed.stderr.readFrom(0).text].filter(Boolean).join('\n').replace(/\x1b\[[0-9;]*m/g, '').slice(-64000)
    const status = this.host.jobs.get(entry.jobId, entry.owner).status
    const state = status === 'running' ? execution ? 'running' : 'starting' : ['completed', 'failed', 'killed', 'stopping'].includes(status) ? status as PreviewState['state'] : 'starting'
    let url = ''
    if (execution?.status === 'running') {
      const found = log.match(/http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+(?:\/[^\s\u001b<>]*)?/g)?.at(-1)
      if (found) {
        try { const response = await fetch(found, { signal: AbortSignal.timeout(1200), redirect: 'manual' }); await response.body?.cancel(); if (response.status < 500) url = found }
        catch (_notReady) { /* 服务尚未就绪，保留进程和日志。 */ }
      }
    }
    return { state: url ? 'ready' : state, jobId: entry.jobId, command: entry.command, url, log }
  }
  /** 用户明确选择已有脚本后启动，同项目已有活动任务时只返回状态。 */
  async start(project: Project, owner: string, script: string): Promise<PreviewState> {
    const shell = this.host.shell, jobs = this.host.jobs
    if (!shell || !jobs) throw new Error('当前宿主缺少 Shell 或 Jobs 服务，请在 dsh 会话中启动预览')
    if (!owner) throw new Error('请先创建项目会话')
    const previous = await this.snapshot(project.root)
    if (['starting', 'running', 'ready', 'stopping'].includes(previous.state)) return previous
    const manager = project.packageManager.split('@')[0]
    if (!['npm', 'pnpm', 'yarn', 'bun'].includes(manager) || !/^[\w:-]+$/.test(script) || !Object.hasOwn(project.scripts, script)) throw new Error('请选择项目已有的有效脚本')
    const command = manager + ' run ' + script, controller = new AbortController()
    const entry: Running = { owner, jobId: '', command, controller, done: Promise.resolve(), error: '' }
    const output = (channel: 'stdout' | 'stderr') => ({ channel, read: (offset: number): OutputRead => entry.execution?.observed[channel].readFrom(offset) ?? { text: '', nextOffset: offset, lossy: false } })
    entry.jobId = jobs.start({ kind: 'bash', label: '设计预览 · ' + project.name + ' · ' + command, owner, output: [output('stdout'), output('stderr')], run: () => {
      const done = (async () => {
        try {
          entry.execution = await shell.execute(shell.resolve({ command, workdir: project.root, onExpiry: 'none', signal: controller.signal, env: { HOST: '127.0.0.1' } }))
          await entry.execution.done
          return { status: controller.signal.aborted ? 'killed' as const : entry.execution.exitCode === 0 ? 'completed' as const : 'failed' as const, detail: 'exit code: ' + entry.execution.exitCode }
        } catch (failed) { entry.error = failed instanceof Error ? failed.message : '预览进程未能启动，请查看 dsh 日志'; return { status: controller.signal.aborted ? 'killed' as const : 'failed' as const, detail: entry.error } }
      })()
      entry.done = done
      return { done, cancel: () => { controller.abort(); entry.execution?.kill() } }
    } })
    this.entries.set(project.root, entry)
    return this.snapshot(project.root)
  }
  /** 只停止本工作室登记的当前项目任务。 */
  async stop(root: string): Promise<PreviewState> {
    const entry = this.entries.get(root)
    if (entry && this.host.jobs) this.host.jobs.kill(entry.jobId, entry.owner, '用户停止设计预览')
    return this.snapshot(root)
  }
  /** 卸载时取消并等待本工作室拥有的进程。 */
  async dispose(): Promise<void> {
    for (const entry of this.entries.values()) { entry.controller.abort(); entry.execution?.kill() }
    await Promise.all([...this.entries.values()].map(entry => entry.done))
    this.entries.clear()
  }
}
