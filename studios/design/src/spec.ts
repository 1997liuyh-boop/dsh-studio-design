/**
 * 节点规格：预读时从导出 HTML 的内联样式抽取尺寸、字号、颜色等可测量字段，
 * 写进 manifest 的 blocks[].spec，供几何与像素审计逐项比对。只保留有文字、背景、描边、
 * 圆角、图片或显式定位的节点，控制清单体积。
 */
import type { DesignNode } from './reader.ts'

export interface NodeSpec {
  id: string
  name?: string
  tag: string
  /** 直接文字内容（折叠空白，最长 120 字）。 */
  text?: string
  /** 自身或子树含文字：文字宽度随字体变化，比对尺寸时需要区别对待。 */
  textual?: true
  width?: number
  height?: number
  /** 导出 HTML 里显式的 left / top（相对父节点），flex 布局的子节点没有。 */
  left?: number
  top?: number
  fontSize?: number
  lineHeight?: number
  fontWeight?: number
  fontFamily?: string
  /** 颜色统一为小写 #rrggbb，带透明度时为 #rrggbbaa。 */
  color?: string
  background?: string
  /** 四角圆角 [左上, 右上, 右下, 左下]，单位 px。 */
  radius?: [number, number, number, number]
  /** 描边宽度与颜色，只在 border-style 不为 none 时记录。 */
  border?: { width: number; color?: string }
}

/** 每个区块最多保留的规格节点数；超出的节点不参与比对。 */
export const MAX_SPEC_NODES = 400

/** 读取内联 style 中的一个属性值；没有则返回 undefined。 */
export function styleProperty(style: string, name: string): string | undefined {
  const match = new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]*)').exec(style)
  const value = match?.[1]?.trim()
  return value ? value : undefined
}

const namedColors: Record<string, string> = { white: '#ffffff', black: '#000000', transparent: '#00000000', red: '#ff0000' }

/** 把 #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() 统一成小写 #rrggbb（有透明度时附 aa）；解析不了返回 undefined。 */
export function normalizeColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  const input = value.trim().toLowerCase()
  if (namedColors[input]) return namedColors[input]
  const hex = /^#([0-9a-f]{3,8})$/.exec(input)?.[1]
  if (hex) {
    if (hex.length === 3 || hex.length === 4) return normalizeColor('#' + [...hex].map(char => char + char).join(''))
    if (hex.length === 6) return '#' + hex
    if (hex.length === 8) return hex.endsWith('ff') ? '#' + hex.slice(0, 6) : '#' + hex
    return undefined
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(input)
  if (!fn) return undefined
  const channel = (text: string) => Math.max(0, Math.min(255, Math.round(Number(text)))).toString(16).padStart(2, '0')
  const alpha = fn[4] === undefined ? 1 : fn[4].endsWith('%') ? Number(fn[4].slice(0, -1)) / 100 : Number(fn[4])
  const rgb = '#' + channel(fn[1]!) + channel(fn[2]!) + channel(fn[3]!)
  const aa = Math.max(0, Math.min(255, Math.round(alpha * 255)))
  return aa === 255 ? rgb : rgb + aa.toString(16).padStart(2, '0')
}

/** 解析 px 数值；百分比、auto 等返回 undefined。 */
export function pxValue(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = /^(-?[\d.]+)(?:px)?$/.exec(value.trim())
  return match ? Number(match[1]) : undefined
}

/** border-radius 简写展开为四角；含百分比或解析失败时返回 undefined。 */
export function parseRadius(value: string | undefined): [number, number, number, number] | undefined {
  if (!value) return undefined
  const parts = value.trim().split('/')[0]!.split(/\s+/).map(pxValue)
  if (parts.length === 0 || parts.length > 4 || parts.some(part => part === undefined)) return undefined
  const [a, b = a, c = a, d = b] = parts as number[]
  return [a!, b!, c!, d!]
}

/** font-weight 关键字转数值。 */
export function parseWeight(value: string | undefined): number | undefined {
  if (!value) return undefined
  const text = value.trim().toLowerCase()
  if (text === 'normal') return 400
  if (text === 'bold') return 700
  const number = Number(text)
  return Number.isFinite(number) ? number : undefined
}

/** 从一个节点的内联样式与文字生成规格；返回 undefined 表示该节点不值得保留。 */
export function nodeSpec(node: DesignNode, isRoot = false): NodeSpec | undefined {
  if (!node.id) return undefined
  const style = node.style ?? ''
  const spec: NodeSpec = { id: node.id, name: node.name, tag: node.tag }
  if (node.text) spec.text = node.text.slice(0, 120)
  spec.width = node.width ?? pxValue(styleProperty(style, 'width'))
  spec.height = node.height ?? pxValue(styleProperty(style, 'height'))
  spec.left = node.left ?? pxValue(styleProperty(style, 'left'))
  spec.top = node.top ?? pxValue(styleProperty(style, 'top'))
  spec.fontSize = pxValue(styleProperty(style, 'font-size'))
  const fontSize = spec.fontSize
  const lineHeight = styleProperty(style, 'line-height')
  spec.lineHeight = pxValue(lineHeight) ?? (lineHeight && fontSize && /^[\d.]+$/.test(lineHeight) ? Number(lineHeight) * fontSize : undefined)
  spec.fontWeight = parseWeight(styleProperty(style, 'font-weight'))
  spec.fontFamily = styleProperty(style, 'font-family')?.replace(/["']/g, '')
  spec.color = normalizeColor(styleProperty(style, 'color'))
  spec.background = normalizeColor(styleProperty(style, 'background-color') ?? styleProperty(style, 'background'))
  spec.radius = parseRadius(styleProperty(style, 'border-radius'))
  // border 简写里的 rgb() 含空格，不能按空白切分，颜色用正则单独取。
  const shorthand = styleProperty(style, 'border')
  const borderStyle = styleProperty(style, 'border-style') ?? /\b(solid|dashed|dotted|double|none)\b/.exec(shorthand ?? '')?.[1]
  if (borderStyle && borderStyle !== 'none') {
    const width = pxValue(styleProperty(style, 'border-width')) ?? pxValue(/(-?[\d.]+)px/.exec(shorthand ?? '')?.[0])
    const color = normalizeColor(styleProperty(style, 'border-color')) ?? normalizeColor(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i.exec(shorthand ?? '')?.[0])
    if (width !== undefined) spec.border = color ? { width, color } : { width }
  }
  const positioned = spec.left !== undefined || spec.top !== undefined
  const keep = isRoot || spec.text || spec.background || spec.border || spec.radius || node.tag === 'img' || positioned
  if (!keep) return undefined
  // 文字相关字段只对有文字的节点有意义，容器上的继承值不记录，减少噪音。
  if (!spec.text) { delete spec.fontSize; delete spec.lineHeight; delete spec.fontWeight; delete spec.fontFamily; delete spec.color }
  for (const key of Object.keys(spec) as (keyof NodeSpec)[]) if (spec[key] === undefined) delete spec[key]
  return spec
}

/** 判断子树是否含文字。 */
function textual(node: DesignNode): boolean {
  return !!node.text || node.children.some(textual)
}

/** 按先序遍历区块导出 HTML 的节点树生成规格表；第一个带 data-node-id 的元素视为区块根。 */
export function blockSpec(tree: DesignNode): NodeSpec[] {
  const result: NodeSpec[] = []
  let root: DesignNode | undefined
  const visit = (node: DesignNode) => {
    if (result.length >= MAX_SPEC_NODES) return
    const isRoot = !root && !!node.id
    if (isRoot) root = node
    const spec = nodeSpec(node, isRoot)
    if (spec) { if (textual(node)) spec.textual = true; result.push(spec) }
    for (const child of node.children) visit(child)
  }
  visit(tree)
  return result
}
