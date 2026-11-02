import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AgentConnections } from '../studios/design/src/agentConnections.ts'
import { participation } from '../studios/design/src/participation.ts'
import { currentContext } from '../studios/design/src/workspace.ts'
import type { DesignAgent } from '../studios/design/src/host.ts'

test('多个工作区只采用明确持有的主会话，页面导航不替换已捕获目录', () => {
  const rows = { a: { cwd: '/a', retainedBy: { mainView: 1 } }, b: { cwd: '/b', retainedBy: {} } }
  const sessions = { list: { getSnapshot: () => ({ byId: rows }) } }
  const submitted = currentContext(sessions)
  rows.a.retainedBy.mainView = 0; rows.b.retainedBy = { mainView: 1 }
  assert.deepEqual(currentContext(sessions), { sessionId: 'b', root: '/b' })
  assert.deepEqual(submitted, { sessionId: 'a', root: '/a' })
  rows.a.retainedBy.mainView = 1
  assert.throws(() => currentContext(sessions), /请先在 dsh 工作区/)
})

test('参与状态由提交记录恢复，不把选中候选词或其他工作室当成参与', () => {
  const initial = participation.init()
  assert.equal(initial.mentioned, false)
  assert.equal(participation.apply(initial, { type: 'user/message', data: { content: [{ type: 'text', text: '@工作室:travel' }] } }), initial)
  const record = { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '@工作室:design 实现此页面' }] } }
  const active = participation.apply(initial, record)
  assert.equal(active.mentioned, true)
  assert.deepEqual(participation.apply(participation.init(), JSON.parse(JSON.stringify(record))), active)
  assert.equal(participation.apply(active, { type: 'turn/end', data: {} }), active)
  assert.equal(participation.apply(initial, { type: 'tool/call', data: { name: 'design_workspace' } }).mentioned, true)
  assert.equal(participation.apply(initial, { type: 'tool/ptc-dispatch-start', data: { name: 'design_workspace' } }).mentioned, true)
  assert.equal(participation.apply(initial, { ...record, data: { ...record.data, source: { kind: 'system-prompt' } } }), initial)
})

test('并行会话的 MasterGo 使用独立 Agent 作用域，释放一个不会影响另一个', async () => {
  const owners = new Map<DesignAgent, string[]>(), effects = new Map<DesignAgent, (() => void | Promise<void>)[]>()
  function agent(id: string): DesignAgent {
    const value: DesignAgent = { session: { id, header: { cwd: '/' + id } }, ctx: {
      tools: { get: () => ({}) },
      plugin() { throw new Error('测试工厂替换 MCP 启动') },
      effect(callback) { effects.get(value)!.push(callback()) },
    } }
    owners.set(value, []); effects.set(value, [])
    return value
  }
  const a = agent('a'), b = agent('b')
  const pool = new AgentConnections(owner => async config => {
    owners.get(owner)!.push(String(config.cwd))
    return { async await() {}, async dispose() { owners.get(owner)!.push('disposed') } }
  }, () => true)
  const one = pool.get(a), two = pool.get(b)
  await Promise.all([one.connect('mastergo', { command: 'node', args: [] }, '/a'), two.connect('mastergo', { command: 'node', args: [] }, '/b')])
  assert.notEqual(one, two)
  assert.equal(pool.get(a), one)
  assert.deepEqual(owners.get(a), ['/a']); assert.deepEqual(owners.get(b), ['/b'])
  await effects.get(a)![0]()
  assert.equal(pool.peek(a), undefined)
  assert.equal(two.snapshot().mastergo.state, 'connected')
  await pool.dispose()
  assert.deepEqual(owners.get(b), ['/b', 'disposed'])
  assert.throws(() => pool.get(b), /卸载/)
})
