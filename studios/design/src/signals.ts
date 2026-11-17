/**
 * 结构信号：从设计稿的几何与样式里认出「名字看不出来」的组件结构。
 *
 * 设计师给图层起的名字是随手的（「左侧导航单元」「黄点提示」「按钮内容」「容器 2399」），按名字匹配映射表认不全；
 * 但结构不会骗人——只有底边一条线的输入、图标角上压着一个数字、一列同款项里只有一项带底色、
 * 每行「标题 + 加减号」且有一行展开着正文。这里只负责「看出是什么结构」，落到哪个组件由 Reborn 知识库的
 * 信号规则决定（knowledge/design-patterns.json 的 signals），两边靠信号名约定。
 *
 * 检测对象是「拼好的整棵树」：根节点结构（get_selection_node）里把每个区块换成它导出 HTML 的展开结构，
 * 这样被拆进不同区块的同组节点（十行问答各是一个区块）也能一起判断。
 * 每个检测都偏保守：宁可漏掉让模型按通用规则选型，也不把普通容器错判成组件。
 */
import type { DesignNode } from './reader.ts'
import { nodeSpec, normalizeColor, parseRadius, pxValue, styleProperty } from './spec.ts'

export type SignalKind = 'underline-field' | 'corner-badge' | 'selection-list' | 'accordion' | 'select-trigger'

/** 信号节点的稿面样式，字段与 Reborn MCP match_design_nodes 的 style 入参一致。 */
export interface SignalStyle {
  width?: number
  height?: number
  /** 最大的一个圆角（px）。 */
  radius?: number
  /** 底色 #rrggbb；透明或没有时不记录。 */
  background?: string
  /** 描边位置：all 四边、bottom 只有底边（含紧贴其下的一条细线）、none 没有。 */
  border?: 'all' | 'bottom' | 'none'
  padding?: [number, number, number, number]
  gap?: number
  fontSize?: number
  sizing?: { width?: 'hug' | 'fixed' | 'fill'; height?: 'hug' | 'fixed' | 'fill' }
}

/** 一处结构信号：写进 manifest，交给知识库判定后由 plan / check 核对。 */
export interface DesignSignal {
  kind: SignalKind
  /** 承载这个结构的节点：输入行、角标、选择组容器、问答列表容器、触发器。 */
  nodeId: string
  name: string
  /** 所在区块的节点 ID。 */
  block?: string
  /** 节点里的文字：占位文案、角标数字、触发器当前值。 */
  text?: string
  /** 附带事实，供信号规则进一步限定（orientation、members、position 等）。 */
  facts?: Record<string, string | number | boolean>
  /** 相关节点：选择组的各项、问答的各行、角标的宿主。实现时这些节点同样可以承载 data-design。 */
  members?: string[]
  /** 这个结构子树里的全部节点 ID（不含自身，最多 300 个）：它们已被这处结构整体认领，不再各自匹配映射表。 */
  covers?: string[]
  style?: SignalStyle
  /** 判定依据，给人读。 */
  evidence: string
}

/** 一次预读最多记录的信号数；超过说明稿面结构异常，不再继续堆。 */
export const MAX_SIGNALS = 120

const css = (node: DesignNode, name: string): string | undefined => styleProperty(node.style ?? '', name)
const isFlex = (node: DesignNode): boolean => /^(?:inline-)?flex$/.test(css(node, 'display') ?? '')
const isColumn = (node: DesignNode): boolean => isFlex(node) && css(node, 'flex-direction') === 'column'

/** 不透明的底色；transparent 与全透明色算没有。 */
function backgroundOf(node: DesignNode): string | undefined {
  const color = normalizeColor(css(node, 'background-color') ?? css(node, 'background'))
  return color && !(color.length === 9 && color.endsWith('00')) ? color : undefined
}

/** 子树（含自身）里的文字叶子，按文档顺序。 */
function textLeaves(node: DesignNode): DesignNode[] {
  const result: DesignNode[] = []
  const visit = (current: DesignNode) => { if (current.text) result.push(current); for (const child of current.children) visit(child) }
  visit(node)
  return result
}

/** 子树（含自身）里的图片 / 图标叶子。 */
function imageLeaves(node: DesignNode): DesignNode[] {
  const result: DesignNode[] = []
  const visit = (current: DesignNode) => { if (current.tag === 'img' || current.tag === 'svg') result.push(current); else for (const child of current.children) visit(child) }
  visit(node)
  return result
}

/** 细线：没有文字和子节点、高度不超过 2px、有底色的条（设计稿里的分割线、下划线）。 */
function isHairline(node: DesignNode): boolean {
  const height = node.height ?? pxValue(css(node, 'height'))
  return node.children.length === 0 && !node.text && height !== undefined && height > 0 && height <= 2 && !!backgroundOf(node)
}

/** 颜色的相对明度（0–1）；解析不了返回 undefined。 */
function lightness(color: string | undefined): number | undefined {
  const hex = normalizeColor(color)?.slice(1, 7)
  if (!hex || hex.length !== 6) return undefined
  const [r, g, b] = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number]
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2
}

/**
 * 解析长度：px、百分比与只含加减的 calc（MasterGo 把约束定位导出成 calc(100% - 24px + 16px)）。
 * @param basis 百分比的基准（父容器对应方向的尺寸）。
 */
export function lengthValue(value: string | undefined, basis: number | undefined): number | undefined {
  if (!value) return undefined
  const text = value.trim()
  const inner = /^calc\((.*)\)$/.exec(text)?.[1] ?? text
  let total = 0
  for (const term of inner.replace(/\s*([+-])\s+/g, ' $1').trim().split(/\s+/)) {
    const match = /^([+-]?)([+-]?[\d.]+)(px|%)?$/.exec(term)
    if (!match) return undefined
    let amount = Number(match[2])
    if (!Number.isFinite(amount)) return undefined
    if (match[3] === '%') { if (basis === undefined) return undefined; amount = amount * basis / 100 }
    total += match[1] === '-' ? -amount : amount
  }
  return total
}

/** 节点的稿面样式：取自规格抽取（与规格表同一套解析），再补描边位置。 */
export function signalStyle(node: DesignNode): SignalStyle {
  const spec = nodeSpec(node, true)
  const style: SignalStyle = {}
  const width = node.width ?? pxValue(css(node, 'width')), height = node.height ?? pxValue(css(node, 'height'))
  if (width !== undefined) style.width = width
  if (height !== undefined) style.height = height
  const radius = parseRadius(css(node, 'border-radius'))
  if (radius) style.radius = Math.max(...radius)
  const background = backgroundOf(node)
  if (background) style.background = background
  const bottomOnly = !!css(node, 'border-bottom') && !css(node, 'border') && !css(node, 'border-top') && !css(node, 'border-left') && !css(node, 'border-right')
  style.border = bottomOnly ? 'bottom' : spec?.border ? 'all' : 'none'
  if (spec?.padding) style.padding = spec.padding
  if (spec?.gap) style.gap = spec.gap
  if (spec?.sizing) style.sizing = spec.sizing
  return style
}

const inputWords = /搜索|搜尋|检索|檢索|查找|search|输入|輸入|input|请|請|enter|type here|keyword|关键|關鍵|邮箱|郵箱|email|手机|手機|phone|placeholder/i

/**
 * 下划线输入：一行「占位文字（+ 小图标）」，整条只有底边一条线——节点自身只有 border-bottom，
 * 或它是纵向容器、最后一个子节点是一条细线。标题下面压一条装饰线的结构与它同形，所以还要像输入：
 * 文字不加粗，且文字颜色是占位灰，或节点名 / 文案里有「搜索、请输入、search」这类字样。
 */
function underlineField(node: DesignNode): DesignSignal | undefined {
  if (!node.id || node.descendants > 8) return undefined
  const style = node.style ?? ''
  const ownBottom = !!styleProperty(style, 'border-bottom') && !styleProperty(style, 'border')
  const elements = node.children
  const line = !ownBottom && isColumn(node) && elements.length === 2 && isHairline(elements[1]!) ? elements[1]! : undefined
  if (!ownBottom && !line) return undefined
  const row = line ? elements[0]! : node
  const texts = textLeaves(row), icons = imageLeaves(row)
  if (texts.length !== 1 || icons.length > 2) return undefined
  if (icons.some(icon => (icon.width ?? 0) > 32 || (icon.height ?? 0) > 32)) return undefined
  const text = texts[0]!, weight = Number(css(text, 'font-weight') ?? 400)
  if (Number.isFinite(weight) && weight > 500) return undefined
  const light = lightness(css(text, 'color'))
  const placeholderGray = light !== undefined && light >= 0.6 && light < 0.95
  if (!placeholderGray && !inputWords.test((node.name ?? '') + ' ' + text.text)) return undefined
  const measured = signalStyle(node)
  // 高度取输入行自身：行没写高度时取行里最高的图标或文字行高。
  const rowHeight = row.height ?? pxValue(css(row, 'height')) ?? Math.max(0, ...icons.map(icon => icon.height ?? 0), pxValue(css(text, 'line-height')) ?? 0)
  const fontSize = pxValue(css(text, 'font-size'))
  return {
    kind: 'underline-field', nodeId: node.id, name: node.name ?? node.tag, text: text.text,
    members: [row.id, text.id, ...icons.map(icon => icon.id)].filter((id): id is string => !!id && id !== node.id),
    style: { ...measured, ...(rowHeight ? { height: rowHeight } : {}), border: 'bottom', ...(fontSize ? { fontSize } : {}) },
    evidence: '一行占位文字「' + text.text!.slice(0, 40) + '」' + (icons.length ? ' + ' + icons.length + ' 个小图标' : '') + '，下面只有一条 ' + (line ? (line.height ?? 1) + 'px 的线' : '底边描边') + '，没有外框',
  }
}

/**
 * 角标：一个不超过 24px 高的小块，绝对定位压在不超过 64px 的图标 / 头像容器的一角，
 * 里面是 1–3 位数字（可带 +），或它本身是个不超过 12px 的实心圆点。
 */
function cornerBadge(node: DesignNode, parent: DesignNode | undefined): DesignSignal | undefined {
  if (!node.id || !parent?.id) return undefined
  const width = node.width, height = node.height
  if (!width || !height || height > 24 || width > 40) return undefined
  if (css(node, 'position') !== 'absolute' && css(parent, 'position') !== 'relative') return undefined
  const hostWidth = parent.width, hostHeight = parent.height
  if (!hostWidth || !hostHeight || hostWidth > 64 || hostHeight > 64 || hostWidth < width) return undefined
  const left = lengthValue(css(node, 'left'), hostWidth) ?? (css(node, 'right') !== undefined ? hostWidth - width - (lengthValue(css(node, 'right'), hostWidth) ?? 0) : undefined)
  const top = lengthValue(css(node, 'top'), hostHeight) ?? (css(node, 'bottom') !== undefined ? hostHeight - height - (lengthValue(css(node, 'bottom'), hostHeight) ?? 0) : undefined)
  if (left === undefined || top === undefined) return undefined
  // 中心落在宿主的四角区域：离宿主中心在两个方向上都超过宿主尺寸的五分之一。
  const dx = left + width / 2 - hostWidth / 2, dy = top + height / 2 - hostHeight / 2
  if (Math.abs(dx) < hostWidth * 0.2 || Math.abs(dy) < hostHeight * 0.2) return undefined
  const texts = textLeaves(node)
  const digits = texts.length === 1 && /^\d{1,3}\+?$/.test(texts[0]!.text!.trim()) ? texts[0]!.text!.trim() : undefined
  const radius = parseRadius(css(node, 'border-radius'))
  const dot = texts.length === 0 && node.children.length === 0 && width <= 12 && height <= 12 && !!backgroundOf(node) && !!radius && Math.max(...radius) * 2 >= height
  if (!digits && !dot) return undefined
  const position = (dy < 0 ? 'top' : 'bottom') + '-' + (dx > 0 ? 'right' : 'left')
  // 角标整个落在宿主内（不外溢）时对应组件的 inset。
  const inset = left >= 0 && top >= 0 && left + width <= hostWidth && top + height <= hostHeight
  return {
    kind: 'corner-badge', nodeId: node.id, name: node.name ?? node.tag, ...(digits ? { text: digits } : {}),
    facts: { position, inset, host: parent.id, ...(dot ? { dot: true } : {}) }, members: [parent.id],
    style: { width, height, ...(backgroundOf(node) ? { background: backgroundOf(node)! } : {}) },
    evidence: (digits ? '数字「' + digits + '」' : '实心圆点') + '（' + width + '×' + height + '）压在 ' + hostWidth + '×' + hostHeight + ' 的「' + (parent.name ?? parent.tag) + '」' + ({ 'top-right': '右上角', 'top-left': '左上角', 'bottom-right': '右下角', 'bottom-left': '左下角' } as Record<string, string>)[position],
  }
}

/** 选择组 / 问答列表的一项：带节点 ID、只有一段文字、结构很小的块。 */
function simpleItem(node: DesignNode): { text: DesignNode; icons: DesignNode[] } | undefined {
  if (!node.id || node.descendants > 6) return undefined
  const texts = textLeaves(node)
  if (texts.length !== 1) return undefined
  return { text: texts[0]!, icons: imageLeaves(node) }
}

/**
 * 互斥选择组：flex 容器里至少三个同款的单文字项（高度不超过 64px），恰好一项有底色而其余都没有
 * （或恰好一项的底色与众不同）。只按底色认——一列链接顶上压一个加粗标题（页脚栏目）不算选择组。
 */
function selectionList(node: DesignNode): DesignSignal | undefined {
  if (!node.id || !isFlex(node)) return undefined
  const items = node.children.filter(child => !isHairline(child))
  if (items.length < 3 || items.length > 30) return undefined
  const parsed = items.map(item => ({ item, parts: simpleItem(item) }))
  if (parsed.some(entry => !entry.parts || (entry.item.height ?? 0) > 64)) return undefined
  // 同款：同名，或标签与直接子节点数一致。
  const sameName = items.every(item => item.name && item.name === items[0]!.name)
  const sameShape = items.every(item => item.tag === items[0]!.tag && item.children.length === items[0]!.children.length)
  if (!sameName && !sameShape) return undefined
  const backgrounds = items.map(item => backgroundOf(item) ?? '')
  const counts = new Map<string, number>()
  for (const value of backgrounds) counts.set(value, (counts.get(value) ?? 0) + 1)
  if (counts.size !== 2) return undefined
  const [common] = [...counts].sort((a, b) => b[1] - a[1])[0]!
  const odd = backgrounds.map((value, index) => ({ value, index })).filter(entry => entry.value !== common)
  if (odd.length !== 1 || !odd[0]!.value) return undefined
  const selected = items[odd[0]!.index]!
  const orientation = isColumn(node) ? 'vertical' : 'horizontal'
  return {
    kind: 'selection-list', nodeId: node.id, name: node.name ?? node.tag, text: parsed.map(entry => entry.parts!.text.text!).join(' / ').slice(0, 200),
    facts: { orientation, members: items.length, selected: selected.id!, selectedIndex: odd[0]!.index }, members: items.map(item => item.id!),
    style: signalStyle(node),
    evidence: (orientation === 'vertical' ? '一列 ' : '一排 ') + items.length + ' 个同款项' + (sameName ? '「' + items[0]!.name + '」' : '') + '，只有第 ' + (odd[0]!.index + 1) + ' 项「' + parsed[odd[0]!.index]!.parts!.text.text!.slice(0, 30) + '」带底色 ' + odd[0]!.value,
  }
}

/**
 * 展开收起列表：纵向容器里至少三行「一段标题 + 一个不超过 40px 的图标」，
 * 多数行用同一张图标（收起），恰有别的行用了另一张图标（展开），并且那一行后面跟着一块只有文字的正文。
 * 只有图标全相同、没有展开样例的列表不在这里认（那可能只是一列带箭头的入口）。
 */
function accordion(node: DesignNode): DesignSignal | undefined {
  if (!node.id || !isColumn(node)) return undefined
  const children = node.children.filter(child => !isHairline(child))
  // 一行可以直接是容器的子节点，也可以和它的正文一起包在一层分组里：把只含「行 + 正文」的分组拆开看。
  const flat: DesignNode[] = []
  for (const child of children) {
    const inner = child.children.filter(item => !isHairline(item))
    if (isColumn(child) && inner.length === 2 && triggerRow(inner[0]!) && isBody(inner[1]!)) flat.push(...inner)
    else flat.push(child)
  }
  const rows = flat.map((child, index) => ({ child, index, row: triggerRow(child) })).filter(entry => entry.row)
  if (rows.length < 3) return undefined
  const icons = new Map<string, number>()
  for (const entry of rows) icons.set(entry.row!.icon, (icons.get(entry.row!.icon) ?? 0) + 1)
  if (icons.size !== 2) return undefined
  const [collapsedIcon] = [...icons].sort((a, b) => b[1] - a[1])[0]!
  const expanded = rows.filter(entry => entry.row!.icon !== collapsedIcon)
  if (expanded.length > rows.length / 2) return undefined
  // 展开的行后面要跟着正文：只有文字、没有图标的块。
  const withBody = expanded.filter(entry => { const next = flat[entry.index + 1]; return !!next && isBody(next) })
  if (!withBody.length) return undefined
  return {
    kind: 'accordion', nodeId: node.id, name: node.name ?? node.tag, text: rows.slice(0, 3).map(entry => entry.row!.title).join(' / ').slice(0, 200),
    facts: { members: rows.length, expanded: withBody[0]!.child.id ?? '', collapsedIcon, expandedIcon: withBody[0]!.row!.icon },
    members: rows.map(entry => entry.child.id).filter((id): id is string => !!id),
    style: signalStyle(node),
    evidence: rows.length + ' 行「标题 + 图标」，' + (rows.length - expanded.length) + ' 行用同一张图标，「' + withBody[0]!.row!.title.slice(0, 30) + '」换了另一张图标并且下面展开着正文',
  }
}

/** 问答的触发行：横向、一段文字、恰好一个不超过 40px 的图标，结构很小。 */
function triggerRow(node: DesignNode): { title: string; icon: string } | undefined {
  if (node.descendants > 6 || isColumn(node)) return undefined
  const texts = textLeaves(node), icons = imageLeaves(node)
  if (texts.length !== 1 || icons.length !== 1) return undefined
  const icon = icons[0]!
  if ((icon.width ?? 0) > 40 || (icon.height ?? 0) > 40 || !icon.src) return undefined
  return { title: texts[0]!.text!, icon: icon.src.split('/').pop()! }
}

/** 展开后的正文：有文字、没有图片的块。 */
function isBody(node: DesignNode): boolean {
  return textLeaves(node).length >= 1 && imageLeaves(node).length === 0 && !isHairline(node)
}

const arrowWords = /箭头|箭頭|arrow|chevron|caret|下拉|展开|展開|\bdown\b|dropdown/i

/**
 * 下拉触发器：不超过 56px 高的横向小块，一段不超过 24 字的文字后面跟着一个不超过 16px、名字像箭头的图标。
 * 值得单独记下来是因为它的宽度：稿面常把它定宽（搜索框左侧 144px 的站点选择），实现时却被做成随文字撑开。
 */
function selectTrigger(node: DesignNode): DesignSignal | undefined {
  if (!node.id || !isFlex(node) || isColumn(node) || node.descendants > 4) return undefined
  const height = node.height ?? pxValue(css(node, 'height'))
  if (height !== undefined && height > 56) return undefined
  const texts = textLeaves(node), icons = imageLeaves(node)
  if (texts.length !== 1 || icons.length !== 1) return undefined
  const text = texts[0]!, icon = icons[0]!
  if ((text.text ?? '').length > 24 || (icon.width ?? 99) > 16 || (icon.height ?? 99) > 16) return undefined
  if (!arrowWords.test((icon.name ?? '') + ' ' + (icon.src ?? ''))) return undefined
  // 箭头在文字之后：按文档顺序比较。
  const order: DesignNode[] = []
  const visit = (current: DesignNode) => { order.push(current); for (const child of current.children) visit(child) }
  visit(node)
  if (order.indexOf(icon) < order.indexOf(text)) return undefined
  const style = signalStyle(node)
  return {
    kind: 'select-trigger', nodeId: node.id, name: node.name ?? node.tag, text: text.text,
    members: [text.id, icon.id].filter((id): id is string => !!id),
    style,
    evidence: '文字「' + text.text + '」后面跟着 ' + (icon.width ?? '?') + 'px 的「' + (icon.name ?? '箭头') + '」' + (style.sizing?.width === 'fixed' && style.width ? '，稿面定宽 ' + style.width + 'px' : ''),
  }
}

/**
 * 在一棵设计节点树上检测全部结构信号，按文档顺序返回。
 * 同一个节点只记一种信号；被选择组、问答列表收作成员的节点不再单独报下拉触发器。
 * @param blockOf 节点 ID → 所在区块节点 ID（没有时不记 block）。
 */
export function detectSignals(root: DesignNode, blockOf?: (nodeId: string) => string | undefined): DesignSignal[] {
  const signals: DesignSignal[] = []
  const claimed = new Set<string>()
  const visit = (node: DesignNode, parent: DesignNode | undefined) => {
    if (signals.length >= MAX_SIGNALS) return
    if (node.id) {
      const found = cornerBadge(node, parent) ?? underlineField(node) ?? accordion(node) ?? selectionList(node) ?? (claimed.has(node.id) ? undefined : selectTrigger(node))
      if (found) {
        const block = blockOf?.(found.nodeId), covers: string[] = []
        const collect = (current: DesignNode) => { for (const child of current.children) { if (child.id && covers.length < 300) covers.push(child.id); collect(child) } }
        collect(node)
        signals.push({ ...found, ...(block ? { block } : {}), ...(covers.length ? { covers } : {}) })
        if (found.kind === 'accordion' || found.kind === 'selection-list') for (const id of found.members ?? []) claimed.add(id)
        // 角标与下划线输入是叶子结构，里面不会再有别的组件。
        if (found.kind === 'corner-badge' || found.kind === 'underline-field' || found.kind === 'select-trigger') return
      }
    }
    for (const child of node.children) visit(child, node)
  }
  visit(root, undefined)
  return signals
}

/**
 * 把各区块导出 HTML 的展开结构接回根节点结构：根结构里的组件实例是没展开的 ui-component，
 * 展开后的内部节点与样式只在区块导出里。找不到对应区块的节点保持原样。
 * @param blocks 区块节点 ID → 该区块导出 HTML 解析出的树。
 */
export function assembleTree(root: DesignNode, blocks: ReadonlyMap<string, DesignNode>): DesignNode {
  const replace = (node: DesignNode): DesignNode => {
    const exported = node.id ? blocks.get(node.id) : undefined
    if (exported) {
      // 区块导出的根元素常写 align-self: stretch 而不写宽高，这时沿用根结构里量到的尺寸。
      return { ...exported, width: exported.width ?? node.width, height: exported.height ?? node.height }
    }
    return { ...node, children: node.children.map(replace) }
  }
  return replace(root)
}
