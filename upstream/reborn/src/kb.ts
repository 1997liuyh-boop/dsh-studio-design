import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ===== 知识库数据类型（与 scripts/kb/schema.ts 生成的结构对应，此处只声明消费用字段） =====

export interface KbIndexEntry {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  platforms?: Array<"web" | "uniapp">;
  /** 检索别名：其它组件库的叫法、中英文同义词、UI 稿上的外观描述；只用于检索打分 */
  aliases?: string[];
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

/**
 * 设计稿节点 → 组件的配方（knowledge/design-patterns.json 经 kb:build 并入 index.json）。
 * match 为节点名 / 变体值 / 子节点名的匹配项：子串（不分大小写）或 /正则/i；按顺序取第一条命中。
 */
export interface KbDesignPattern {
  id: string;
  pattern: string;
  match: string[];
  component: string | null;
  with?: string[];
  ignore?: boolean;
  custom?: boolean;
  /** 排版容器：自身不是组件，传了 children 时改按子节点再匹配一次 */
  container?: boolean;
  confidence?: "high" | "low";
  minCount?: number;
  recipe?: string;
  imports?: string[];
  uses?: { props?: string[]; slots?: string[]; events?: string[]; ui?: string[] };
  pitfalls?: string[];
}

/**
 * 结构信号规则（design-patterns.json 的 signals，并入 index.json 的 designSignals）。
 *
 * 节点名是设计师随手起的（「左侧导航单元」「黄点提示」「按钮内容」），按名字认不全；
 * 结构信号由读取设计稿的一方（设计工作室）从几何与样式里算出来——只有底边一条线的输入、
 * 图标右上角压着一个数字、一列同款项里只有一个带底色——再按这张表落到组件。
 * 命中 confidence 不为 low 的信号规则时，它优先于按名字命中的规则。
 */
export interface KbDesignSignal {
  id: string;
  /** 信号名：underline-field / corner-badge / selection-list / accordion / select-trigger */
  signal: string;
  pattern: string;
  /** 进一步限定信号附带的事实（如 { orientation: "vertical" }），全部相等才命中 */
  when?: Record<string, string | number | boolean>;
  component: string;
  with?: string[];
  confidence?: "high" | "low";
  /** 低置信时一并给出的其它候选组件 */
  alternatives?: string[];
  /** 复用哪条名字规则（patterns 里的 id）的 recipe / uses / pitfalls / imports，自身的 recipe 排在前面 */
  use?: string;
  /** 必须出现在组件标签上的写法（variant="underlined"），调用方可据此做硬性核对 */
  requires?: string[];
  recipe?: string;
  imports?: string[];
  uses?: KbDesignPattern["uses"];
  pitfalls?: string[];
}

/** 稿面特征的判断条件：全部给出的键都满足才算命中 */
export interface KbTraitCondition {
  /** 描边位置：all 四边、bottom 只有底边、none 没有 */
  border?: "all" | "bottom" | "none";
  /** 有没有底色（透明不算） */
  background?: boolean;
  /** 外形：circle 宽高相等的正圆、pill 圆角不小于半高的胶囊、square 其余 */
  shape?: "circle" | "pill" | "square";
  /** 宽度的取值方式（自动布局）：hug 随内容、fixed 写死、fill 占满 */
  width?: "hug" | "fixed" | "fill";
  /** 自身文字：digits 纯数字（可带 +）、none 没有、any 有 */
  text?: "digits" | "none" | "any";
  /** 节点带有这个结构信号 */
  signal?: string;
}

/**
 * 稿面特征 → 组件取值（design-patterns.json 的 traits，并入 index.json 的 designTraits）。
 * 组件有现成的变体却被 ui 覆盖硬改出来，是还原里最常见的偏差；这张表把「看到什么」对应到「写什么」。
 */
export interface KbDesignTrait {
  component: string;
  /** Web 端 size 档位 → 高度（px） */
  sizes?: Record<string, number>;
  /** 档位只在满足条件时适用（角标的高度档位只对文字角标成立，圆点另算） */
  sizesWhen?: KbTraitCondition;
  /** 稿面高度不在档位时，用哪个 ui 键补 h-[…] */
  sizeKey?: string;
  rules?: Array<{
    id: string;
    when: KbTraitCondition;
    /** 要写的 props：true 为布尔属性；"$text" 取节点自身文字 */
    set: Record<string, string | boolean>;
    note?: string;
  }>;
}

/**
 * 模板用法规则（design-patterns.json 的 lint，并入 index.json 的 designLint）：
 * 组件有专门的变体或专门的组件，模板却用 ui 覆盖 / 手写状态绕了过去。
 */
export interface KbDesignLint {
  id: string;
  component: string;
  level: "error" | "warn";
  when: {
    /** 标签上有这个属性（静态或绑定都算），如 aria-expanded */
    attr?: string;
    /** 某个 prop 的静态取值在这些值里 */
    prop?: { name: string; in?: string[]; notIn?: string[] };
    /** 只看这个 ui 键的类名；缺省看全部 ui 键 */
    uiKey?: string;
    /** 类名里全部命中才算（正则源码，不分大小写） */
    classAll?: string[];
  };
  message: string;
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
  private readonly patterns: KbDesignPattern[];
  private readonly signals: KbDesignSignal[];
  private readonly traits: KbDesignTrait[];
  private readonly lint: KbDesignLint[];
  private readonly componentCache = new Map<string, KbComponent>();

  constructor(dir: string) {
    this.dir = dir;
    const raw = JSON.parse(
      fs.readFileSync(path.join(dir, "index.json"), "utf8"),
    );
    this.indexEntries = Array.isArray(raw) ? raw : raw.components;
    // 旧版索引没有配方表：工具退化为纯检索映射，不报错
    this.patterns = Array.isArray(raw?.designPatterns) ? raw.designPatterns : [];
    // 结构信号、特征取值与用法规则是后加的三张表，旧索引里没有时各自为空，相应能力不生效
    this.signals = Array.isArray(raw?.designSignals) ? raw.designSignals : [];
    this.traits = Array.isArray(raw?.designTraits) ? raw.designTraits : [];
    this.lint = Array.isArray(raw?.designLint) ? raw.designLint : [];
  }

  /** 轻量索引全量列表 */
  list(): KbIndexEntry[] {
    return this.indexEntries;
  }

  /** 设计稿配方表（索引里没有时为空数组） */
  designPatterns(): KbDesignPattern[] {
    return this.patterns;
  }

  /** 结构信号规则（索引里没有时为空数组） */
  designSignals(): KbDesignSignal[] {
    return this.signals;
  }

  /** 稿面特征 → 组件取值（索引里没有时为空数组） */
  designTraits(): KbDesignTrait[] {
    return this.traits;
  }

  /** 模板用法规则（索引里没有时为空数组） */
  designLint(): KbDesignLint[] {
    return this.lint;
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
