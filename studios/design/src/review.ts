/** 固定还原流程的只读检查；任务计划先登记，代码与素材随后逐项核对。 */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { inside, object, readOptional, text } from './project.ts'
import { imageSize, MANIFEST_PATH, type Manifest } from './reader.ts'
import { INTERACTION_SPEC_PATH, interactionTemplateIssues, isPending, loadInteractions, type InteractionSpec } from './interactions.ts'
import { boundDesignIds, mappingIssues, propIssues, unregisteredHits } from './installed.ts'
import { readManifestForCompare, resolvePreviewUrl, runCompare, type CompareResult, type Measurer } from './compare.ts'
import { INTERACTION_REPORT_PATH, runInteractions, type DriverFactory, type InteractResult } from './interact.ts'
import { matchManifest, type ComponentRule } from './componentMap.ts'
import { loadComponentMap } from './componentMapStore.ts'

/** 需求里「允许自定义 <节点名>」声明的节点：只有这些节点可以把映射命中的实例登记为 custom。 */
export function customAllowances(request: string): string[] {
  return [...request.matchAll(/允许自定义\s*[:：]?\s*([^\s，,。；;、]+)/g)].map(match => match[1]!.trim()).filter(Boolean)
}

/** 节点的交互语义；用于检查通用按钮不能代替完整业务组件。 */
export const reviewPatterns = ['button', 'search', 'menu', 'select', 'carousel', 'tabs', 'dialog', 'drawer', 'popover', 'pagination', 'table', 'tree', 'date-picker', 'form', 'coupon', 'fab', 'badge', 'image', 'layout', 'custom'] as const
type Pattern = typeof reviewPatterns[number]
interface Requirement { node: string; component: string; file: string; source: 'project' | 'reborn' | 'custom'; pattern?: Pattern; evidence?: string; /** 用户明确允许自定义的节点。 */ allowed?: boolean }
interface Interaction { node: string; action: string; expected: string }
interface Asset { node: string; exported: string; used: string; digest: string }
interface Plan { root: string; requirements: Requirement[]; assets: Asset[]; interactions: Interaction[] }

/** 几何与像素审计的最大轮数，之后剩余差异写进清单。 */
export const MAX_COMPARE_ROUNDS = 3
const screenshotName = /(?:^|[/\\])(?:screenshots?|截图|screen-capture)(?:[/\\.]|$)/i
const ignoredDirectories = /(?:^|[/\\])(?:node_modules|\.git|dist|\.nuxt|\.output)(?:[/\\]|$)/
const interactive = new Set<Pattern>(['button', 'search', 'menu', 'select', 'carousel', 'tabs', 'dialog', 'drawer', 'popover', 'pagination', 'tree', 'date-picker', 'form', 'fab'])
const patternComponents: Partial<Record<Pattern, readonly string[]>> = {
  button: ['reborn-button'], search: ['reborn-search-box', 'halo-search'], menu: ['reborn-dropdown'], select: ['reborn-select', 'reborn-dropdown-select', 'reborn-tree-select'],
  carousel: ['reborn-carousel', 'apple-card-carousel'], tabs: ['reborn-tabs', 'reborn-tabbar', 'morphing-tabs'], dialog: ['reborn-dialog'], drawer: ['reborn-drawer'],
  popover: ['reborn-popover'], pagination: ['reborn-pagination'], table: ['reborn-table'], tree: ['reborn-tree', 'reborn-tree-select'],
  'date-picker': ['reborn-date-picker', 'reborn-date-picker-panel'], form: ['reborn-form'], coupon: ['reborn-coupon'], fab: ['reborn-fab'],
  badge: ['reborn-badge', 'reborn-chip'], image: ['reborn-image', 'reborn-avatar'],
}

function inferredPattern(name: string): Pattern | undefined {
  if (/按钮|button/i.test(name) && !/按钮组|浮动操作|悬浮操作/i.test(name)) return 'button'
  if (/日期选择|date.?picker/i.test(name)) return 'date-picker'
  const rules: [RegExp, Pattern][] = [[/搜索框|搜索区|search.?box/i, 'search'], [/下拉菜单|dropdown.?menu/i, 'menu'], [/下拉选择|选择器|select/i, 'select'], [/轮播|carousel/i, 'carousel'], [/标签页|选项卡|tabs/i, 'tabs'], [/对话框|弹窗|dialog/i, 'dialog'], [/抽屉|drawer/i, 'drawer'], [/气泡|popover/i, 'popover'], [/分页|pagination/i, 'pagination'], [/数据表格|data.?table/i, 'table'], [/树形|tree/i, 'tree'], [/日期选择|date.?picker/i, 'date-picker'], [/表单|form/i, 'form'], [/优惠券|卡券|coupon/i, 'coupon'], [/浮动操作|悬浮操作|悬浮按钮|fab/i, 'fab']]
  return rules.find(([expression]) => expression.test(name))?.[1]
}

function inferredComponent(component: string): Pattern | undefined {
  return (Object.entries(patternComponents) as [Pattern, readonly string[]][]).find(([, components]) => components.includes(component))?.[0]
}

function nodeNames(manifest: Manifest | null, node: string): string {
  const refersTo = (id: string) => new RegExp('(?:^|[^A-Za-z0-9:_-])' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^A-Za-z0-9:_-])').test(node)
  return [node, ...(manifest?.blocks.flatMap(block => [block, ...(block.spec ?? [])]).filter(item => refersTo('nodeId' in item ? item.nodeId : item.id)).map(item => item.name ?? '') ?? [])].join(' ')
}

function manifestAssets(manifest: Manifest | null): string[] {
  return [...new Set(manifest?.blocks.filter(block => block.status === 'ok').flatMap(block => block.assets.filter(asset => ['icon', 'image', 'shape'].includes(asset.kind)).map(asset => asset.path)) ?? [])]
}

function rows(value: unknown, name: string, max: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(name + '数量无效')
  return value.map(object)
}
function localPath(value: unknown): string {
  const path = text(value, 2048)
  if (!path || path.startsWith('/') || /^[A-Za-z]:|^\\|(?:^|[/\\])\.\.(?:[/\\]|$)/.test(path) || ignoredDirectories.test(path)) throw new Error('需要项目内的相对文件路径')
  return path
}
function requiredText(value: unknown, max = 256): string {
  const result = text(value, max).trim()
  if (!result) throw new Error('节点、动作与验收说明不能为空')
  return result
}
async function digest(root: string, path: string): Promise<string> {
  const file = await inside(root, path)
  const info = await stat(file)
  if (!info.isFile() || info.size === 0 || info.size > 32_000_000) throw new Error('素材文件为空或过大：' + path)
  return createHash('sha256').update(await readFile(file)).digest('hex')
}
function markup(source: string): string {
  // 注释和脚本里的组件名称不算模板使用；这里只检查 Vue 模板，不执行项目代码。
  const template = /<template(?:\s[^>]*)?>([\s\S]*)<\/template>/.exec(source)?.[1] ?? ''
  return template.replace(/<!--[\s\S]*?-->/g, '')
}
function uses(template: string, component: string): boolean {
  const pascal = component.split('-').map(word => word[0]!.toUpperCase() + word.slice(1)).join('')
  return new RegExp('<(?:' + component + '|' + pascal + ')(?=[\\s/>])').test(template)
}

/** 工作室预读产物（可能不存在：Magic 读取或关闭预读时）。 */
async function readManifest(root: string): Promise<Manifest | null> {
  const content = await readOptional(root, MANIFEST_PATH, 8_000_000)
  if (content === null) return null
  const value = JSON.parse(content) as Manifest
  if (value.schemaVersion !== 1 || !Array.isArray(value.blocks) || value.blocks.some(block => !Array.isArray(block.assets))) throw new Error('预读清单无效，请重新读取设计稿后登记计划')
  return value
}

/**
 * 模板级检查，针对历次还原里反复出现的错误：
 * 导出图标被旋转、被画布裁切的图用 cover 放大、轮播插槽里的箭头点不到、轮播没有指示器配置。
 * @param clipped - 已登记且在 manifest 中标为裁切的素材在页面里的引用路径。
 */
export function templateIssues(file: string, template: string, clipped: string[], partial: string[] = []): { issues: string[]; warnings: string[] } {
  const issues: string[] = [], warnings: string[] = []
  for (const [, attrs] of template.matchAll(/<img\b([^>]*)>/g)) {
    const src = /\bsrc="([^"]*)"/.exec(attrs!)?.[1] ?? ''
    const exported = /asset\/icons\/|\/icons\/|\.svg(?:\?|$)/i.test(src)
    if (exported && /(?:^|[\s"'])-?rotate-|\brotate\(/.test(attrs!)) issues.push(file + '：导出图标 ' + src + ' 被旋转，请核对并使用该节点的原始切图方向')
    if (clipped.some(reference => src === reference) && /\bobject-cover\b/.test(attrs!)) issues.push(file + '：' + src + ' 只有画布可见的半幅，不能用 object-cover 放大；按稿面位置用 object-fit: none 与 object-position')
    else if (partial.some(reference => src === reference) && /\bobject-(?:cover|fill)\b|object-fit:\s*(?:cover|fill)/.test(attrs!)) issues.push(file + '：' + src + ' 的导出像素只有稿面盒子的一部分，不能用 object-cover / object-fill 拉伸；用预读补导出的全图（manifest 该素材的 fullImage），没有全图时按稿面位置用 object-fit: none')
  }
  for (const [, attrs] of template.matchAll(/<Icon\b([^>]*)>/g)) if (/lucide:/.test(attrs!) && /(?:^|[\s"'])-?rotate-/.test(attrs!)) warnings.push(file + '：图标库图标被旋转，请核对稿面箭头方向')
  for (const [, slot, inner] of template.matchAll(/<template\s+#(prev|next)(?:="[^"]*")?\s*>([\s\S]*?)<\/template>/g)) {
    if (/<(?:button|RebornButton|reborn-button)\b/.test(inner!) && !/pointer-events-auto/.test(inner!)) issues.push(file + '：轮播 #' + slot + ' 插槽里的按钮缺少 pointer-events-auto，箭头组默认不接收点击')
  }
  for (const [, attrs] of template.matchAll(/<(?:RebornCarousel|reborn-carousel)\b([^>]*)>/g)) if (!/\bpagination\b/.test(attrs!)) warnings.push(file + '：轮播未配置 pagination；稿面有指示器时需 :pagination="{ type: \'dot\', indicatorBackground: false }"')
  return { issues, warnings }
}

/** 检查结果不代替视觉验收；截图只登记存在性，不虚构像素相似度。 */
export interface ReviewResult {
  stage: 'plan' | 'check' | 'verify'
  ready: boolean
  issues: string[]
  /** 不阻塞流程但需要在报告中说明的提醒。 */
  warnings: string[]
  components: number
  assets: number
  visualStatus: 'pending-comparison' | 'evidence-recorded'
  verificationStatus: 'pending' | 'evidence-recorded'
  interactions: Interaction[]
  evidence?: { path: string; sha256: string }[]
  /** docs/design/interactions.yaml 存在时的规范概况：待补条目 ID；文件解析失败时只有 issue。 */
  specs?: { path: string; total: number; pending: string[]; issue?: string }
  /** verify 采用的宿主侧交互执行结果（本会话 design_review(stage=interact) 的报告）。 */
  executed?: { id: string; name: string; status: string; passed: boolean; actual: string; evidence: { before?: string; after?: string } }[]
  next: string
}

/** 预览地址解析与可达性：工具参数 → 清单 → 工作室设置 → 框架默认；不可达时由宿主用项目脚本启动。 */
interface PreviewOptions { workspaceUrl?: string; fallbackUrl?: string; startPreview?: () => Promise<string | undefined> }
async function reachablePreview(root: string, override: unknown, options: PreviewOptions): Promise<string> {
  let url = resolvePreviewUrl({ override, checklist: await readOptional(root, 'docs/design/implementation-checklist.md'), workspaceUrl: options.workspaceUrl, fallback: options.fallbackUrl })
  const probe = async (target: string) => { try { const response = await fetch(target, { signal: AbortSignal.timeout(5000), redirect: 'manual' }); await response.body?.cancel(); return response.status < 500 } catch (error) { return false } }
  let reachable = await probe(url)
  // 预览没起来时由工作室用项目脚本启动（宿主侧，不经模型沙箱），再按它报告的地址访问。
  if (!reachable && options.startPreview) { const started = await options.startPreview(); if (started) { url = started; reachable = await probe(url) } }
  if (!reachable) throw new Error('预览地址无法访问：' + url + '。请启动项目预览脚本（或在工作室面板启动预览）后再试')
  return url
}

/** 读取交互规范；格式错误作为问题返回而不是抛出，让模型修文件。 */
async function readSpecs(root: string): Promise<{ specs: InteractionSpec[] | null; issue?: string }> {
  try { return { specs: await loadInteractions(root) } }
  catch (error) { return { specs: null, issue: '交互规范无法解析：' + (error instanceof Error ? error.message : String(error)) } }
}
function specsSummary(specs: InteractionSpec[] | null, issue?: string): Pick<ReviewResult, 'specs'> {
  if (!specs && !issue) return {}
  return { specs: { path: 'docs/design/interactions.yaml', total: specs?.length ?? 0, pending: (specs ?? []).filter(isPending).map(spec => spec.id), ...(issue ? { issue } : {}) } }
}

/** 按真实执行会话隔离计划，释放会话后不保留引用。 */
export class Reviews {
  private readonly plans = new WeakMap<object, Plan>()
  private readonly checked = new WeakSet<object>()
  /** 每个 Agent 已运行的几何与像素审计轮数，超过三轮后提示把剩余差异写进清单。 */
  private readonly rounds = new WeakMap<object, number>()
  /** 用户在需求里允许自定义的节点名，按 Agent 记录；plan 据此放行 custom。 */
  private readonly allowances = new WeakMap<object, string[]>()
  /** 本会话最近一次审计结果；verify 据此要求剩余差异已写进清单。 */
  private readonly compares = new WeakMap<object, CompareResult>()
  /** 本会话最近一次宿主侧交互执行结果；verify 直接采用它的结果与截图，不接受模型自报。 */
  private readonly interacts = new WeakMap<object, InteractResult>()

  /** @param owner 新任务所属 Agent；旧任务的登记不得用于新稿件。 */
  reset(owner: object): void { this.plans.delete(owner); this.checked.delete(owner); this.rounds.delete(owner); this.compares.delete(owner); this.interacts.delete(owner) }

  /** 记录用户本次需求里允许自定义的节点名（design_workspace 解析后传入）。 */
  allow(owner: object, names: string[]): void { this.allowances.set(owner, names) }

  /**
   * 登记从设计稿确认的组件和原始素材，不写目标项目。
   * @param owner 当前执行 Agent。
   * @param root 当前会话的真实目录。
   * @param input 已在工具参数处限定大小的 JSON。
   * @returns 缺素材时拒绝进入实现，保留错误供重试。
   */
  async plan(owner: object, root: string, input: Record<string, unknown>): Promise<ReviewResult> {
    this.reset(owner)
    const manifest = await readManifest(root)
    const requirements: Requirement[] = rows(input.requirements, '组件', 100).map(row => {
      const component = text(row.component, 128), file = localPath(row.file)
      const source = row.source ?? 'reborn'
      if (source !== 'reborn' && source !== 'project' && source !== 'custom') throw new Error('组件来源无效')
      if (!(source === 'reborn' ? /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/ : /^(?:[A-Z][A-Za-z0-9]*|[a-z][a-z0-9]*(?:-[a-z0-9]+)+)$/).test(component) || !file.endsWith('.vue')) throw new Error('组件标识无效，实施文件需要 Vue 文件')
      const node = requiredText(row.node), pattern = row.pattern === undefined ? inferredPattern(nodeNames(manifest, node)) ?? inferredComponent(component) : text(row.pattern, 64)
      if (pattern !== undefined && !reviewPatterns.some(value => value === pattern)) throw new Error('未知组件语义')
      return { node, component, file, source, pattern: pattern as Pattern | undefined, evidence: row.evidence === undefined ? undefined : requiredText(row.evidence, 2048) }
    })
    if (requirements.length === 0) throw new Error('请先从实际设计稿登记组件映射')
    const issues: string[] = [], assets: Asset[] = []
    const interactions = rows(input.interactions ?? [], '交互', 100).map(row => ({ node: requiredText(row.node), action: requiredText(row.action, 512), expected: requiredText(row.expected, 1024) }))
    // 映射表命中的节点不接受 custom / 原生替代：只有用户需求里「允许自定义 <节点>」的例外；project 组件源码必须含映射组件标签；伴随组件也要登记。
    const hits = manifest ? matchManifest((await loadComponentMap(root)).rules, manifest).matched : []
    const allowed = this.allowances.get(owner) ?? []
    const registered = requirements.map(item => item.component)
    const refersTo = (node: string, id: string) => new RegExp('(?:^|[^A-Za-z0-9:_/-])' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^A-Za-z0-9:_/-])').test(node)
    const exempt: string[] = []
    for (const item of requirements) {
      item.allowed = allowed.some(name => item.node.includes(name) || nodeNames(manifest, item.node).includes(name))
      // 只按节点 ID 把登记项与命中实例对应，不按自由文本猜（「搜索按钮」不等于搜索框）。
      const hit = hits.find(candidate => candidate.nodeIds.some(id => refersTo(item.node, id)))
      if (!hit) continue
      const rule: ComponentRule = hit.rule, required = [rule.component, ...(rule.with ?? [])]
      if (item.source === 'custom' && item.allowed) { exempt.push(...hit.nodeIds); continue }
      if (item.source === 'custom') issues.push(item.node + '：命中映射「' + rule.pattern + '」，应使用 ' + required.join(' + ') + '，不接受 custom 或原生标签；只有用户在需求里写「允许自定义 ' + item.node + '」才可例外')
      else if (item.source === 'reborn' && !required.includes(item.component)) issues.push(item.node + '：命中映射「' + rule.pattern + '」应使用 ' + rule.component + '，登记的是 ' + item.component)
      else if (item.source === 'project' && item.evidence) {
        const source = await readOptional(root, localPath(item.evidence)).catch(() => null)
        if (source !== null && !uses(markup(source), rule.component)) issues.push(item.node + '：项目组件 ' + item.evidence + ' 没有使用映射要求的 ' + rule.component + '，不能代替')
      }
      for (const companion of rule.with ?? []) if (!registered.includes(companion)) issues.push(item.node + '：命中映射「' + rule.pattern + '」还需登记伴随组件 ' + companion)
    }
    for (const item of requirements) {
      const inferred = inferredPattern(nodeNames(manifest, item.node)), pattern = inferred ?? item.pattern
      if (inferred && item.pattern && inferred !== item.pattern) issues.push(item.node + '：登记的 ' + item.pattern + ' 与设计节点语义 ' + inferred + ' 不符')
      if (pattern && pattern !== 'button' && /^(?:reborn-?button|button)$/i.test(item.component)) issues.push(item.node + '：不能用通用按钮代替完整的 ' + pattern + ' 组件')
      if (item.source === 'reborn' && patternComponents[pattern!] && !patternComponents[pattern!]!.includes(item.component)) issues.push(item.node + '：' + item.component + ' 不匹配 ' + pattern + '，请通过组件 MCP 核对专用组件')
      if (item.source === 'project') {
        if (!item.evidence) issues.push(item.node + '：项目组件需要提供已有源码的相对路径')
        // 本次新写的文件不能当「项目已有组件」的依据，否则原生控件禁令被自写组件绕过。
        else if (requirements.some(other => other.file === item.evidence)) issues.push(item.node + '：项目组件的源码依据 ' + item.evidence + ' 是本次登记的实现文件，不算项目已有组件；新写的组件按 reborn 登记，确需自定义时用 custom')
        else { const source = await readOptional(root, localPath(item.evidence)); if (!source?.trim()) issues.push(item.node + '：项目组件源码不存在或为空') }
      }
      if (item.source !== 'reborn' && !item.pattern) issues.push(item.node + '：项目或自定义组件需要登记对应的节点交互语义')
      if (item.source === 'custom' && (!item.evidence || item.evidence.length < 16)) issues.push(item.node + '：自定义组件需要说明现有组件缺失或不兼容的具体依据')
      if (pattern && interactive.has(pattern) && !interactions.some(interaction => interaction.node === item.node)) issues.push(item.node + '：请登记实际交互动作及预期结果')
    }
    for (const row of rows(input.assets ?? [], '素材', 200)) {
      const node = requiredText(row.node), exported = localPath(row.exported), used = localPath(row.used)
      if (screenshotName.test(exported)) { issues.push(node + '：截图不能充当原始素材'); continue }
      try { assets.push({ node, exported, used, digest: await digest(root, exported) }) }
      catch (error) { issues.push(node + '：' + (error instanceof Error ? error.message : '无法读取导出素材')) }
    }
    // 预读清单里的区块若没有任何登记提到，提醒补齐映射（页脚、推广位等纯布局区块可在清单中说明）。
    const warnings: string[] = []
    if (manifest) {
      const mentioned = requirements.map(item => item.node).join('\n')
      for (const block of manifest.blocks) if (block.status === 'ok' && !mentioned.includes(block.nodeId) && !mentioned.includes(block.name)) warnings.push('预读区块未登记映射：' + block.name + '（' + block.nodeId + '）')
      for (const path of manifestAssets(manifest)) if (!assets.some(item => item.exported === path)) issues.push('原始素材未登记使用：' + path + '；不得用相似图标或自绘图形替代')
      // 映射表命中的实例必须出现在登记里（缺失的组件由工作室安装），check 阶段再按模板标签硬性核对。
      issues.push(...await unregisteredHits(root, manifest, requirements.map(item => item.component), exempt))
    }
    // 交互规范：待补条目提醒；已填写的条目必须登记为断言（node 填规范 id 或节点），否则 verify 无法覆盖。
    const { specs, issue: specIssue } = await readSpecs(root)
    if (specIssue) issues.push(specIssue)
    for (const spec of specs ?? []) {
      if (isPending(spec)) { warnings.push('待补交互：' + spec.id + '（' + spec.name + '）尚未填写触发与响应，可在 docs/design/interactions.yaml 填写或在需求里用「交互 ' + spec.name + '：<触发> → <响应>」补充'); continue }
      if (!interactions.some(item => item.node === spec.id || item.node === spec.node || item.node === spec.name)) issues.push('交互规范 ' + spec.id + '（' + spec.name + '）未登记为 interactions 断言：node 填 ' + spec.id + '，action 填其 trigger，expected 填其 response')
    }
    if (issues.length === 0) this.plans.set(owner, { root, requirements, assets, interactions })
    return { stage: 'plan', ready: issues.length === 0, issues, warnings, components: requirements.length, assets: assets.length, visualStatus: 'pending-comparison', verificationStatus: 'pending', interactions, ...specsSummary(specs, specIssue),
      next: issues.length ? '先补齐真实组件、原始素材和交互断言，再登记计划；不要猜测替换。' : '按已登记映射实现；完成后调用 design_review(stage=check)，再执行交互与截图对照并调用 verify 登记证据。' }
  }

  /**
   * 按已登记计划读取页面和素材；缺失、替换或未使用组件均保持未完成状态。
   * @param owner 与登记计划相同的 Agent。
   * @param root 执行会话目录，防止跨工作区复用。
   * @returns 静态问题和仍需执行的视觉、交互验收。
   */
  async check(owner: object, root: string): Promise<ReviewResult> {
    const plan = this.plans.get(owner)
    if (!plan || plan.root !== root) throw new Error('请先在本会话调用 design_review(stage=plan) 登记当前工作区的还原计划')
    const issues: string[] = [], warnings: string[] = [], templates = new Map<string, string>(), sources: string[] = []
    const manifest = await readManifest(root)
    for (const path of manifestAssets(manifest)) if (!plan.assets.some(item => item.exported === path)) issues.push('预读素材未登记：' + path + '，请重新 plan')
    const clippedExports = new Set(manifest?.blocks.flatMap(block => block.assets.filter(asset => asset.clipped).map(asset => asset.path)) ?? [])
    const clippedReferences = plan.assets.filter(asset => clippedExports.has(asset.exported)).map(asset => asset.used.replace(/^public\//, '/').replaceAll('\\', '/'))
    // 裁切 / 缩略导出：登记了它却没登记预读补导出的全图，算问题；页面引用它时不得拉伸。
    const partialAssets = manifest?.blocks.flatMap(block => block.assets.filter(asset => asset.partial !== undefined && !asset.scaledByDesign)) ?? []
    const partialReferences = plan.assets.filter(asset => partialAssets.some(item => item.path === asset.exported)).map(asset => asset.used.replace(/^public\//, '/').replaceAll('\\', '/'))
    for (const asset of partialAssets) {
      if (asset.fullImage && plan.assets.some(item => item.exported === asset.path) && !plan.assets.some(item => item.exported === asset.fullImage)) issues.push(asset.path + '：导出只有稿面的 ' + Math.round((asset.partial ?? 0) * 100) + '%，预读已补导出全图 ' + asset.fullImage + '（' + asset.fullWidth + '×' + asset.fullHeight + '），请改用全图并重新登记')
    }
    for (const item of plan.requirements) {
      if (templates.has(item.file)) continue
      const source = await readOptional(root, item.file)
      if (source === null) { issues.push('缺少实现文件：' + item.file); templates.set(item.file, ''); continue }
      const template = markup(source)
      sources.push(source.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, ''))
      templates.set(item.file, template)
      const native = [...new Set([...template.matchAll(/<(button|input|select)(?=[\s/>])/g)].map(match => match[1]))]
      // 原生控件只在两种情况下放行：有源码依据的项目业务组件，或用户明确允许自定义的节点。
      if (native.length && !plan.requirements.some(requirement => requirement.file === item.file && requirement.evidence && (requirement.source === 'project' || (requirement.source === 'custom' && requirement.allowed)))) issues.push(item.file + '：原生控件需替换为 Reborn 组件：' + native.join('、') + '（项目业务组件需登记 source=project 与源码依据；自定义需用户在需求里允许）')
      const found = templateIssues(item.file, template, clippedReferences, partialReferences)
      issues.push(...found.issues); warnings.push(...found.warnings)
    }
    for (const item of plan.requirements) {
      if (uses(templates.get(item.file) ?? '', item.component)) continue
      // 登记的是组件自己的定义文件时提示：file 应填使用它的页面或父组件。
      const basename = item.file.split('/').pop()!.replace(/\.vue$/, '').toLowerCase().replace(/-/g, '')
      const defines = item.source !== 'reborn' && basename.length > 2 && item.component.toLowerCase().replace(/-/g, '').endsWith(basename)
      issues.push(item.node + '：' + item.file + ' 未使用 ' + item.component + (defines ? '（这是它的定义文件；file 应填使用该组件的页面或父组件，如 app/pages/*.vue）' : ''))
    }
    // 取值以项目内已安装的 *.config.ts 为准；映射表命中的实例必须有对应标签。
    const props = await propIssues(root, templates)
    issues.push(...props.issues); warnings.push(...props.warnings)
    const mapped = await mappingIssues(root, manifest, templates)
    issues.push(...mapped.issues); warnings.push(...mapped.warnings)
    for (const asset of plan.assets) {
      try {
        if (await digest(root, asset.exported) !== asset.digest) issues.push(asset.node + '：导出素材已变化，需重新核对设计稿并登记计划')
        if (await digest(root, asset.used) !== asset.digest) issues.push(asset.node + '：页面素材与登记的导出原图不同')
        const reference = asset.used.replace(/^public\//, '/').replaceAll('\\', '/')
        if (!sources.some(source => source.includes(reference))) issues.push(asset.node + '：实现文件未引用登记的素材路径 ' + reference)
      } catch (error) { issues.push(asset.node + '：' + (error instanceof Error ? error.message : '素材检查失败')) }
    }
    // 交互规范：每条已填写规范按 id 或节点找到 data-design 元素并核对事件处理 / 状态绑定；Playwright 脚本缺失只提醒。
    const { specs, issue: specIssue } = await readSpecs(root)
    if (specIssue) issues.push(specIssue)
    if (specs) {
      const found = interactionTemplateIssues(specs, templates, await readOptional(root, INTERACTION_SPEC_PATH), await boundDesignIds(root, templates.keys()))
      issues.push(...found.issues); warnings.push(...found.warnings)
    }
    if (issues.length === 0) this.checked.add(owner)
    else this.checked.delete(owner)
    return { stage: 'check', ready: issues.length === 0, issues, warnings, components: plan.requirements.length, assets: plan.assets.length, visualStatus: 'pending-comparison', verificationStatus: 'pending', interactions: plan.interactions, ...specsSummary(specs, specIssue),
      next: issues.length ? '修正列出的问题后重新检查，不得宣称还原完成。' : '静态检查通过。接着调用 design_review(stage=compare) 做几何与像素审计，再调用 design_review(stage=interact) 由工作室在宿主侧执行交互断言并截图（含窄屏），然后调用 verify 登记结果；不要自己启动浏览器，不能把静态通过当作视觉通过。' + (specs?.some(spec => !isPending(spec)) ? ' docs/design/interactions.yaml 已填写的条目会由 interact 按 trigger / response 执行与判定。' : '') }
  }

  /**
   * 登记执行记录与图片摘要，不执行页面，也不根据文件存在性宣称视觉或交互通过。
   * @param owner 与计划相同的 Agent。
   * @param root 执行会话目录。
   * @param input 交互实际结果和项目内证据文件。
   * @returns 证据完整性、摘要与仍需审阅的视觉结果。
   */
  async verify(owner: object, root: string, input: Record<string, unknown>): Promise<ReviewResult> {
    if (!this.checked.has(owner)) throw new Error('请先调用 design_review(stage=check) 修复静态问题，再登记验收证据')
    const checked = await this.check(owner, root)
    const plan = this.plans.get(owner)!
    const issues = [...checked.issues], evidence: NonNullable<ReviewResult['evidence']> = []
    const results = rows(input.interactions ?? [], '交互结果', 100)
    // 宿主侧执行过交互时直接采用它的结果与截图；磁盘上有报告但本会话没跑过，说明是旧报告或模型自写，要求重跑。
    const executed = this.interacts.get(owner)
    if (!executed && await readOptional(root, INTERACTION_REPORT_PATH, 8_000_000) !== null) issues.push(INTERACTION_REPORT_PATH + ' 不是本会话 design_review(stage=interact) 生成的，请重新调用 interact 执行交互')
    const adopted: NonNullable<ReviewResult['executed']> = []
    // plan 里的交互既有按规范 id 登记的，也有按「<节点ID> <名称>」登记的：先精确匹配 id / 节点 / 名称，再按节点 ID 片段或名称包含匹配。
    const refersTo = (node: string, id: string) => new RegExp('(?:^|[^A-Za-z0-9:_/-])' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^A-Za-z0-9:_/-])').test(node)
    // 登记项在 yaml 里对应的是待补条目时，interact 不会执行它：提示填写后重跑，而不是笼统说没有条目。
    const specs = executed ? (await readSpecs(root)).specs ?? [] : []
    const pendingFor = (node: string) => specs.find(spec => isPending(spec) && (spec.id === node || spec.node === node || spec.name === node || (spec.node && refersTo(node, spec.node))))
    for (const expected of plan.interactions) {
      const outcome = executed?.results.find(item => item.id === expected.node || item.node === expected.node || item.name === expected.node)
        ?? executed?.results.find(item => (item.node && refersTo(expected.node, item.node)) || (item.name.length >= 2 && expected.node.includes(item.name)))
      if (outcome) {
        adopted.push({ id: outcome.id, name: outcome.name, status: outcome.status, passed: outcome.passed, actual: outcome.actual, evidence: outcome.evidence })
        if (!outcome.passed) issues.push(expected.node + '：交互断言未通过（' + outcome.actual + '），修复后重新调用 design_review(stage=interact)')
        for (const path of [outcome.evidence.before, outcome.evidence.after]) {
          if (!path || evidence.some(item => item.path === path)) continue
          try { evidence.push({ path, sha256: await digest(root, path) }) }
          catch (error) { issues.push(expected.node + '：交互截图不可读取：' + (error instanceof Error ? error.message : String(error))) }
        }
        continue
      }
      const result = results.find(row => row.node === expected.node && row.action === expected.action && row.expected === expected.expected)
      if (!result) {
        const pending = executed ? pendingFor(expected.node) : undefined
        issues.push(expected.node + '：缺少已登记动作的实际执行结果：' + expected.action + (!executed ? '' : pending ? '（交互规范 ' + pending.id + ' 的 trigger / response 尚未填写，interact 未执行它；填写后重跑 design_review(stage=interact)，或在 verify 里登记结果）' : '（interactions.yaml 没有对应条目，interact 未执行它；补上条目重跑 interact，或在 verify 里登记结果）'))
        continue
      }
      if (result.passed !== true) issues.push(expected.node + '：交互断言未通过，请修复后重新执行')
      requiredText(result.actual, 2048)
      try { const path = localPath(result.evidence); evidence.push({ path, sha256: await digest(root, path) }) }
      catch (error) { issues.push(expected.node + '：交互证据不可读取：' + (error instanceof Error ? error.message : String(error))) }
    }
    if (executed) {
      for (const outcome of executed.results) if (outcome.status === 'unsupported' && !adopted.some(item => item.id === outcome.id)) issues.push('交互 ' + outcome.id + '（' + outcome.name + '）：' + outcome.actual)
    }
    // 几何与像素审计门禁：有规格表的项目必须跑过 compare；仍有失败或相似度不足 0.9 的区块，必须在清单「四、剩余差异」里写明。
    const manifest = await readManifest(root)
    if (manifest?.blocks.some(block => block.spec?.length)) {
      const last = this.compares.get(owner)
      if (!last) issues.push('尚未运行 design_review(stage=compare)：有规格表的页面必须先做几何与像素审计')
      else {
        const checklist = await readOptional(root, 'docs/design/implementation-checklist.md') ?? ''
        const remaining = /##\s*(?:[一二三四五六七八九十\d]+[、.．]\s*)?剩余差异[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(checklist)?.[1] ?? ''
        for (const block of last.blocks) {
          const unexplained = block.status !== 'ok' || block.failures > 0 || (block.pixel !== undefined && block.pixel.similarity < 0.9)
          if (unexplained && !remaining.includes(block.nodeId) && !remaining.includes(block.name)) issues.push('审计未通过且未说明：区块「' + block.name + '」（' + block.nodeId + '）' + (block.status !== 'ok' ? '状态 ' + block.status : block.failures + ' 条失败' + (block.pixel ? '，相似度 ' + block.pixel.similarity : '')) + '；修复后重查，或把原因写进清单「四、剩余差异」')
        }
      }
    }
    const visuals = rows(input.visuals ?? [], '视觉证据', 20)
    // 宿主侧已截窄屏整页图且 compare 已写出各区块实测图时，视口证据由工具提供，模型不必再传 visuals。
    const hostVisuals: string[] = []
    if (executed?.narrow.screenshot) {
      hostVisuals.push(executed.narrow.screenshot)
      for (const block of this.compares.get(owner)?.blocks ?? []) if (block.pixel?.actualImage) hostVisuals.push(block.pixel.actualImage)
      for (const path of hostVisuals) {
        try { evidence.push({ path, sha256: await digest(root, path) }) }
        catch (error) { issues.push('工具截图不可读取：' + path + '：' + (error instanceof Error ? error.message : String(error))) }
      }
    }
    if (hostVisuals.length < 2 && (visuals.length < 2 || new Set(visuals.map(row => requiredText(row.viewport, 128))).size < 2)) issues.push(executed ? '缺少基准视口证据：先运行 design_review(stage=compare) 得到各区块实测图，或在 visuals 里登记基准视口与窄屏截图' : '请分别登记设计基准视口与窄屏的截图及对应设计参考图，或先运行 design_review(stage=interact) 由工具截图')
    for (const row of visuals) {
      const viewport = requiredText(row.viewport, 128)
      try {
        const actual = localPath(row.evidence), reference = localPath(row.reference)
        if (actual === reference || !/\.(?:png|jpe?g|webp)$/i.test(actual) || !/\.(?:png|jpe?g|webp)$/i.test(reference)) throw new Error('实现截图与设计参考图需为不同的图片文件')
        for (const path of [actual, reference]) {
          const sha256 = await digest(root, path)
          if (!imageSize(await readFile(await inside(root, path)), path)) throw new Error('证据文件没有可读取的图片尺寸：' + path)
          evidence.push({ path, sha256 })
        }
      } catch (error) { issues.push(viewport + '：截图证据不可读取：' + (error instanceof Error ? error.message : String(error))) }
    }
    const ready = issues.length === 0
    return { ...checked, stage: 'verify', ready, issues, evidence, ...(executed ? { executed: adopted } : {}), visualStatus: ready ? 'evidence-recorded' : 'pending-comparison', verificationStatus: ready ? 'evidence-recorded' : 'pending',
      next: ready ? (executed ? '已登记执行结果与文件摘要：交互由工作室在浏览器里实际执行并判定，截图见 docs/design/screenshots/。像素一致性未判断；请对照截图报告可见差异，不凭此状态宣称 1:1。' : '已登记执行结果与文件摘要。工具没有执行这些动作，也没有判断像素一致性；请审阅记录并对照截图，报告可见差异，不凭此状态宣称 1:1。') : '补齐或修复未通过的交互与截图证据，再重新 verify；当前未完成验收。' }
  }

  /**
   * 宿主侧执行交互断言：按 docs/design/interactions.yaml 已填写条目在基准视口打开预览，执行 trigger、核对 response，写前后截图、窄屏整页图与报告。
   * 门禁：本会话 check 通过。不计轮次，可反复执行。
   * @param options.open 真实实现用 Playwright 驱动工厂；缺失时说明 Playwright 不可用。
   */
  async interact(owner: object, root: string, input: Record<string, unknown>, options: PreviewOptions & { open?: DriverFactory; signal?: AbortSignal }): Promise<InteractResult> {
    if (!options.open) throw new Error('未找到 Playwright：请设置 DSH_PLAYWRIGHT_MODULE 指向 playwright 的 index.js，或在目标项目 / dsh 仓库中安装 playwright 后重试')
    if (!this.checked.has(owner)) throw new Error('请先在本会话通过 design_review(stage=check)，再执行交互断言')
    const { specs, issue } = await readSpecs(root)
    if (issue) throw new Error(issue)
    if (!specs?.length) throw new Error('没有交互规范 docs/design/interactions.yaml，或其中没有条目；请先填写 trigger 与 response')
    if (!specs.some(spec => !isPending(spec))) throw new Error('docs/design/interactions.yaml 全部是待补条目：先填写 trigger（点击 / 悬停 / 输入「文字」/ 按 Enter / 滚动）与 response（出现 / 消失 / 文字 / aria 属性 / 跳转），稿面没有交互的写「无」')
    const url = await reachablePreview(root, input.url, options)
    const manifest = await readManifest(root)
    const width = manifest?.root.width ?? 1920, height = Math.min(Math.max(manifest?.root.height ?? 1080, 720), 4000)
    const result = await runInteractions({ root, specs, url, width, height, open: options.open, signal: options.signal })
    if (!manifest?.root.width) result.warnings.unshift('预读清单没有记录画布宽度，按 1920 执行')
    this.interacts.set(owner, result)
    return result
  }

  /**
   * 几何与像素审计：按预读规格表实测页面，输出按差异排序的清单与各区块像素相似度。
   * 不依赖 plan 登记（规格表来自 manifest），但按 Agent 计轮，便于限制修复轮数。
   * @param input url 可覆盖清单里的预览地址；blocks 限定只比对部分区块。
   * @param options.measurer 真实测量函数；缺失时说明 Playwright 不可用。
   */
  async compare(owner: object, root: string, input: Record<string, unknown>, options: PreviewOptions & { measurer?: Measurer }): Promise<CompareResult> {
    if (!options.measurer) throw new Error('未找到 Playwright：请设置 DSH_PLAYWRIGHT_MODULE 指向 playwright 的 index.js，或在目标项目 / dsh 仓库中安装 playwright 后重试')
    // 门禁：先 plan、check 通过才比对；最多三轮，之后把剩余差异写进清单而不是继续刷轮次。
    if (!this.checked.has(owner)) throw new Error('请先在本会话通过 design_review(stage=check)，再做几何与像素审计')
    const round = (this.rounds.get(owner) ?? 0) + 1
    if (round > MAX_COMPARE_ROUNDS) throw new Error('几何与像素审计已跑满 ' + MAX_COMPARE_ROUNDS + ' 轮。把仍未消除的差异逐条写进 docs/design/implementation-checklist.md「四、剩余差异」（节点、字段、设计值、实际值、原因），然后调用 design_review(stage=verify)；不要再调用 compare')
    const manifest = await readManifestForCompare(root)
    const url = await reachablePreview(root, input.url, options)
    if (input.blocks !== undefined && (!Array.isArray(input.blocks) || input.blocks.length > 100)) throw new Error('blocks 需要区块节点 ID 数组')
    const blocks = input.blocks === undefined ? undefined : (input.blocks as unknown[]).map(value => text(value, 128))
    this.rounds.set(owner, round)
    const result = await runCompare({ root, manifest, url, measurer: options.measurer, round, only: blocks })
    this.compares.set(owner, result)
    return result
  }
}
