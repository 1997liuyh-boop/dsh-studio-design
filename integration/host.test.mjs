import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'

const harness = process.env.DSH_HARNESS_ROOT
if (!harness) throw new Error('请设置 DSH_HARNESS_ROOT 到已构建的 dsh 源码目录')
const { Context } = await import(pathToFileURL(join(harness, 'vendor/cordis/lib/index.js')).href)
const { default: Tools } = await import(pathToFileURL(join(harness, 'packages/core/tools/lib/index.js')).href)
const { default: SystemPrompt } = await import(pathToFileURL(join(harness, 'packages/core/system-prompt/lib/index.js')).href)
const plugin = await import(new URL('../studios/design/lib/index.js', import.meta.url))

test('真实 Cordis 加载、API 拒绝跨站、内置 MCP 登记与卸载释放', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'design-host-')), previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  t.after(async () => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; await rm(dir, { recursive: true, force: true }) })
  const ctx = new Context(), pages = new Map()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  ctx.provide('studioProjects', { register(page) { pages.set(page.id, page); return () => pages.delete(page.id) } })
  const fiber = ctx.plugin(plugin)
  await fiber.await()
  const page = pages.get('design')
  assert.ok(page)
  async function request(method, input, extra = {}) {
    const req = Readable.from(input ? [Buffer.from(JSON.stringify(input))] : [])
    req.method = method; req.headers = { 'content-type': 'application/json', ...extra }
    let code = 0, data = ''
    await page.handle(req, { writeHead(value) { code = value }, end(value) { data = value } }, 'api')
    return { code, body: JSON.parse(data) }
  }
  assert.equal((await request('POST', { action: 'refresh' }, { 'sec-fetch-site': 'cross-site' })).code, 403)
  const initial = await request('GET')
  assert.equal(initial.body.components.length, 172)
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'design-smoke', dependencies: { vue: '3.5.42' } }))
  const configured = await request('POST', { action: 'configure', settings: { ...initial.body.settings, projectRoot: dir } })
  assert.equal(configured.code, 200)
  const connected = await request('POST', { action: 'connect', target: 'reborn' })
  assert.equal(connected.code, 200, JSON.stringify(connected.body))
  assert.ok(ctx.tools.get('mcp__design_reborn__get_component'))
  await fiber.dispose()
  assert.equal(pages.size, 0)
  assert.equal(ctx.tools.get('mcp__design_reborn__get_component'), undefined)
})
