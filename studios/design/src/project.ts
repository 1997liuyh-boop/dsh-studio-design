import { readFile, realpath, stat, readdir } from 'node:fs/promises'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import type { Project, Component } from './types.ts'

/** 解析磁盘与请求中的 JSON 对象，拒绝数组与空值。 */
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('需要 JSON 对象')
  return value as Record<string, unknown>
}
/** 限制输入长度，不修改用户输入的文件路径。 */
export function text(value: unknown, max = 4096): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new Error('文字参数无效')
  return value
}
/** 只读取已选根目录内的真实文件，阻止符号链接越界。 */
export async function inside(root: string, path: string): Promise<string> {
  const resolved = await realpath(resolve(root, path))
  const difference = relative(root, resolved)
  if (difference === '..' || difference.startsWith('..' + sep) || isAbsolute(difference)) throw new Error('文件超出项目目录')
  return resolved
}
/** 有界读取，缺失文件可忽略，其余读取失败必须显示。 */
export async function readOptional(root: string, path: string, limit = 512_000): Promise<string | null> {
  let file: string
  try { file = await inside(root, path) }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error }
  if ((await stat(file)).size > limit) throw new Error('文件过大：' + path)
  return readFile(file, 'utf8')
}
function strings(value: unknown): Record<string, string> {
  if (value === undefined) return {}
  return Object.fromEntries(Object.entries(object(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

/** 读取配置和组件名，不导入或执行目标项目的 JavaScript 配置。 */
export async function inspectProject(input: string): Promise<Project> {
  if (!isAbsolute(input)) throw new Error('请选择项目的绝对目录')
  const root = await realpath(input)
  const content = await readOptional(root, 'package.json')
  if (!content) throw new Error('目录下没有 package.json')
  const pkg = object(JSON.parse(content))
  const dependencies = { ...strings(pkg.dependencies), ...strings(pkg.devDependencies) }
  const platform = '@dcloudio/uni-app' in dependencies ? 'uniapp' : 'web'
  const framework = 'nuxt' in dependencies ? 'Nuxt' : 'vue' in dependencies ? 'Vue' : '未知'
  const configFiles: string[] = [], warnings: string[] = []
  const config: Record<string, unknown> = {}
  for (const name of ['components.json', 'shadcn-docs.json', 'tsconfig.json', 'jsconfig.json', 'nuxt.config.ts', 'vite.config.ts', 'tailwind.config.ts', 'tailwind.config.js', 'src/style.css', 'src/assets/main.css', 'app/assets/theme/base.css']) {
    const value = await readOptional(root, name)
    if (value === null) continue
    configFiles.push(name)
    if (name === 'components.json' || name === 'shadcn-docs.json') config[name] = object(JSON.parse(value))
    else config[name] = value
  }
  if (platform === 'uniapp') warnings.push('首版仅生成 Vue Web；UniApp 的组件与 rpx 规则需要单独适配')
  if (framework === '未知') warnings.push('未检测到 Vue 或 Nuxt，请确认项目目录')
  if (!configFiles.includes('components.json')) warnings.push('没有 components.json，生成时先确认组件目录、别名与主题，禁止盲目初始化覆盖项目')
  const reborn = config['components.json'] ? object(config['components.json']) : {}
  const componentRoot = typeof reborn.componentsDir === 'string' ? reborn.componentsDir : framework === 'Nuxt' ? 'app/components' : 'src/components'
  const components: string[] = []
  async function scan(dir: string, depth: number): Promise<void> {
    let path: string
    try { path = await inside(root, dir) }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return; throw error }
    const files = await readdir(path, { withFileTypes: true })
    for (const item of files) {
      if (components.length >= 500) { warnings.push('组件摘要最多列出 500 项，请在生成时继续查找目标组件'); return }
      if (item.isSymbolicLink()) continue
      const child = dir + '/' + item.name
      if (item.isFile() && item.name.endsWith('.vue')) components.push(child)
      else if (item.isDirectory() && depth < 3 && !item.name.startsWith('.')) await scan(child, depth + 1)
    }
  }
  await scan(componentRoot, 0)
  return { root, name: typeof pkg.name === 'string' ? pkg.name : root, framework, platform, packageManager: typeof pkg.packageManager === 'string' ? pkg.packageManager : await readOptional(root, 'pnpm-lock.yaml', 20_000_000) !== null ? 'pnpm' : 'npm', dependencies, scripts: strings(pkg.scripts), config, configFiles, components, warnings }
}

/** 使用固定知识库索引提供候选；真实参数和示例仍通过 Reborn MCP 查询。 */
export async function catalog(root: string): Promise<Component[]> {
  const value = object(JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8')))
  if (!Array.isArray(value.components) || value.components.length > 2000) throw new Error('Reborn 索引无效')
  return value.components.map(item => {
    const entry = object(item)
    return { id: text(entry.id, 128), title: text(entry.title ?? entry.id, 256), description: text(entry.description ?? '', 2000), platforms: Array.isArray(entry.platforms) ? entry.platforms.map(item => text(item, 32)) : [] }
  })
}
