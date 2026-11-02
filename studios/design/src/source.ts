/** GitHub 资料缓存只获取文件，不执行仓库脚本、包安装或自定义钩子。 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm, realpath, stat } from 'node:fs/promises'
import { join, relative, isAbsolute, basename, dirname } from 'node:path'
import { promisify } from 'node:util'
import { catalog, readOptional, object } from './project.ts'

const execute = promisify(execFile)

/** 接受源码根、MCP 分发目录或直接选择的 knowledge 目录。 */
export async function locateSource(input: string, allowUnbuilt = false): Promise<{ root: string; knowledge: boolean; contentCommit: string }> {
  const root = await realpath(input)
  const candidates = basename(root) === 'knowledge' ? [dirname(root)] : [root, join(root, 'upstream/reborn'), join(root, 'packages/mcp')]
  for (const candidate of candidates) {
    const difference = relative(root, candidate)
    if (basename(root) !== 'knowledge' && (difference.startsWith('..') || isAbsolute(difference))) throw new Error('知识库目录越界')
    let index: string | null
    try { index = await readOptional(candidate, 'knowledge/index.json') }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue; throw error }
    if (index === null) continue
    const knowledge = await validateSource(candidate, allowUnbuilt)
    const metadata = await readOptional(candidate, 'REBORN-SOURCE.json')
    const commit = metadata === null ? '' : object(JSON.parse(metadata)).commit
    if (commit !== '' && (typeof commit !== 'string' || !/^[a-f0-9]{40,64}$/.test(commit))) throw new Error('Reborn 源码版本无效')
    return { root: await realpath(candidate), knowledge, contentCommit: String(commit) }
  }
  throw new Error('目录中没有 Reborn 知识库，请选择源码根、完整知识包或 knowledge 目录')
}

/** 检查组件与示例均为所选目录中的可读取资料。 */
export async function validateSource(root: string, allowUnbuilt = false): Promise<boolean> {
  root = await realpath(root)
  const entries = await catalog(join(root, 'knowledge'))
  if (!entries.length) throw new Error('Reborn 知识库没有组件')
  try { await stat(join(root, 'knowledge/components')) }
  catch (error) {
    if (allowUnbuilt && error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw new Error('Reborn 仓库没有生成后的 knowledge/components，请使用内置资料或选择已生成知识库的本地目录', { cause: error })
  }
  for (const entry of entries) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entry.id)) throw new Error('Reborn 组件标识无效')
    const content = await readOptional(root, 'knowledge/components/' + entry.id + '.json', 2000000)
    if (!content) throw new Error('Reborn 组件资料缺失：' + entry.id)
    const data = object(JSON.parse(content))
    if (Array.isArray(data.examples)) for (const input of data.examples) {
      const example = object(input)
      if (example.code || !example.path) continue
      if (typeof example.path !== 'string' || !await readOptional(root, example.path)) throw new Error('Reborn 示例路径无效或文件缺失')
    }
  }
  return true
}

/** 只接受无凭据、无查询参数的 GitHub 仓库地址。 */
export function repositoryUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || !/^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(url.pathname)) throw new Error('请填写 GitHub HTTPS 仓库地址')
  return 'https://github.com' + url.pathname.replace(/\/$/, '').replace(/\.git$/, '') + '.git'
}

/**
 * 解析到具体提交并保存经过检查的知识库，失败保持旧版本。
 * @param base - 工作室拥有的缓存根目录。
 * @param repository - GitHub 仓库。
 * @param ref - 分支、标签或提交。
 * @param signal - 工作室生命周期。
 * @returns 本地源码目录和固定提交。
 */
export async function syncSource(base: string, repository: string, ref: string, signal: AbortSignal): Promise<{ root: string; commit: string; knowledge: boolean; contentCommit: string }> {
  const url = repositoryUrl(repository)
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(90000)])
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(ref) || ref.includes('..')) throw new Error('分支、标签或提交格式无效')
  await mkdir(base, { recursive: true })
  const temporary = await mkdtemp(join(base, 'fetch-'))
  const hooks = join(temporary, 'disabled-hooks'), root = join(temporary, 'source')
  await mkdir(hooks)
  const git = async (args: string[], cwd = temporary) => execute('git', ['-c', 'core.hooksPath=' + hooks, '-c', 'core.symlinks=false', ...args], { cwd, signal: deadline, timeout: 90000, maxBuffer: 1000000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(temporary, 'no-global-config') } })
  try {
    await git(['clone', '--no-checkout', '--depth=1', '--', url, root])
    await git(['fetch', '--depth=1', 'origin', ref], root)
    await git(['checkout', '--detach', 'FETCH_HEAD'], root)
    const commit = (await git(['rev-parse', 'HEAD'], root)).stdout.trim()
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('无法确认 Reborn 版本')
    const source = await locateSource(root, true)
    const target = join(base, commit)
    try { await rename(root, target) }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && ['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(String(error.code)))) throw error
      await locateSource(target, true)
    }
    return { ...source, root: join(target, relative(root, source.root)), commit }
  } catch (error) {
    if (signal.aborted) throw new Error('资料获取已取消')
    throw new Error('无法获取或验证 GitHub 知识库，请检查网络、Git 和分支；当前资料保持原版本', { cause: error })
  } finally {
    const child = relative(base, temporary)
    if (child && !child.startsWith('..') && !isAbsolute(child)) await rm(temporary, { recursive: true, force: true })
  }
}
