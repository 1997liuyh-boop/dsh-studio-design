import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Connections } from '../studios/design/src/connections.ts'

test('失败握手释放子插件，断线后不再显示已连接', async () => {
  let online = false, disposed = 0, fail = true
  const connections = new Connections(async () => ({ async await() { if (fail) throw new Error('offline'); online = true }, async dispose() { online = false; disposed++ } }), () => online)
  try {
    await assert.rejects(connections.connect('reborn', { command: 'node', args: [] }, '/project'), /offline/)
    assert.equal(disposed, 1)
    assert.equal(connections.snapshot().reborn.state, 'error')
    fail = false
    await connections.connect('reborn', { command: 'node', args: [] }, '/project')
    assert.equal(connections.snapshot().reborn.state, 'connected')
    online = false
    assert.equal(connections.snapshot().reborn.state, 'error')
    await connections.disconnect()
    assert.equal(disposed, 2)
  } finally { await connections.dispose() }
})

test('卸载中止正在握手的连接，并拒绝后续连接', async () => {
  let entered!: () => void, release!: () => void
  const barrier = new Promise<void>(resolve => { entered = resolve })
  const handshake = new Promise<void>(resolve => { release = resolve })
  const connections = new Connections(async () => ({ async await() { entered(); await handshake }, async dispose() { release() } }), () => true)
  const connecting = connections.connect('mastergo', { command: 'node', args: [] }, '/project')
  const rejected = assert.rejects(connecting, /已卸载/)
  await barrier
  await connections.dispose()
  await rejected
  assert.equal(connections.snapshot().mastergo.state, 'disconnected')
  await assert.rejects(connections.connect('mastergo', { command: 'node', args: [] }, '/project'), /已卸载/)
})
