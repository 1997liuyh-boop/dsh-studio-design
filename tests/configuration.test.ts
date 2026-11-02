import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mastergoForm, mastergoSpec } from '../studios/design/src/mastergo.ts'
import { currentWorkspace, type WorkspaceSessions } from '../studios/design/src/workspace.ts'
import { defaults } from '../studios/design/src/storage.ts'
import { locateSource } from '../studios/design/src/source.ts'
import { designPrompt } from '../studios/design/src/prompt.ts'
import type { Project, Workspace } from '../studios/design/src/types.ts'

test('旧 MasterGo 配置转为可视化表单，自定义参数不丢失', () => {
  assert.deepEqual(mastergoForm(defaults().mastergo), { mode: 'visual', address: 'http://127.0.0.1:30678', version: '1.0.32' })
  const changed = mastergoSpec('http://localhost:30679/', 'latest')
  assert.equal(changed.args[2], '--url=http://localhost:30679')
  assert.equal(mastergoForm({ ...changed, args: [...changed.args, '--extra'] }).mode, 'custom')
  for (const address of ['https://example.com', 'http://user:secret@localhost:30678', 'http://localhost:30678/path', 'http://localhost:30678?token=x']) assert.throws(() => mastergoSpec(address, '1.0.32'))
  assert.throws(() => mastergoSpec('http://localhost:30678', 'other-package'))
})

test('工作区取自主视图持有的会话，不借用后台会话或其他窗口的项目', () => {
  const background = { cwd: '/other', retainedBy: {} }, main = { cwd: '/project', retainedBy: { mainView: 1 } }
  assert.equal(currentWorkspace({ list: { getSnapshot: () => ({ byId: { background, main } }) } }), '/project')
  const ambiguous: ReturnType<WorkspaceSessions['list']['getSnapshot']>['byId'][] = [{ background }, { main, second: main }, { main: { retainedBy: { mainView: 1 } } }]
  for (const byId of ambiguous) assert.throws(() => currentWorkspace({ list: { getSnapshot: () => ({ byId }) } }))
})

test('本地 knowledge 目录与完整 GitHub 数据包都能定位，缺失组件拒绝使用', async t => {
  const root = await mkdtemp(join(tmpdir(), 'design-knowledge-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const base = join(root, 'upstream/reborn')
  await mkdir(join(base, 'knowledge/components'), { recursive: true })
  await writeFile(join(base, 'knowledge/index.json'), JSON.stringify({ components: [{ id: 'button' }] }))
  await assert.rejects(locateSource(root), /组件资料缺失/)
  await writeFile(join(base, 'knowledge/components/button.json'), JSON.stringify({ examples: [{ code: '<button />' }] }))
  await writeFile(join(base, 'REBORN-SOURCE.json'), JSON.stringify({ commit: 'a'.repeat(40) }))
  assert.equal((await locateSource(root)).contentCommit, 'a'.repeat(40))
  assert.equal((await locateSource(join(base, 'knowledge'))).root, await import('node:fs/promises').then(fs => fs.realpath(base)))
  await writeFile(join(base, 'REBORN-SOURCE.json'), JSON.stringify({ commit: '../wrong' }))
  await assert.rejects(locateSource(root), /版本无效/)
})

test('规则生成不要求 MasterGo 或 Vue 项目，规则文件和证据随普通消息留档', () => {
  const project: Project = { root: '/project', name: 'existing', framework: '未知', platform: 'web', packageManager: 'pnpm', dependencies: {}, scripts: {}, config: {}, configFiles: [], components: [], warnings: [] }
  const workspace: Workspace = { schemaVersion: 1, revision: '', root: project.root, sessionId: '', mappings: [], previewUrl: '' }
  const prompt = designPrompt(project, workspace, '', 'rules')
  assert.match(prompt, /docs\/design-rules.md/)
  assert.match(prompt, /AGENTS.md/)
  assert.match(prompt, /实际文件路径作为依据/)
  assert.match(prompt, /不修改业务代码/)
  assert.doesNotMatch(prompt, /先调用 mcp__design_mastergo/)
  assert.throws(() => designPrompt(project, workspace, '实现页面', 'generate'), /只支持/)
})
