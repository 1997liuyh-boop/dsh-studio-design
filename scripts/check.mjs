import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url)), dir = join(root, 'studios/design')
for (const file of ['package.json', 'studio.json', 'dsh.plugin.json', 'lib/index.js', 'lib/client.js', 'lib/reborn-mcp.js', 'static/index.html', 'static/app.js', 'static/app.css', 'reborn/knowledge/components/reborn-button.json', 'reborn/spec/component-doc.md', 'README.md', 'LICENSE', 'UPSTREAM.json']) await access(join(dir, file))
const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
const manifest = JSON.parse(await readFile(join(dir, 'dsh.plugin.json'), 'utf8'))
assert.equal(pkg.version, manifest.version)
assert.equal(pkg.name, manifest.name)
for (const name of ['SDK-SNAPSHOT.json', 'REBORN-SNAPSHOT.json']) {
  const snapshot = JSON.parse(await readFile(join(root, name), 'utf8'))
  for (const entry of snapshot.files) assert.equal(createHash('sha256').update(await readFile(join(root, entry.path))).digest('hex'), entry.sha256, entry.path)
}
const vue = await readFile(join(dir, 'src/App.vue'), 'utf8')
assert.doesNotMatch(vue.split('<template>')[1], /\bas (?:string|number|unknown|boolean)\b/)
console.log('类型、产物、版本与两份上游快照摘要已检查')
