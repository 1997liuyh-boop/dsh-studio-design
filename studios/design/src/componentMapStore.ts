/** 映射表与实现清单的文件读写（宿主端）；纯匹配逻辑在 componentMap.ts，浏览器端只打包后者。 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readOptional } from './project.ts'
import { CHECKLIST_PATH, writeJsonAtomic } from './reader.ts'
import { COMPONENT_MAP_PATH, componentMapSkeleton, componentRules, defaultRules, unmappedSection, type ComponentRule, type MappingResult } from './componentMap.ts'

/** 已载入的映射表：来源为项目文件或默认表。 */
export interface LoadedComponentMap {
  path: string
  source: 'project' | 'default'
  rules: readonly ComponentRule[]
  /** 本次是否新写出了骨架文件。 */
  created: boolean
  warnings: string[]
}

/**
 * 读取项目映射表；不存在时用默认表，create 为真时同时写出骨架。
 * 文件损坏不抛错：本次退回默认表并在 warnings 里说明，避免卡住整个设计任务。
 * @param known 知识库中存在的组件标识，用于提醒规则里写错的组件名。
 */
export async function loadComponentMap(root: string, options: { create?: boolean; known?: Set<string> } = {}): Promise<LoadedComponentMap> {
  const warnings: string[] = []
  let rules: readonly ComponentRule[] = defaultRules, source: LoadedComponentMap['source'] = 'default', created = false
  let content: string | null = null
  try { content = await readOptional(root, COMPONENT_MAP_PATH, 2_000_000) }
  catch (error) { warnings.push('映射表无法读取：' + (error instanceof Error ? error.message : String(error)) + '，本次使用默认表') }
  if (content !== null) {
    try {
      const raw = JSON.parse(content) as Record<string, unknown>
      const own = componentRules(raw)
      // 由骨架生成（inheritDefaults 为真，或说明文字仍是骨架的）的表会继承新默认规则：按 pattern 补到末尾，项目规则仍在前、优先命中，预读时写回文件；完全手写的表保持原样。
      const inherits = raw.inheritDefaults === true || raw.description === (componentMapSkeleton() as { description: string }).description
      const added = inherits ? defaultRules.filter(rule => !own.some(item => item.pattern === rule.pattern)) : []
      rules = added.length ? [...own, ...added] : own
      source = 'project'
      if (added.length) {
        warnings.push('映射表补充了 ' + added.length + ' 条新默认规则：' + added.map(rule => rule.pattern).join('、'))
        if (options.create) await writeJsonAtomic(root, COMPONENT_MAP_PATH, { ...raw, inheritDefaults: true, rules })
      }
    }
    catch (error) { warnings.push('映射表 ' + COMPONENT_MAP_PATH + ' 无法解析：' + (error instanceof Error ? error.message : String(error)) + '，本次使用默认表') }
  } else if (options.create) {
    await writeJsonAtomic(root, COMPONENT_MAP_PATH, componentMapSkeleton())
    created = true
  }
  if (options.known) for (const rule of rules) if (!rule.ignore && !options.known.has(rule.component)) warnings.push('映射表规则「' + rule.pattern + '」指向知识库中不存在的组件：' + rule.component)
  return { path: COMPONENT_MAP_PATH, source, rules, created, warnings }
}

const sectionHeading = /^##\s*(?:[一二三四五六七八九十\d]+[、.．]\s*)?待映射组件[^\n]*\n[\s\S]*?(?=^##\s|(?![\s\S]))/m

/** 把待映射实例写进实现清单：已有「待映射组件」段落则替换正文，否则追加到末尾；清单不存在时不创建。 */
export async function recordUnmapped(root: string, result: MappingResult, path = COMPONENT_MAP_PATH): Promise<boolean> {
  const content = await readOptional(root, CHECKLIST_PATH, 4_000_000)
  if (content === null) return false
  const heading = sectionHeading.exec(content)?.[0].split('\n')[0] ?? '## 待映射组件'
  const section = heading + '\n\n' + unmappedSection(result, path) + '\n\n'
  const next = sectionHeading.test(content) ? content.replace(sectionHeading, section) : content.replace(/\s*$/, '\n\n') + section
  if (next !== content) await writeFile(join(root, CHECKLIST_PATH), next, 'utf8')
  return true
}

/** 读取现有清单（供测试与工具核对）。 */
export async function readChecklist(root: string): Promise<string> {
  return readFile(join(root, CHECKLIST_PATH), 'utf8')
}
