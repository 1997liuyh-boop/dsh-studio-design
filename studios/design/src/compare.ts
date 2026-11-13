/**
 * 几何与像素审计：用浏览器实测实现页面里 data-design 节点的位置、尺寸与计算样式，
 * 与预读规格表（manifest.blocks[].spec）及导出 HTML 在同一浏览器里的渲染结果逐项比对，
 * 再把每个区块的截图与 MasterGo 预览图做像素比对。测量函数可注入，比对与像素算法不依赖浏览器，
 * 结果写进目标项目 docs/design/compare-report.json，差异图写进 docs/design/compare/。
 */
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { inside, readOptional, text } from './project.ts'
import { CHECKLIST_PATH, MANIFEST_PATH, imageSize, writeJsonAtomic, type BlockRecord, type Manifest } from './reader.ts'
import { normalizeColor, pxValue, type NodeSpec } from './spec.ts'

export interface Rect { x: number; y: number; width: number; height: number }
/** 浏览器 getComputedStyle 的原始字符串，比对时再归一化。 */
export interface MeasuredStyles {
  fontSize?: string
  lineHeight?: string
  fontWeight?: string
  fontFamily?: string
  color?: string
  backgroundColor?: string
  /** 四角圆角 [左上, 右上, 右下, 左下]。 */
  radius?: [string, string, string, string]
  borderWidth?: string
  borderStyle?: string
  borderColor?: string
  /** 内边距 [上, 右, 下, 左]。 */
  padding?: [string, string, string, string]
}
export interface MeasuredNode {
  rect: Rect
  text?: string
  styles?: MeasuredStyles
  /** 内容滚动尺寸：大于盒子即内容溢出（导出 HTML 在回落字体下 nowrap 文字撑宽时会这样）。 */
  scrollWidth?: number
  scrollHeight?: number
  /** img 元素：实际加载的图片尺寸与 object-fit，用于判断小图被拉伸。 */
  image?: { src: string; naturalWidth: number; naturalHeight: number; objectFit: string }
  /** 节点是 RebornImage 的根（直接子元素是组件内部带 peer 类的 img）。 */
  rebornImage?: boolean
}
export interface MeasureBlock {
  nodeId: string
  /** 需要测量的节点 ID（含区块根）。 */
  ids: string[]
  /** 区块导出 HTML 的绝对路径；测量函数在同一浏览器里渲染它，得到设计侧的节点几何。 */
  exportHtml?: string
  /** 区块在设计稿里的宽度：渲染导出 HTML 时视口设为这个宽度，flex: 1 / align-self: stretch 的根才不会撑满整页。 */
  width?: number
}
export interface MeasureJob { url: string; width: number; height: number; blocks: MeasureBlock[] }
export interface BlockMeasurement {
  nodeId: string
  /** 实现页面里按 data-design 找到的节点，矩形为页面绝对坐标。 */
  nodes: Record<string, MeasuredNode>
  /** 导出 HTML 渲染后按 data-node-id 找到的节点，矩形为该页面的绝对坐标。 */
  design?: Record<string, MeasuredNode>
  /** 区块根元素的 PNG 截图。 */
  screenshot?: Buffer
  error?: string
}
export interface MeasureResult { blocks: BlockMeasurement[]; warnings: string[] }
/** 测量函数：真实实现用 Playwright，测试里可注入假数据。 */
export type Measurer = (job: MeasureJob) => Promise<MeasureResult>

export interface Difference {
  block: string
  node: string
  name?: string
  field: string
  expected: string
  actual: string
  /** 数值字段的差值绝对值（px）。 */
  delta?: number
  /** fail 需要修复；hint 只记录（字体族不同、文字节点的自适应尺寸）。 */
  level: 'fail' | 'hint'
  /** 降级为 hint 的原因：font = 本机缺字体导致的文字度量差；overflow = 导出 HTML 渲染溢出。 */
  reason?: 'font' | 'overflow'
  /** 排序权重：越大越靠前。 */
  weight: number
}
export interface PixelResult {
  /** 1 - 不一致像素 / 比对像素。 */
  similarity: number
  mismatched: number
  total: number
  width: number
  height: number
  designWidth: number
  designHeight: number
  /** 预览图与截图尺寸不同，已把预览图按宽度缩放后比较重叠区域。 */
  scaled: boolean
  /** 预览图含阴影外扩，已按节点盒居中裁掉外圈再比。 */
  cropped?: true
  diffImage?: string
  actualImage?: string
}
export interface BlockReport {
  nodeId: string
  name: string
  status: 'ok' | 'missing-root' | 'no-spec' | 'error'
  specNodes: number
  measured: number
  /** 规格表里有、页面上没找到 data-design 的节点（最多列 50 个）。 */
  unmeasured: string[]
  failures: number
  hints: number
  pixel?: PixelResult
  pixelIssue?: string
  /** 导出 HTML 渲染溢出，位置差异已降为提示。 */
  designOverflow?: true
  error?: string
}
export interface CompareResult {
  stage: 'compare'
  ready: boolean
  round: number
  url: string
  width: number
  thresholdPx: number
  issues: string[]
  warnings: string[]
  blocks: BlockReport[]
  /** 按权重排序的差异（最多 150 条，完整清单在 report 文件里）。 */
  differences: Difference[]
  summary: { blocks: number; measuredBlocks: number; specNodes: number; measured: number; failures: number; hints: number; /** 其中因本机缺字体降级的提示数。 */ fontHints: number; /** 其中因导出 HTML 渲染溢出降级的提示数。 */ overflowHints: number; similarity?: number }
  report: string
  next: string
}

export const COMPARE_REPORT_PATH = 'docs/design/compare-report.json'
export const COMPARE_DIR = 'docs/design/compare'
/** 位置与尺寸的容差（px）。 */
export const POSITION_TOLERANCE = 2
/** 像素比对的颜色阈值（pixelmatch 同义，0–1）。 */
export const PIXEL_THRESHOLD = 0.1
const MAX_DIFFERENCES = 150
const weights = { bitmap: 330, coverage: 60, text: 100, radius: 150, border: 150, lineHeight: 200, fontWeight: 300, padding: 320, stretch: 350, fontSize: 400, color: 500, background: 500 }

const loopback = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:\/[^\s"'<>）)]*)?$/

/** 清单「预览地址」行里登记的本机地址；骨架占位符（括号开头）不算登记。 */
export function checklistPreviewUrl(markdown: string | null): string | undefined {
  if (!markdown) return undefined
  const match = /预览地址\s*[:：]\s*([^\n]*)/.exec(markdown)
  if (!match) return undefined
  const value = match[1]!.trim()
  if (!value || value.startsWith('（') || value.startsWith('(')) return undefined
  const url = /https?:\/\/\S+/.exec(value)?.[0]?.replace(/[，。；,;）)`]+$/, '')
  return url && loopback.test(url) ? url : undefined
}

/** 预览地址只接受回环地址：工具参数 → 实现清单 → 工作室预览设置 → 框架默认。 */
export function resolvePreviewUrl(options: { override?: unknown; checklist: string | null; workspaceUrl?: string; fallback?: string }): string {
  const override = options.override === undefined ? '' : text(options.override, 512).trim()
  const candidate = override || checklistPreviewUrl(options.checklist) || options.workspaceUrl || options.fallback || ''
  if (!candidate) throw new Error('没有预览地址：请先启动预览，并把本机地址写进 ' + CHECKLIST_PATH + ' 的「预览地址」行，或传入 url 参数')
  if (!loopback.test(candidate)) throw new Error('预览地址只接受本机回环地址（http://localhost:端口/…）：' + candidate)
  return candidate
}

const relative = (node: MeasuredNode, root: MeasuredNode): Rect => ({ x: node.rect.x - root.rect.x, y: node.rect.y - root.rect.y, width: node.rect.width, height: node.rect.height })
const round1 = (value: number) => Math.round(value * 10) / 10
const px = (value: number) => round1(value) + 'px'
const family = (value: string | undefined) => value?.split(',')[0]?.replace(/["']/g, '').trim().toLowerCase() ?? ''

/** 圆角解析：px 取数值，百分比 ≥ 50% 视为全圆。 */
function radiusPx(value: string | undefined, width: number, height: number): number | undefined {
  if (!value) return undefined
  const first = value.trim().split(/\s+/)[0]!
  if (first.endsWith('%')) return Number(first.slice(0, -1)) >= 50 ? Math.min(width, height) / 2 : Number(first.slice(0, -1)) / 100 * Math.min(width, height)
  return pxValue(first)
}
/** 圆角达到短边一半即为胶囊 / 圆形，两边都是胶囊时视为相等（238px 与 9999px 同义）。 */
function sameRadius(expected: number, actual: number, width: number, height: number): boolean {
  const limit = Math.max(0, Math.min(width, height) / 2 - 0.5)
  if (expected >= limit && actual >= limit) return true
  return Math.abs(expected - actual) < 0.5
}

/**
 * 比对一个规格节点：几何按容差，颜色、字号、字重、行高、圆角、描边精确；字体族不同只提示。
 * @param spec - 预读规格。
 * @param actual - 实现页面测得的节点；undefined 表示页面上没有 data-design。
 * @param actualRoot - 实现页面的区块根，位置相对它计算。
 * @param design - 导出 HTML 渲染后的同一节点（有则位置与尺寸以它为准）。
 * @param designRoot - 导出 HTML 渲染后的区块根。
 */
export function compareNode(block: string, spec: NodeSpec, actual: MeasuredNode, actualRoot: MeasuredNode, design: MeasuredNode | undefined, designRoot: MeasuredNode | undefined, options: { tolerance?: number; designUnreliable?: boolean; /** 设计稿本身放大的位图文件名，不按拉伸报错。 */ designScaled?: ReadonlySet<string> } = {}): Difference[] {
  const result: Difference[] = []
  const tolerance = options.tolerance ?? POSITION_TOLERANCE
  const base = { block, node: spec.id, name: spec.name }
  const rect = relative(actual, actualRoot)
  const rendered = design && designRoot ? relative(design, designRoot) : undefined
  // 导出 HTML 渲染溢出时它的几何不可信：尺寸退回规格表，位置只提示。
  const designRect = options.designUnreliable ? undefined : rendered
  const styles = actual.styles ?? {}
  // 本机缺稿面字体时文字度量不同：该文字节点的横向位置与宽度差异只提示并标明原因，避免淹没真实差异。
  const fontMismatch = !!(spec.text !== undefined && spec.fontFamily && styles.fontFamily && !family(styles.fontFamily).includes(spec.fontFamily.toLowerCase()) && !styles.fontFamily.toLowerCase().includes(spec.fontFamily.toLowerCase()))
  const numeric = (field: string, expected: number | undefined, value: number, level: Difference['level'] = 'fail', reason?: Difference['reason']) => {
    if (expected === undefined) return
    const delta = Math.abs(expected - value)
    if (delta > tolerance) result.push({ ...base, field, expected: px(expected), actual: px(value), delta: round1(delta), level, weight: round1(delta), ...(level === 'hint' && reason ? { reason } : {}) })
  }
  // 文字节点没有显式宽高时随字体变化，尺寸差异只提示；显式尺寸与位置仍按容差判定。
  const horizontal = (fallback: Difference['level']): [Difference['level'], Difference['reason'] | undefined] => options.designUnreliable ? ['hint', 'overflow'] : fontMismatch ? ['hint', 'font'] : [fallback, undefined]
  numeric('width', designRect?.width ?? spec.width, rect.width, ...horizontal(spec.textual && spec.width === undefined ? 'hint' : 'fail'))
  numeric('height', designRect?.height ?? spec.height, rect.height, spec.textual && spec.height === undefined ? 'hint' : 'fail')
  if (rendered && spec.id !== block) {
    numeric('x', rendered.x, rect.x, ...horizontal('fail'))
    numeric('y', rendered.y, rect.y, options.designUnreliable ? 'hint' : 'fail', options.designUnreliable ? 'overflow' : undefined)
  }
  const exact = (field: keyof typeof weights, expected: string | number | undefined, value: string | number | undefined, delta?: number) => {
    if (expected === undefined || value === undefined || String(expected) === String(value)) return
    result.push({ ...base, field, expected: String(expected), actual: String(value), delta, level: 'fail', weight: weights[field] + (delta ?? 0) })
  }
  if (spec.text !== undefined) {
    const actualText = actual.text?.replace(/\s+/g, ' ').trim()
    if (actualText !== undefined && actualText !== spec.text) result.push({ ...base, field: 'text', expected: spec.text, actual: actualText.slice(0, 120), level: 'fail', weight: weights.text })
    exact('fontSize', spec.fontSize === undefined ? undefined : spec.fontSize + 'px', styles.fontSize, spec.fontSize !== undefined && pxValue(styles.fontSize) !== undefined ? Math.abs(spec.fontSize - pxValue(styles.fontSize)!) : undefined)
    exact('lineHeight', spec.lineHeight === undefined ? undefined : spec.lineHeight + 'px', styles.lineHeight, spec.lineHeight !== undefined && pxValue(styles.lineHeight) !== undefined ? Math.abs(spec.lineHeight - pxValue(styles.lineHeight)!) : undefined)
    exact('fontWeight', spec.fontWeight, styles.fontWeight === undefined ? undefined : styles.fontWeight === 'normal' ? 400 : styles.fontWeight === 'bold' ? 700 : Number(styles.fontWeight))
    exact('color', spec.color, normalizeColor(styles.color) ?? styles.color)
    if (fontMismatch) result.push({ ...base, field: 'fontFamily', expected: spec.fontFamily!, actual: family(styles.fontFamily), level: 'hint', weight: 0, reason: 'font' })
  }
  if (spec.background !== undefined) exact('background', spec.background, normalizeColor(styles.backgroundColor) ?? styles.backgroundColor)
  if (spec.radius && styles.radius) {
    const expectedBox = { width: designRect?.width ?? spec.width ?? rect.width, height: designRect?.height ?? spec.height ?? rect.height }
    const corners = ['左上', '右上', '右下', '左下']
    for (let index = 0; index < 4; index += 1) {
      const expected = spec.radius[index]!, value = radiusPx(styles.radius[index], rect.width, rect.height)
      if (value === undefined || sameRadius(expected, value, expectedBox.width, expectedBox.height)) continue
      result.push({ ...base, field: 'radius' + corners[index], expected: px(expected), actual: px(value), delta: round1(Math.abs(expected - value)), level: 'fail', weight: weights.radius + Math.abs(expected - value) })
      break
    }
  }
  // 位图被放大超过 1.25 倍（object-fit 不是 none / scale-down）：导出的是裁切或缩略图却被拉到稿面尺寸。SVG 无固有像素，不判。
  const image = actual.image
  const imageName = image ? decodeURIComponent(image.src.split(/[?#]/)[0]!.split('/').pop() ?? '') : ''
  if (image && image.naturalWidth > 0 && image.naturalHeight > 0 && !/\.svg(?:[?#]|$)/i.test(image.src) && !['none', 'scale-down'].includes(image.objectFit) && !options.designScaled?.has(imageName)) {
    const scale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight)
    if (scale > 1.25) result.push({ ...base, field: 'stretch', expected: '原图 ' + image.naturalWidth + '×' + image.naturalHeight, actual: '渲染 ' + px(rect.width) + '×' + px(rect.height) + '（放大 ' + round1(scale) + ' 倍，object-fit: ' + image.objectFit + '）', delta: round1(scale), level: 'fail', weight: weights.stretch + scale * 10 })
  }
  // 稿面位图（图片节点或带子元素的图片填充）必须用 reborn-image：原生 img、CSS 背景图都不算。
  if (spec.bitmap && !actual.rebornImage) result.push({ ...base, field: 'reborn-image', expected: spec.bitmap === 'background' ? '图片填充用 RebornImage，子元素放进它的默认插槽' : '位图用 RebornImage（传稿面 width / height，mode 对应 object-fit）', actual: actual.image ? '原生 img' : '不是 RebornImage（可能是 CSS 背景图）', level: 'fail', weight: weights.bitmap })
  // 由内容撑开（hug）的节点：宽度随字体变化，真正决定外观的是内边距。按钮、胶囊、标签写死 w-[…] 时内边距通常被改掉，这里逐边核对。
  if (spec.padding && styles.padding && (spec.sizing?.width === 'hug' || spec.sizing?.height === 'hug')) {
    const sides = ['上', '右', '下', '左']
    const actualPadding = styles.padding.map(value => pxValue(value) ?? 0)
    const index = spec.padding.findIndex((value, side) => Math.abs(value - actualPadding[side]!) >= 1)
    if (index >= 0) result.push({ ...base, field: 'padding', expected: spec.padding.join(' ') + 'px', actual: actualPadding.map(round1).join(' ') + 'px（' + sides[index] + '边不同）', delta: round1(Math.abs(spec.padding[index]! - actualPadding[index]!)), level: 'fail', weight: weights.padding + Math.abs(spec.padding[index]! - actualPadding[index]!) })
  }
  if (spec.border) {
    const width = styles.borderStyle === 'none' || styles.borderStyle === undefined && styles.borderWidth === undefined ? 0 : pxValue(styles.borderWidth)
    // 浏览器把描边宽度吸附到整数设备像素（4.8px 读出 4px），容差放到 1px。
    if (width !== undefined && Math.abs(width - spec.border.width) >= 1) result.push({ ...base, field: 'borderWidth', expected: px(spec.border.width), actual: px(width), delta: round1(Math.abs(width - spec.border.width)), level: 'fail', weight: weights.border })
    else if (spec.border.color && styles.borderColor) exact('border', spec.border.color, normalizeColor(styles.borderColor) ?? styles.borderColor)
  }
  return result
}

export interface Image { width: number; height: number; data: Uint8Array }

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 解码非隔行 PNG 为 RGBA；支持 1–16 位的灰度、RGB、调色板、带 alpha 各类型。 */
export function decodePng(buffer: Buffer): Image {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) throw new Error('不是 PNG 文件')
  let offset = 8, width = 0, height = 0, depth = 0, colorType = 0, interlace = 0
  const idat: Buffer[] = []
  let palette: Buffer | undefined, transparency: Buffer | undefined
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('latin1', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]!; colorType = data[9]!; interlace = data[12]! }
    else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') transparency = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (!width || !height) throw new Error('PNG 缺少 IHDR')
  if (interlace) throw new Error('暂不支持隔行 PNG')
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0
  if (!channels) throw new Error('未知 PNG 颜色类型 ' + colorType)
  const bitsPerPixel = channels * depth, bytesPerPixel = Math.max(1, bitsPerPixel >> 3), stride = Math.ceil(width * bitsPerPixel / 8)
  const raw = inflateSync(Buffer.concat(idat))
  if (raw.length < (stride + 1) * height) throw new Error('PNG 数据不完整')
  const lines = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!, source = y * (stride + 1) + 1, target = y * stride, previous = (y - 1) * stride
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source + x]!
      const left = x >= bytesPerPixel ? lines[target + x - bytesPerPixel]! : 0
      const up = y > 0 ? lines[previous + x]! : 0
      const upLeft = y > 0 && x >= bytesPerPixel ? lines[previous + x - bytesPerPixel]! : 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = (left + up) >> 1
      else if (filter === 4) { const p = left + up - upLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft); predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft }
      else if (filter !== 0) throw new Error('未知 PNG 滤波 ' + filter)
      lines[target + x] = (value + predictor) & 0xff
    }
  }
  const out = new Uint8Array(width * height * 4)
  const sample = (line: number, index: number): number => {
    // 按位深取样并归一到 0–255；16 位只取高字节。
    if (depth === 8) return lines[line * stride + index]!
    if (depth === 16) return lines[line * stride + index * 2]!
    const bit = index * depth, byte = lines[line * stride + (bit >> 3)]!, shift = 8 - depth - (bit & 7)
    const value = (byte >> shift) & ((1 << depth) - 1)
    return colorType === 3 ? value : Math.round(value * 255 / ((1 << depth) - 1))
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const o = (y * width + x) * 4
    if (colorType === 0) { const v = sample(y, x); out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = transparency && depth === 8 && transparency.readUInt16BE(0) === v ? 0 : 255 }
    else if (colorType === 2) { out[o] = sample(y, x * 3); out[o + 1] = sample(y, x * 3 + 1); out[o + 2] = sample(y, x * 3 + 2); out[o + 3] = 255 }
    else if (colorType === 3) { const index = sample(y, x); out[o] = palette?.[index * 3] ?? 0; out[o + 1] = palette?.[index * 3 + 1] ?? 0; out[o + 2] = palette?.[index * 3 + 2] ?? 0; out[o + 3] = transparency && index < transparency.length ? transparency[index]! : 255 }
    else if (colorType === 4) { const v = sample(y, x * 2); out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = sample(y, x * 2 + 1) }
    else { out[o] = sample(y, x * 4); out[o + 1] = sample(y, x * 4 + 1); out[o + 2] = sample(y, x * 4 + 2); out[o + 3] = sample(y, x * 4 + 3) }
  }
  return { width, height, data: out }
}

/** 把 RGBA 编码为 8 位 RGBA PNG（无滤波），用于写差异图。 */
export function encodePng(image: Image): Buffer {
  const stride = image.width * 4, raw = Buffer.alloc((stride + 1) * image.height)
  for (let y = 0; y < image.height; y += 1) { raw[y * (stride + 1)] = 0; raw.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1) }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([head, body, tail])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(image.width, 0); ihdr.writeUInt32BE(image.height, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** 双线性缩放到指定尺寸。 */
export function scaleImage(image: Image, width: number, height: number): Image {
  if (image.width === width && image.height === height) return image
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(image.height - 1, (y + 0.5) * image.height / height - 0.5), y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(image.height - 1, y0 + 1), fy = Math.max(0, sy - y0)
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(image.width - 1, (x + 0.5) * image.width / width - 0.5), x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(image.width - 1, x0 + 1), fx = Math.max(0, sx - x0)
      for (let c = 0; c < 4; c += 1) {
        const top = image.data[(y0 * image.width + x0) * 4 + c]! * (1 - fx) + image.data[(y0 * image.width + x1) * 4 + c]! * fx
        const bottom = image.data[(y1 * image.width + x0) * 4 + c]! * (1 - fx) + image.data[(y1 * image.width + x1) * 4 + c]! * fx
        out[(y * width + x) * 4 + c] = Math.round(top * (1 - fy) + bottom * fy)
      }
    }
  }
  return { width, height, data: out }
}

/** 裁出子图。 */
export function cropImage(image: Image, x: number, y: number, width: number, height: number): Image {
  const out = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row += 1) out.set(image.data.subarray(((y + row) * image.width + x) * 4, ((y + row) * image.width + x + width) * 4), row * width * 4)
  return { width, height, data: out }
}

/** 预览图比截图在四周各多出同一圈（1–64px，宽高外扩相差不超过 2px）时视为阴影外扩，返回居中裁剪后的预览图；否则 undefined。 */
export function cropMargin(design: Image, actual: Image): Image | undefined {
  const mx = (design.width - actual.width) / 2, my = (design.height - actual.height) / 2
  if (mx < 1 || my < 1 || mx > 64 || my > 64 || Math.abs(mx - my) > 2) return undefined
  return cropImage(design, Math.floor(mx), Math.floor(my), actual.width, actual.height)
}

/** pixelmatch 的 YIQ 色差：alpha 先与白底混合。 */
function colorDelta(a: Uint8Array, b: Uint8Array, i: number, j: number): number {
  let r1 = a[i]!, g1 = a[i + 1]!, b1 = a[i + 2]!, a1 = a[i + 3]!
  let r2 = b[j]!, g2 = b[j + 1]!, b2 = b[j + 2]!, a2 = b[j + 3]!
  if (a1 === a2 && r1 === r2 && g1 === g2 && b1 === b2) return 0
  if (a1 < 255) { a1 /= 255; r1 = 255 + (r1 - 255) * a1; g1 = 255 + (g1 - 255) * a1; b1 = 255 + (b1 - 255) * a1 }
  if (a2 < 255) { a2 /= 255; r2 = 255 + (r2 - 255) * a2; g2 = 255 + (g2 - 255) * a2; b2 = 255 + (b2 - 255) * a2 }
  const y = (r1 - r2) * 0.29889531 + (g1 - g2) * 0.58662247 + (b1 - b2) * 0.11448223
  const i2 = (r1 - r2) * 0.59597799 - (g1 - g2) * 0.27417610 - (b1 - b2) * 0.32180189
  const q = (r1 - r2) * 0.21147017 - (g1 - g2) * 0.52261711 + (b1 - b2) * 0.31114694
  return 0.5053 * y * y + 0.299 * i2 * i2 + 0.1957 * q * q
}

/**
 * 像素比对：预览图按截图宽度缩放后比较重叠区域，返回相似度与差异图（灰底，不同像素标红）。
 * 不做抗锯齿检测，文字边缘的渲染差异会计入，相似度只作为趋势指标。
 */
export function diffImages(actual: Image, design: Image, threshold = PIXEL_THRESHOLD): { similarity: number; mismatched: number; total: number; scaled: boolean; diff: Image; width: number; height: number } {
  const scaled = design.width !== actual.width
  const reference = scaled ? scaleImage(design, actual.width, Math.max(1, Math.round(design.height * actual.width / design.width))) : design
  const width = actual.width, height = Math.min(actual.height, reference.height)
  const maxDelta = 35215 * threshold * threshold
  const diff = new Uint8Array(width * height * 4)
  let mismatched = 0
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = (y * actual.width + x) * 4, j = (y * reference.width + x) * 4, o = (y * width + x) * 4
    if (colorDelta(actual.data, reference.data, i, j) > maxDelta) { mismatched += 1; diff[o] = 255; diff[o + 1] = 0; diff[o + 2] = 0; diff[o + 3] = 255; continue }
    const alpha = actual.data[i + 3]! / 255
    const gray = 255 + ((actual.data[i]! * 0.29889531 + actual.data[i + 1]! * 0.58662247 + actual.data[i + 2]! * 0.11448223) * alpha + 255 * (1 - alpha) - 255) * 0.25
    diff[o] = diff[o + 1] = diff[o + 2] = Math.round(gray); diff[o + 3] = 255
  }
  const total = width * height
  return { similarity: total ? Math.round((1 - mismatched / total) * 1000) / 1000 : 0, mismatched, total, scaled, diff: { width, height, data: diff }, width, height }
}

export interface CompareInput {
  root: string
  manifest: Manifest
  url: string
  measurer: Measurer
  round: number
  thresholdPx?: number
  /** 只比对这些区块（节点 ID）；缺省比对全部 status 为 ok 且有规格的区块。 */
  only?: string[]
}

/** 完整审计：测量 → 逐节点比对 → 像素比对 → 写报告与差异图。 */
export async function runCompare(input: CompareInput): Promise<CompareResult> {
  const { root, manifest, url, round } = input
  const tolerance = input.thresholdPx ?? POSITION_TOLERANCE
  const width = manifest.root.width ?? 1920, height = Math.min(Math.max(manifest.root.height ?? 1080, 720), 4000)
  const warnings: string[] = [], issues: string[] = []
  if (!manifest.root.width) warnings.push('预读清单没有记录画布宽度，按 1920 测量')
  const candidates = manifest.blocks.filter(block => block.status === 'ok' && (!input.only || input.only.includes(block.nodeId)))
  const jobs: MeasureBlock[] = []
  for (const block of candidates) {
    if (!block.spec?.length) continue
    // 导出 HTML 的根常是 flex: 1 或 align-self: stretch 而没有宽度，单独渲染会撑满视口；设计宽度按 区块宽度 → 规格根宽度 → 预览图宽度 取。
    const designWidth = block.width ?? block.spec[0]?.width ?? await previewWidth(root, block)
    jobs.push({ nodeId: block.nodeId, ids: [...new Set([block.nodeId, ...block.spec.map(node => node.id)])], exportHtml: block.html ? await inside(root, block.html).catch(() => undefined) : undefined, width: designWidth === undefined ? undefined : Math.round(designWidth) })
  }
  if (!jobs.length) throw new Error('预读清单里没有带规格表的区块，请重新读取设计稿（需求里写「重新读取」）后再比对')
  const measured = await input.measurer({ url, width, height, blocks: jobs })
  warnings.push(...measured.warnings)
  // 设计稿本身放大的位图（补导出证实原图就这么大）：页面按同样倍数放大不算拉伸。
  const designScaled = new Set(manifest.blocks.flatMap(block => block.assets.filter(asset => asset.scaledByDesign).map(asset => asset.path.split('/').pop()!)))
  await mkdir(join(root, COMPARE_DIR), { recursive: true })
  const differences: Difference[] = [], blocks: BlockReport[] = []
  for (const block of candidates) {
    const report: BlockReport = { nodeId: block.nodeId, name: block.name, status: 'ok', specNodes: block.spec?.length ?? 0, measured: 0, unmeasured: [], failures: 0, hints: 0 }
    blocks.push(report)
    if (!block.spec?.length) { report.status = 'no-spec'; continue }
    const result = measured.blocks.find(item => item.nodeId === block.nodeId)
    if (!result) { report.status = 'error'; report.error = '测量函数没有返回该区块'; continue }
    if (result.error) { report.status = 'error'; report.error = result.error; issues.push(block.name + '（' + block.nodeId + '）：' + result.error); continue }
    const actualRoot = result.nodes[block.nodeId]
    if (!actualRoot) { report.status = 'missing-root'; issues.push(block.name + '（' + block.nodeId + '）：页面上没有 data-design="' + block.nodeId + '" 的区块根元素，无法测量'); continue }
    const designRoot = result.design?.[block.nodeId]
    // 导出 HTML 在回落字体下 nowrap 文字撑宽、内容溢出根盒时，渲染出的位置不代表稿面：只作提示，尺寸退回规格表。
    const overflow = designRoot && ((designRoot.scrollWidth ?? 0) > designRoot.rect.width + tolerance || (designRoot.scrollHeight ?? 0) > designRoot.rect.height + tolerance)
    if (overflow) { report.designOverflow = true; warnings.push(block.name + '（' + block.nodeId + '）：导出 HTML 渲染时内容溢出（' + Math.round(designRoot.scrollWidth ?? 0) + '×' + Math.round(designRoot.scrollHeight ?? 0) + ' > ' + Math.round(designRoot.rect.width) + '×' + Math.round(designRoot.rect.height) + '，常见于回落字体撑宽 nowrap 文字），该块位置差异只作提示，尺寸按规格表比对') }
    const unmeasured: string[] = []
    for (const spec of block.spec) {
      const actual = result.nodes[spec.id]
      if (!actual) { unmeasured.push(spec.id); continue }
      report.measured += 1
      const found = compareNode(block.nodeId, spec, actual, actualRoot, result.design?.[spec.id], designRoot, { tolerance, designUnreliable: !!overflow, designScaled })
      for (const item of found) { if (item.level === 'fail') report.failures += 1; else report.hints += 1 }
      differences.push(...found)
    }
    // 文字、图标、位图和带内边距的节点必须能测到：字号、图标与文字的间距、图片尺寸都只能在这些节点上核对。
    // 只标区块根会让这些差异全部漏掉，因此缺 data-design 本身算失败（列表项按节点 ID 逐项绑定）。
    for (const id of unmeasured) {
      const spec = block.spec.find(item => item.id === id)!
      if (!(spec.text !== undefined || spec.tag === 'img' || spec.bitmap || spec.padding)) continue
      const what = spec.text !== undefined ? '文字「' + spec.text.slice(0, 20) + '」' : spec.bitmap ? '图片' : spec.tag === 'img' ? '图标' : '带内边距的容器'
      differences.push({ block: block.nodeId, node: id, name: spec.name, field: 'data-design', expected: what + '带 data-design="' + id + '"', actual: '页面上找不到', level: 'fail', weight: weights.coverage })
      report.failures += 1
    }
    report.unmeasured = unmeasured.slice(0, 50)
    if (unmeasured.length > 50) report.unmeasured.push('…另 ' + (unmeasured.length - 50) + ' 个')
    await pixelCompare(root, block, result, report)
  }
  differences.sort((a, b) => (a.level === b.level ? b.weight - a.weight : a.level === 'fail' ? -1 : 1))
  const measuredBlocks = blocks.filter(block => block.status === 'ok')
  const similarities = measuredBlocks.map(block => block.pixel?.similarity).filter((value): value is number => value !== undefined)
  const summary: CompareResult['summary'] = {
    blocks: blocks.length, measuredBlocks: measuredBlocks.length, specNodes: blocks.reduce((sum, block) => sum + block.specNodes, 0), measured: blocks.reduce((sum, block) => sum + block.measured, 0),
    failures: differences.filter(item => item.level === 'fail').length, hints: differences.filter(item => item.level === 'hint').length,
    fontHints: differences.filter(item => item.reason === 'font').length, overflowHints: differences.filter(item => item.reason === 'overflow').length,
    similarity: similarities.length ? Math.round(similarities.reduce((sum, value) => sum + value, 0) / similarities.length * 1000) / 1000 : undefined,
  }
  const ready = issues.length === 0 && summary.failures === 0 && measuredBlocks.length === blocks.length
  const next = ready ? '几何与样式比对全部在容差内。像素相似度只反映趋势（字体渲染差异会计入），请对照 ' + COMPARE_DIR + '/ 下的差异图确认；再调用 design_review(stage=verify) 登记证据。'
    : round >= 3 ? '已比对 ' + round + ' 轮。把仍未消除的差异（节点、字段、设计值、实际值与原因）写进 ' + CHECKLIST_PATH + ' 的「四、剩余差异」，报告中如实说明，不得宣称 1:1。'
    : '按差异清单从权重最高的开始修复（缺少 data-design 的区块根先补属性），再调用 design_review(stage=compare) 重查；最多三轮，第 ' + round + ' 轮。'
  const full = { stage: 'compare' as const, generatedAt: new Date().toISOString(), round, url, width, thresholdPx: tolerance, issues, warnings, blocks, differences, summary }
  await writeJsonAtomic(root, COMPARE_REPORT_PATH, full)
  return { stage: 'compare', ready, round, url, width, thresholdPx: tolerance, issues, warnings, blocks, differences: differences.slice(0, MAX_DIFFERENCES), summary, report: COMPARE_REPORT_PATH, next }
}

/** 预览图的像素宽度（MasterGo 按节点实际尺寸渲染，1 倍导出时即设计宽度）；读不到返回 undefined。 */
async function previewWidth(root: string, block: BlockRecord): Promise<number | undefined> {
  if (!block.screenshot?.path) return undefined
  try { return imageSize(await readFile(await inside(root, block.screenshot.path)), block.screenshot.path)?.width }
  catch (error) { return undefined }
}

/** 区块截图与预览图的像素比对；预览图缺失或格式不支持时只记录原因。 */
async function pixelCompare(root: string, block: BlockRecord, result: BlockMeasurement, report: BlockReport): Promise<void> {
  if (!result.screenshot) { report.pixelIssue = '没有区块截图'; return }
  const slug = basename(block.dir)
  const actualImage = COMPARE_DIR + '/' + slug + '-actual.png'
  await writeFile(join(root, actualImage), result.screenshot)
  if (!block.screenshot?.path) { report.pixelIssue = '预读没有拿到该区块的预览图（' + (block.screenshot?.status ?? 'missing') + '）'; return }
  let preview: Buffer
  try { preview = await readFile(await inside(root, block.screenshot.path)) }
  catch (error) { report.pixelIssue = '预览图不可读取：' + (error instanceof Error ? error.message : String(error)); return }
  try {
    const actual = decodePng(result.screenshot), design = decodePng(preview)
      // 预览图四周比截图各多出同样的一圈（阴影 / 外发光的外扩）时，按节点盒居中裁掉再比，避免缩放失真。
    const cropped = cropMargin(design, actual)
    const diff = diffImages(actual, cropped ?? design)
    const diffImage = COMPARE_DIR + '/' + slug + '-diff.png'
    await writeFile(join(root, diffImage), encodePng(diff.diff))
    report.pixel = { similarity: diff.similarity, mismatched: diff.mismatched, total: diff.total, width: diff.width, height: diff.height, designWidth: design.width, designHeight: design.height, scaled: diff.scaled, ...(cropped ? { cropped: true } : {}), diffImage, actualImage }
  } catch (error) { report.pixelIssue = '像素比对失败：' + (error instanceof Error ? error.message : String(error)) }
}

/** 读取预读清单并要求规格表存在。 */
export async function readManifestForCompare(root: string): Promise<Manifest> {
  const content = await readOptional(root, MANIFEST_PATH, 8_000_000)
  if (content === null) throw new Error('没有预读清单 ' + MANIFEST_PATH + '，请先通过 design_workspace 读取设计稿')
  const manifest = JSON.parse(content) as Manifest
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.blocks)) throw new Error('预读清单无效')
  return manifest
}
