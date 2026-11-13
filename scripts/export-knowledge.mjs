/** 导出可供工作室直接读取的完整资料，不包含可执行仓库脚本。 */
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const target = join(root, 'artifacts/reborn-knowledge')
const snapshot = JSON.parse(await readFile(join(root, 'REBORN-SNAPSHOT.json'), 'utf8'))
await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
for (const path of ['knowledge', 'spec', 'LICENSE']) await cp(join(root, 'upstream/reborn', path), join(target, path), { recursive: true })
await writeFile(join(target, 'REBORN-SOURCE.json'), JSON.stringify({ repository: snapshot.repository, commit: snapshot.commit, files: snapshot.files.filter(file => !file.path.includes('/src/')).map(file => ({ ...file, path: file.path.replace('upstream/reborn/', '') })) }, null, 2) + '\n')
await writeFile(join(target, 'README.md'), '# Reborn 完整知识库\n\n由设计工作室构建流程从 Reborn 源码生成，示例源码已内联。此分支只分发数据。版本与 SHA256 见 REBORN-SOURCE.json，许可见 LICENSE。\n\n设计工作室「组件知识库」选择「GitHub · 最新发布」时默认就从这里获取（仓库 https://github.com/1997liuyh-boop/dsh-studio-design ，分支 knowledge），测试时拉取并固定版本；每次发布设计工作室都会同步更新本分支。也可下载 Actions 中的 reborn-knowledge artifact，解压后作为本地知识库。\n')
console.log('完整知识库已导出，Reborn 提交：' + snapshot.commit)
