import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Previews, type PreviewHost } from '../studios/design/src/preview.ts'
import { defaults, settings } from '../studios/design/src/storage.ts'
import { repositoryUrl, validateSource } from '../studios/design/src/source.ts'
import type { Project } from '../studios/design/src/types.ts'

test('旧项目配置保留，本地资料与内置来源可区分', () => {
  const previous = { ...defaults(), projectRoot: 'D:/project', rebornRoot: 'D:/reborn' }
  delete previous.rebornSource
  assert.equal(settings(previous).rebornSource, 'local')
  assert.equal(settings({ ...previous, rebornRoot: '' }).rebornSource, 'builtin')
  assert.equal(settings(previous).projectRoot, 'D:/project')
})

test('GitHub 来源拒绝凭据、查询参数和非仓库地址', () => {
  assert.equal(repositoryUrl('https://github.com/1997liuyh-boop/Reborn-UI'), 'https://github.com/1997liuyh-boop/Reborn-UI.git')
  for (const value of ['https://user:secret@github.com/a/b', 'https://github.com/a/b?token=x', 'https://github.com/a/b/tree/main', 'file:///a/b']) assert.throws(() => repositoryUrl(value))
})

test('GitHub 未生成组件资料时明确沿用内置资料，本地来源仍须完整', async t => {
  const root = await mkdtemp(join(tmpdir(), 'design-unbuilt-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'knowledge'), { recursive: true })
  await writeFile(join(root, 'knowledge/index.json'), JSON.stringify({ components: [{ id: 'button' }] }))
  assert.equal(await validateSource(root, true), false)
  await assert.rejects(validateSource(root), /没有生成后的/)
})

test('资料索引不允许组件或示例读取缓存目录外文件', async t => {
  const root = await mkdtemp(join(tmpdir(), 'design-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'knowledge/components'), { recursive: true })
  await writeFile(join(root, 'knowledge/index.json'), JSON.stringify({ components: [{ id: 'button' }] }))
  await writeFile(join(root, 'knowledge/components/button.json'), JSON.stringify({ examples: [{ path: '../../outside.vue' }] }))
  await assert.rejects(validateSource(root))
  await writeFile(join(root, 'knowledge/components/button.json'), JSON.stringify({ examples: [{ code: '<button />' }] }))
  await validateSource(root)
})

test('项目预览复用任务，停止与卸载只取消工作室拥有的进程', async () => {
  let started = 0, killed = 0, release!: () => void
  const done = new Promise<void>(resolve => { release = resolve })
  let status = 'running'
  const read = () => ({ text: '', nextOffset: 0, lossy: false })
  let hooks: ReturnType<Parameters<NonNullable<PreviewHost['jobs']>['start']>[0]['run']>
  const host: PreviewHost = {
    shell: { resolve: value => value, execute: async () => ({ status: 'running', exitCode: null, done, kill() { killed++; release(); return true }, observed: { stdout: { readFrom: read }, stderr: { readFrom: read } } }) },
    jobs: { start(spec) { started++; hooks = spec.run(); return 'bash-test' }, get() { return { status } }, kill() { status = 'stopping'; hooks.cancel(); return status } },
  }
  const project: Project = { root: 'D:/fixture', name: 'fixture', packageManager: 'npm@10', scripts: { dev: 'vite' }, dependencies: {}, framework: 'Vue', platform: 'web', config: {}, configFiles: [], components: [], warnings: [] }
  const previews = new Previews(host)
  assert.equal((await previews.start(project, 'session-test', 'dev')).jobId, 'bash-test')
  await previews.start(project, 'session-test', 'dev')
  assert.equal(started, 1)
  assert.equal((await previews.stop(project.root)).state, 'stopping')
  await previews.dispose()
  assert.ok(killed >= 1)
})

test('项目没有声明脚本时不执行任何命令', async () => {
  let ran = false
  const previews = new Previews({ shell: { resolve: value => value, execute: async () => { ran = true; throw new Error('unexpected') } }, jobs: { start() { ran = true; return '' }, get: () => ({ status: 'running' }), kill: () => '' } })
  await assert.rejects(previews.start({ packageManager: 'npm', scripts: {} } as Project, 'session-test', 'dev'))
  assert.equal(ran, false)
})
