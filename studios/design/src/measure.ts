/**
 * Playwright 测量：按设计稿基准宽度打开实现页面，读取 data-design 节点的几何与计算样式并逐块截图；
 * 同一浏览器再渲染区块导出 HTML，得到设计侧的节点几何。Playwright 不随插件打包，
 * 从环境变量 DSH_PLAYWRIGHT_MODULE、目标项目、插件目录、宿主工作目录或 DSH_HARNESS_ROOT 解析。
 */
import { readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MeasuredNode, Measurer } from './compare.ts'

interface Locator { first(): Locator; screenshot(options: object): Promise<Buffer> }
interface Page {
  setDefaultTimeout(ms: number): void
  goto(url: string, options?: object): Promise<unknown>
  setViewportSize(size: { width: number; height: number }): Promise<void>
  evaluate<T>(script: (arg: never) => T, arg?: unknown): Promise<T>
  addStyleTag(options: { content: string }): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  locator(selector: string): Locator
  close(): Promise<void>
}
interface Browser { newContext(options: object): Promise<{ newPage(): Promise<Page> }>; close(): Promise<void> }
interface Playwright { chromium: { launch(options: object): Promise<Browser> } }

async function exists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile() }
  catch (error) { return false }
}

/** 版本排序：正式版优先，再按版本号降序。 */
function newest(names: string[]): string | undefined {
  const parse = (name: string) => { const version = /@(\d+)\.(\d+)\.(\d+)(-[^_]+)?/.exec(name); return version ? { pre: version[4] ? 1 : 0, parts: [Number(version[1]), Number(version[2]), Number(version[3])] } : undefined }
  return names.filter(parse).sort((a, b) => { const x = parse(a)!, y = parse(b)!; if (x.pre !== y.pre) return x.pre - y.pre; for (let i = 0; i < 3; i += 1) if (x.parts[i] !== y.parts[i]) return y.parts[i]! - x.parts[i]!; return 0 })[0]
}

/**
 * 解析 playwright 入口文件：显式路径 → 各根目录的常规解析 → 沿祖先目录查找 pnpm 虚拟仓库里的 playwright。
 * @returns 入口文件的绝对路径；找不到返回 undefined。
 */
export async function locatePlaywright(options: { explicit?: string; roots: string[] }): Promise<string | undefined> {
  if (options.explicit) return await exists(options.explicit) ? options.explicit : undefined
  const roots = [...new Set(options.roots.filter(Boolean))]
  for (const root of roots) {
    const require = createRequire(join(root, 'noop.js'))
    for (const name of ['playwright', 'playwright-core']) {
      try { const entry = require.resolve(name); if (await exists(entry)) return entry }
      catch (error) { /* 该目录解析不到，继续其他候选。 */ }
    }
  }
  for (const root of roots) {
    let dir = root
    for (let depth = 0; depth < 8; depth += 1) {
      for (const name of ['playwright', 'playwright-core']) {
        const direct = join(dir, 'node_modules', name, 'index.js')
        if (await exists(direct)) return direct
        const store = join(dir, 'node_modules', '.pnpm')
        let entries: string[] = []
        try { entries = (await readdir(store)).filter(entry => entry.startsWith(name + '@')) }
        catch (error) { entries = [] }
        const best = newest(entries)
        if (best) { const entry = join(store, best, 'node_modules', name, 'index.js'); if (await exists(entry)) return entry }
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return undefined
}

/** 载入 Playwright 入口并取出 chromium；入口没有 chromium 时抛错并给出路径，便于排查 DSH_PLAYWRIGHT_MODULE。 */
export async function loadChromium(module: string): Promise<Playwright['chromium']> {
  const loaded = await import(pathToFileURL(module).href) as Playwright & { default?: Playwright }
  const chromium = loaded.chromium ?? loaded.default?.chromium
  if (!chromium) throw new Error('Playwright 模块没有 chromium 入口：' + module)
  return chromium
}

/** 页面内执行：按属性找节点，返回绝对矩形、文字与计算样式。 */
function collect(input: { attribute: string; ids: string[] }): Record<string, MeasuredNode> {
  const out: Record<string, MeasuredNode> = {}
  for (const id of input.ids) {
    const element = document.querySelector('[' + input.attribute + '="' + CSS.escape(id) + '"]')
    if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
    const own = element instanceof HTMLElement ? element.innerText : element.textContent ?? ''
    out[id] = {
      rect: { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height },
      scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
      ...(element instanceof HTMLImageElement ? { image: { src: element.currentSrc || element.src, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight, objectFit: style.objectFit } } : {}),
      text: own.replace(/\s+/g, ' ').trim().slice(0, 200),
      styles: { fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight, fontFamily: style.fontFamily, color: style.color, backgroundColor: style.backgroundColor, radius: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius], borderWidth: style.borderTopWidth, borderStyle: style.borderTopStyle, borderColor: style.borderTopColor },
    }
  }
  return out
}

/** 页面内执行：逐屏滚动触发懒加载后回到顶部。 */
async function scrollThrough(): Promise<void> {
  const step = Math.max(400, window.innerHeight)
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 60)) }
  window.scrollTo(0, 0)
  await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready
}

/**
 * 创建 Playwright 测量函数。
 * @param options.module playwright 入口文件绝对路径。
 * @param options.timeoutMs 单次页面操作上限，默认 60 秒。
 */
export function playwrightMeasurer(options: { module: string; signal?: AbortSignal; timeoutMs?: number }): Measurer {
  const timeout = options.timeoutMs ?? 60_000
  return async job => {
    const chromium = await loadChromium(options.module)
    const browser = await chromium.launch({ headless: true })
    const abort = () => { void browser.close() }
    options.signal?.addEventListener('abort', abort, { once: true })
    const warnings: string[] = []
    try {
      const context = await browser.newContext({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'zh-CN' })
      const page = await context.newPage()
      page.setDefaultTimeout(timeout)
      await page.goto(job.url, { waitUntil: 'networkidle' })
      // 关闭动画与过渡，保证截图稳定；滚动一遍触发懒加载。
      await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' })
      await page.evaluate(scrollThrough)
      await page.waitForTimeout(300)
      const design = await context.newPage()
      design.setDefaultTimeout(timeout)
      const blocks = []
      for (const block of job.blocks) {
        options.signal?.throwIfAborted()
        const nodes = await page.evaluate(collect, { attribute: 'data-design', ids: block.ids })
        let screenshot: Buffer | undefined
        if (nodes[block.nodeId]) {
          try { screenshot = await page.locator('[data-design="' + block.nodeId.replace(/"/g, '\\"') + '"]').first().screenshot({ type: 'png', animations: 'disabled', scale: 'css', caret: 'hide', timeout }) }
          catch (error) { warnings.push(block.nodeId + '：区块截图失败：' + (error instanceof Error ? error.message : String(error))) }
        }
        let designNodes: Record<string, MeasuredNode> | undefined
        if (block.exportHtml) {
          try {
            // 视口宽度取区块设计宽度：导出 HTML 的根没有宽度时按视口撑开，这样它的盒子才等于设计稿里的盒子。
            await design.setViewportSize({ width: Math.max(1, block.width ?? job.width), height: job.height })
            await design.goto(pathToFileURL(block.exportHtml).href, { waitUntil: 'load' })
            // 导出 HTML 里的 <img> 是行内元素，行盒会给容器多算约 4px 基线间隙；按块显示后容器高度才等于稿面。
            await design.addStyleTag({ content: 'img { display: block; }' })
            await design.evaluate(scrollThrough)
            designNodes = await design.evaluate(collect, { attribute: 'data-node-id', ids: block.ids })
          } catch (error) { warnings.push(block.nodeId + '：导出 HTML 渲染失败，位置只按规格表比对：' + (error instanceof Error ? error.message : String(error))) }
        }
        blocks.push({ nodeId: block.nodeId, nodes, design: designNodes, screenshot })
      }
      return { blocks, warnings }
    } finally {
      options.signal?.removeEventListener('abort', abort)
      await browser.close().catch(() => {})
    }
  }
}
