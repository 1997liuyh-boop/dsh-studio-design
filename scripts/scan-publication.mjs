import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url)), rejected = []
async function scan(dir, path = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'lib', 'static', 'artifacts', '.local', '.test-build', 'reborn'].includes(entry.name) && !(path === 'upstream' && entry.name === 'reborn')) continue
    const relative = path ? path + '/' + entry.name : entry.name
    if (entry.isDirectory()) { await scan(join(dir, entry.name), relative); continue }
    if (entry.isSymbolicLink()) throw new Error('公开源码不得包含符号链接：' + relative)
    const content = await readFile(join(dir, entry.name), 'utf8')
    if (/(?:sk-[a-zA-Z0-9]{24,}|gh[pousr]_[a-zA-Z0-9]{25,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----|eyJ[a-zA-Z0-9_-]{30,}\.[a-zA-Z0-9_-]{30,}\.[a-zA-Z0-9_-]{20,})/.test(content)) rejected.push(relative)
    if (/(?:^|\/)(?:\.env|settings\.json|runtime\.json|credentials\.json|studio-data)(?:\/|$)/.test(relative)) rejected.push(relative)
  }
}
await scan(root)
if (rejected.length) throw new Error('发现疑似私有文件或凭据，请人工核查这些路径：\n' + rejected.join('\n'))
console.log('公开源码文件检查通过；未输出文件内容或凭据')
