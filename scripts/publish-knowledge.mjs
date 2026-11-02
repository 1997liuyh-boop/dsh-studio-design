/** CI 只向独立资料分支追加提交，远端移动时由普通 push 拒绝覆盖。 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== '1997liuyh-boop/dsh-studio-design' || !process.env.GITHUB_TOKEN) throw new Error('发布仅用于本仓库的可信 CI')
const root = fileURLToPath(new URL('../', import.meta.url)), temporary = await mkdtemp(join(tmpdir(), 'design-knowledge-'))
const env = { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic ' + Buffer.from('x-access-token:' + process.env.GITHUB_TOKEN).toString('base64'), GIT_TERMINAL_PROMPT: '0' }
const options = { cwd: temporary, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
const git = args => execFileSync('git', args, options)
try {
  git(['init', '--initial-branch=knowledge'])
  git(['remote', 'add', 'origin', 'https://github.com/' + process.env.GITHUB_REPOSITORY + '.git'])
  const remote = spawnSync('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/knowledge'], options)
  if (remote.status === 0) { git(['fetch', '--depth=1', 'origin', 'knowledge']); git(['checkout', '-B', 'knowledge', 'FETCH_HEAD']) }
  else if (remote.status !== 2) throw new Error('无法读取知识库分支，停止发布')
  git(['rm', '-r', '--ignore-unmatch', '.'])
  await cp(join(root, 'artifacts/reborn-knowledge'), temporary, { recursive: true })
  git(['add', '--all'])
  const changed = spawnSync('git', ['diff', '--cached', '--quiet'], options)
  if (changed.status === 0) console.log('知识库未变化')
  else {
    if (changed.status !== 1) throw new Error('无法检查知识库差异')
    git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', 'chore: refresh complete Reborn knowledge'])
    git(['push', 'origin', 'HEAD:refs/heads/knowledge'])
    console.log('完整知识库已发布到 knowledge 分支')
  }
} finally { await rm(temporary, { recursive: true, force: true }) }
