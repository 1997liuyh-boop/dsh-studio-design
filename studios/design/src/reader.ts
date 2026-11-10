/**
 * 设计稿预读：工作室宿主自己按区块读取 MasterGo，把结构、素材与预览图落到项目目录，
 * 模型随后只读本地文件。画布单请求上限 120 秒且串行处理，整页导出必超时并堵塞队列，
 * 所以这里只对根节点做一次结构读取，再按区块逐个导出，一次只发一个请求。
 */
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { DesignAgent, ToolCallInput, ToolCallOutcome } from './host.ts'
import { inside, readOptional } from './project.ts'
import { blockSpec, type NodeSpec } from './spec.ts'

/** 导出 HTML 中的一个元素：只保留还原需要的属性。 */
export interface DesignNode {
  tag: string
  id?: string
  name?: string
  width?: number
  height?: number
  left?: number
  top?: number
  src?: string
  /** 完整内联 style，规格抽取时再解析字号、颜色等。 */
  style?: string
  /** 直接文字内容（不含子元素），空白已折叠。 */
  text?: string
  /** 组件实例（ui-component）的 MasterGo 属性值，来自 props 属性的 JSON。 */
  props?: Record<string, string | number | boolean>
  /** 组件实例的文案覆盖，来自 text 属性的 JSON；跨帧比较文字变化时使用。 */
  instanceText?: Record<string, string>
  depth: number
  children: DesignNode[]
  /** 子树元素数（不含自身）。 */
  descendants: number
  /** 子树中的组件实例数（ui-component）。 */
  instances: number
}

/** 区块内的一个组件实例（导出 HTML 里的 ui-component）：名称用于匹配映射表，尺寸与位置供排版。 */
export interface BlockComponent {
  nodeId: string
  name: string
  width?: number
  height?: number
  left?: number
  top?: number
  /** MasterGo 组件属性值（如 尺寸、状态），原样保留供选型参考。 */
  props?: Record<string, string | number | boolean>
}

/** 预读选出的一个区块。 */
export interface Block {
  nodeId: string
  name: string
  tag: string
  depth: number
  parentId?: string
  width?: number
  height?: number
  descendants: number
  instances: number
  /** 子树内的组件实例（含区块自身是实例的情况）；旧版 manifest 没有此字段。 */
  components?: BlockComponent[]
}

export interface BlockAsset {
  path: string
  kind: 'image' | 'icon' | 'shape' | 'other'
  width?: number
  height?: number
  cssWidth?: number
  cssHeight?: number
  usedBy?: string
  /** 文件比稿面 CSS 尺寸窄：画布裁掉了一侧，只有可见半幅。 */
  clipped?: 'left' | 'right' | 'unknown'
  /** 导出像素只有稿面盒子的这个比例（宽高取较小者，小于 0.9 才记录）：被父容器裁切或只导出了缩略图，不能用 cover 拉伸。 */
  partial?: number
  /** 按图片节点自己的 ID 补导出得到的完整原图（项目相对路径）及其像素尺寸。 */
  fullImage?: string
  fullWidth?: number
  fullHeight?: number
  /** 补导出没有得到更大的图时的原因。 */
  recovery?: string
  /** 原图本身就这么小、是设计稿把它放大到稿面尺寸：实现按 cover 放大即可，check 与 compare 不按拉伸报错。 */
  scaledByDesign?: true
}

export interface BlockRecord extends Block {
  index: number
  dir: string
  html?: string
  /** path 为项目内副本（复制成功时），source 为 MasterGo 返回的原始路径或资源 URI。 */
  screenshot?: { path?: string; source?: string; status: 'ok' | 'missing' | 'failed' }
  assets: BlockAsset[]
  /** 规格表：导出 HTML 中有文字、背景、描边、圆角、图片或显式定位的节点及其可测量字段。 */
  spec?: NodeSpec[]
  status: 'ok' | 'timeout' | 'error' | 'skipped'
  error?: string
  durationMs: number
}

export interface Manifest {
  schemaVersion: 1
  generatedAt: string
  source: { fileId: string; pageId: string; nodeId: string }
  root: { nodeId: string; name: string; width?: number; height?: number; html: string }
  selection: { rule: string; maxBlocks: number }
  blocks: BlockRecord[]
  variables: { status: 'ok' | 'timeout' | 'error' | 'skipped'; summary?: string }
  pending: string[]
  timing: { startedAt: string; finishedAt: string; calls: number }
  /** 多链接请求里第一条之外的状态画板；旧版 manifest 没有此字段。 */
  frames?: FrameRecord[]
  /** 同名区块跨帧的差异，按状态实现时的依据。 */
  stateDeltas?: StateDelta[]
}

/** 状态帧里选出的区块：只记录结构，不单独导出。 */
export interface FrameBlock { nodeId: string; name: string; tag: string; width?: number; height?: number }
/** 状态帧相对基础帧新增的节点：单独导出到帧目录，供实现该状态的新增内容。 */
export interface FrameExport {
  nodeId: string
  name: string
  dir: string
  html?: string
  screenshot?: { path?: string; source?: string; status: 'ok' | 'missing' }
  assets: BlockAsset[]
  status: 'ok' | 'timeout' | 'error' | 'skipped'
  error?: string
}
/** 一个状态画板的预读记录：第一条链接是基础帧，其余按链接顺序逐帧读取结构。 */
export interface FrameRecord {
  nodeId: string
  name: string
  /** 状态标签：画板名最后一个 / - _ 之后的非数字片段；没有分隔符时为「默认」。 */
  state: string
  pageId: string
  html?: string
  width?: number
  height?: number
  blocks: FrameBlock[]
  exports: FrameExport[]
  status: 'ok' | 'error' | 'skipped'
  error?: string
}
export type StateDeltaKind = 'added' | 'removed' | 'moved' | 'resized' | 'text' | 'variant' | 'style'
/** 同名（data-name）节点在基础帧与状态帧之间的一项差异；节点先按 ID 配对，再按名称与出现次序配对。 */
export interface StateDelta {
  state: string
  /** 状态帧节点 ID。 */
  frame: string
  kind: StateDeltaKind
  /** 同名节点第二次出现起带 #序号。 */
  name: string
  /** 状态帧中的节点 ID（消失的节点没有）。 */
  nodeId?: string
  /** 基础帧中的节点 ID（新增的节点没有）。 */
  baseNodeId?: string
  from?: string
  to?: string
}

export const MANIFEST_PATH = 'docs/design/mastergo-manifest.json'
export const CHECKLIST_PATH = 'docs/design/implementation-checklist.md'
export const EXPORT_DIR = '.mastergo/export'

const voidTags = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source'])
/** 这些元素内的文本不是设计文案。 */
const silentTags = new Set(['#root', 'html', 'head', 'style', 'script', 'title', 'body'])
const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' }

function px(style: string, property: string): number | undefined {
  const match = new RegExp('(?:^|;)\\s*' + property + '\\s*:\\s*(-?[\\d.]+)px').exec(style)
  return match ? Number(match[1]) : undefined
}

/** 折叠空白并还原常见实体；空串返回 undefined。 */
function collapseText(raw: string): string | undefined {
  const text = raw.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, entity => entities[entity] ?? entity).replace(/\s+/g, ' ').trim()
  return text ? text : undefined
}

/** 小型 HTML 分词器：只认标签、属性、自闭合与元素的直接文字；属性值内的 > 不会截断标签。 */
export function parseNodeTree(html: string): DesignNode {
  const root: DesignNode = { tag: '#root', depth: -1, children: [], descendants: 0, instances: 0 }
  const stack: DesignNode[] = [root]
  let i = 0
  while (i < html.length) {
    const open = html.indexOf('<', i)
    if (open === -1) break
    if (open > i) {
      const owner = stack[stack.length - 1]!
      const text = silentTags.has(owner.tag) ? undefined : collapseText(html.slice(i, open))
      if (text) owner.text = owner.text ? owner.text + ' ' + text : text
    }
    if (html.startsWith('<!--', open)) { const end = html.indexOf('-->', open); i = end === -1 ? html.length : end + 3; continue }
    if (html.startsWith('<!', open) || html.startsWith('<?', open)) { const end = html.indexOf('>', open); i = end === -1 ? html.length : end + 1; continue }
    let j = open + 1
    const closing = html[j] === '/'
    if (closing) j += 1
    const nameStart = j
    while (j < html.length && /[A-Za-z0-9:-]/.test(html[j]!)) j += 1
    const tag = html.slice(nameStart, j).toLowerCase()
    if (!tag) { i = open + 1; continue }
    // 读取属性直到标签结束，引号内的字符原样跳过。
    let quote = '', attrs = ''
    while (j < html.length) {
      const char = html[j]!
      if (quote) { if (char === quote) quote = ''; attrs += char; j += 1; continue }
      if (char === '"' || char === "'") { quote = char; attrs += char; j += 1; continue }
      if (char === '>') break
      attrs += char; j += 1
    }
    i = j + 1
    if (closing) {
      for (let k = stack.length - 1; k > 0; k -= 1) if (stack[k]!.tag === tag) { stack.length = k; break }
      continue
    }
    const selfClosing = attrs.trimEnd().endsWith('/') || voidTags.has(tag)
    const attribute = (key: string) => new RegExp('(?:^|\\s)' + key + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')').exec(attrs)
    const style = attribute('style')?.[1] ?? attribute('style')?.[2] ?? ''
    const parent = stack[stack.length - 1]!
    const node: DesignNode = {
      tag, id: attribute('data-node-id')?.[1] ?? attribute('data-node-id')?.[2], name: attribute('data-name')?.[1] ?? attribute('data-name')?.[2],
      width: px(style, 'width'), height: px(style, 'height'), left: px(style, 'left'), top: px(style, 'top'),
      src: attribute('src')?.[1] ?? attribute('src')?.[2], style: style || undefined, depth: parent.depth + 1, children: [], descendants: 0, instances: 0,
    }
    if (tag === 'ui-component') {
      const raw = attribute('props')?.[1] ?? attribute('props')?.[2]
      if (raw) node.props = instanceProps(raw)
      const overrides = instanceProps(attribute('text')?.[1] ?? attribute('text')?.[2] ?? '')
      if (overrides) node.instanceText = Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, String(value)]))
    }
    parent.children.push(node)
    for (const ancestor of stack) { ancestor.descendants += 1; if (tag === 'ui-component') ancestor.instances += 1 }
    if (!selfClosing) stack.push(node)
  }
  return root
}

/** ui-component 的 props 属性：MasterGo 组件属性值 JSON，只保留标量；解析失败返回 undefined。 */
function instanceProps(raw: string): Record<string, string | number | boolean> | undefined {
  try {
    const value = JSON.parse(raw.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'"))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const entries = Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string | number | boolean] => ['string', 'number', 'boolean'].includes(typeof entry[1]))
    return entries.length ? Object.fromEntries(entries) : undefined
  } catch (error) { return undefined }
}

/** 收集子树（含自身）里带节点 ID 的组件实例，按文档顺序。 */
export function collectComponents(node: DesignNode): BlockComponent[] {
  const result: BlockComponent[] = []
  const visit = (current: DesignNode) => {
    if (current.tag === 'ui-component' && current.id) result.push({ nodeId: current.id, name: current.name ?? current.tag, width: current.width, height: current.height, left: current.left, top: current.top, props: current.props })
    for (const child of current.children) visit(child)
  }
  visit(node)
  return result
}

/** get_selection_node 头部的「- 节点: 名称 (ID)」行：读取当前选区时由它得知根节点。 */
export function parseSelectionHeader(text: string): { nodeId?: string; name?: string } {
  const match = /^-\s*节点[:：]\s*(.+?)\s*\(([^()\s]+)\)\s*$/m.exec(text)
  return match ? { name: match[1]!.trim(), nodeId: match[2]! } : {}
}

/** get_selection_node 的文本结果：头部摘要之后是「代码内容：」与 HTML；多节点时是 ``` 围栏。 */
export function parseSelectionResult(text: string): string {
  const marker = text.indexOf('代码内容：')
  if (marker !== -1) return text.slice(marker + '代码内容：'.length).trim()
  const fenced = /```html\s*([\s\S]*?)```/.exec(text)
  if (fenced) return fenced[1]!.trim()
  const first = text.indexOf('<')
  return first === -1 ? '' : text.slice(first).trim()
}

/** 返回第一个带 data-node-id 的元素作为设计根。 */
export function designRoot(tree: DesignNode): DesignNode | undefined {
  const queue = [...tree.children]
  while (queue.length) { const node = queue.shift()!; if (node.id) return node; queue.push(...node.children) }
  return undefined
}

export interface SelectOptions { maxDepth?: number; maxBlocks?: number; maxDescendants?: number; maxInstances?: number }
/** 一次预读最多导出的区块数。 */
export const DEFAULT_MAX_BLOCKS = 120

/**
 * 选区块：子树够小（元素 ≤ maxDescendants 且实例 ≤ maxInstances）或已是叶子 / 实例就作为一个导出单元，
 * 否则继续下探；超过 maxBlocks 的进入 pending。阈值按首页实测（商品行 5 张卡导出最长约 110 秒）定。
 */
export function selectBlocks(root: DesignNode, options: SelectOptions = {}): { blocks: Block[]; pending: string[] } {
  // 上限按整页算：每块导出约 2–3 秒，120 块仍在 20 分钟预算内；超出的才进 pending，避免长页面的首屏、顶部等落在审计之外。
  const { maxDepth = 4, maxBlocks = DEFAULT_MAX_BLOCKS, maxDescendants = 24, maxInstances = 6 } = options
  const blocks: Block[] = [], pending: string[] = []
  const visit = (node: DesignNode, depth: number, parentId: string | undefined) => {
    if (!node.id) { for (const child of node.children) visit(child, depth, parentId); return }
    const leaf = node.tag === 'ui-component' || node.children.length === 0
    const small = node.descendants <= maxDescendants && node.instances <= maxInstances
    if (leaf || small || depth >= maxDepth) {
      if (blocks.length >= maxBlocks) pending.push(node.id)
      else blocks.push({ nodeId: node.id, name: node.name ?? node.tag, tag: node.tag, depth, parentId, width: node.width, height: node.height, descendants: node.descendants, instances: node.instances, components: collectComponents(node) })
      return
    }
    for (const child of node.children) visit(child, depth + 1, node.id)
  }
  for (const child of root.children) visit(child, 1, root.id)
  return { blocks, pending }
}

/** 目录名：序号 + 名称 + 节点 ID；节点 ID 里的冒号不能出现在 Windows 目录名中。 */
export function slugFor(index: number, name: string, nodeId: string): string {
  const safe = name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return String(index).padStart(2, '0') + '-' + (safe || 'node') + '-' + nodeId.replace(/[^A-Za-z0-9]+/g, '-')
}

/** get_frontend_code 的文本结果：导出文件行与随之落盘的预览图行。 */
export function parseExportResult(text: string): { files: string[]; screenshots: string[]; screenshotFailed: boolean } {
  const files: string[] = [], screenshots: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const exported = /^-\s*\[\d+\]\s+(.+?\.html?)(?:\s*（|\s*\(|\s*$)/i.exec(line)
    if (exported) { files.push(exported[1]!.trim()); continue }
    const shot = /(screenshots:\/\/\S+|[A-Za-z]:\\[^\s（）()]+\.(?:png|jpe?g|webp)|\/[^\s（）()]+\.(?:png|jpe?g|webp))/i.exec(line)
    if (shot && !exported) screenshots.push(shot[1]!)
  }
  return { files, screenshots, screenshotFailed: /预览图保存失败|截图失败/.test(text) }
}

/** get_screenshot 的文本结果：每个节点一行路径或资源 URI。 */
export function parseScreenshotResult(text: string): string[] {
  return parseExportResult(text).screenshots
}

/** 读取 PNG / JPEG / SVG 的像素尺寸，不引入图像依赖；其余格式返回 undefined。 */
export function imageSize(buffer: Buffer, name = ''): { width: number; height: number } | undefined {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue }
      const marker = buffer[offset + 1]!
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      offset += 2 + buffer.readUInt16BE(offset + 2)
    }
    return undefined
  }
  if (/\.svg$/i.test(name) || buffer.subarray(0, 512).toString('utf8').includes('<svg')) {
    const head = buffer.subarray(0, 4096).toString('utf8')
    const width = /\swidth="([\d.]+)/.exec(head)?.[1], height = /\sheight="([\d.]+)/.exec(head)?.[1]
    if (width && height) return { width: Number(width), height: Number(height) }
    const box = /viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"\s*/.exec(head)
    return box ? { width: Number(box[1]), height: Number(box[2]) } : undefined
  }
  return undefined
}

function kindOf(path: string): BlockAsset['kind'] {
  if (/[/\\]asset[/\\]icons[/\\]/.test(path)) return 'icon'
  if (/[/\\]asset[/\\]images[/\\]/.test(path)) return 'image'
  if (/[/\\]asset[/\\]shapes[/\\]/.test(path)) return 'shape'
  return 'other'
}

/** 收集导出 HTML 里的 <img>：src 对应的 CSS 尺寸与同级位置，用于裁切判定。 */
export function collectImages(tree: DesignNode): Map<string, { cssWidth?: number; cssHeight?: number; usedBy?: string; position: 'first' | 'last' | 'middle' | 'only' }> {
  const result = new Map<string, { cssWidth?: number; cssHeight?: number; usedBy?: string; position: 'first' | 'last' | 'middle' | 'only' }>()
  const visit = (node: DesignNode) => {
    const images = node.children.filter(child => child.tag === 'img' && child.src)
    images.forEach((image, index) => {
      const key = image.src!.replace(/^\.\//, '').replaceAll('\\', '/')
      if (result.has(key)) return
      result.set(key, { cssWidth: image.width, cssHeight: image.height, usedBy: image.id ?? node.id, position: images.length === 1 ? 'only' : index === 0 ? 'first' : index === images.length - 1 ? 'last' : 'middle' })
    })
    for (const child of node.children) visit(child)
  }
  visit(tree)
  return result
}

async function listFiles(dir: string): Promise<string[]> {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []; throw error }
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

/** 导出文本只有在 HTML 和引用素材已真实落盘后才可作为实现依据。 */
async function validateExport(root: string, dir: string, htmlFiles: string[]): Promise<void> {
  if (!htmlFiles.length) throw new Error('导出没有返回 HTML 文件，不能按成功处理')
  const base = await inside(root, dir)
  for (const file of htmlFiles) {
    const path = await inside(root, file), within = relative(base, path)
    if (within === '..' || within.startsWith('..' + sep) || isAbsolute(within)) throw new Error('导出 HTML 不在当前区块目录内')
    const html = await readOptional(root, file, 4_000_000)
    if (!html?.trim() || !parseNodeTree(html).children.length) throw new Error('导出 HTML 不存在、为空或没有可读取的节点')
    const references = new Set<string>()
    for (const [, attributes] of html.matchAll(/<(?:img|image|source|use)\b([^>]*)>/gi)) {
      for (const [, quoted, single] of attributes!.matchAll(/(?:src|href|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) references.add(quoted ?? single ?? '')
    }
    for (const [, quoted, single, plain] of html.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi)) references.add(quoted ?? single ?? plain ?? '')
    for (const match of html.matchAll(/(?:\.\/)?asset\/(?:images|icons|shapes)\/[^"'<>\s)]+/g)) references.add(match[0])
    for (const raw of references) {
      const reference = raw.replace(/&amp;/g, '&').trim()
      if (!reference || reference.startsWith('#') || reference.startsWith('data:')) continue
      if (/^(?:[A-Za-z]+:|\/\/)/.test(reference)) throw new Error('导出素材仍为远程或临时地址，请通过 MasterGo MCP 重新导出落盘')
      const clean = decodeURIComponent(reference.split(/[?#]/)[0]!)
      const asset = await inside(root, relative(root, resolve(dirname(path), clean)))
      const assetWithin = relative(base, asset)
      if (assetWithin === '..' || assetWithin.startsWith('..' + sep) || isAbsolute(assetWithin)) throw new Error('引用素材不在当前区块导出目录内')
      const info = await stat(asset)
      if (!info.isFile() || info.size === 0 || info.size > 32_000_000) throw new Error('导出素材为空、不是文件或超过大小上限')
    }
  }
}

/** 扫描一个区块目录：素材像素尺寸对照导出 HTML 的 CSS 尺寸，标出被画布裁掉一侧的图。 */
export async function scanAssets(root: string, dir: string, htmlFiles: string[]): Promise<BlockAsset[]> {
  await validateExport(root, dir, htmlFiles)
  const images = new Map<string, ReturnType<typeof collectImages> extends Map<string, infer V> ? V : never>()
  for (const file of htmlFiles) {
    const html = await readOptional(root, file, 4_000_000)
    if (html === null) throw new Error('导出 HTML 已不可读取')
    for (const [key, value] of collectImages(parseNodeTree(html))) if (!images.has(key)) images.set(key, value)
  }
  const base = await inside(root, dir)
  const assets: BlockAsset[] = []
  for (const file of await listFiles(join(base, 'asset'))) {
    const relativeToBlock = relative(base, file).split(sep).join('/')
    const info = await stat(file)
    if (info.size === 0 || info.size > 32_000_000) throw new Error('导出素材为空或超过大小上限：' + relativeToBlock)
    const size = imageSize(await readFile(file), file)
    const usage = images.get(relativeToBlock)
    const asset: BlockAsset = { path: (dir + '/' + relativeToBlock).replaceAll('\\', '/'), kind: kindOf(file), width: size?.width, height: size?.height, cssWidth: usage?.cssWidth, cssHeight: usage?.cssHeight, usedBy: usage?.usedBy }
    if (asset.kind === 'image' && size && usage?.cssWidth && size.width + 1 < usage.cssWidth) asset.clipped = usage.position === 'first' ? 'left' : usage.position === 'last' ? 'right' : 'unknown'
    // 位图像素明显小于稿面盒子（任一边不足 90%）：画布裁切或缩略图，记录比例供补导出与拉伸检查。
    if (asset.kind === 'image' && size && usage?.cssWidth && usage.cssHeight) {
      const ratio = Math.min(size.width / usage.cssWidth, size.height / usage.cssHeight)
      if (ratio < 0.9) asset.partial = Math.round(ratio * 100) / 100
    }
    assets.push(asset)
  }
  return assets.sort((a, b) => a.path.localeCompare(b.path))
}

/** 原子写入：先写临时文件再改名，照 storage.ts 的做法。 */
export async function writeJsonAtomic(root: string, path: string, value: object): Promise<void> {
  const target = join(root, path)
  await mkdir(join(target, '..'), { recursive: true })
  const temp = join(root, path + '.' + randomUUID() + '.tmp')
  try { await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8'); await rename(temp, target) }
  finally { await rm(temp, { force: true }) }
}

/** 实现清单骨架：区块表留出「Reborn 对应」列，由模型填写；已有文件不覆盖。预览地址与剩余差异由审计阶段使用。 */
export function checklistSkeleton(manifest: Manifest): string {
  const rows = manifest.blocks.map(block => '| ' + [block.nodeId, block.name, (block.width ?? '?') + '×' + (block.height ?? '?'), block.html ?? '—', block.screenshot?.path ?? '—', String(block.assets.length) + (block.assets.some(asset => asset.clipped) ? '（含裁切）' : ''), block.status, ''].join(' | ') + ' |')
  return [
    '# 首页实现清单（MasterGo ' + manifest.source.nodeId + '）', '',
    '- 设计稿：文件 `' + manifest.source.fileId + '` / 页面 `' + manifest.source.pageId + '` / 节点 `' + manifest.source.nodeId + '`「' + manifest.root.name + '」' + (manifest.root.width && manifest.root.height ? '，画布 ' + manifest.root.width + '×' + manifest.root.height : ''),
    '- 预读产物：`' + MANIFEST_PATH + '`（区块、素材、预览图路径、节点规格），导出目录 `' + EXPORT_DIR + '/`',
    '- 预览地址：（实现后填写页面的本机地址，如 http://localhost:3000/；用浏览器实际打开、执行交互并截图，再调用 design_review(stage=verify) 登记证据）', '',
    '## 一、区块 → 组件映射（模型填写最后一列）', '',
    '| 节点 | 名称 | 尺寸 | 导出 HTML | 预览图 | 素材 | 状态 | Reborn 对应 |', '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows, '',
    '## 二、素材待补', '',
    ...manifest.blocks.flatMap(block => block.assets.filter(asset => asset.clipped).map(asset => '- ' + asset.path + '：画布裁掉了' + (asset.clipped === 'left' ? '左' : asset.clipped === 'right' ? '右' : '一') + '侧，只有 ' + asset.width + '×' + asset.height + '（稿面 ' + asset.cssWidth + '×' + asset.cssHeight + '）')),
    ...manifest.blocks.flatMap(block => block.assets.filter(asset => asset.partial !== undefined).map(asset => '- ' + asset.path + '：导出只有 ' + asset.width + '×' + asset.height + '（稿面 ' + asset.cssWidth + '×' + asset.cssHeight + '，' + Math.round((asset.partial ?? 0) * 100) + '%）' + (asset.fullImage ? '，已按节点补导出全图 ' + asset.fullImage + '（' + asset.fullWidth + '×' + asset.fullHeight + '），实现时用全图' : asset.scaledByDesign ? '，' + asset.recovery : '，' + (asset.recovery ?? '未补导出') + '；不得用 cover 拉伸，按稿面位置用 object-fit: none'))),
    ...(manifest.pending.length ? ['- 未导出的节点：' + manifest.pending.join('、')] : []), '',
    '## 三、与稿面 / 组件的已知差异', '', '（实现时填写）', '',
    '## 四、剩余差异', '', '（实际浏览器对照后仍未消除的差异：节点、字段、设计值、实际值与原因；verify 只登记证据，不自动判断像素一致性）', '',
    '## 五、待映射组件', '', '（预读后由工作室按 docs/design/component-map.json 填写：未命中映射表的实例名在此登记，实现时写明所选组件并补进映射表）', '',
    ...(manifest.frames?.length ? [
      '## 六、状态帧与交互', '',
      ...manifest.frames.map(frame => '- ' + frame.state + '：画板「' + frame.name + '」（' + frame.nodeId + '），结构 ' + (frame.html ?? '—') + '，与默认态差异 ' + (manifest.stateDeltas ?? []).filter(delta => delta.frame === frame.nodeId).length + ' 项，新增节点导出 ' + frame.exports.length + ' 个，状态 ' + frame.status + (frame.error ? '（' + frame.error + '）' : '')),
      '- 交互规范：`docs/design/interactions.yaml`（trigger / response 为空的条目待补；实现时在对应元素加 data-design="<id>"）', '',
    ] : []),
  ].join('\n')
}

/** 预读过程调用的宿主能力：工具执行、计时与等待可替换，便于测试。 */
export interface ReaderHost {
  execute(input: ToolCallInput): Promise<ToolCallOutcome>
  agent?: DesignAgent
  rootCallId?: string
  parent?: symbol
  signal: AbortSignal
  now?: () => number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

export interface PreReadInput {
  root: string
  /** nodeId 缺省时读取 MasterGo 当前选区，根节点 ID 从返回头部取得。 */
  target: { fileId: string; pageId: string; nodeId?: string }
  /** 总预算（毫秒），超出后剩余区块记为 skipped。 */
  budgetMs?: number
  select?: SelectOptions
  /** 变量接口只读取活动文档；跨文件定位节点时关闭，避免混入其他稿件变量。 */
  readVariables?: boolean
  /** 同一文件里的其他状态画板（请求里第二条起的链接），逐帧读取结构并与基础帧比较。 */
  frames?: { pageId: string; nodeId: string }[]
}

/** 把 MasterGo 落盘的预览图复制进区块目录，模型与验收脚本按项目相对路径读取；资源 URI 或不存在的路径只记录来源。 */
export async function localizeScreenshot(root: string, dir: string, source: string): Promise<{ path?: string; source: string; status: 'ok' | 'missing' }> {
  if (!isAbsolute(source) || !/\.(?:png|jpe?g|webp)$/i.test(source)) return { source, status: 'missing' }
  try {
    const extension = source.slice(source.lastIndexOf('.')).toLowerCase()
    const target = join(root, dir, 'preview' + extension)
    if (!(await stat(source)).isFile()) return { source, status: 'missing' }
    if (resolve(source) !== resolve(target)) await copyFile(source, target)
    return { path: (dir + '/preview' + extension).replaceAll('\\', '/'), source, status: 'ok' }
  } catch (error) { return { source, status: 'missing' } }
}

export type PreReadResult = { ok: true; manifest: Manifest } | { ok: false; phase: 'root' | 'aborted'; issue: string }

/** 单请求超时：MasterGo 服务端 120 秒即回 timeout，本地留 150 秒等它返回，客户端上限 180 秒。 */
export const CALL_TIMEOUT_MS = 150_000
/** 服务端处理超时请求仍占着画布队列，下一请求至少距上次发起 125 秒。 */
export const SERVER_COOLDOWN_MS = 125_000

class CanvasReader {
  calls = 0
  private lastStart = 0
  constructor(private readonly host: ReaderHost, private readonly root: string) {}
  private now(): number { return (this.host.now ?? Date.now)() }
  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return
    if (this.host.sleep) return this.host.sleep(ms, this.host.signal)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.host.signal.removeEventListener('abort', abort); resolve() }, ms)
      const abort = () => { clearTimeout(timer); reject(this.host.signal.reason instanceof Error ? this.host.signal.reason : new Error('预读已取消')) }
      this.host.signal.addEventListener('abort', abort, { once: true })
    })
  }
  /** 一次画布请求：上一请求超时后先等服务端空闲，失败时抛出带 timeout 标记的错误。 */
  async call(tool: string, args: Record<string, unknown>, timeoutMs: number): Promise<string> {
    this.host.signal.throwIfAborted()
    const since = this.now() - this.lastStart
    if (this.lastTimedOut && since < SERVER_COOLDOWN_MS) await this.sleep(SERVER_COOLDOWN_MS - since)
    this.lastStart = this.now(); this.calls += 1
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
    const onAbort = () => controller.abort(this.host.signal.reason)
    this.host.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const outcome = await this.host.execute({ callId: 'design-' + randomUUID(), rootCallId: this.host.rootCallId, name: 'mcp__design_mastergo__' + tool, arguments: { projectDir: this.root, ...args }, agent: this.host.agent, parent: this.host.parent, signal: controller.signal })
      const text = (outcome.content ?? []).map(block => block.text ?? '').join('\n') || (typeof outcome.value === 'string' ? outcome.value : '')
      if (outcome.isError) throw new Error(outcome.error?.message || text || tool + ' 调用失败')
      this.lastTimedOut = false
      return text
    } catch (error) {
      this.host.signal.throwIfAborted()
      const message = error instanceof Error ? error.message : String(error)
      this.lastTimedOut = /timeout|timed out|超时/i.test(message) || controller.signal.aborted
      throw new Error(this.lastTimedOut ? 'timeout: ' + message : message)
    } finally { clearTimeout(timer); this.host.signal.removeEventListener('abort', onAbort) }
  }
  private lastTimedOut = false
}

const isTimeout = (error: unknown) => error instanceof Error && error.message.startsWith('timeout')
const isConflict = (error: unknown) => error instanceof Error && /冲突|conflict/i.test(error.message)

/** Vibe 1.0.32 的目标参数支持 goto 链接，由适配器解析文件、页面和节点路由。 */
function routedNode(nodeId: string, target: PreReadInput['target']): string {
  if (!target.fileId) return nodeId
  const url = new URL('https://mastergo.com/goto')
  url.searchParams.set('file', target.fileId)
  if (target.pageId) url.searchParams.set('page_id', target.pageId)
  url.searchParams.set('layer_id', nodeId)
  return url.href
}

/**
 * 预读全流程：根节点结构 → 按区块导出（失败的大区块拆成子节点再试）→ 变量 → 扫描素材 → 写 manifest 与清单骨架。
 * @returns 成功时返回 manifest；根节点读不到时返回失败原因，不写任何文件。
 */
export async function preRead(host: ReaderHost, input: PreReadInput): Promise<PreReadResult> {
  const reader = new CanvasReader(host, input.root)
  const startedAt = new Date().toISOString(), started = (host.now ?? Date.now)()
  const budget = input.budgetMs ?? 20 * 60_000
  let rootHtml = '', header: { nodeId?: string; name?: string } = {}
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const text = await reader.call('get_selection_node', input.target.nodeId ? { targetNodeId: routedNode(input.target.nodeId, input.target) } : {}, CALL_TIMEOUT_MS)
      rootHtml = parseSelectionResult(text); header = parseSelectionHeader(text); break
    } catch (error) {
      if (host.signal.aborted) return { ok: false, phase: 'aborted', issue: '预读已取消' }
      if (attempt === 1 || !isTimeout(error)) return { ok: false, phase: 'root', issue: '读取设计稿根节点失败：' + (error instanceof Error ? error.message : String(error)) + '。请在 MasterGo 桌面端打开该文件和页面并选中该图层后重试。' }
    }
  }
  const tree = parseNodeTree(rootHtml), rootNode = designRoot(tree)
  if (!rootNode?.id) return { ok: false, phase: 'root', issue: '设计稿根节点没有返回可解析的结构，请确认链接中的 layer_id 指向一个画板或容器，或在画布中选中一个画板。' }
  if (input.target.nodeId && header.nodeId && header.nodeId !== input.target.nodeId && rootNode.id !== input.target.nodeId) return { ok: false, phase: 'root', issue: '画布返回的节点 ' + header.nodeId + ' 与链接中的 ' + input.target.nodeId + ' 不一致，请在 MasterGo 中打开链接对应的文件和页面后重试。' }
  const source = { fileId: input.target.fileId, pageId: input.target.pageId, nodeId: input.target.nodeId ?? header.nodeId ?? rootNode.id }
  const rootDir = EXPORT_DIR + '/' + slugFor(0, 'root', rootNode.id)
  await mkdir(join(input.root, rootDir), { recursive: true })
  await writeFile(join(input.root, rootDir, 'root.html'), rootHtml, 'utf8')
  // 状态帧：先读各帧结构并与基础帧比较（每帧一次请求），新增节点等基础区块导出完再导出。
  const remainingBudget = () => budget - ((host.now ?? Date.now)() - started)
  const frames = input.frames?.length ? await readFrameRoots(reader, host, input, rootNode, remainingBudget) : undefined
  const { blocks, pending } = selectBlocks(rootNode, input.select)
  const records: BlockRecord[] = []
  const exportBlock = async (block: Block, index: number, split: number): Promise<void> => {
    const dir = EXPORT_DIR + '/' + slugFor(index, block.name, block.nodeId)
    const record: BlockRecord = { ...block, index, dir, assets: [], status: 'skipped', durationMs: 0 }
    records.push(record)
    const elapsed = (host.now ?? Date.now)() - started
    if (elapsed >= budget) { record.error = '超出预读预算'; return }
    const begin = (host.now ?? Date.now)()
    try {
      const result = parseExportResult(await reader.call('get_frontend_code', { targetNodeIds: [routedNode(block.nodeId, input.target)], frontendFramework: 'html', writeToFile: true, outDir: dir }, CALL_TIMEOUT_MS))
      const files = result.files.map(file => relative(input.root, isAbsolute(file) ? file : resolve(input.root, file)).split(sep).join('/'))
      await validateExport(input.root, dir, files)
      record.html = files[0]
      record.screenshot = result.screenshots[0] ? await localizeScreenshot(input.root, dir, result.screenshots[0]) : { status: result.screenshotFailed ? 'failed' : 'missing' }
      record.status = 'ok'
    } catch (error) {
      if (host.signal.aborted) throw error
      record.status = isTimeout(error) ? 'timeout' : 'error'
      record.error = error instanceof Error ? error.message : String(error)
      // 大区块超时或素材路径冲突：拆成有节点 ID 的子节点逐个导出，最多拆两层。
      const node = findNode(rootNode, block.nodeId)
      const children = node?.children.filter(child => child.id) ?? []
      if (split < 2 && children.length > 1 && (isTimeout(error) || isConflict(error))) {
        record.error += '；已拆成 ' + children.length + ' 个子节点导出'
        for (const child of children) await exportBlock({ nodeId: child.id!, name: child.name ?? child.tag, tag: child.tag, depth: block.depth + 1, parentId: block.nodeId, width: child.width, height: child.height, descendants: child.descendants, instances: child.instances, components: collectComponents(child) }, records.length, split + 1)
      }
    } finally { record.durationMs = (host.now ?? Date.now)() - begin }
    if (record.status === 'ok' && record.screenshot?.status !== 'ok') {
      try { const shots = parseScreenshotResult(await reader.call('get_screenshot', { targetNodeId: routedNode(block.nodeId, input.target), scale: 1 }, 90_000)); if (shots[0]) record.screenshot = await localizeScreenshot(input.root, dir, shots[0]) }
      catch (error) { if (host.signal.aborted) throw error; record.screenshot = { status: 'failed' } }
    }
    if (record.status === 'ok') {
      try { record.assets = await scanAssets(input.root, dir, record.html ? [record.html] : []) }
      catch (error) { record.status = 'error'; record.error = '素材扫描失败：' + (error instanceof Error ? error.message : String(error)) }
      try { record.spec = record.html ? await readSpec(input.root, record.html) : undefined }
      catch (error) { record.status = 'error'; record.error = '规格抽取失败：' + (error instanceof Error ? error.message : String(error)) }
      if (record.status === 'ok') await recoverPartialAssets(reader, host, input, record, remainingBudget, recoveries)
    }
  }
  const recoveries = { left: MAX_RECOVERIES }
  for (const [index, block] of blocks.entries()) await exportBlock(block, index + 1, 0)
  if (frames) await exportFrameAdditions(reader, host, input, frames, remainingBudget)
  let variables: Manifest['variables'] = { status: 'skipped', ...(input.readVariables === false ? { summary: '当前活动画布与目标文件不同，变量接口无法指定文件，已跳过以免混入其他文档变量' } : {}) }
  if (input.readVariables !== false) {
    try { const text = await reader.call('get_variables', {}, 60_000); variables = { status: 'ok', summary: text.replace(/\s+/g, ' ').slice(0, 300) } }
    catch (error) { if (host.signal.aborted) throw error; variables = { status: isTimeout(error) ? 'timeout' : 'error', summary: error instanceof Error ? error.message.slice(0, 300) : undefined } }
  }
  const manifest: Manifest = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), source,
    root: { nodeId: rootNode.id, name: rootNode.name ?? rootNode.tag, width: rootNode.width, height: rootNode.height, html: rootDir + '/root.html' },
    selection: { rule: 'leaf-or-small-subtree', maxBlocks: input.select?.maxBlocks ?? DEFAULT_MAX_BLOCKS }, blocks: records, variables, pending,
    timing: { startedAt, finishedAt: new Date().toISOString(), calls: reader.calls },
    ...(frames ? { frames: frames.records, stateDeltas: frames.deltas } : {}),
  }
  await writeJsonAtomic(input.root, MANIFEST_PATH, manifest)
  if (await readOptional(input.root, CHECKLIST_PATH) === null) {
    await mkdir(join(input.root, 'docs/design'), { recursive: true })
    await writeFile(join(input.root, CHECKLIST_PATH), checklistSkeleton(manifest), 'utf8')
  }
  return { ok: true, manifest }
}

/** 一次预读最多补导出的裁切 / 缩略图数量，每次约 2–3 秒。 */
export const MAX_RECOVERIES = 24

/**
 * 被父容器裁切或只导出缩略图的位图，按图片节点自己的 ID 单独再导出一次：没有裁切它的父级时通常能拿到完整原图。
 * 结果记在 asset.fullImage；没拿到更大的图或预算不足时记录原因，不影响区块状态。
 */
async function recoverPartialAssets(reader: CanvasReader, host: ReaderHost, input: PreReadInput, record: BlockRecord, remainingBudget: () => number, quota: { left: number }): Promise<void> {
  for (const asset of record.assets) {
    if (asset.partial === undefined || !asset.usedBy) continue
    if (quota.left <= 0) { asset.recovery = '补导出数量已达上限'; continue }
    if (remainingBudget() < 30_000) { asset.recovery = '预读预算不足，未补导出'; continue }
    quota.left -= 1
    // 实例内部节点的 ID 带斜杠（实例ID/内部ID），MasterGo 只接受实例本身：按实例导出，再按原文件名找同一张图。
    const target = asset.usedBy.includes('/') ? asset.usedBy.split('/')[0]! : asset.usedBy
    const dir = record.dir + '/full/' + target.replace(/[^A-Za-z0-9]+/g, '-')
    const name = asset.path.split('/').pop()!
    try {
      await reader.call('get_frontend_code', { targetNodeIds: [routedNode(target, input.target)], frontendFramework: 'html', writeToFile: true, outDir: dir }, CALL_TIMEOUT_MS)
      const base = join(input.root, dir)
      let best: { path: string; width: number; height: number; same: boolean } | undefined
      for (const file of await listFiles(join(base, 'asset'))) {
        const size = imageSize(await readFile(file), file)
        if (!size || /\.svg$/i.test(file)) continue
        const candidate = { path: (dir + '/' + relative(base, file).split(sep).join('/')).replaceAll('\\', '/'), width: size.width, height: size.height, same: file.split(sep).pop() === name }
        // 同名文件优先；都同名或都不同名时取像素最大的。
        if (!best || (candidate.same && !best.same) || (candidate.same === best.same && size.width * size.height > best.width * best.height)) best = candidate
      }
      if (best && best.width > (asset.width ?? 0) * 1.05 && best.height >= (asset.height ?? 0)) { asset.fullImage = best.path; asset.fullWidth = best.width; asset.fullHeight = best.height; continue }
      // 单独导出仍是小图：MasterGo 对实例里的图片只给缩略 / 裁切文件（预览图里却是清晰的），改用节点 2 倍截图当位图；截图也不比原文件大才算设计稿本身放大。
      const shots = parseScreenshotResult(await reader.call('get_screenshot', { targetNodeId: routedNode(target, input.target), scale: 2 }, 90_000))
      const shot = shots[0] ? await localizeScreenshot(input.root, dir, shots[0]) : undefined
      const shotSize = shot?.path ? imageSize(await readFile(join(input.root, shot.path)), shot.path) : undefined
      if (shot?.path && shotSize && shotSize.width > (asset.width ?? 0) * 1.05) { asset.fullImage = shot.path; asset.fullWidth = shotSize.width; asset.fullHeight = shotSize.height; asset.recovery = '导出文件只有缩略图，已用节点 2 倍截图代替（含该节点自身的背景与描边，按稿面尺寸显示）' }
      else if (best && best.same && Math.abs(best.width - (asset.width ?? 0)) <= 1) { asset.scaledByDesign = true; asset.recovery = '原图本身就是 ' + best.width + '×' + best.height + '，设计稿把它放大到稿面尺寸，实现时同样按 cover 放大即可' }
      else asset.recovery = '按节点单独导出仍是' + (best ? best.width + '×' + best.height : '无位图') + '，截图也未取得更大的图'
    } catch (error) {
      if (host.signal.aborted) throw error
      asset.recovery = '补导出失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 160)
    }
  }
}

/** 读取区块导出 HTML 并抽取规格表；文件不存在时返回 undefined。 */
export async function readSpec(root: string, html: string): Promise<NodeSpec[] | undefined> {
  const content = await readOptional(root, html, 4_000_000)
  return content === null ? undefined : blockSpec(parseNodeTree(content))
}

function findNode(root: DesignNode, id: string): DesignNode | undefined {
  if (root.id === id) return root
  for (const child of root.children) { const found = findNode(child, id); if (found) return found }
  return undefined
}

/** 状态标签：画板名按 / - _ 切分后去掉纯数字段（如 1920），取最后一段；少于两段时为「默认」。 */
export function frameState(name: string): string {
  const parts = name.split(/[/_-]/).map(part => part.trim()).filter(part => part && !/^\d+(?:px|x\d+)?$/i.test(part))
  return parts.length >= 2 ? parts[parts.length - 1]! : '默认'
}

interface NamedNode { key: string; node: DesignNode }

/** 画板内带节点 ID 与名称的节点（不含画板本身），同名第二次出现起键为「名称#序号」。 */
function namedNodes(root: DesignNode): NamedNode[] {
  const counts = new Map<string, number>(), result: NamedNode[] = []
  const visit = (node: DesignNode) => {
    if (node.id && node.name) {
      const count = (counts.get(node.name) ?? 0) + 1
      counts.set(node.name, count)
      result.push({ key: count === 1 ? node.name : node.name + '#' + count, node })
    }
    for (const child of node.children) visit(child)
  }
  for (const child of root.children) visit(child)
  return result
}

/** 去掉几何属性后的内联样式，用于判断颜色、背景等变化。 */
function plainStyle(style: string | undefined): string {
  return (style ?? '').split(';').map(part => part.trim()).filter(part => part && !/^(?:width|height|left|top|z-index)\s*:/.test(part)).join('; ')
}

function changedEntries(before: Record<string, string | number | boolean> = {}, after: Record<string, string | number | boolean> = {}): [string, string] | undefined {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => before[key] !== after[key])
  if (!keys.length) return undefined
  const pick = (source: Record<string, string | number | boolean>) => JSON.stringify(Object.fromEntries(keys.map(key => [key, source[key] ?? null])))
  return [pick(before), pick(after)]
}

/**
 * 基础帧与状态帧的差异：节点先按 ID 配对，其余按「名称#序号」配对；
 * 比较父级相对位置、尺寸、直接文字、实例属性 / 文案与非几何样式。
 */
export function compareFrames(base: DesignNode, frame: DesignNode, state: string, frameId: string, limit = 400): StateDelta[] {
  const baseNodes = namedNodes(base), frameNodes = namedNodes(frame)
  const byId = new Map(frameNodes.map(item => [item.node.id!, item])), byKey = new Map(frameNodes.map(item => [item.key, item]))
  const matched = new Set<NamedNode>(), deltas: StateDelta[] = []
  const push = (delta: StateDelta) => { if (deltas.length < limit) deltas.push(delta) }
  const differs = (x?: number, y?: number) => Math.abs((x ?? 0) - (y ?? 0)) > 1
  const position = (node: DesignNode) => (node.left ?? 0) + ',' + (node.top ?? 0)
  const size = (node: DesignNode) => (node.width ?? '?') + '×' + (node.height ?? '?')
  // 画板本身总是配对：只比较尺寸，画板改名或换 ID 不算差异。
  if (differs(base.width, frame.width) || differs(base.height, frame.height)) push({ state, frame: frameId, kind: 'resized', name: '画板', nodeId: frame.id, baseNodeId: base.id, from: size(base), to: size(frame) })
  for (const item of baseNodes) {
    const pair = byId.get(item.node.id!) ?? byKey.get(item.key)
    if (!pair || matched.has(pair)) { push({ state, frame: frameId, kind: 'removed', name: item.key, baseNodeId: item.node.id }); continue }
    matched.add(pair)
    const common = { state, frame: frameId, name: item.key, nodeId: pair.node.id, baseNodeId: item.node.id }
    const before = item.node, after = pair.node
    if (differs(before.left, after.left) || differs(before.top, after.top)) push({ ...common, kind: 'moved', from: position(before), to: position(after) })
    if (differs(before.width, after.width) || differs(before.height, after.height)) push({ ...common, kind: 'resized', from: size(before), to: size(after) })
    if ((before.text ?? '') !== (after.text ?? '')) push({ ...common, kind: 'text', from: before.text, to: after.text })
    const texts = changedEntries(before.instanceText, after.instanceText)
    if (texts) push({ ...common, kind: 'text', from: texts[0], to: texts[1] })
    const variant = changedEntries(before.props, after.props)
    if (variant) push({ ...common, kind: 'variant', from: variant[0], to: variant[1] })
    const styleBefore = plainStyle(before.style), styleAfter = plainStyle(after.style)
    if (styleBefore !== styleAfter) push({ ...common, kind: 'style', from: styleBefore.slice(0, 160), to: styleAfter.slice(0, 160) })
  }
  for (const item of frameNodes) if (!matched.has(item)) push({ state, frame: frameId, kind: 'added', name: item.key, nodeId: item.node.id, to: size(item.node) + '@' + position(item.node) })
  return deltas
}

interface FrameReading { records: FrameRecord[]; deltas: StateDelta[]; additions: { record: FrameRecord; dir: string; node: DesignNode }[] }

/** 逐帧读取状态画板结构，写出帧目录下的 root.html，并记录与基础帧的差异和最外层新增节点。 */
async function readFrameRoots(reader: CanvasReader, host: ReaderHost, input: PreReadInput, base: DesignNode, remaining: () => number): Promise<FrameReading> {
  const reading: FrameReading = { records: [], deltas: [], additions: [] }
  for (const [index, frame] of (input.frames ?? []).entries()) {
    const record: FrameRecord = { nodeId: frame.nodeId, name: '', state: '', pageId: frame.pageId, blocks: [], exports: [], status: 'skipped' }
    reading.records.push(record)
    if (remaining() <= 0) { record.error = '超出预读预算'; continue }
    let html = ''
    try { html = parseSelectionResult(await reader.call('get_selection_node', { targetNodeId: routedNode(frame.nodeId, { fileId: input.target.fileId, pageId: frame.pageId }) }, CALL_TIMEOUT_MS)) }
    catch (error) { if (host.signal.aborted) throw error; record.status = 'error'; record.error = '读取状态帧失败：' + (error instanceof Error ? error.message : String(error)); continue }
    const root = designRoot(parseNodeTree(html))
    if (!root?.id) { record.status = 'error'; record.error = '状态帧没有返回可解析的结构'; continue }
    if (root.id !== frame.nodeId) { record.status = 'error'; record.error = '画布返回的节点 ' + root.id + ' 与链接中的 ' + frame.nodeId + ' 不一致'; continue }
    record.name = root.name ?? root.tag; record.state = frameState(record.name); record.width = root.width; record.height = root.height
    const dir = EXPORT_DIR + '/frames/' + slugFor(index + 1, record.state, frame.nodeId)
    await mkdir(join(input.root, dir), { recursive: true })
    await writeFile(join(input.root, dir, 'root.html'), html, 'utf8')
    record.html = dir + '/root.html'
    record.blocks = selectBlocks(root, input.select).blocks.map(block => ({ nodeId: block.nodeId, name: block.name, tag: block.tag, width: block.width, height: block.height }))
    const deltas = compareFrames(base, root, record.state, frame.nodeId)
    reading.deltas.push(...deltas)
    record.status = 'ok'
    // 只导出最外层的新增节点，其子节点随之导出。
    const added = new Set(deltas.filter(delta => delta.kind === 'added').map(delta => delta.nodeId!))
    const collect = (node: DesignNode) => { if (node.id && added.has(node.id)) { reading.additions.push({ record, dir, node }); return }; for (const child of node.children) collect(child) }
    collect(root)
  }
  return reading
}

/** 导出状态帧的新增节点（每帧最多 8 个），结果挂在对应帧记录的 exports 下。 */
async function exportFrameAdditions(reader: CanvasReader, host: ReaderHost, input: PreReadInput, reading: FrameReading, remaining: () => number): Promise<void> {
  const counts = new Map<FrameRecord, number>()
  for (const { record, dir, node } of reading.additions) {
    const count = (counts.get(record) ?? 0) + 1
    counts.set(record, count)
    const name = node.name ?? node.tag
    const entry: FrameExport = { nodeId: node.id!, name, dir: dir + '/' + slugFor(count, name, node.id!), assets: [], status: 'skipped' }
    record.exports.push(entry)
    if (count > 8) { entry.error = '新增节点过多，只导出前 8 个'; continue }
    if (remaining() <= 0) { entry.error = '超出预读预算'; continue }
    try {
      const result = parseExportResult(await reader.call('get_frontend_code', { targetNodeIds: [routedNode(node.id!, { fileId: input.target.fileId, pageId: record.pageId })], frontendFramework: 'html', writeToFile: true, outDir: entry.dir }, CALL_TIMEOUT_MS))
      const files = result.files.map(file => relative(input.root, isAbsolute(file) ? file : resolve(input.root, file)).split(sep).join('/'))
      await validateExport(input.root, entry.dir, files)
      entry.html = files[0]
      entry.assets = await scanAssets(input.root, entry.dir, files)
      if (result.screenshots[0]) entry.screenshot = await localizeScreenshot(input.root, entry.dir, result.screenshots[0])
      entry.status = 'ok'
    } catch (error) {
      if (host.signal.aborted) throw error
      entry.status = isTimeout(error) ? 'timeout' : 'error'
      entry.error = error instanceof Error ? error.message : String(error)
    }
  }
}

/** 只复用目标文件、页面和节点一致且本地导出仍完整的清单；优化或重读请求总是重新读取。 */
export async function reusableManifest(root: string, nodeId: string | undefined, request: string, target?: PreReadInput['target'], frameIds: readonly string[] = []): Promise<Manifest | null> {
  if (!nodeId || /重新读取|重读|刷新设计稿|refresh|优化|optimi[sz]e/i.test(request)) return null
  const content = await readOptional(root, MANIFEST_PATH, 8_000_000)
  if (content === null) return null
  try {
    const value = JSON.parse(content) as Manifest
    if (value.schemaVersion !== 1 || value.source?.nodeId !== nodeId || !Array.isArray(value.blocks)) return null
    if (target && (value.source.fileId !== target.fileId || value.source.pageId !== target.pageId)) return null
    // 状态帧集合必须一致且全部读取成功，否则重新预读。
    if (JSON.stringify((value.frames ?? []).map(frame => frame.nodeId).sort()) !== JSON.stringify([...frameIds].sort())) return null
    if (value.frames?.some(frame => frame.status !== 'ok' || frame.exports.some(item => item.status !== 'ok'))) return null
    const age = Date.now() - Date.parse(value.generatedAt)
    if (!Number.isFinite(age) || age < 0 || age > 24 * 3_600_000) return null
    if (value.blocks.some(block => block.status !== 'ok') || value.pending.length) return null
    if (!(await readOptional(root, value.root.html))?.trim()) return null
    for (const block of value.blocks) {
      if (!block.html) return null
      await validateExport(root, block.dir, [block.html])
      for (const asset of block.assets) { const info = await stat(await inside(root, asset.path)); if (!info.isFile() || info.size === 0) return null }
      if (block.screenshot?.path) { const info = await stat(await inside(root, block.screenshot.path)); if (!info.isFile() || info.size === 0) return null }
      if (block.screenshot?.status === 'ok' && !block.screenshot.path) return null
    }
    return value
  } catch (error) { return null }
}

/**
 * 交给模型的摘要：区块、状态、裁切素材与组件实例名，细节在 manifest 文件里。
 * @param mapping 实例名与映射表的匹配结果（命中 / 待映射），由 design_workspace 附上。
 */
export function manifestSummary(manifest: Manifest, reused = false, mapping?: object): object {
  return {
    path: MANIFEST_PATH, reused, root: { nodeId: manifest.root.nodeId, name: manifest.root.name, width: manifest.root.width, height: manifest.root.height, html: manifest.root.html },
    blocks: manifest.blocks.map(block => ({ nodeId: block.nodeId, name: block.name, dir: block.dir, html: block.html, screenshot: block.screenshot?.path ?? block.screenshot?.source, status: block.status, assets: block.assets.length, clipped: block.assets.filter(asset => asset.clipped).map(asset => asset.path), partial: block.assets.filter(asset => asset.partial !== undefined).map(asset => ({ path: asset.path, ratio: asset.partial, fullImage: asset.fullImage })), spec: block.spec?.length ?? 0, components: (block.components ?? []).map(instance => ({ nodeId: instance.nodeId, name: instance.name })) })),
    pending: manifest.pending, variables: manifest.variables.status, calls: manifest.timing.calls, startedAt: manifest.timing.startedAt, finishedAt: manifest.timing.finishedAt,
    ...(mapping ? { mapping } : {}),
    // 状态帧与差异：差异最多列 200 项，其余在 manifest 文件里。
    ...(manifest.frames ? {
      frames: manifest.frames.map(frame => ({ nodeId: frame.nodeId, name: frame.name, state: frame.state, html: frame.html, blocks: frame.blocks.length, exports: frame.exports.map(item => ({ nodeId: item.nodeId, name: item.name, dir: item.dir, html: item.html, status: item.status })), status: frame.status, error: frame.error })),
      stateDeltas: (manifest.stateDeltas ?? []).slice(0, 200), stateDeltasTotal: manifest.stateDeltas?.length ?? 0,
    } : {}),
  }
}
