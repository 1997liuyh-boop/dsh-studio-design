/**
 * 预读结果的组件判定：项目映射表 + Reborn 知识库，合成一份由 plan / check 统一执行的结果。
 *
 * 三层，强度递减：
 * 1. 映射表命中（项目 docs/design/component-map.json 或默认表）——强制，原有行为不变；
 * 2. 结构判定——工作室从导出结构识别出的结构信号（signals.ts）交给知识库的信号规则，高置信的结论强制，
 *    并且优先于默认表按名字的命中（名字叫「搜索」但结构是下划线输入）；项目自己写进映射表的规则仍然最优先；
 * 3. 知识库建议——映射表没覆盖的实例，把实例名、变体与稿面样式交给知识库的配方表：不强制用哪个组件，
 *    但 plan 必须逐个表态，不能像以前那样留在「待映射」里由模型凭感觉自写。
 * 另外给每处命中附上「按稿面取值」：稿面高度、圆角、描边经知识库特征表解析出的 size / shape / variant。
 */
import { defaultRules, matchManifest, type BlocksWithComponents, type ComponentRule, type MappingGroup, type MappingHit, type MappingResult, type MappingUsage } from './componentMap.ts'
import type { DesignSignal, SignalStyle } from './signals.ts'
import type { NodeSpec } from './spec.ts'
import type { DesignNodeInput, DesignNodeMatch, Knowledge } from './knowledge.ts'

/** 判定用到的 manifest 字段：区块里的实例与规格表，以及预读记录的结构信号。 */
export interface MappingSource extends BlocksWithComponents {
  blocks: readonly { nodeId?: string; name?: string; components?: BlocksWithComponents['blocks'][number]['components']; spec?: readonly NodeSpec[] }[]
  signals?: readonly DesignSignal[]
}

const signalLabels: Record<DesignSignal['kind'], string> = { 'underline-field': '下划线输入', 'corner-badge': '角标', 'selection-list': '互斥选择组', accordion: '展开收起列表', 'select-trigger': '下拉触发器' }

/** 规格表节点 → 交给知识库的稿面样式；规格表不区分「只有底边」的描边，所以没有描边时不下结论。 */
function specStyle(spec: NodeSpec | undefined): SignalStyle | undefined {
  if (!spec) return undefined
  const style: SignalStyle = {}
  if (spec.width !== undefined) style.width = spec.width
  if (spec.height !== undefined) style.height = spec.height
  if (spec.radius) style.radius = Math.max(...spec.radius)
  if (spec.background && !(spec.background.length === 9 && spec.background.endsWith('00'))) style.background = spec.background
  if (spec.border) style.border = 'all'
  if (spec.padding) style.padding = spec.padding
  if (spec.gap) style.gap = spec.gap
  if (spec.fontSize) style.fontSize = spec.fontSize
  if (spec.sizing) style.sizing = spec.sizing
  return Object.keys(style).length ? style : undefined
}

/** 知识库判定 → 可由 plan / check 执行的规则。配方过长时只留前 400 字，全文用 get_component 查。 */
function ruleOf(match: DesignNodeMatch, origin: 'signal' | 'knowledge'): ComponentRule {
  const recipe = match.recipe && match.recipe.length > 400 ? match.recipe.slice(0, 400) + '…（全文见 get_component）' : match.recipe
  const notes = [match.note, ...(match.imports ?? []).slice(-1), ...(match.pitfalls ?? []).slice(0, 2)].filter(Boolean).join('；')
  return {
    pattern: (origin === 'signal' ? '结构判定：' : '知识库：') + (match.pattern ?? match.name), match: [], component: match.component!, origin,
    ...(recipe ? { props: recipe } : {}), ...(notes ? { notes } : {}), ...(match.with.length ? { with: match.with } : {}), ...(match.requires?.length ? { requires: match.requires } : {}),
  }
}

/** 从各组里去掉被认领的节点，空组丢弃。 */
function without<T extends MappingGroup>(groups: T[], claimed: ReadonlySet<string>): T[] {
  return groups.map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => !claimed.has(id)) })).filter(group => group.nodeIds.length > 0)
}

/**
 * 合成判定结果。没有知识库（或知识库没有配方表）时与 matchManifest 完全一致。
 * @param rules 已载入的映射表规则（项目表或默认表）。
 */
export function resolveMapping(rules: readonly ComponentRule[], manifest: MappingSource, knowledge?: Knowledge): MappingResult {
  const base = matchManifest(rules, manifest)
  if (!knowledge) return base
  const specs = new Map<string, NodeSpec>(), blockNames = new Map<string, string>(), instances = new Map<string, { name: string; props?: Record<string, string | number | boolean> }>()
  for (const block of manifest.blocks) {
    for (const spec of block.spec ?? []) if (!specs.has(spec.id)) specs.set(spec.id, spec)
    for (const instance of block.components ?? []) { instances.set(instance.nodeId, instance); blockNames.set(instance.nodeId, block.name ?? block.nodeId ?? '') }
  }
  // 项目自己写的规则（不在默认表里）是用户的明确意图，结构判定不覆盖它。
  const defaults = new Set(defaultRules.map(rule => rule.pattern))
  const userOwned = new Set(base.matched.filter(hit => !defaults.has(hit.rule.pattern)).flatMap(hit => hit.nodeIds))
  const hints: string[] = [], structural: MappingHit[] = [], claimed = new Set<string>()

  // 结构判定：每处信号一条输入，知识库按信号规则返回组件、必须写的属性与按稿面解析的取值。
  const signals = knowledge.hasSignals ? [...(manifest.signals ?? [])] : []
  const verdicts = signals.length ? knowledge.match(signals.map((signal): DesignNodeInput => ({ id: signal.nodeId, name: signal.name, group: signal.block, signals: [signal.kind], facts: signal.facts, style: signal.style, text: signal.text }))).matches : []
  signals.forEach((signal, index) => {
    const verdict = verdicts[index]!
    const label = signalLabels[signal.kind] + '「' + signal.name + '」（' + signal.nodeId + '）'
    const usage = verdict.resolved
    if (verdict.source !== 'signal' || !verdict.component || verdict.confidence === 'low') {
      // 低置信或让位给名字规则的信号只作提示；宽度这类按稿面解析的说明照样带上。
      const detail = [signal.evidence, verdict.component ? '候选 ' + [verdict.component, ...(verdict.alternatives ?? []).map(item => item.id)].join(' / ') : '', ...(usage?.notes ?? [])].filter(Boolean).join('，')
      hints.push(label + '：' + detail)
      return
    }
    const ids = [signal.nodeId, ...(signal.members ?? [])]
    if (ids.some(id => userOwned.has(id))) { hints.push(label + '结构上是「' + verdict.pattern + '」（' + verdict.component + '），但项目映射表已有规则覆盖这些节点，按映射表执行'); return }
    structural.push({
      name: signalLabels[signal.kind] + '「' + signal.name + '」', nodeIds: [...new Set(ids)], rule: ruleOf(verdict, 'signal'), evidence: signal.evidence,
      ...(usage ? { usage: [{ nodeId: signal.nodeId, attrs: usage.attrs, ui: usage.ui, notes: usage.notes }] } : {}),
    })
    // 结构里的节点整体归这处判定：不再各自匹配映射表，也不留在待映射里。
    for (const id of [signal.nodeId, ...(signal.members ?? []), ...(signal.covers ?? [])]) if (!userOwned.has(id)) claimed.add(id)
  })
  // 角标的宿主（图标容器）只用于定位，不从别的规则里拿走。
  for (const signal of signals) if (signal.kind === 'corner-badge') for (const id of signal.members ?? []) claimed.delete(id)

  // 深匹配的组（问答列表要同区块至少三行问句）被结构判定拿走一部分节点后，剩下的不够数就不再成立。
  const matched = without(base.matched, claimed).filter(hit => !(claimed.size && hit.name.startsWith('深匹配：') && hit.rule.minPerBlock && hit.nodeIds.length < hit.rule.minPerBlock))
  const ignored = without(base.ignored, claimed)
  let unmatched = without(base.unmatched, claimed)

  // 知识库建议：映射表没覆盖的实例，整批交给配方表；同名一组的结论一致且不是低置信才算建议。
  const suggested: MappingHit[] = []
  if (unmatched.length) {
    const inputs: DesignNodeInput[] = [], owners: number[] = []
    unmatched.forEach((group, index) => {
      for (const nodeId of group.nodeIds) {
        const instance = instances.get(nodeId), spec = specs.get(nodeId), style = specStyle(spec)
        inputs.push({ id: nodeId, name: instance?.name ?? group.name, group: blockNames.get(nodeId), ...(instance?.props ? { variant: instance.props } : {}), ...(spec?.bitmap ? { fill: 'image' as const } : {}), ...(style ? { style } : {}), ...(spec?.text ? { text: spec.text } : {}) })
        owners.push(index)
      }
    })
    const result = knowledge.match(inputs)
    const remaining: MappingGroup[] = []
    unmatched.forEach((group, index) => {
      const own = result.matches.filter((_, position) => owners[position] === index), first = own[0]
      const agreed = !!first && own.every(match => match.status === first.status && match.component === first.component)
      if (agreed && first.status === 'ignore') { ignored.push({ ...group, rule: { pattern: '知识库：' + (first.pattern ?? '不是组件'), match: [], component: '', ignore: true, origin: 'knowledge', ...(first.recipe ? { notes: first.recipe } : {}) } }); return }
      if (agreed && first.status === 'pattern' && first.component && first.confidence !== 'low') {
        const usage = own.filter(match => match.resolved).map((match): MappingUsage => ({ nodeId: match.id!, attrs: match.resolved!.attrs, ui: match.resolved!.ui, notes: match.resolved!.notes }))
        suggested.push({ ...group, rule: ruleOf(first, 'knowledge'), ...(usage.length ? { usage } : {}) })
        return
      }
      remaining.push(group)
      const candidates = first?.selectionGroup ? first.note : first?.component ? '候选 ' + [first.component, ...(first.alternatives ?? []).map(item => item.id)].filter((id, position, all) => all.indexOf(id) === position).join(' / ') + (first.confidence === 'low' ? '（低置信，按稿面确认是否整体采用）' : '') : ''
      if (candidates) hints.push('「' + group.name + '」（' + group.nodeIds.slice(0, 3).join('、') + '）：' + candidates)
    })
    unmatched = remaining
    for (const hint of result.hints) if (/互斥选择组|图廊/.test(hint) && !hints.includes(hint)) hints.push(hint)
  }

  // 映射表命中的实例也附上按稿面解析的取值，配方里的「按稿面取」不再靠估。
  for (const hit of matched) {
    if (!hit.rule.component) continue
    const usage: MappingUsage[] = []
    for (const nodeId of hit.nodeIds) {
      const spec = specs.get(nodeId), style = specStyle(spec)
      if (!style) continue
      const resolved = knowledge.usage(hit.rule.component, { id: nodeId, name: hit.name, style, ...(spec?.text ? { text: spec.text } : {}) })
      if (resolved) usage.push({ nodeId, attrs: resolved.attrs, ui: resolved.ui, notes: resolved.notes })
    }
    if (usage.length) hit.usage = usage
  }

  return { total: base.total + structural.length, matched: [...structural, ...matched], ignored, unmatched, ...(suggested.length ? { suggested } : {}), ...(hints.length ? { hints } : {}) }
}
