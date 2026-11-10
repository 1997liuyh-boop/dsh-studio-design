/**
 * 交互规范：docs/design/interactions.yaml。工作室按预读清单里的可交互区块与状态帧生成骨架，
 * 用户或模型填写触发与响应，design_review 据此核对模板里的事件处理与状态绑定。
 * 这里只实现该文件用到的 YAML 子集（映射、序列、标量、行内数组），不引入依赖。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readOptional } from './project.ts'
import type { Manifest, StateDelta } from './reader.ts'

export const INTERACTIONS_PATH = 'docs/design/interactions.yaml'
/** 按规范生成的 Playwright 交互脚本与截图归档位置。 */
export const INTERACTION_SPEC_PATH = 'tests/design/interactions.spec.ts'
export const SCREENSHOT_DIR = 'docs/design/screenshots'

export type InteractionType = 'button' | 'carousel' | 'dropdown' | 'tabs' | 'search' | 'fab' | 'coupon' | 'input' | 'link' | 'state' | 'custom'
export const interactionTypes: readonly InteractionType[] = ['button', 'carousel', 'dropdown', 'tabs', 'search', 'fab', 'coupon', 'input', 'link', 'state', 'custom']

/** 一条交互规范；trigger 与 response 为空即「待补交互」。 */
export interface InteractionSpec {
  id: string
  /** 设计节点 ID；状态条目为状态画板的节点 ID。 */
  node: string
  name: string
  type: InteractionType
  trigger: string
  response: string
  /** 涉及的状态标签（与 manifest.frames[].state 对应）。 */
  states: string[]
  /** 骨架提示或跨帧差异摘要；人工填写后保留。 */
  notes?: string
  /** 交互依赖的数据字段：实现时保留 mock 并标 TODO。 */
  data?: Record<string, string>
  /** 可选：实现文件，省略时按已登记的实施文件查找。 */
  file?: string
}

/** 请求正文里用自然语言补充的一条交互。 */
export interface InteractionSupplement { node: string; trigger: string; response: string; states: string[] }

/** 交给模型与 design_workspace 返回值的摘要。 */
export interface InteractionSummary {
  path: string
  total: number
  pending: { id: string; node: string; name: string; hint: string }[]
  filled: { id: string; node: string; trigger: string; response: string; states: string[] }[]
  /** 本次从请求正文写回的条目 ID。 */
  supplemented: string[]
  issue?: string
}

/** 按名称识别可交互区块的类型与默认提示；顺序即优先级（搜索栏先于按钮）。 */
const typeRules: readonly (readonly [RegExp, InteractionType, string])[] = [
  [/轮播|banner|carousel|swiper|指示器/i, 'carousel', '点击左右箭头或指示器 → 切换上一张 / 下一张，边界按稿面决定是否循环'],
  [/搜索|search/i, 'search', '输入关键字后回车或点击搜索 → 以关键字请求结果（mock）；站点或分类选择 → 切换搜索范围'],
  [/下拉|dropdown|选择器|選擇|语言|語言|地区|站点切换/i, 'dropdown', '点击触发器 → 展开选项；选中一项 → 触发器文字更新并收起'],
  [/标签页|选项卡|tabs?\b|分段|导航|\bnav/i, 'tabs', '点击标签 → 当前标签高亮，内容区切换'],
  [/悬浮|浮动|侧边栏|\bfab\b|float|回到顶部/i, 'fab', '点击 → 打开对应面板（购物车 / 客服）或回到顶部'],
  [/优惠券|卡券|coupon|领券/i, 'coupon', '点击领取 → 按钮变为已领取并禁用（mock）'],
  [/输入框|\binput\b|表单|\bform\b/i, 'input', '输入 → 校验并显示错误；提交 → 请求（mock）'],
  [/按钮|\bbtn\b|button|加载更多|查看更多|签到|登录|登錄|注册|註冊/i, 'button', '点击 → 对应动作（加载更多追加数据 / 跳转 / 弹窗），请求中显示 loading'],
  [/通知|公告|notice|资讯|資訊|商品卡|卡片|\bcard\b|链接|\blink\b/i, 'link', '点击 → 跳转详情页（mock 路由）'],
]
const typeHints: Record<InteractionType, string> = Object.fromEntries(typeRules.map(([, type, hint]) => [type, hint])) as Record<InteractionType, string>
typeHints.state = '触发该状态的动作 → 页面按 stateDeltas 切换显示'
typeHints.custom = '触发动作 → 预期响应'

/** 实例属性里表示状态的键：布尔值或键名含状态字样。 */
const stateKey = /状态|state|选中|選中|禁用|hover|悬停|激活|active|loading/i

export function interactionHint(type: InteractionType): string { return typeHints[type] }

/** 可读的 ID 片段：保留中英文与数字，其余折成连字符。 */
export function slug(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'node'
}

export function isPending(spec: Pick<InteractionSpec, 'trigger' | 'response'>): boolean {
  return !spec.trigger.trim() || !spec.response.trim()
}

/** 跨帧差异的一句话摘要，写进状态条目的 notes。 */
export function describeDeltas(deltas: readonly StateDelta[], limit = 6): string {
  const labels: Record<StateDelta['kind'], string> = { added: '新增', removed: '消失', moved: '位移', resized: '尺寸', text: '文字', variant: '变体', style: '样式' }
  const parts = deltas.slice(0, limit).map(delta => labels[delta.kind] + ' ' + delta.name + (delta.from !== undefined || delta.to !== undefined ? '（' + (delta.from ?? '—') + ' → ' + (delta.to ?? '—') + '）' : ''))
  return parts.join('；') + (deltas.length > limit ? '；另有 ' + (deltas.length - limit) + ' 项见 manifest.stateDeltas' : '')
}

/**
 * 从预读清单生成骨架：区块与其中的组件实例按名称识别类型（同名只登记一次），
 * 带状态属性的实例和每个状态帧各生成一条 state 条目。
 */
export function interactionSkeleton(manifest: Pick<Manifest, 'blocks' | 'frames' | 'stateDeltas'>): InteractionSpec[] {
  const specs: InteractionSpec[] = [], ids = new Set<string>(), seen = new Map<string, InteractionSpec>(), counts = new Map<string, number>()
  const unique = (id: string) => { let candidate = id, n = 2; while (ids.has(candidate)) candidate = id + '-' + n++; ids.add(candidate); return candidate }
  const candidates: { nodeId: string; name: string; props?: Record<string, string | number | boolean> }[] = []
  for (const block of manifest.blocks) {
    // 区块自身是实例时 components 含它本身，属性从那里取；其余实例各自成候选。
    candidates.push({ nodeId: block.nodeId, name: block.name, props: block.components?.find(instance => instance.nodeId === block.nodeId)?.props })
    for (const instance of block.components ?? []) if (instance.nodeId !== block.nodeId) candidates.push(instance)
  }
  for (const candidate of candidates) {
    counts.set(candidate.name, (counts.get(candidate.name) ?? 0) + 1)
    if (seen.has(candidate.name)) continue
    const rule = typeRules.find(([expression]) => expression.test(candidate.name))
    const states = Object.entries(candidate.props ?? {}).filter(([key, value]) => typeof value === 'boolean' || stateKey.test(key)).map(([key, value]) => typeof value === 'boolean' ? key : key + '=' + String(value))
    if (!rule && !states.length) continue
    const type = rule?.[1] ?? 'state'
    const spec: InteractionSpec = { id: unique(type + '-' + slug(candidate.name)), node: candidate.nodeId, name: candidate.name, type, trigger: '', response: '', states }
    seen.set(candidate.name, spec)
    specs.push(spec)
  }
  for (const spec of specs) { const count = counts.get(spec.name) ?? 1; if (count > 1) spec.notes = '稿面出现 ' + count + ' 处，实现为同一组件' }
  for (const frame of manifest.frames ?? []) {
    if (frame.status !== 'ok') continue
    const deltas = (manifest.stateDeltas ?? []).filter(delta => delta.frame === frame.nodeId)
    specs.push({ id: unique('state-' + slug(frame.state)), node: frame.nodeId, name: frame.name, type: 'state', trigger: '', response: '', states: [frame.state], notes: deltas.length ? '差异：' + describeDeltas(deltas) : '与默认态没有检测到差异' })
  }
  return specs
}

/** 请求正文里的「交互 <节点>：<触发> → <响应>（状态：a、b）」行。 */
export function parseRequestInteractions(request: string): InteractionSupplement[] {
  const result: InteractionSupplement[] = []
  for (const raw of request.split(/\r?\n/)) {
    const match = /^\s*(?:[-*•]\s*)?交互\s*[:：]?\s*(.+?)\s*(?:→|->|=>|－>)\s*(.+?)\s*$/.exec(raw)
    if (!match) continue
    // 节点名可能含冒号（如 banner16:9），所以从最后一个冒号切分节点与触发，全角冒号优先。
    const left = match[1]!
    const colon = left.includes('：') ? left.lastIndexOf('：') : left.lastIndexOf(':')
    if (colon === -1) continue
    const node = left.slice(0, colon).trim(), trigger = left.slice(colon + 1).trim()
    let response = match[2]!, states: string[] = []
    const trailing = /\s*[（(]\s*状态\s*[:：]\s*([^）)]+)[）)]\s*$/.exec(response)
    if (trailing) { states = trailing[1]!.split(/[、,，/|]/).map(item => item.trim()).filter(Boolean); response = response.slice(0, trailing.index).trim() }
    if (!node || !trigger || !response) continue
    result.push({ node, trigger, response, states })
  }
  return result
}

/** 合并：已有条目（含人工填写）优先保留，骨架只补缺失条目，补充项按 id / 节点 / 名称匹配后覆盖触发与响应。 */
export function mergeInteractions(existing: readonly InteractionSpec[], skeleton: readonly InteractionSpec[], supplements: readonly InteractionSupplement[] = []): { specs: InteractionSpec[]; supplemented: string[] } {
  const specs = existing.map(spec => ({ ...spec, states: [...spec.states] }))
  for (const item of skeleton) {
    const current = specs.find(spec => spec.id === item.id || spec.node === item.node && spec.type === item.type)
    if (!current) { specs.push({ ...item, states: [...item.states] }); continue }
    if (!current.notes && item.notes) current.notes = item.notes
    for (const state of item.states) if (!current.states.includes(state)) current.states.push(state)
  }
  const supplemented: string[] = []
  for (const supplement of supplements) {
    const key = supplement.node.toLowerCase()
    const target = specs.find(spec => spec.id.toLowerCase() === key || spec.node === supplement.node)
      ?? specs.find(spec => spec.name.toLowerCase() === key)
      ?? specs.filter(spec => spec.name.toLowerCase().includes(key) || key.includes(spec.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0]
    const spec = target ?? { id: '', node: supplement.node, name: supplement.node, type: 'custom' as const, trigger: '', response: '', states: [] }
    if (!target) { let id = 'custom-' + slug(supplement.node), n = 2; while (specs.some(item => item.id === id)) id = 'custom-' + slug(supplement.node) + '-' + n++; spec.id = id; specs.push(spec) }
    spec.trigger = supplement.trigger; spec.response = supplement.response
    for (const state of supplement.states) if (!spec.states.includes(state)) spec.states.push(state)
    supplemented.push(spec.id)
  }
  return { specs, supplemented: [...new Set(supplemented)] }
}

function quote(value: string): string {
  return /^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(value) ? value : JSON.stringify(value)
}

/** 写出 YAML；待补条目附提示注释，注释在下次写出时重新生成。 */
export function formatInteractions(specs: readonly InteractionSpec[]): string {
  const lines = [
    '# 交互规范：设计工作室按预读清单生成骨架，人工或模型补全。',
    '# - trigger / response 为空的条目是「待补交互」，design_review(stage=plan) 会列出；',
    '# - 在需求里写「交互 <节点>：<触发> → <响应>（状态：a、b）」可由工作室写回；',
    '# - 实现时在对应元素加 data-design="<id>"，check 阶段按 id 核对事件处理或状态绑定。',
    'version: 1',
    'interactions:' + (specs.length ? '' : ' []'),
  ]
  for (const spec of specs) {
    lines.push('  - id: ' + quote(spec.id), '    node: ' + quote(spec.node), '    name: ' + quote(spec.name), '    type: ' + spec.type, '    trigger: ' + JSON.stringify(spec.trigger), '    response: ' + JSON.stringify(spec.response), '    states: [' + spec.states.map(state => JSON.stringify(state)).join(', ') + ']')
    if (spec.notes) lines.push('    notes: ' + JSON.stringify(spec.notes))
    if (spec.file) lines.push('    file: ' + JSON.stringify(spec.file))
    if (spec.data && Object.keys(spec.data).length) { lines.push('    data:'); for (const [key, value] of Object.entries(spec.data)) lines.push('      ' + quote(key) + ': ' + JSON.stringify(value)) }
    if (isPending(spec)) lines.push('    # 提示：' + interactionHint(spec.type))
  }
  return lines.join('\n') + '\n'
}

interface YamlLine { indent: number; text: string; number: number }

/** 去掉行尾注释：引号外、前面是空白或行首的 # 起始。 */
function stripComment(raw: string): string {
  let quoteChar = ''
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]!
    if (quoteChar) { if (char === '\\' && quoteChar === '"') i += 1; else if (char === quoteChar) quoteChar = ''; continue }
    if (char === '"' || char === "'") quoteChar = char
    else if (char === '#' && (i === 0 || /\s/.test(raw[i - 1]!))) return raw.slice(0, i)
  }
  return raw
}

function scalar(text: string, line: YamlLine): unknown {
  const value = text.trim()
  if (value === '' || value === '~' || value === 'null') return null
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) throw new Error(INTERACTIONS_PATH + ' 第 ' + line.number + ' 行：双引号未闭合')
    try { return JSON.parse(value) } catch (error) { throw new Error(INTERACTIONS_PATH + ' 第 ' + line.number + ' 行：字符串转义无效') }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw new Error(INTERACTIONS_PATH + ' 第 ' + line.number + ' 行：单引号未闭合')
    return value.slice(1, -1).replaceAll("''", "'")
  }
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) throw new Error(INTERACTIONS_PATH + ' 第 ' + line.number + ' 行：数组未闭合')
    const inner = value.slice(1, -1).trim()
    return inner ? splitFlow(inner).map(item => scalar(item, line)) : []
  }
  return value
}

/** 行内数组按逗号切分，引号内的逗号保留。 */
function splitFlow(inner: string): string[] {
  const items: string[] = []
  let current = '', quoteChar = ''
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i]!
    if (quoteChar) { current += char; if (char === '\\' && quoteChar === '"') { current += inner[i + 1] ?? ''; i += 1 } else if (char === quoteChar) quoteChar = ''; continue }
    if (char === '"' || char === "'") { quoteChar = char; current += char; continue }
    if (char === ',') { items.push(current); current = ''; continue }
    current += char
  }
  if (current.trim()) items.push(current)
  return items
}

/** 解析本文件用到的 YAML 子集；语法错误带行号抛出。 */
export function parseYamlSubset(source: string): unknown {
  const lines: YamlLine[] = []
  source.split(/\r?\n/).forEach((raw, index) => {
    const text = stripComment(raw)
    if (!text.trim()) return
    lines.push({ indent: raw.length - raw.trimStart().length, text: text.trim(), number: index + 1 })
  })
  let position = 0
  const fail = (line: YamlLine, message: string) => new Error(INTERACTIONS_PATH + ' 第 ' + line.number + ' 行：' + message)
  const isItem = (line: YamlLine) => line.text === '-' || line.text.startsWith('- ')
  const entry = (line: YamlLine) => /^([^\s:"'#\[\]][^:]*?)\s*:(?:\s+(.*))?$/.exec(line.text)
  function block(): unknown {
    const line = lines[position]!
    return isItem(line) ? sequence(line.indent) : mapping(line.indent)
  }
  function sequence(indent: number): unknown[] {
    const items: unknown[] = []
    while (position < lines.length && lines[position]!.indent === indent && isItem(lines[position]!)) {
      const line = lines[position]!
      const rest = line.text.slice(1).trim()
      if (!rest) { position += 1; items.push(position < lines.length && lines[position]!.indent > indent ? block() : null); continue }
      if (entry({ ...line, text: rest })) { lines[position] = { indent: indent + 2, text: rest, number: line.number }; items.push(mapping(indent + 2)) }
      else { position += 1; items.push(scalar(rest, line)) }
    }
    return items
  }
  function mapping(indent: number): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    while (position < lines.length && lines[position]!.indent === indent && !isItem(lines[position]!)) {
      const line = lines[position]!
      const match = entry(line)
      if (!match) throw fail(line, '需要「键: 值」')
      const key = match[1]!.trim(), rest = match[2]
      position += 1
      if (rest !== undefined && rest.trim() !== '') { result[key] = scalar(rest, line); continue }
      result[key] = position < lines.length && lines[position]!.indent > indent ? block() : null
    }
    if (position < lines.length && lines[position]!.indent > indent) throw fail(lines[position]!, '缩进无效')
    return result
  }
  if (!lines.length) return {}
  const value = block()
  if (position < lines.length) throw fail(lines[position]!, '缩进无效')
  return value
}

function textOf(value: unknown, max: number): string {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new Error('需要文字')
  return String(value).slice(0, max)
}

/** 校验解析结果并整理成规范数组；未知类型归为 custom，缺失字段取空值。 */
export function parseInteractions(source: string): { version: number; interactions: InteractionSpec[] } {
  const value = parseYamlSubset(source)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(INTERACTIONS_PATH + ' 需要顶层映射')
  const root = value as Record<string, unknown>
  const list = root.interactions ?? []
  if (!Array.isArray(list) || list.length > 300) throw new Error(INTERACTIONS_PATH + ' 的 interactions 需要数组且不超过 300 条')
  const ids = new Set<string>()
  const interactions = list.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(INTERACTIONS_PATH + ' 第 ' + (index + 1) + ' 条不是映射')
    const row = item as Record<string, unknown>
    try {
      const id = textOf(row.id, 64).trim()
      if (!id || !/^[\p{L}\p{N}_-]+$/u.test(id)) throw new Error('id 需要字母、数字、连字符或中文')
      if (ids.has(id)) throw new Error('id 重复：' + id)
      ids.add(id)
      const type = textOf(row.type, 32) as InteractionType
      const rawStates = row.states ?? []
      const states = (Array.isArray(rawStates) ? rawStates : [rawStates]).map(state => textOf(state, 64).trim()).filter(Boolean)
      let data: Record<string, string> | undefined
      if (row.data !== null && row.data !== undefined) {
        if (typeof row.data !== 'object' || Array.isArray(row.data)) throw new Error('data 需要键值映射')
        data = Object.fromEntries(Object.entries(row.data as Record<string, unknown>).map(([key, item]) => [key.slice(0, 64), textOf(item, 512)]))
      }
      const spec: InteractionSpec = { id, node: textOf(row.node, 256).trim(), name: textOf(row.name, 256).trim() || id, type: interactionTypes.includes(type) ? type : 'custom', trigger: textOf(row.trigger, 512).trim(), response: textOf(row.response, 1024).trim(), states }
      const notes = textOf(row.notes, 1024).trim(), file = textOf(row.file, 2048).trim()
      if (notes) spec.notes = notes
      if (file) spec.file = file
      if (data) spec.data = data
      return spec
    } catch (error) { throw new Error(INTERACTIONS_PATH + ' 第 ' + (index + 1) + ' 条：' + (error instanceof Error ? error.message : String(error))) }
  })
  return { version: typeof root.version === 'number' ? root.version : 1, interactions }
}

/** 读取项目内的交互规范；文件不存在返回 null，格式错误抛出带行号的错误。 */
export async function loadInteractions(root: string): Promise<InteractionSpec[] | null> {
  const content = await readOptional(root, INTERACTIONS_PATH, 2_000_000)
  return content === null ? null : parseInteractions(content).interactions
}

async function writeTextAtomic(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path)
  await mkdir(join(target, '..'), { recursive: true })
  const temp = join(root, path + '.' + randomUUID() + '.tmp')
  try { await writeFile(temp, content, 'utf8'); await rename(temp, target) }
  finally { await rm(temp, { force: true }) }
}

export function summarize(specs: readonly InteractionSpec[], supplemented: string[] = [], issue?: string): InteractionSummary {
  return {
    path: INTERACTIONS_PATH, total: specs.length,
    pending: specs.filter(isPending).map(spec => ({ id: spec.id, node: spec.node, name: spec.name, hint: interactionHint(spec.type) })),
    filled: specs.filter(spec => !isPending(spec)).map(spec => ({ id: spec.id, node: spec.node, trigger: spec.trigger, response: spec.response, states: spec.states })),
    supplemented, ...(issue ? { issue } : {}),
  }
}

/**
 * 预读完成后同步规范文件：解析已有内容、补骨架、写回请求正文里的补充；内容无变化不改写。
 * 已有文件无法解析时不改写，只在摘要里报告错误。
 */
export async function syncInteractions(root: string, manifest: Pick<Manifest, 'blocks' | 'frames' | 'stateDeltas'>, request: string): Promise<InteractionSummary> {
  const content = await readOptional(root, INTERACTIONS_PATH, 2_000_000)
  let existing: InteractionSpec[] = []
  if (content !== null) {
    try { existing = parseInteractions(content).interactions }
    catch (error) { return summarize([], [], (error instanceof Error ? error.message : String(error)) + '；本次未改写该文件，请修正后重试') }
  }
  const { specs, supplemented } = mergeInteractions(existing, interactionSkeleton(manifest), parseRequestInteractions(request))
  const output = formatInteractions(specs)
  if (output !== content) await writeTextAtomic(root, INTERACTIONS_PATH, output)
  return summarize(specs, supplemented)
}

/** 模板里能证明交互已实现的绑定：事件处理、v-model、条件渲染或状态类 props。 */
const bindingPattern = /(?:^|\s)(?:@[\w.:-]+|v-on:[\w.:-]+|v-model(?::[\w-]+)?(?:\.[\w-]+)*|v-if|v-else-if|v-show|:(?:disabled|active|loading|selected|checked|open|visible|model-value|modelValue|value|current|active-key|activeKey|index|class|style|variant|color|state|status))\s*=/

function escape(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/**
 * check 阶段：每条已填写规范按 id 或 node 找到带 data-design 的元素，核对其开标签上有事件处理或状态绑定。
 * 交互本身由 design_review(stage=interact) 在宿主侧执行，不要求项目里有 Playwright 脚本；脚本存在时只提醒未覆盖的条目。
 * @param templates 实施文件 → 模板内容（已去注释）。
 * @param script 项目里已有的 Playwright 脚本内容；不存在为 null。
 */
export function interactionTemplateIssues(specs: readonly InteractionSpec[], templates: ReadonlyMap<string, string>, script: string | null): { issues: string[]; warnings: string[] } {
  const issues: string[] = [], warnings: string[] = []
  let filled = 0
  for (const spec of specs) {
    if (isPending(spec)) { warnings.push('待补交互：' + spec.id + '（' + spec.name + '）尚未填写触发与响应'); continue }
    filled += 1
    const keys = [spec.id, spec.node].filter(Boolean).map(escape).join('|')
    const pattern = new RegExp('<[A-Za-z][\\w-]*\\b([^>]*?)\\bdata-design\\s*=\\s*"(?:' + keys + ')"([^>]*)>')
    const files = spec.file ? [[spec.file, templates.get(spec.file) ?? ''] as const] : [...templates.entries()]
    let found: { file: string; attributes: string } | undefined
    for (const [file, template] of files) { const match = pattern.exec(template); if (match) { found = { file, attributes: ' ' + match[1] + ' ' + match[2] }; break } }
    if (!found) { issues.push('交互 ' + spec.id + '：实施文件中没有 data-design="' + spec.id + '" 的元素（也可用节点 ' + spec.node + '），请在对应节点根元素上标记'); continue }
    if (!bindingPattern.test(found.attributes)) issues.push('交互 ' + spec.id + '：' + found.file + ' 的 data-design 元素没有事件处理或状态绑定（需要 @事件、v-model、v-if / v-show 或 :disabled、:active、:loading 等）')
    if (script !== null && !script.includes('data-design="' + spec.id + '"') && !script.includes("data-design='" + spec.id + "'") && !script.includes('data-design="' + spec.node + '"')) warnings.push('交互 ' + spec.id + '：' + INTERACTION_SPEC_PATH + ' 没有覆盖该条目')
  }
  if (filled && script === null) warnings.push('已填写 ' + filled + ' 条交互规范：实现后由 design_review(stage=interact) 在宿主侧执行并把截图写到 ' + SCREENSHOT_DIR + '/，不需要自己写或运行 Playwright 脚本')
  return { issues, warnings }
}
