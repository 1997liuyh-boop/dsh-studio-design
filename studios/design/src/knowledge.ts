/**
 * Reborn 知识库的本地读取：工作室在预读与检查时直接用知识库判定，而不是只在提示词里请模型去调 MCP。
 *
 * 判定逻辑不在这里重写——直接引用内置 Reborn MCP 的同一份源码（upstream/reborn/src，
 * 即 match_design_nodes 与 check_usage 两个工具背后的函数），规则数据读当前生效的知识库目录
 * （内置快照、本地目录或 GitHub 同步来的版本）。这样模型自己调 MCP 得到的结论，与工作室审计用的结论是同一个。
 * 知识库没有配方表（很旧的索引）时返回 undefined，调用方退回工作室自带的默认映射表。
 */
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { matchDesignNodes, resolveUsage, type DesignMatchResult, type DesignNodeInput, type ResolvedUsage } from '../../../upstream/reborn/src/search.ts'
import { lintTemplate, type UsageReport } from '../../../upstream/reborn/src/usage.ts'
import type { KbComponent, KbDesignLint, KbDesignPattern, KbDesignSignal, KbDesignTrait, KbIndexEntry } from '../../../upstream/reborn/src/kb.ts'

export type { DesignMatchResult, DesignNodeInput, ResolvedUsage, UsageReport }
export type DesignNodeMatch = DesignMatchResult['matches'][number]

/** 工作室用到的知识库能力。 */
export interface Knowledge {
  /** 把一批设计节点（实例名、变体、结构信号、稿面样式）落到组件，与 MCP 的 match_design_nodes 同一实现。 */
  match(nodes: DesignNodeInput[]): DesignMatchResult
  /** 按特征表把稿面样式解析成某个组件的取值（size / shape / variant 与 ui 补充）。 */
  usage(component: string, node: DesignNodeInput): ResolvedUsage | undefined
  /** 模板用法检查，与 MCP 的 check_usage 同一实现。 */
  lint(source: string): UsageReport
  /** 知识库里是否有结构信号规则；没有时结构信号只进提示，不参与判定。 */
  hasSignals: boolean
  /** 知识库里是否有模板用法规则与 ui 键位资料。 */
  hasLint: boolean
}

/**
 * 读取一个知识库目录（含 index.json 与 components/）。
 * @returns 索引读不到、解析失败或没有配方表时返回 undefined。
 */
export async function loadKnowledge(dir: string): Promise<Knowledge | undefined> {
  let raw: unknown
  try { raw = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) }
  catch (error) { return undefined }
  const index = raw as { components?: KbIndexEntry[]; designPatterns?: KbDesignPattern[]; designSignals?: KbDesignSignal[]; designTraits?: KbDesignTrait[]; designLint?: KbDesignLint[] }
  const entries = Array.isArray(index.components) ? index.components : []
  const patterns = Array.isArray(index.designPatterns) ? index.designPatterns : []
  if (!entries.length || !patterns.length) return undefined
  const signals = Array.isArray(index.designSignals) ? index.designSignals : []
  const traits = Array.isArray(index.designTraits) ? index.designTraits : []
  const lint = Array.isArray(index.designLint) ? index.designLint : []
  // 组件条目按需读取并缓存；判定函数是同步的，这里用同步读取（单个文件几十 KB）。
  const cache = new Map<string, KbComponent | null>()
  const get = (id: string): KbComponent | null => {
    if (cache.has(id)) return cache.get(id)!
    let component: KbComponent | null = null
    if (/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) {
      const file = join(dir, 'components', id + '.json')
      try { if (existsSync(file)) component = JSON.parse(readFileSync(file, 'utf8')) as KbComponent }
      catch (error) { component = null }
    }
    cache.set(id, component)
    return component
  }
  const traitOf = new Map(traits.map(trait => [trait.component, trait]))
  return {
    match: nodes => matchDesignNodes(patterns, entries, nodes, { platform: 'web', getComponent: get, signals, traits }),
    usage: (component, node) => resolveUsage(traitOf.get(component), node),
    lint: source => lintTemplate(source, { list: () => entries, get, designLint: () => lint }, { platform: 'web' }),
    hasSignals: signals.length > 0,
    hasLint: true,
  }
}
