import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import z from 'zod'
import { participation } from '../studios/design/src/participation.ts'

test('参与投影重放提交、工具调用和会话切换的固定记录', async () => {
  const data = z.object({ name: z.string().optional(), source: z.object({ kind: z.string() }).optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() }).passthrough()
  const fixture = z.array(z.object({ name: z.string(), events: z.array(z.object({ type: z.string(), data })), expected: z.array(z.boolean()) })).parse(JSON.parse(await readFile(new URL('./fixtures/participation.snapshot.json', import.meta.url), 'utf8')))
  for (const scenario of fixture) {
    let state = participation.init()
    const observed: boolean[] = []
    for (const event of scenario.events) { state = participation.apply(state, event); observed.push(state.mentioned) }
    assert.deepEqual(observed, scenario.expected, scenario.name)
  }
})
