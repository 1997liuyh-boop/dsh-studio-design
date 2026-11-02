import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// ===== 知识库数据类型（与 scripts/kb/schema.ts 生成的结构对应，此处只声明消费用字段） =====

export interface KbIndexEntry {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  platforms?: Array<"web" | "uniapp">;
}

export interface KbProp {
  name: string;
  type?: string;
  default?: string;
  required?: boolean;
  description?: string;
  options?: string[];
  /** 仅在两端同名 prop 签名不同、按平台并存两条时出现；缺省表示两端通用 */
  platform?: string;
}

export interface KbExample {
  title?: string;
  description?: string;
  /** 示例源码。仓库内的 demo 示例不内联源码，此处为空，需按 path 现读 */
  code?: string;
  /** 演示文件的仓库相对路径（POSIX 分隔符），仅 demo 示例有 */
  path?: string;
  source?: string;
  platform?: string;
}

export interface KbComponent extends KbIndexEntry {
  props?: KbProp[];
  events?: Array<{ name: string; payload?: string; description?: string }>;
  slots?: Array<{ name: string; props?: string; description?: string }>;
  exposes?: Array<{ name: string; type?: string; description?: string }>;
  examples?: KbExample[];
  related?: string[];
  whenToUse?: string[];
  whenNotToUse?: string[];
  pitfalls?: string[];
  dependencies?: string[];
  install?: { cli?: string };
  sourceRefs?: { web?: string[]; uniapp?: string[] };
  docPath?: string | null;
}

// ===== 知识库目录定位 =====

/**
 * 解析知识库目录，优先级：
 * 1. --kb-dir 命令行参数
 * 2. REBORN_KB_DIR 环境变量
 * 3. 向上查找 pnpm-workspace.yaml（monorepo 内开发场景）→ <root>/knowledge
 * 4. 包内快照（npm 发布产物，prepack 时拷贝）
 */
export function resolveKbDir(argv: string[] = process.argv.slice(2)): string {
  const flagIndex = argv.indexOf("--kb-dir");
  if (flagIndex !== -1 && argv[flagIndex + 1]) {
    const dir = path.resolve(argv[flagIndex + 1]);
    assertKbDir(dir, "--kb-dir 参数");
    return dir;
  }

  if (process.env.REBORN_KB_DIR) {
    const dir = path.resolve(process.env.REBORN_KB_DIR);
    assertKbDir(dir, "REBORN_KB_DIR 环境变量");
    return dir;
  }

  // monorepo 内：从当前文件向上找仓库根
  const here = path.dirname(fileURLToPath(import.meta.url));
  let current = here;
  for (;;) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      const dir = path.join(current, "knowledge");
      if (isKbDir(dir)) return dir;
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // 包内快照：dist/index.js 的上一级是包根
  const bundled = path.resolve(here, "..", "knowledge");
  if (isKbDir(bundled)) return bundled;
  const bundledFromSrc = path.resolve(here, "..", "..", "knowledge");
  if (isKbDir(bundledFromSrc)) return bundledFromSrc;

  throw new Error(
    "未找到知识库目录：请通过 --kb-dir 或 REBORN_KB_DIR 指定 knowledge/ 路径",
  );
}

function isKbDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, "index.json"));
}

function assertKbDir(dir: string, from: string): void {
  if (!isKbDir(dir)) {
    throw new Error(`${from} 指定的目录不是有效知识库（缺 index.json）：${dir}`);
  }
}

// ===== 数据读取（启动时读索引，组件详情按需读并缓存） =====

export class KnowledgeBase {
  private readonly dir: string;
  private readonly indexEntries: KbIndexEntry[];
  private readonly componentCache = new Map<string, KbComponent>();

  constructor(dir: string) {
    this.dir = dir;
    const raw = JSON.parse(
      fs.readFileSync(path.join(dir, "index.json"), "utf8"),
    );
    this.indexEntries = Array.isArray(raw) ? raw : raw.components;
  }

  /** 轻量索引全量列表 */
  list(): KbIndexEntry[] {
    return this.indexEntries;
  }

  /** 全部分类及其组件数 */
  categories(): Array<{ category: string; count: number }> {
    const counter = new Map<string, number>();
    for (const e of this.indexEntries) {
      const c = e.category ?? "uncategorized";
      counter.set(c, (counter.get(c) ?? 0) + 1);
    }
    return [...counter.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }

  /** 按 id 读取完整组件条目，不存在返回 null */
  get(id: string): KbComponent | null {
    const cached = this.componentCache.get(id);
    if (cached) return cached;
    const file = path.join(this.dir, "components", `${id}.json`);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as KbComponent;
    this.hydrateExamples(data);
    this.componentCache.set(id, data);
    return data;
  }

  /**
   * 补齐示例源码
   *
   * 知识库 JSON 里 demo 示例只存 path 不存 code（内联会让改一个 demo 就重写整份 JSON）。
   * npm 包内快照在 prepack 时已把 code 灌好，这里不会命中；
   * monorepo 内开发（知识库目录就在仓库里）才需要按 path 现读源文件。
   * 文件缺失时保持 code 为空，交由上层按「无示例」处理，不抛错。
   */
  private hydrateExamples(component: KbComponent): void {
    const repoRoot = path.resolve(this.dir, "..");
    for (const example of component.examples ?? []) {
      if (example.code || !example.path) continue;
      const abs = path.join(repoRoot, example.path);
      if (!fs.existsSync(abs)) continue;
      example.code = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
    }
  }
}
