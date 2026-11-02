import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { object } from '../studios/design/src/project.ts'

test('分发的 Reborn MCP 可独立查询真实按钮参数、示例及写作规范', async t => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../studios/design/lib/reborn-mcp.js', import.meta.url)), '--kb-dir', fileURLToPath(new URL('../studios/design/reborn/knowledge', import.meta.url)), '--spec-dir', fileURLToPath(new URL('../studios/design/reborn/spec', import.meta.url))] })
  const client = new Client({ name: 'design-package-test', version: '1' })
  t.after(() => client.close())
  await client.connect(transport)
  assert.equal((await client.listTools()).tools.length, 7)
  for (const [name, args, pattern] of [
    ['get_component', { id: 'reborn-button' }, /"props"/],
    ['get_component_example', { id: 'reborn-button', platform: 'web' }, /<template>/],
    ['get_authoring_spec', { kind: 'doc' }, /Props/],
  ] as const) {
    const result = await client.callTool({ name, arguments: args })
    assert.notEqual(result.isError, true)
    const blocks: unknown[] = Array.isArray(result.content) ? result.content : []
    assert.match(blocks.map(block => { const entry = object(block); return entry.type === 'text' ? String(entry.text) : '' }).join('\n'), pattern)
  }
})
