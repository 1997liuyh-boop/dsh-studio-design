import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { MANIFEST_PATH } from './reader.ts'

/**
 * 预读清单的来源凭据。
 * docs/design/mastergo-manifest.json 放在目标项目里，模型能读也能写；预读不可用时，模型曾自己导出区块、
 * 再仿照格式手写一份清单（没有组件实例、规格来自自己渲染的导出 HTML），审计据此「通过」却与设计稿对不上。
 * 工作室每次预读落盘后，把清单内容的 SHA-256 记在项目之外（DSH_HOME/studio/design/seals/），
 * 审计与复用清单前核对：内容与记录不一致或没有记录，就不是工作室写出的清单。
 */
export class ManifestSeals {
  constructor(readonly dir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'studio/design/seals')) {}

  /** 每个项目目录一份记录，文件名取目录绝对路径的摘要（Windows 不区分大小写）。 */
  private file(root: string): string {
    const key = resolve(root).replaceAll('\\', '/')
    return join(this.dir, createHash('sha256').update(process.platform === 'win32' ? key.toLowerCase() : key).digest('hex').slice(0, 32) + '.json')
  }

  private static digest(content: string): string {
    return createHash('sha256').update(content).digest('hex')
  }

  /** 预读写出清单后调用：读取刚落盘的文件并记录摘要。 */
  async seal(root: string): Promise<void> {
    const content = await readFile(join(root, MANIFEST_PATH), 'utf8')
    await mkdir(this.dir, { recursive: true })
    const temp = join(this.dir, randomUUID() + '.tmp')
    await writeFile(temp, JSON.stringify({ root: resolve(root), digest: ManifestSeals.digest(content), sealedAt: new Date().toISOString() }), 'utf8')
    await rename(temp, this.file(root))
  }

  /** 清单内容是否就是工作室最近一次为该项目写出的那份。 */
  async verify(root: string, content: string): Promise<boolean> {
    try {
      const record = JSON.parse(await readFile(this.file(root), 'utf8')) as { digest?: unknown }
      return typeof record.digest === 'string' && record.digest === ManifestSeals.digest(content)
    } catch { return false }
  }
}

/** 清单不是工作室写出时给模型的说明：不要自己写，重新预读。 */
export const UNSEALED_MANIFEST = '项目里的 docs/design/mastergo-manifest.json 不是设计工作室预读写出的那一份（没有工作室的记录，或内容被改动过，例如手写、仿写或从别的页面复制）。不要自己编写或修改这个清单：调用 design_workspace，需求里写「重新读取」并附上设计稿链接，由工作室重新预读；预读不可用时把原因告诉用户，不要伪造清单继续审计。'
