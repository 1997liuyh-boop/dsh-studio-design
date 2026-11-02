import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'

const harness = process.env.DSH_HARNESS_ROOT
if (!harness) throw new Error('请设置 DSH_HARNESS_ROOT 到已构建的 dsh 源码目录')
const { Context } = await import(pathToFileURL(join(harness, 'vendor/cordis/lib/index.js')).href)
const { default: Tools } = await import(pathToFileURL(join(harness, 'packages/core/tools/lib/index.js')).href)
const { default: SystemPrompt } = await import(pathToFileURL(join(harness, 'packages/core/system-prompt/lib/index.js')).href)
const { default: Projections } = await import(pathToFileURL(join(harness, 'packages/session/session-projection/lib/index.js')).href)
const { default: Sessions } = await import(pathToFileURL(join(harness, 'packages/core/session/lib/index.js')).href)
const { createScope } = await import(pathToFileURL(join(harness, 'packages/core/scope/lib/index.js')).href)
const { PluginPackages, createRuntimeResolution } = await import(pathToFileURL(join(harness, 'packages/boot/app-boot/lib/index.js')).href)
const plugin = await import(new URL('../studios/design/lib/index.js', import.meta.url))

test('真实 Cordis 加载、API 拒绝跨站、内置 MCP 登记与卸载释放', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'design-host-'))), previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const ctx = new Context(), pages = new Map(), scopes = []
  t.after(async () => {
    try { for (const scope of scopes) await scope.dispose(); await ctx.fiber.dispose() }
    finally { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; await rm(dir, { recursive: true, force: true }) }
  })
  const resolution = await createRuntimeResolution({ installAnchor: join(harness, 'apps/cli/package.json'), home: dir })
  await ctx.plugin(PluginPackages, { resolution: { ...resolution, linkedRoots: [{ name: 'dsh-studio-design', realPath: fileURLToPath(new URL('../studios/design', import.meta.url)) }] } }).await()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  await ctx.plugin(Projections).await()
  await ctx.plugin(Sessions).await()
  const agents = new Map()
  ctx.provide('agents', { get(id) { return agents.get(id) } })
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
  assert.equal(initial.body.connections.reborn.state, "connected")
  assert.ok(ctx.tools.get("mcp__design_reborn__get_component"))
  const rebornTool = ctx.tools.get('mcp__design_reborn__get_component')
  const missingProject = await request('POST', { action: 'connect', target: 'mastergo' })
  assert.equal(missingProject.code, 400)
  assert.match(missingProject.body.error, /当前会话.*自动连接/)
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'design-smoke', dependencies: { vue: '3.5.42' } }))
  const session = ctx.sessions.create(undefined, { meta: { cwd: dir } })
  const configured = await request('POST', { action: 'snapshot', sessionId: session.id })
  assert.equal(configured.code, 200)
  assert.equal(configured.body.project.name, 'design-smoke')
  assert.equal(configured.body.context.sessionId, session.id)
  const noContext = await request('GET')
  assert.equal(noContext.body.project, null)
  const tool = ctx.tools.get('design_workspace')
  assert.ok(tool)
  const prepared = JSON.parse(await tool.execute({ task: 'rules', request: '生成项目规则' }, { agent: { session }, signal: new AbortController().signal }))
  assert.equal(prepared.sessionId, session.id)
  assert.equal(prepared.root, configured.body.project.root)
  assert.match(prepared.instructions, /docs\/design-rules.md/)
  await assert.rejects(tool.execute({ task: 'rules', request: '' }, { signal: new AbortController().signal }), /打开项目会话/)
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(tool.execute({ task: 'rules', request: '' }, { agent: { session }, signal: cancelled.signal }), /abort/i)
  const configuredMcp = await request('POST', { action: 'configure', settings: { ...initial.body.settings, mastergo: { command: process.execPath, args: [fileURLToPath(new URL('./mastergo.fixture.mjs', import.meta.url))] } } })
  assert.equal(configuredMcp.code, 200)
  const bRoot = join(dir, 'b'); await mkdir(bRoot)
  await writeFile(join(bRoot, 'package.json'), JSON.stringify({ name: 'project-b', dependencies: { vue: '3.5.42' } }))
  const second = ctx.sessions.create(undefined, { meta: { cwd: bRoot } })
  const firstAgent = { session }, secondAgent = { session: second }
  const firstScope = createScope(ctx, firstAgent), secondScope = createScope(ctx, secondAgent)
  scopes.push(firstScope, secondScope)
  firstAgent.ctx = firstScope.ctx; secondAgent.ctx = secondScope.ctx
  agents.set(session.id, firstAgent); agents.set(second.id, secondAgent)
  const results = await Promise.all([firstAgent, secondAgent].map((agent, index) => ctx.tools.execute({ callId: 'prepare-' + index, name: 'design_workspace', arguments: { task: 'read', request: '只读取当前选区' }, agent, signal: new AbortController().signal })))
  for (const result of results) assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(JSON.parse(results[0].value).root, configured.body.project.root)
  assert.equal(JSON.parse(results[1].value).root, bRoot)
  assert.equal(ctx.tools.get('mcp__design_mastergo__get_selection_code'), undefined)
  const selections = await Promise.all([firstAgent, secondAgent].map((agent, index) => ctx.tools.execute({ callId: 'selection-' + index, name: 'mcp__design_mastergo__get_selection_code', arguments: {}, agent, signal: new AbortController().signal })))
  for (const result of selections) assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(JSON.parse(selections[0].content[0].text).cwd, configured.body.project.root)
  assert.equal(JSON.parse(selections[1].content[0].text).cwd, bRoot)
  assert.notDeepEqual(selections[0].content, selections[1].content)
  await firstScope.dispose()
  assert.ok(ctx.tools.get('mcp__design_mastergo__get_selection_code', secondAgent))
  assert.equal((await request('POST', { action: 'snapshot', sessionId: second.id })).body.project.name, 'project-b')
  assert.equal(ctx.tools.get('mcp__design_reborn__get_component'), rebornTool)
  const connected = await request('POST', { action: 'connect', target: 'reborn' })
  assert.equal(connected.code, 200, JSON.stringify(connected.body))
  assert.ok(ctx.tools.get('mcp__design_reborn__get_component'))
  await fiber.dispose()
  assert.equal(pages.size, 0)
  assert.equal(ctx.tools.get('mcp__design_reborn__get_component'), undefined)
  assert.equal(ctx.tools.get('design_workspace'), undefined)
})
