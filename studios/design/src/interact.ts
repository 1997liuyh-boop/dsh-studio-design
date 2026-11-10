/**
 * 交互断言执行：读取 docs/design/interactions.yaml 已填写的条目，把 trigger 翻译成有限动作集
 * （click / hover / type / press / scroll），由宿主用 Playwright 在设计稿基准视口打开预览页面，
 * 按 data-design 定位元素执行，再按 response 里可机器判断的断言核对（元素出现或消失、文字包含、
 * aria 等属性、路由变化、无变化）。每条交互前后各截一张图写到 docs/design/screenshots/<id>-before.png / -after.png，
 * 另截一张 390 宽的窄屏整页图；结果写 docs/design/interaction-report.json。
 * 解析、判定与报告不依赖浏览器，执行函数可注入，测试里用假驱动。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SCREENSHOT_DIR, isPending, type InteractionSpec } from './interactions.ts'
import { loadChromium } from './measure.ts'
import { imageSize, writeJsonAtomic } from './reader.ts'

export const INTERACTION_REPORT_PATH = 'docs/design/interaction-report.json'
/** 窄屏整页截图的视口。 */
export const NARROW_WIDTH = 390
export const NARROW_HEIGHT = 844
/** trigger 只说「输入关键字」没给文字时使用的输入内容。 */
export const DEFAULT_INPUT = '测试关键字'
const MAX_ACTIONS = 8
/** 元素本身没有、但常落在内部控件上的状态属性：快照时向下补找一层。 */
const stateAttributes = ['aria-expanded', 'aria-selected', 'aria-checked', 'aria-pressed', 'aria-disabled', 'aria-hidden', 'aria-current', 'disabled', 'open', 'hidden', 'data-state', 'data-active', 'data-selected']

export type ActionKind = 'click' | 'hover' | 'type' | 'press' | 'scroll'
export interface Action {
  kind: ActionKind
  /** 目标选择器；缺省为条目本身的 data-design 元素。 */
  selector?: string
  text?: string
  key?: string
  /** scroll：滚到页面底部。 */
  bottom?: boolean
}

export type AssertionKind = 'appear' | 'disappear' | 'change' | 'unchanged' | 'text' | 'value' | 'attribute' | 'route' | 'route-same'
export interface Assertion {
  kind: AssertionKind
  /** 显式目标；缺省时 attribute / unchanged / value 看条目元素，其余看整页。 */
  selector?: string
  description: string
  text?: string
  attribute?: string
  /** attribute：期望值；缺省表示执行前后应当变化。 */
  value?: string
  /** route：期望地址包含的路径。 */
  path?: string
}

export interface ElementState {
  exists: boolean
  visible: boolean
  text: string
  /** 元素或其内部第一个输入控件的值。 */
  value: string
  html: string
  rect: { x: number; y: number; width: number; height: number }
  attributes: Record<string, string>
}
export interface PageState { url: string; title: string; elements: number; textLength: number; bodyText: string }
export interface Snapshot { page: PageState; elements: Record<string, ElementState> }

/** 页面驱动：真实实现用 Playwright，测试里注入假驱动。 */
export interface InteractionDriver {
  goto(url: string): Promise<void>
  snapshot(selectors: string[]): Promise<Snapshot>
  perform(action: Action, defaultSelector: string): Promise<void>
  screenshot(options: { selector?: string; fullPage?: boolean }): Promise<Buffer>
  close(): Promise<void>
}
export type DriverFactory = (viewport: { width: number; height: number }) => Promise<InteractionDriver>

export interface InteractionOutcome {
  id: string
  node: string
  name: string
  type: string
  trigger: string
  response: string
  /** passed 断言全过；failed 有断言未过或执行出错；skipped 条目声明无交互；unsupported 触发翻译不了。 */
  status: 'passed' | 'failed' | 'skipped' | 'unsupported'
  passed: boolean
  selector: string
  actions: string[]
  assertions: { description: string; passed: boolean; actual: string }[]
  actual: string
  evidence: { before?: string; after?: string }
  error?: string
  durationMs: number
}
export interface InteractResult {
  stage: 'interact'
  ready: boolean
  url: string
  width: number
  height: number
  results: InteractionOutcome[]
  /** 窄屏整页图：imageWidth 大于视口宽度说明页面没有响应式适配，内容横向溢出。 */
  narrow: { width: number; height: number; screenshot?: string; imageWidth?: number; imageHeight?: number; overflow?: true; error?: string }
  summary: { total: number; passed: number; failed: number; skipped: number; unsupported: number }
  issues: string[]
  warnings: string[]
  report: string
  next: string
}

/** data-design 属性选择器；值里的引号与反斜杠转义。 */
export function selectorFor(value: string): string {
  return '[data-design="' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]'
}

const quoted = /[「“"『]([^」”"』]{1,200})[」”"』]/
const nodeId = /(?<![\d:/])(\d+:\d+(?:\/\d+:\d+)*)(?![\d:/])/

/**
 * 文字里提到的目标：data-design="…" → 已知的规范 id / 节点 ID（长的优先）→ 形如 84:63426 的节点 ID。
 * @returns data-design 的值；没有提到返回 undefined。
 */
export function mentionedTarget(text: string, known: readonly string[] = []): string | undefined {
  const explicit = /data-design\s*=\s*["'“「]?([^"'”」\s\]]+)/.exec(text)
  if (explicit) return explicit[1]
  const hit = [...known].filter(Boolean).sort((a, b) => b.length - a.length).find(value => text.includes(value))
  if (hit) return hit
  return nodeId.exec(text)?.[1]
}

/** 「或」分隔的备选触发只执行第一种。 */
function firstAlternative(text: string): string {
  return text.split(/或者|或是|或/)[0]!
}
/** 按标点与先后连接词切成顺序子句。 */
function clauses(text: string): string[] {
  return text.split(/[，,；;。]|然后|然後|接着|接著|之后|之後|(?<=\S)[后後](?=\S)|再(?=[点點按输輸滚滾悬懸])/).map(item => item.trim()).filter(Boolean)
}

const keyNames: readonly (readonly [RegExp, string])[] = [
  [/回车|回車|\benter\b|键盘触发|鍵盤觸發/i, 'Enter'], [/\besc(?:ape)?\b|退出键|退出鍵/i, 'Escape'], [/空格|\bspace\b/i, 'Space'], [/\btab\b|制表/i, 'Tab'],
  [/退格|\bbackspace\b/i, 'Backspace'], [/\bdelete\b|删除键|刪除鍵/i, 'Delete'],
  [/左方向|方向键左|方向鍵左|左箭头键|左箭頭鍵|\barrowleft\b|←/i, 'ArrowLeft'], [/右方向|方向键右|方向鍵右|右箭头键|右箭頭鍵|\barrowright\b|→/i, 'ArrowRight'],
  [/上方向|方向键上|方向鍵上|\barrowup\b|↑/i, 'ArrowUp'], [/下方向|方向键下|方向鍵下|\barrowdown\b|↓/i, 'ArrowDown'],
]
const modifiers: Record<string, string> = { ctrl: 'Control', control: 'Control', cmd: 'Meta', command: 'Meta', meta: 'Meta', alt: 'Alt', option: 'Alt', shift: 'Shift' }

/** 子句里的按键：「按 Enter」「按下 Ctrl+K 键」或 回车 / Esc / 方向键 等说法。 */
export function keyOf(clause: string): string | undefined {
  const explicit = /(?:按下?|press)\s*([A-Za-z][A-Za-z0-9]*(?:\s*\+\s*[A-Za-z0-9]+)*)\s*(?:键|鍵)?/i.exec(clause)
  if (explicit) {
    const parts = explicit[1]!.split(/\s*\+\s*/).map(part => modifiers[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)))
    const last = parts.at(-1)!
    const named = keyNames.find(([pattern]) => pattern.test(last))?.[1]
    return [...parts.slice(0, -1), named ?? last].join('+')
  }
  return keyNames.find(([pattern]) => pattern.test(clause))?.[1]
}

/**
 * 把 trigger 翻译成动作序列。每个子句按动词出现的先后排动作，目标按子句里提到的节点取；
 * 「无 / 沒有」开头的触发表示稿面没有交互。
 */
export function parseTrigger(trigger: string, context: { known?: readonly string[] } = {}): { actions: Action[]; issue?: string } {
  const text = trigger.trim()
  if (!text) return { actions: [], issue: '触发为空' }
  if (/^(?:无|無|没有|沒有|不适用|不適用|n\/a|none|-)\b|^(?:无|無|没有|沒有)[（(：:，,\s]|^(?:无|無)$/i.test(text)) return { actions: [], issue: '触发声明为无交互' }
  const actions: Action[] = []
  for (const clause of clauses(firstAlternative(text))) {
    const target = mentionedTarget(clause, context.known)
    const selector = target ? selectorFor(target) : undefined
    const found: { index: number; action: Action }[] = []
    const detect = (pattern: RegExp, make: () => Action) => { const match = pattern.exec(clause); if (match) found.push({ index: match.index, action: make() }) }
    detect(/输入|輸入|填写|填寫|键入|鍵入|\btype\b|\bfill\b/i, () => ({ kind: 'type', selector, text: quoted.exec(clause)?.[1] ?? DEFAULT_INPUT }))
    detect(/悬停|懸停|悬浮|懸浮|移到|移入|移至|移上|\bhover\b|鼠标移|滑鼠移|指向/i, () => ({ kind: 'hover', selector }))
    detect(/点击|點擊|单击|單擊|点选|點選|轻点|輕點|点一下|點一下|\bclick\b|\btap\b/i, () => ({ kind: 'click', selector }))
    const key = keyOf(clause)
    if (key) { const match = /按|press|回车|回車|enter|esc|空格|space|tab|退格|backspace|delete|方向|箭头|箭頭|键盘|鍵盤|arrow|[←→↑↓]/i.exec(clause); found.push({ index: match?.index ?? clause.length, action: { kind: 'press', selector, key } }) }
    detect(/滚动|滾動|滑动|滑動|\bscroll\b|滑到|滚到|滾到/i, () => ({ kind: 'scroll', selector, bottom: /底|末尾|最下/.test(clause) }))
    actions.push(...found.sort((a, b) => a.index - b.index).map(item => item.action))
  }
  if (!actions.length) return { actions, issue: '触发无法翻译为 点击 / 悬停 / 输入 / 按键 / 滚动 动作：' + text }
  return { actions: actions.slice(0, MAX_ACTIONS) }
}

/** 描述另一个动作或带条件的子句不作断言（「再次点击收起」「空关键字时不跳转」）。 */
const furtherAction = /点击|點擊|单击|單擊|输入|輸入|回车|回車|悬停|懸停|按下|按\s*[A-Za-z]|滚动|滾動/
const conditional = /[时時](?![间間])|若|如果|除非|否则|否則|当(?!前)|當(?!前)/
/** 可断言的状态属性；data-design 是定位用的标记，不当属性断言。 */
const attributePattern = /(aria-[a-z]+|data-(?!design\b)[a-z][a-z-]*|disabled|checked|selected|open|hidden)(?:\s*(?:=|为|為|设为|設為|变为|變為|切换为|切換為|改为|改為|:|：)\s*["'“「]?(true|false|[a-z0-9-]+)["'”」]?)?/i
const routePath = /((?:\/[A-Za-z][\w-]*)+\/?)/

/**
 * 从 response 提取可机器判断的断言；什么都识别不出时退回「执行后页面或节点有变化」。
 * @param context.typed trigger 里输入的文字：自动断言它写进了输入框。
 */
export function parseResponse(response: string, context: { known?: readonly string[]; typed?: string } = {}): Assertion[] {
  const result: Assertion[] = []
  const seen = new Set<string>()
  const add = (assertion: Assertion) => { const key = [assertion.kind, assertion.selector, assertion.attribute, assertion.value, assertion.text, assertion.path].join('|'); if (!seen.has(key)) { seen.add(key); result.push(assertion) } }
  if (context.typed) add({ kind: 'value', text: context.typed, description: '输入的「' + context.typed + '」写进了输入框' })
  let routeDecided = false
  for (const clause of response.split(/[；;。，,]/).map(item => item.trim()).filter(Boolean)) {
    if (furtherAction.test(clause) || conditional.test(clause)) continue
    const target = mentionedTarget(clause, context.known)
    const selector = target ? selectorFor(target) : undefined
    const label = target ? '节点 ' + target : undefined
    if (!routeDecided) {
      if (/不(?:会|會)?(?:跳转|跳轉|跳页|跳頁|导航|導航|离开|離開|切换路由|切換路由|改变地址|改變地址)/.test(clause)) { add({ kind: 'route-same', description: '地址不变（不跳转）' }); routeDecided = true }
      else if (/跳转|跳轉|跳页|跳頁|导航到|導航到|进入.{0,8}[页頁]|進入.{0,8}[页頁]|路由|地址栏|地址欄|\burl\b/i.test(clause)) { const path = routePath.exec(clause)?.[1]; add({ kind: 'route', path, description: path ? '地址变为包含 ' + path : '地址发生变化（跳转）' }); routeDecided = true }
    }
    const attribute = attributePattern.exec(clause)
    if (attribute) add({ kind: 'attribute', selector, attribute: attribute[1]!.toLowerCase(), value: attribute[2]?.toLowerCase(), description: (label ?? '目标元素') + ' 的 ' + attribute[1]!.toLowerCase() + (attribute[2] ? ' 为 ' + attribute[2] : ' 发生变化') })
    else if (/(?<!不|未|非)(?:禁用|置灰|不可用|不可点|不可點)/.test(clause)) add({ kind: 'attribute', selector, attribute: 'disabled', value: 'true', description: (label ?? '目标元素') + ' 被禁用' })
    else if (/恢复可用|恢復可用|启用|啟用|解除禁用/.test(clause)) add({ kind: 'attribute', selector, attribute: 'disabled', value: 'false', description: (label ?? '目标元素') + ' 可用' })
    const text = quoted.exec(clause)?.[1]
    if (text && /文字|文案|标题|標題|显示|顯示|变为|變為|更新|提示|内容|內容|为「|為「|改为|改為/.test(clause) && !/图标|圖標|\bicon\b|原图|原圖|图片|圖片|素材|class|类名|類名|placeholder/i.test(clause)) add({ kind: 'text', selector, text, description: (label ?? '页面') + ' 出现文字「' + text + '」' })
    if (/不变形|不變形|不改变|不改變|保持|无变化|無變化|不变|不變|静态|靜態|照稿|不做|不实作|不實作|不实现|不實現|维持|維持/.test(clause)) add({ kind: 'unchanged', selector, description: (label ?? '目标元素') + ' 没有变化' })
    else if (/消失|隐藏|隱藏|收起|关闭|關閉|不显示|不顯示|移除|让位|讓位|清空/.test(clause)) add({ kind: 'disappear', selector, description: label ? label + ' 消失或隐藏' : '页面有内容消失或隐藏' })
    else if (/展开|展開|显示|顯示|出现|出現|可见|可見|打开|打開|弹出|彈出|展示|追加|新增|载入|載入|加载|加載|浮现|浮現/.test(clause)) add({ kind: 'appear', selector, description: label ? label + ' 出现并可见' : '页面出现新内容' })
    else if (/切换|切換|更新|高亮|变为|變為|改变|改變|变化|變化|替换|替換|写入|寫入|填入|响应|響應|改为|改為|聚焦|获得焦点|獲得焦點/.test(clause)) add({ kind: 'change', selector, description: label ? label + ' 有变化' : '页面或目标元素有变化' })
  }
  if (!result.length) add({ kind: 'change', description: '执行后页面或目标元素有变化' })
  return result
}

const describeRect = (state: ElementState) => Math.round(state.rect.width) + '×' + Math.round(state.rect.height)
const truthy = (value: string | undefined) => value !== undefined && value !== 'false'

/**
 * 判定一条断言。
 * @param defaultSelector 条目本身的 data-design 选择器（没有显式目标时 attribute / unchanged / value / change 看它）。
 */
export function judge(assertion: Assertion, before: Snapshot, after: Snapshot, defaultSelector: string): { passed: boolean; actual: string } {
  const selector = assertion.selector ?? defaultSelector
  const prev = before.elements[selector], next = after.elements[selector]
  const explicit = assertion.selector !== undefined
  const pageChanged = after.page.url !== before.page.url || after.page.elements !== before.page.elements || after.page.textLength !== before.page.textLength
  const targetChanged = !!prev && !!next && (prev.html !== next.html || prev.exists !== next.exists || prev.visible !== next.visible)
  switch (assertion.kind) {
    case 'route': {
      const changed = after.page.url !== before.page.url
      const matched = assertion.path ? after.page.url.includes(assertion.path) : changed
      return { passed: matched, actual: '地址 ' + before.page.url + ' → ' + after.page.url }
    }
    case 'route-same': return { passed: after.page.url === before.page.url, actual: after.page.url === before.page.url ? '地址未变：' + after.page.url : '地址变为 ' + after.page.url }
    case 'attribute': {
      if (!next?.exists) return { passed: false, actual: '执行后找不到元素 ' + selector }
      const was = prev?.attributes[assertion.attribute!], now = next.attributes[assertion.attribute!]
      const shown = assertion.attribute + ': ' + (was === undefined ? '（无）' : JSON.stringify(was)) + ' → ' + (now === undefined ? '（无）' : JSON.stringify(now))
      if (assertion.value === undefined) return { passed: was !== now, actual: shown }
      if (assertion.value === 'true') return { passed: truthy(now), actual: shown }
      if (assertion.value === 'false') return { passed: !truthy(now), actual: shown }
      return { passed: now?.toLowerCase() === assertion.value, actual: shown }
    }
    case 'text': {
      const haystack = explicit ? next?.text ?? '' : after.page.bodyText
      return { passed: haystack.includes(assertion.text!), actual: haystack.includes(assertion.text!) ? '找到文字「' + assertion.text + '」' : '没有找到文字「' + assertion.text + '」' + (explicit ? '，元素文字：' + (next?.text ?? '').slice(0, 120) : '') }
    }
    case 'value': {
      if (!next?.exists) return { passed: false, actual: '执行后找不到元素 ' + selector }
      return { passed: next.value.includes(assertion.text!), actual: '输入框值：' + JSON.stringify(next.value.slice(0, 120)) }
    }
    case 'appear': {
      if (explicit) return { passed: !!next?.exists && next.visible, actual: !next?.exists ? '元素不存在：' + selector : next.visible ? '元素可见（' + describeRect(next) + '）' : '元素存在但不可见' }
      const grew = after.page.elements > before.page.elements || after.page.textLength > before.page.textLength
      return { passed: grew || targetChanged, actual: '元素数 ' + before.page.elements + ' → ' + after.page.elements + '，文字长度 ' + before.page.textLength + ' → ' + after.page.textLength + (targetChanged ? '，目标元素已变化' : '') }
    }
    case 'disappear': {
      if (explicit) return { passed: !next?.exists || !next.visible, actual: !next?.exists ? '元素已不存在' : next.visible ? '元素仍可见（' + describeRect(next) + '）' : '元素已隐藏' }
      const shrank = after.page.elements < before.page.elements || after.page.textLength < before.page.textLength
      return { passed: shrank || targetChanged, actual: '元素数 ' + before.page.elements + ' → ' + after.page.elements + '，文字长度 ' + before.page.textLength + ' → ' + after.page.textLength + (targetChanged ? '，目标元素已变化' : '') }
    }
    case 'change': return { passed: explicit ? targetChanged : targetChanged || pageChanged, actual: targetChanged ? '目标元素已变化' : pageChanged ? '页面已变化（元素数 ' + before.page.elements + ' → ' + after.page.elements + '，地址 ' + after.page.url + '）' : '执行后页面与目标元素都没有变化' }
    case 'unchanged': {
      if (!prev?.exists || !next?.exists) return { passed: false, actual: '找不到元素 ' + selector }
      const same = prev.html === next.html && Math.round(prev.rect.width) === Math.round(next.rect.width) && Math.round(prev.rect.height) === Math.round(next.rect.height)
      return { passed: same, actual: same ? '元素未变化（' + describeRect(next) + '）' : '元素有变化：' + describeRect(prev) + ' → ' + describeRect(next) + (prev.html !== next.html ? '，结构或属性不同' : '') }
    }
  }
}

/** 动作的可读描述，写进报告。 */
export function describeAction(action: Action, defaultSelector: string): string {
  const target = action.selector ?? defaultSelector
  switch (action.kind) {
    case 'click': return 'click ' + target
    case 'hover': return 'hover ' + target
    case 'type': return 'type ' + JSON.stringify(action.text ?? '') + ' → ' + target
    case 'press': return 'press ' + action.key + ' @ ' + target
    case 'scroll': return action.bottom ? 'scroll 到页面底部' : 'scroll ' + target
  }
}

export interface InteractInput {
  root: string
  specs: readonly InteractionSpec[]
  url: string
  width: number
  height: number
  open: DriverFactory
  /** 是否另截窄屏整页图，默认截。 */
  narrow?: boolean
  signal?: AbortSignal
}

/** 逐条执行已填写的交互规范，写截图与报告。 */
export async function runInteractions(input: InteractInput): Promise<InteractResult> {
  const { root, url, width, height } = input
  const filled = input.specs.filter(spec => !isPending(spec))
  if (!filled.length) throw new Error('docs/design/interactions.yaml 里没有已填写 trigger 与 response 的条目，无法执行交互')
  const known = [...new Set(input.specs.flatMap(spec => [spec.id, spec.node]).filter(Boolean))]
  const issues: string[] = [], warnings: string[] = [], results: InteractionOutcome[] = []
  await mkdir(join(root, SCREENSHOT_DIR), { recursive: true })
  let lastShot: Buffer | undefined
  const shot = async (driver: InteractionDriver, path: string, options: { selector?: string; fullPage?: boolean }): Promise<string | undefined> => {
    try { lastShot = await driver.screenshot(options); await writeFile(join(root, path), lastShot); return path }
    catch (error) { warnings.push(path + '：截图失败：' + (error instanceof Error ? error.message : String(error))); return undefined }
  }
  const driver = await input.open({ width, height })
  try {
    for (const spec of filled) {
      input.signal?.throwIfAborted()
      const started = Date.now()
      const outcome: InteractionOutcome = { id: spec.id, node: spec.node, name: spec.name, type: spec.type, trigger: spec.trigger, response: spec.response, status: 'failed', passed: false, selector: '', actions: [], assertions: [], actual: '', evidence: {}, durationMs: 0 }
      results.push(outcome)
      const parsed = parseTrigger(spec.trigger, { known })
      if (parsed.issue) {
        outcome.status = parsed.issue === '触发声明为无交互' ? 'skipped' : 'unsupported'
        outcome.passed = outcome.status === 'skipped'
        outcome.actual = parsed.issue
        if (outcome.status === 'unsupported') issues.push('交互 ' + spec.id + '（' + spec.name + '）：' + parsed.issue + '；请把 trigger 改写成 点击 / 悬停 / 输入「文字」/ 按 Enter / 滚动 的描述（可写节点 ID 指定目标），稿面没有交互时写「无」')
        else warnings.push('交互 ' + spec.id + '（' + spec.name + '）声明无交互，未执行')
        outcome.durationMs = Date.now() - started
        continue
      }
      try {
        // 每条交互都从初始页面开始，前一条留下的状态不影响后一条。
        await driver.goto(url)
        const candidates = [spec.node, spec.id].filter(Boolean).map(selectorFor)
        const probe = await driver.snapshot(candidates)
        const selector = candidates.find(candidate => probe.elements[candidate]?.exists)
        if (!selector) {
          outcome.actual = '页面上没有 data-design="' + spec.node + '"（或 "' + spec.id + '"）的元素'
          issues.push('交互 ' + spec.id + '（' + spec.name + '）：' + outcome.actual + '，请在对应节点根元素上标记')
          outcome.evidence.before = await shot(driver, SCREENSHOT_DIR + '/' + spec.id + '-before.png', {})
          outcome.durationMs = Date.now() - started
          continue
        }
        outcome.selector = selector
        outcome.actions = parsed.actions.map(action => describeAction(action, selector))
        const typed = parsed.actions.find(action => action.kind === 'type')?.text
        const assertions = parseResponse(spec.response, { known, typed })
        const watched = [...new Set([selector, ...assertions.map(assertion => assertion.selector).filter((value): value is string => !!value), ...parsed.actions.map(action => action.selector).filter((value): value is string => !!value)])]
        const before = await driver.snapshot(watched)
        outcome.evidence.before = await shot(driver, SCREENSHOT_DIR + '/' + spec.id + '-before.png', { selector })
        let error: string | undefined, typedState: ElementState | undefined
        for (const action of parsed.actions) {
          input.signal?.throwIfAborted()
          try {
            await driver.perform(action, selector)
            // 输入后可能紧接着回车跳页，输入框的值在跳转前记下来，value 断言按它判定。
            if (action.kind === 'type') typedState = (await driver.snapshot([action.selector ?? selector])).elements[action.selector ?? selector]
          } catch (failed) { error = describeAction(action, selector) + ' 失败：' + (failed instanceof Error ? failed.message.split('\n')[0] : String(failed)); break }
        }
        const after = await driver.snapshot(watched)
        outcome.evidence.after = await shot(driver, SCREENSHOT_DIR + '/' + spec.id + '-after.png', { selector })
        const typedAfter: Snapshot = typedState ? { ...after, elements: { ...after.elements, [selector]: typedState } } : after
        outcome.assertions = assertions.map(assertion => ({ description: assertion.description, ...judge(assertion, before, assertion.kind === 'value' ? typedAfter : after, selector) }))
        if (error) { outcome.error = error; outcome.actual = error }
        else outcome.actual = outcome.assertions.map(item => (item.passed ? '✓ ' : '✗ ') + item.description + '：' + item.actual).join('；')
        outcome.passed = !error && outcome.assertions.every(item => item.passed)
        outcome.status = outcome.passed ? 'passed' : 'failed'
        if (!outcome.passed) issues.push('交互 ' + spec.id + '（' + spec.name + '）未通过：' + outcome.actual)
      } catch (failed) {
        if (input.signal?.aborted) throw failed
        outcome.error = failed instanceof Error ? failed.message.split('\n')[0] : String(failed)
        outcome.actual = '执行出错：' + outcome.error
        issues.push('交互 ' + spec.id + '（' + spec.name + '）执行出错：' + outcome.error)
      }
      outcome.durationMs = Date.now() - started
    }
  } finally { await driver.close().catch(() => {}) }
  const narrow: InteractResult['narrow'] = { width: NARROW_WIDTH, height: NARROW_HEIGHT }
  if (input.narrow !== false) {
    try {
      const mobile = await input.open({ width: NARROW_WIDTH, height: NARROW_HEIGHT })
      try {
        await mobile.goto(url)
        narrow.screenshot = await shot(mobile, SCREENSHOT_DIR + '/narrow-' + NARROW_WIDTH + '.png', { fullPage: true })
        // 整页截图的宽度就是文档滚动宽度：比视口宽说明页面没有响应式适配，如实记录而不是只给一张图。
        const size = narrow.screenshot && lastShot ? imageSize(lastShot, narrow.screenshot) : undefined
        if (size) {
          narrow.imageWidth = size.width; narrow.imageHeight = size.height
          if (size.width > NARROW_WIDTH + 2) { narrow.overflow = true; warnings.push('窄屏（' + NARROW_WIDTH + ' 宽）下页面内容宽 ' + size.width + 'px，横向溢出，没有响应式适配；若稿面只有桌面版，在清单里说明') }
        }
      } finally { await mobile.close().catch(() => {}) }
    } catch (error) { narrow.error = error instanceof Error ? error.message.split('\n')[0] : String(error); warnings.push('窄屏截图失败：' + narrow.error) }
  }
  const summary = { total: results.length, passed: results.filter(item => item.status === 'passed').length, failed: results.filter(item => item.status === 'failed').length, skipped: results.filter(item => item.status === 'skipped').length, unsupported: results.filter(item => item.status === 'unsupported').length }
  const ready = issues.length === 0
  const next = ready ? '全部交互断言通过，前后截图在 ' + SCREENSHOT_DIR + '/。调用 design_review(stage=verify)，verify 直接采用本报告的结果与证据，不必再传 interactions 与 visuals。'
    : '按 issues 修复实现（或修正 interactions.yaml 里写得不可执行的 trigger / response），再调用 design_review(stage=interact) 重跑；不要自己启动浏览器。'
  const full = { stage: 'interact' as const, generatedAt: new Date().toISOString(), url, width, height, narrow, results, summary, issues, warnings }
  await writeJsonAtomic(root, INTERACTION_REPORT_PATH, full)
  return { stage: 'interact', ready, url, width, height, results, narrow, summary, issues, warnings, report: INTERACTION_REPORT_PATH, next }
}

interface Locator {
  first(): Locator
  count(): Promise<number>
  locator(selector: string): Locator
  click(options?: object): Promise<void>
  hover(options?: object): Promise<void>
  fill(value: string, options?: object): Promise<void>
  pressSequentially(value: string, options?: object): Promise<void>
  press(key: string, options?: object): Promise<void>
  scrollIntoViewIfNeeded(options?: object): Promise<void>
}
interface Page {
  setDefaultTimeout(ms: number): void
  goto(url: string, options?: object): Promise<unknown>
  evaluate<T>(script: (arg: never) => T, arg?: unknown): Promise<T>
  addStyleTag(options: { content: string }): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  waitForLoadState(state: string, options?: object): Promise<void>
  locator(selector: string): Locator
  screenshot(options: object): Promise<Buffer>
  keyboard: { press(key: string, options?: object): Promise<void> }
  mouse: { wheel(x: number, y: number): Promise<void> }
}
interface Browser { newContext(options: object): Promise<{ newPage(): Promise<Page> }>; close(): Promise<void> }

/** 页面内执行：按选择器取元素状态与整页概况。 */
function inspect(input: { selectors: string[]; attributes: string[] }): Snapshot {
  const elements: Record<string, ElementState> = {}
  for (const selector of input.selectors) {
    let element: Element | null = null
    try { element = document.querySelector(selector) } catch (error) { element = null }
    if (!(element instanceof HTMLElement || element instanceof SVGElement)) { elements[selector] = { exists: false, visible: false, text: '', value: '', html: '', rect: { x: 0, y: 0, width: 0, height: 0 }, attributes: {} }; continue }
    const rect = element.getBoundingClientRect()
    const checker = element as Element & { checkVisibility?(options: object): boolean }
    const visible = typeof checker.checkVisibility === 'function' ? checker.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && rect.width > 0 && rect.height > 0 : rect.width > 0 && rect.height > 0
    const attributes: Record<string, string> = {}
    for (const attribute of Array.from(element.attributes)) attributes[attribute.name] = attribute.value
    // 状态属性常在内部控件上（行里的按钮带 aria-expanded），元素本身没有时向下补找。
    for (const name of input.attributes) if (!(name in attributes)) { const inner = element.querySelector('[' + name + ']'); if (inner) attributes[name] = inner.getAttribute(name) ?? '' }
    const field = element.matches('input, textarea, select, [contenteditable]') ? element : element.querySelector('input, textarea, select, [contenteditable]')
    const value = field ? 'value' in field && typeof (field as HTMLInputElement).value === 'string' ? (field as HTMLInputElement).value : (field as HTMLElement).innerText ?? '' : ''
    const text = (element instanceof HTMLElement ? element.innerText : element.textContent ?? '').replace(/\s+/g, ' ').trim()
    elements[selector] = { exists: true, visible, text: text.slice(0, 2000), value: value.slice(0, 2000), html: element.outerHTML.slice(0, 30000), rect: { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height }, attributes }
  }
  const body = document.body ? document.body.innerText : ''
  return { page: { url: location.href, title: document.title, elements: document.querySelectorAll('*').length, textLength: body.length, bodyText: body.replace(/\s+/g, ' ').slice(0, 100000) }, elements }
}

/** 页面内执行：滚到底部。 */
function scrollToBottom(): void { window.scrollTo(0, document.documentElement.scrollHeight) }

/**
 * 创建 Playwright 驱动工厂；每个视口起一个独立浏览器。
 * @param options.module playwright 入口文件绝对路径。
 * @param options.timeoutMs 单次页面操作上限，默认 30 秒。
 */
export function playwrightDriver(options: { module: string; signal?: AbortSignal; timeoutMs?: number }): DriverFactory {
  const timeout = options.timeoutMs ?? 30_000
  return async viewport => {
    const chromium = await loadChromium(options.module) as unknown as { launch(options: object): Promise<Browser> }
    const browser = await chromium.launch({ headless: true })
    const abort = () => { void browser.close() }
    options.signal?.addEventListener('abort', abort, { once: true })
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'zh-CN' })
    const page = await context.newPage()
    page.setDefaultTimeout(timeout)
    const locate = (selector: string) => page.locator(selector).first()
    /** 输入与按键落在元素内部的第一个输入控件上；元素本身可编辑或没有控件时就是它自己。 */
    const editable = async (selector: string) => {
      const inner = locate(selector).locator('xpath=descendant-or-self::*[self::input or self::textarea or @contenteditable]').first()
      return await inner.count() > 0 ? inner : locate(selector)
    }
    /** data-design 常标在包裹行上，点击落在它中心会错过左侧的按钮：元素本身不是控件时点内部第一个控件（button / a / summary / role 为按钮类 / 输入控件）。 */
    const clickable = async (selector: string) => {
      const inner = locate(selector).locator('xpath=descendant-or-self::*[self::button or self::a or self::summary or self::input or self::select or self::textarea or @role="button" or @role="tab" or @role="menuitem" or @role="option" or @role="switch" or @role="checkbox" or @role="link" or @onclick]').first()
      return await inner.count() > 0 ? inner : locate(selector)
    }
    const settle = async () => { await page.waitForTimeout(400); await page.waitForLoadState('load', { timeout: 3000 }).catch(() => {}); await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {}) }
    return {
      async goto(url) {
        await page.goto(url, { waitUntil: 'networkidle', timeout }).catch(async () => { await page.goto(url, { waitUntil: 'load', timeout }) })
        // 关闭动画与过渡，保证前后截图与状态比较稳定。
        await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' }).catch(() => {})
        await page.waitForTimeout(200)
      },
      snapshot: selectors => page.evaluate(inspect, { selectors, attributes: stateAttributes }),
      async perform(action, defaultSelector) {
        const selector = action.selector ?? defaultSelector
        if (action.kind === 'click') await (await clickable(selector)).click({ timeout })
        else if (action.kind === 'hover') await locate(selector).hover({ timeout })
        else if (action.kind === 'type') { const field = await editable(selector); try { await field.fill(action.text ?? '', { timeout }) } catch (error) { await field.pressSequentially(action.text ?? '', { timeout }) } }
        else if (action.kind === 'press') await (await editable(selector)).press(action.key ?? 'Enter', { timeout })
        else if (action.bottom) await page.evaluate(scrollToBottom)
        else if (action.selector) await locate(selector).scrollIntoViewIfNeeded({ timeout })
        else await page.mouse.wheel(0, 600)
        await settle()
      },
      async screenshot({ selector, fullPage }) {
        // 跳转后目标元素可能已不在页面上，先确认存在再滚动，避免白等到超时。
        if (selector && await locate(selector).count() > 0) await locate(selector).scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
        return page.screenshot({ type: 'png', fullPage: !!fullPage, animations: 'disabled', caret: 'hide', timeout })
      },
      async close() { options.signal?.removeEventListener('abort', abort); await browser.close().catch(() => {}) },
    }
  }
}
