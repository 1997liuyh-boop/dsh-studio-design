import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url)), output = join(root, 'artifacts')
await mkdir(output, { recursive: true })
const npm = process.env.npm_execpath?.endsWith('npm-cli.js') ? process.env.npm_execpath : join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
const result = spawnSync(process.execPath, [npm, 'pack', '--json', '--pack-destination', output], { cwd: join(root, 'studios/design'), encoding: 'utf8' })
if (result.status !== 0) throw new Error(result.stderr)
const [pkg] = JSON.parse(result.stdout)
for (const file of pkg.files) if (/(?:^|\/)(?:node_modules|\.env|settings\.json|studio-data)(?:\/|$)|\.log$|\.tmp$/.test(file.path)) throw new Error('安装包中包含私有或构建缓存文件：' + file.path)
const sha256 = createHash('sha256').update(await readFile(join(output, pkg.filename))).digest('hex')
await writeFile(join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, artifacts: [{ id: 'design', name: pkg.name, version: pkg.version, file: pkg.filename, sha256 }] }, null, 2) + '\n')
console.log(pkg.filename + '\nSHA256 ' + sha256)
