/**
 * 已安装 Reborn 组件的取值核对：读取目标项目里组件的 *.config.ts，取出 variants 枚举与 as const 常量数组，
 * 再对照 Vue 模板上写死的 size / variant / color 等取值。知识库合并了两端，项目内安装的配置才是本端真值。
 * 另外按映射表核对：命中的设计实例必须在已登记的实现文件里出现对应组件标签。
 */
import { object, readOptional } from './project.ts'
import { matchManifest, type BlocksWithComponents } from './componentMap.ts'
import { loadComponentMap } from './componentMapStore.ts'

/** 一个组件的配置枚举：prop 名 → 可用取值。 */
export interface InstalledConfig { path: string; enums: Map<string, string[]> }

/** 去掉注释，避免注释里的花括号与键名干扰解析；字符串里的 // 只在前面是空白、括号或行首时才当注释。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s(,])\/\/[^\n]*/g, '$1')
}

/** 从 open 处的括号开始找到配对的闭括号，跳过字符串与模板串；找不到返回 -1。 */
function closing(source: string, open: number): number {
  let depth = 0, quote = ''
  for (let i = open; i < source.length; i += 1) {
    const char = source[i]!
    if (quote) { if (char === '\\') i += 1; else if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '{' || char === '[' || char === '(') depth += 1
    else if (char === '}' || char === ']' || char === ')') { depth -= 1; if (depth === 0) return i }
  }
  return -1
}

/** 对象字面量正文按顶层逗号切成 键 → 值文本；键可以是标识符或引号字符串。 */
function objectEntries(body: string): { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = []
  let depth = 0, quote = '', start = 0
  const push = (piece: string) => {
    const match = /^\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z_$][\w$-]*))\s*:\s*([\s\S]*)$/.exec(piece)
    if (match) entries.push({ key: match[1] ?? match[2] ?? match[3]!, value: match[4]!.trim() })
  }
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]!
    if (quote) { if (char === '\\') i += 1; else if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '{' || char === '[' || char === '(') depth += 1
    else if (char === '}' || char === ']' || char === ')') depth -= 1
    else if (char === ',' && depth === 0) { push(body.slice(start, i)); start = i + 1 }
  }
  push(body.slice(start))
  return entries
}

/** 常量名归一成 prop 名：去掉组件名前缀与复数，如 buttonSizes → size、chipPositions → position、sizes → size。 */
function propNameOf(constant: string, id: string): string {
  const prefix = id.replace(/^reborn-/, '').replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
  let name = constant
  if (name.toLowerCase().startsWith(prefix.toLowerCase()) && name.length > prefix.length) name = name.slice(prefix.length)
  name = name[0]!.toLowerCase() + name.slice(1)
  return name.length > 1 && name.endsWith('s') ? name.slice(0, -1) : name
}

/**
 * 解析一份组件配置：variants 对象的键 → 其取值键（文件里多处 variants 合并取并集），
 * 再补上 as const 常量数组（含 ...展开与 export { a as b } 重命名）。布尔变体（true / false）不算枚举。
 */
export function configEnums(source: string, id: string): Map<string, string[]> {
  const clean = stripComments(source)
  const enums = new Map<string, string[]>()
  const add = (key: string, values: string[]) => { if (values.length) enums.set(key, [...new Set([...(enums.get(key) ?? []), ...values])]) }
  for (const match of clean.matchAll(/\bvariants\s*:\s*\{/g)) {
    const open = match.index! + match[0].length - 1, close = closing(clean, open)
    if (close === -1) continue
    for (const entry of objectEntries(clean.slice(open + 1, close))) {
      if (!entry.value.startsWith('{')) continue
      const end = closing(entry.value, 0)
      if (end === -1) continue
      add(entry.key, objectEntries(entry.value.slice(1, end)).map(item => item.key).filter(key => key !== 'true' && key !== 'false'))
    }
  }
  const constants = new Map<string, string[]>()
  for (const match of clean.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*\[([^\]]*)\]\s*as\s+const/g)) {
    const values: string[] = []
    let complete = true
    for (const item of match[2]!.split(',').map(part => part.trim()).filter(Boolean)) {
      const literal = /^(["'])(.*)\1$/.exec(item)
      if (literal) values.push(literal[2]!)
      else if (item.startsWith('...') && constants.has(item.slice(3))) values.push(...constants.get(item.slice(3))!)
      else complete = false
    }
    if (complete && values.length) constants.set(match[1]!, values)
  }
  for (const match of clean.matchAll(/export\s*\{([^}]*)\}/g)) for (const piece of match[1]!.split(',')) {
    const alias = /^\s*([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)\s*$/.exec(piece)
    if (alias && constants.has(alias[1]!)) constants.set(alias[2]!, constants.get(alias[1]!)!)
  }
  for (const [name, values] of constants) { const key = propNameOf(name, id); if (!enums.has(key)) enums.set(key, values) }
  return enums
}

/** 模板里一次 Reborn 组件使用：标签名、组件标识与写死的取值（静态属性，或绑定值是字符串字面量）。 */
export interface TemplateUsage { component: string; tag: string; props: Record<string, string> }

/** 扫描模板里的 Reborn 标签；属性区到标签结束的 > 为止，引号内的 > 不算。 */
export function templateUsages(template: string): TemplateUsage[] {
  const usages: TemplateUsage[] = []
  for (const match of template.matchAll(/<(Reborn[A-Z][A-Za-z0-9]*|reborn-[a-z][a-z0-9-]*)(?=[\s/>])/g)) {
    const tag = match[1]!, from = match.index! + match[0].length
    let i = from, quote = ''
    while (i < template.length) {
      const char = template[i]!
      if (quote) { if (char === quote) quote = '' }
      else if (char === '"' || char === "'") quote = char
      else if (char === '>') break
      i += 1
    }
    const props: Record<string, string> = {}
    for (const attribute of template.slice(from, i).matchAll(/(?:^|\s)(:|v-bind:)?([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const raw = attribute[3] ?? attribute[4] ?? ''
      const literal = attribute[1] ? /^\s*(?:'([^']*)'|"([^"]*)")\s*$/.exec(raw) : null
      const value = attribute[1] ? (literal ? literal[1] ?? literal[2] ?? '' : undefined) : raw
      if (value === undefined) continue
      props[attribute[2]!.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value
    }
    usages.push({ component: tag.startsWith('reborn-') ? tag : tag.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()).slice(1), tag, props })
  }
  return usages
}

/** 在目标项目里找已安装组件的配置文件：components.json 的 componentsDir 及 Nuxt / Vite 常见目录下的几种布局。 */
export async function installedConfig(root: string, id: string, cache?: Map<string, InstalledConfig | null>): Promise<InstalledConfig | null> {
  if (cache?.has(id)) return cache.get(id)!
  const bases: string[] = []
  const content = await readOptional(root, 'components.json').catch(() => null)
  if (content) {
    try {
      const dir = object(JSON.parse(content)).componentsDir
      if (typeof dir === 'string' && dir.trim()) { const clean = dir.trim().replace(/^\.\//, '').replace(/\/+$/, ''); bases.push(clean, 'app/' + clean, 'src/' + clean) }
    } catch (error) { /* 配置无效时只查默认目录 */ }
  }
  bases.push('app/components', 'src/components', 'components')
  let found: InstalledConfig | null = null
  for (const base of new Set(bases)) {
    for (const path of [base + '/' + id + '/' + id + '.config.ts', base + '/reborn/ui/' + id + '/' + id + '.config.ts', base + '/reborn/' + id + '/' + id + '.config.ts', base + '/ui/' + id + '/' + id + '.config.ts']) {
      const source = await readOptional(root, path, 2_000_000).catch(() => null)
      if (source !== null) { found = { path, enums: configEnums(source, id) }; break }
    }
    if (found) break
  }
  cache?.set(id, found)
  return found
}

/** 核对模板上写死的取值是否在已安装配置的枚举里；找不到配置文件的组件只提醒，不阻塞。 */
export async function propIssues(root: string, templates: Map<string, string>): Promise<{ issues: string[]; warnings: string[] }> {
  const issues = new Set<string>(), warnings = new Set<string>(), cache = new Map<string, InstalledConfig | null>()
  for (const [file, template] of templates) for (const usage of templateUsages(template)) {
    const config = await installedConfig(root, usage.component, cache)
    if (!config) { warnings.add(file + '：未找到已安装组件 ' + usage.component + ' 的 *.config.ts，无法核对 size / variant 等取值；请确认已按 get_install_command 安装到项目组件目录'); continue }
    for (const [name, value] of Object.entries(usage.props)) {
      const allowed = config.enums.get(name)
      if (allowed && !allowed.includes(value)) issues.add(file + '：<' + usage.tag + '> 的 ' + name + '="' + value + '" 不在已安装组件的取值中（' + config.path + '：' + allowed.join(' / ') + '）')
    }
  }
  return { issues: [...issues], warnings: [...warnings] }
}

function usesTag(template: string, component: string): boolean {
  const pascal = component.split('-').map(word => word[0]!.toUpperCase() + word.slice(1)).join('')
  return new RegExp('<(?:' + component + '|' + pascal + ')(?=[\\s/>])').test(template)
}

/**
 * 映射表命中的设计实例必须用对应组件实现：按 data-design 找到渲染该节点的实现文件，文件里必须有组件标签（含伴随组件）；
 * 没有任何文件标记该节点时退回全文核对并提醒补 data-design。
 */
export async function mappingIssues(root: string, manifest: BlocksWithComponents | null, templates: Map<string, string>): Promise<{ issues: string[]; warnings: string[] }> {
  if (!manifest) return { issues: [], warnings: [] }
  const map = await loadComponentMap(root)
  const all = [...templates.values()].join('\n')
  const issues: string[] = [], warnings: string[] = []
  for (const hit of matchManifest(map.rules, manifest).matched) {
    const required = [hit.rule.component, ...(hit.rule.with ?? [])]
    const where = '实例「' + hit.name + '」（' + hit.nodeIds.join('、') + '）应使用 ' + required.join(' + ') + '（规则「' + hit.rule.pattern + '」，' + map.path + '）'
    const located = [...templates].filter(([, template]) => hit.nodeIds.some(id => template.includes('data-design="' + id + '"')))
    if (located.length === 0) {
      warnings.push('映射命中的节点没有 data-design 标记，只能按全文核对：' + where)
      for (const component of required) if (!usesTag(all, component)) issues.push('映射命中未实现：' + where + '，已登记的实现文件里没有 ' + component + ' 标签')
      continue
    }
    for (const component of required) if (!located.some(([, template]) => usesTag(template, component))) issues.push('映射命中未实现：' + where + '，渲染它的文件 ' + located.map(([file]) => file).join('、') + ' 里没有 ' + component + ' 标签')
  }
  return { issues, warnings }
}

/** plan 阶段：映射命中的组件（含伴随组件）没有出现在 requirements 里；用户明确允许自定义的节点除外。 */
export async function unregisteredHits(root: string, manifest: BlocksWithComponents | null, components: readonly string[], exemptNodeIds: readonly string[] = []): Promise<string[]> {
  if (!manifest) return []
  const map = await loadComponentMap(root)
  const messages: string[] = []
  for (const hit of matchManifest(map.rules, manifest).matched) {
    if (hit.nodeIds.some(id => exemptNodeIds.includes(id))) continue
    for (const component of [hit.rule.component, ...(hit.rule.with ?? [])]) if (!components.includes(component)) messages.push('映射命中未登记：实例「' + hit.name + '」（' + hit.nodeIds.join('、') + '）应使用 ' + component + '，requirements 里没有该组件')
  }
  return messages
}
