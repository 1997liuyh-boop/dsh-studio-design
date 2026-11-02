import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store, previewUrl, mappings, defaults } from '../studios/design/src/storage.ts'

test('并发旧版本保存只能成功一次，不同项目的映射与会话相互隔离', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'design-store-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new Store(dir), first = await store.workspace('one')
  const content = { ...first, sessionId: 'session-one', mappings: [{ node: '1:2', source: 'reborn', component: 'reborn-button', variant: 'primary' }] }
  const results = await Promise.allSettled([store.saveWorkspace('one', content), store.saveWorkspace('one', content)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal((await store.workspace('one')).sessionId, 'session-one')
  assert.deepEqual((await store.workspace('two')).mappings, [])
  assert.equal((await store.workspace('two')).sessionId, '')
  assert.throws(() => mappings([...content.mappings, ...content.mappings]), /重复/)
})

test('损坏的设置保持原样并报告；预览拒绝远程、脚本和嵌入凭据', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'design-settings-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.saveSettings(defaults())
  await writeFile(join(dir, 'settings.json'), '{bad')
  await assert.rejects(store.loadSettings(), SyntaxError)
  for (const input of ['javascript:alert(1)', 'https://example.com', 'http://user:pass@localhost', 'http://127.0.0.1.example.com']) assert.throws(() => previewUrl(input))
  assert.equal(previewUrl('http://127.0.0.1:5173'), 'http://127.0.0.1:5173/')
})
