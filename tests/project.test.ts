import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectProject, readOptional } from '../studios/design/src/project.ts'

test('识别 Nuxt 项目的配置、别名、组件和锁定版本，拒绝链接越界', async t => {
  const base = await mkdtemp(join(tmpdir(), 'design-project-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const root = join(base, 'project'); await mkdir(join(root, 'app/components'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'demo', packageManager: 'pnpm@10.0.0', dependencies: { nuxt: '^4.0.0', vue: '3.5.42' }, scripts: { dev: 'nuxt dev' } }))
  await writeFile(join(root, 'components.json'), JSON.stringify({ schemaVersion: 1, componentsDir: 'app/components', aliasSymbol: '~', registry: 'https://example.org/components' }))
  await writeFile(join(root, 'tsconfig.json'), '{ "compilerOptions": { "paths": { "~/*": ["app/*"] } } }')
  await writeFile(join(root, 'app/components/ExistingCard.vue'), '<template><div /></template>')
  await writeFile(join(base, 'outside.json'), 'private')
  await symlink(base, join(root, 'external'), process.platform === 'win32' ? 'junction' : 'dir')
  const project = await inspectProject(root)
  assert.equal(project.framework, 'Nuxt')
  assert.equal(project.packageManager, 'pnpm@10.0.0')
  assert.equal(project.dependencies.vue, '3.5.42')
  assert.deepEqual(project.components, ['app/components/ExistingCard.vue'])
  assert.match(String(project.config['tsconfig.json']), /~\/\*/)
  await assert.rejects(readOptional(project.root, 'external/outside.json'), /超出项目/)
  await assert.rejects(inspectProject('relative'), /绝对目录/)
})

test('UniApp 与非 Vue 项目有明确识别，损坏的配置不会被忽略', async t => {
  const root = await mkdtemp(join(tmpdir(), 'design-platform-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@dcloudio/uni-app': '3', vue: '3' } }))
  assert.equal((await inspectProject(root)).platform, 'uniapp')
  await writeFile(join(root, 'components.json'), '{bad')
  await assert.rejects(inspectProject(root), SyntaxError)
})
