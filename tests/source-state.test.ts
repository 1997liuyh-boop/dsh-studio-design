import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('知识库打包只允许指定的 registry 生成文件变化，源码差异仍然阻止发布', async t => {
  const root = await mkdtemp(join(tmpdir(), 'design-git-state-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = (args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, stdio: 'pipe' })
  await mkdir(join(root, 'packages/cli/src/generated'), { recursive: true })
  const generated = join(root, 'packages/cli/src/generated/templates.ts'), source = join(root, 'source.vue')
  await writeFile(generated, 'original\n'); await writeFile(source, '<template />\n')
  git(['init']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture'])
  const script = fileURLToPath(new URL('../scripts/sync-reborn.mjs', import.meta.url))
  const check = (allow: boolean) => spawnSync(process.execPath, [script, root, '--check-source', ...(allow ? ['--allow-generated-templates'] : [])], { encoding: 'utf8' }).status
  assert.equal(check(false), 0)
  await writeFile(generated, 'regenerated\n')
  assert.notEqual(check(false), 0)
  assert.equal(check(true), 0)
  await writeFile(source, '<template><div /></template>\n')
  assert.notEqual(check(true), 0)
})
