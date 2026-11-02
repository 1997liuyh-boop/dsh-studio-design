import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

// 测试只提供设计读取工具，返回进程真实目录，不访问 MasterGo 或模型。
const server = new McpServer({ name: 'design-workspace-fixture', version: '1' })
server.tool('get_selection_code', {}, async () => ({ content: [{ type: 'text', text: JSON.stringify({ cwd: process.cwd() }) }] }))
await server.connect(new StdioServerTransport())
