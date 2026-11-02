import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TurnReader } from '../studios/design/src/session.ts'
import { designPrompt } from '../studios/design/src/prompt.ts'
import type { Project, Workspace } from '../studios/design/src/types.ts'

const event = (type: string, data: object) => ({ type: 'event', event: { type, data } })
test('会话只显示对应 requestId 的回合，真实完成事件才结束', () => {
  let output = ''
  const reader = new TurnReader('this-request', text => { output = text })
  reader.frame(event('turn/start', { turn: 1 }))
  reader.frame(event('user/message', { source: { rpcId: 'other-request' } }))
  reader.frame(event('assistant/message', { turn: 1, message: { content: [{ type: 'text', text: 'other' }] } }))
  assert.equal(reader.frame(event('turn/end', { turn: 1, reason: { kind: 'completed' } })), false)
  assert.equal(output, '')
  reader.frame(event('turn/start', { turn: 2 }))
  reader.frame(event('user/message', { source: { rpcId: 'this-request' } }))
  reader.frame({ type: 'assistant-stream', frame: { type: 'start', turn: 2, attemptId: 'a' } })
  reader.frame({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a', chunk: { type: 'text-delta', text: 'new' } } })
  assert.equal(output, 'new')
  assert.equal(reader.frame(event('turn/end', { turn: 2, reason: { kind: 'completed' } })), true)
})

test('中断回合显式失败，不把部分输出当成功', () => {
  const reader = new TurnReader('id', () => {})
  reader.frame(event('turn/start', { turn: 1 }))
  reader.frame(event('user/message', { source: { rpcId: 'id' } }))
  assert.throws(() => reader.frame(event('turn/end', { turn: 1, reason: { kind: 'cancelled' } })), /停止或失败/)
})

test('生成请求携带配置与映射，默认禁止回写画布，UniApp 被拒绝', () => {
  const project: Project = { root: '/target', name: 'demo', framework: 'Vue', platform: 'web', packageManager: 'pnpm', dependencies: { vue: '3' }, scripts: {}, config: { 'components.json': { aliasSymbol: '~' } }, configFiles: ['components.json'], components: ['src/components/Existing.vue'], warnings: [] }
  const workspace: Workspace = { schemaVersion: 1, root: '/target', revision: '', sessionId: '', mappings: [{ node: 'Button', component: 'reborn-button', source: 'reborn', variant: 'primary' }], previewUrl: '' }
  const prompt = designPrompt(project, workspace, '实现设置页')
  assert.match(prompt, /Existing.vue/); assert.match(prompt, /reborn-button/); assert.match(prompt, /aliasSymbol/)
  assert.match(prompt, /没有授权修改 MasterGo 画布/)
  assert.match(designPrompt(project, workspace, '同步当前根节点', 'sync'), /只使用当前页面已验证的静态 HTML/)
  assert.throws(() => designPrompt({ ...project, platform: 'uniapp' }, workspace, '生成'), /只支持/)
})
