/**
 * 宿主侧安装 Reborn 组件：映射命中但项目里没有的组件，在模型实现之前由工作室装进组件目录，
 * 模型不再在沙箱里跑包管理器。优先从本地 registry（Reborn-UI 仓库 packages/cli/registry 或配置目录）直接写文件，
 * 只报告缺失的 npm 依赖与共享文件，不执行安装命令；没有本地 registry 时退回 Reborn CLI 子进程。
 */
import { spawn } from 'node:child_process'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { object, readOptional } from './project.ts'

export interface InstallReport {
  /** 本次写入的组件。 */
  installed: string[]
  /** 项目里已有、未改动的组件。 */
  skipped: string[]
  failed: { id: string; reason: string }[]
  /** 组件引用但 package.json 没有的 npm 包，需在项目里安装。 */
  npmDependencies: string[]
  /** 组件引用但项目里没有的共享文件（@/lib、@/composables）。 */
  missingShared: string[]
  /** 组件写进的目录（项目相对路径）。 */
  componentsDir?: string
  method: 'registry' | 'cli' | 'none'
  registry?: string
}

interface RegistryFile { path: string; content: string; target?: string }
interface RegistryComponent { name: string; files: RegistryFile[] }

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true }
  catch (error) { return false }
}

/** 找本地 registry：显式目录 → 各根目录及其 packages/cli/registry；目录里需有 components/ 子目录。 */
export async function locateRegistry(options: { explicit?: string; roots: string[] }): Promise<string | undefined> {
  const candidates: string[] = []
  if (options.explicit) candidates.push(options.explicit, join(options.explicit, 'packages/cli/registry'))
  for (const root of options.roots.filter(Boolean)) candidates.push(root, join(root, 'packages/cli/registry'), join(root, 'registry'))
  for (const candidate of candidates) if (await exists(join(candidate, 'components'))) return candidate
  return undefined
}

/** 项目组件目录：components.json 的 componentsDir；已有 reborn-* 组件的目录优先，Nuxt 4 的 app/ 布局次之。 */
export async function componentsBase(root: string): Promise<{ dir: string; alias: string; lib: string }> {
  let componentsDir = 'components', alias = '@', lib = 'lib'
  const content = await readOptional(root, 'components.json').catch(() => null)
  if (content) {
    try {
      const config = object(JSON.parse(content))
      if (typeof config.componentsDir === 'string' && config.componentsDir.trim()) componentsDir = config.componentsDir.trim().replace(/^\.\//, '').replace(/\/+$/, '')
      if (typeof config.aliasSymbol === 'string' && config.aliasSymbol.trim()) alias = config.aliasSymbol.trim()
      if (typeof config.libDir === 'string' && config.libDir.trim()) lib = config.libDir.trim().replace(/^\.\//, '').replace(/\/+$/, '')
    } catch (error) { /* 配置无效时按默认目录 */ }
  }
  const bases = [componentsDir, 'app/' + componentsDir, 'src/' + componentsDir]
  for (const base of bases) {
    try { if ((await readdir(join(root, base))).some(entry => entry.startsWith('reborn-'))) return { dir: base, alias, lib: base.replace(/components$/, lib) } }
    catch (error) { /* 目录不存在 */ }
  }
  if (await exists(join(root, 'app')) && !await exists(join(root, componentsDir))) return { dir: 'app/' + componentsDir, alias, lib: 'app/' + lib }
  return { dir: componentsDir, alias, lib }
}

const componentImport = /["'](?:[@~]\/components|\.\.)\/([a-zA-Z0-9-]+)\//g
const sharedImport = /["'][@~]\/(lib|composables)\/([^"']+)["']/g
const bareImport = /\bfrom\s+["']([^"'./~#][^"']*)["']|\bimport\(\s*["']([^"'./~#][^"']*)["']\s*\)/g
const builtinModules = new Set(['vue', 'nuxt', 'vue-router', '#app', '#imports'])

function packageName(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

/**
 * 从本地 registry 安装组件及其引用的前置组件；已存在的文件不覆盖。
 * @returns 写入、跳过与失败的组件，以及需要的 npm 包与缺失的共享文件。
 */
export async function installFromRegistry(root: string, ids: string[], registry: string, platform: 'web' | 'uniapp' = 'web'): Promise<InstallReport> {
  const base = await componentsBase(root)
  const report: InstallReport = { installed: [], skipped: [], failed: [], npmDependencies: [], missingShared: [], componentsDir: base.dir, method: 'registry', registry }
  const pkg = await readOptional(root, 'package.json').then(content => content ? object(JSON.parse(content)) : {}).catch(() => ({} as Record<string, unknown>))
  const declared = new Set([...Object.keys(object(pkg.dependencies ?? {})), ...Object.keys(object(pkg.devDependencies ?? {}))])
  const npm = new Set<string>(), shared = new Set<string>(), queue = [...ids], seen = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    let component: RegistryComponent
    try { component = JSON.parse(await readFile(join(registry, 'components', id + '.json'), 'utf8')) as RegistryComponent }
    catch (error) { report.failed.push({ id, reason: 'registry 里没有该组件：' + join(registry, 'components', id + '.json') }); continue }
    const files = (component.files ?? []).filter(file => !file.target || file.target === platform)
    if (!files.length) { report.failed.push({ id, reason: '该组件没有 ' + platform + ' 平台文件' }); continue }
    const target = join(root, base.dir, id)
    let written = 0
    for (const file of files) {
      const path = join(target, ...file.path.split('/'))
      const content = file.content.replaceAll('@/', base.alias + '/')
      for (const match of content.matchAll(componentImport)) if (match[1] && match[1] !== id) queue.push(match[1])
      for (const match of content.matchAll(sharedImport)) shared.add(match[1] + '/' + match[2]!.replace(/\.(?:ts|js)$/, ''))
      for (const match of content.matchAll(bareImport)) {
        const specifier = match[1] ?? match[2] ?? ''
        // 别名路径（@/、~/）不是 npm 包。
        if (!specifier || specifier.startsWith('@/') || specifier.startsWith('~/')) continue
        const name = packageName(specifier)
        if (name && !builtinModules.has(name) && !declared.has(name)) npm.add(name)
      }
      if (await exists(path)) continue
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf8')
      written += 1
    }
    if (written) report.installed.push(id)
    else report.skipped.push(id)
  }
  for (const item of shared) {
    const [kind, ...rest] = item.split('/')
    const file = rest.join('/')
    const folder = kind === 'lib' ? base.lib : base.lib.replace(/lib$/, 'composables')
    const candidates = [file, file + '.ts', file + '.js', file + '/index.ts'].map(name => join(root, folder, name))
    let found = false
    for (const candidate of candidates) if (await exists(candidate)) { found = true; break }
    if (!found) report.missingShared.push(folder + '/' + file)
  }
  report.npmDependencies = [...npm].sort()
  report.missingShared.sort()
  return report
}

/** 退回 Reborn CLI：npx reborn-ui add，在宿主进程里运行（不经模型沙箱），只在没有本地 registry 时使用。 */
export async function installWithCli(root: string, ids: string[], options: { command?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<InstallReport> {
  const report: InstallReport = { installed: [], skipped: [], failed: [], npmDependencies: [], missingShared: [], method: 'cli' }
  if (!ids.length) return report
  const command = options.command ?? 'npx -y reborn-ui@latest'
  const [executable, ...prefix] = command.split(/\s+/)
  // 组件目录按项目实际布局（Nuxt 4 的 app/components 等）传给 CLI，不让它按 components.json 字面量写到根目录。
  const target = await componentsBase(root)
  const args = [...prefix, 'add', ...ids, '--yes', '--platform', 'web', '--cwd', root, '--components-dir', target.dir, '--lib-dir', target.lib]
  const output = await new Promise<{ code: number | null; text: string }>((resolve, reject) => {
    const child = spawn(executable!, args, { cwd: root, shell: process.platform === 'win32', windowsHide: true })
    let text = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Reborn CLI 超时')) }, options.timeoutMs ?? 240_000)
    const abort = () => { child.kill(); reject(new Error('已取消')) }
    options.signal?.addEventListener('abort', abort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => { text += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { text += chunk.toString() })
    child.on('error', error => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); reject(error) })
    child.on('close', code => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); resolve({ code, text }) })
  }).catch(error => ({ code: -1, text: error instanceof Error ? error.message : String(error) }))
  const base = await componentsBase(root)
  report.componentsDir = base.dir
  for (const id of ids) {
    if (await exists(join(root, base.dir, id))) report.installed.push(id)
    else report.failed.push({ id, reason: 'Reborn CLI 退出码 ' + output.code + '：' + output.text.replace(/\s+/g, ' ').slice(-300) })
  }
  return report
}

/**
 * 安装项目里缺失的组件：已存在的跳过；有本地 registry 时写文件，否则用 CLI。
 * @param ids 映射命中的组件（含伴随组件）。
 */
export async function installComponents(root: string, ids: string[], options: { registry?: string; cli?: string; signal?: AbortSignal }): Promise<InstallReport> {
  const unique = [...new Set(ids)].filter(id => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(id))
  const base = await componentsBase(root)
  const missing: string[] = [], present: string[] = []
  for (const id of unique) (await exists(join(root, base.dir, id)) ? present : missing).push(id)
  if (!missing.length) return { installed: [], skipped: present, failed: [], npmDependencies: [], missingShared: [], componentsDir: base.dir, method: 'none' }
  const report = options.registry ? await installFromRegistry(root, missing, options.registry) : await installWithCli(root, missing, { command: options.cli, signal: options.signal })
  report.skipped.push(...present)
  return report
}
