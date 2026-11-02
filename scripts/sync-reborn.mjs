import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../', import.meta.url))
if (!process.argv[2]) throw new Error('用法：node scripts/sync-reborn.mjs <Reborn-UI 源码目录>')
const source = resolve(process.argv[2]), target = join(root, 'upstream/reborn')
const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const changed = execFileSync('git', ['-C', source, 'diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
const allowed = process.argv.includes('--allow-generated-templates') ? ['packages/cli/src/generated/templates.ts'] : []
if (changed.some(file => !allowed.includes(file))) throw new Error('Reborn 检出包含源码改动，停止同步：' + changed.filter(file => !allowed.includes(file)).join('、'))
if (process.argv.includes('--check-source')) { console.log('Reborn 源码状态检查通过'); process.exit(0) }
const hashes = []
// 清理本脚本拥有的生成目录，避免已删除组件留在新快照中。
await rm(join(target, 'knowledge/components'), { recursive: true, force: true })
async function save(path, body) {
  body = Buffer.isBuffer(body) ? body.toString('utf8').replaceAll('\r\n', '\n') : body
  await mkdir(resolve(target, path, '..'), { recursive: true })
  await writeFile(join(target, path), body)
  hashes.push({ path: 'upstream/reborn/' + path, sha256: createHash('sha256').update(body).digest('hex') })
}
for (const file of ['index.ts', 'kb.ts', 'search.ts', 'spec.ts']) await save('src/' + file, await readFile(join(source, 'packages/mcp/src', file)))
await save('LICENSE', await readFile(join(source, 'LICENSE')))
await save('knowledge/index.json', await readFile(join(source, 'knowledge/index.json')))
for (const file of await readdir(join(source, 'knowledge/components'))) {
  if (!file.endsWith('.json')) continue
  const data = JSON.parse(await readFile(join(source, 'knowledge/components', file), 'utf8'))
  for (const example of data.examples ?? []) {
    if (example.code || !example.path) continue
    const path = resolve(source, example.path), diff = relative(source, path)
    if (diff.startsWith('..') || isAbsolute(diff)) throw new Error('示例路径越界')
    example.code = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n')
  }
  await save('knowledge/components/' + file, JSON.stringify(data, null, 2) + '\n')
}
for (const [from, to] of [
  ['docs/authoring/component-doc.md', 'component-doc.md'],
  ['content/2.components/button/reborn-button.md', 'template-component-doc.md'],
  ['docs/authoring/component-demo.md', 'component-demo.md'],
  ['app/components/reborn/examples/reborn-button/RebornButtonDemo.vue', 'template-component-demo.vue'],
]) await save('spec/' + to, (await readFile(join(source, from), 'utf8')).replaceAll('\r\n', '\n'))
await writeFile(join(root, 'REBORN-SNAPSHOT.json'), JSON.stringify({ repository: 'https://github.com/1997liuyh-boop/Reborn-UI', commit, knowledge: '由该检出的知识库生成，示例源码已内联；文本统一为 LF，摘要覆盖分发内容', files: hashes }, null, 2) + '\n')
console.log('已同步 Reborn MCP、知识库与规范：' + hashes.length + ' 个文件，提交 ' + commit)
