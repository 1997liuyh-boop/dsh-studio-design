import type { KbComponent, KbDesignPattern, KbIndexEntry } from "./kb.js";

/**
 * 组件加权检索：id 精确 > title 精确 > 别名精确 > id 包含 > title 包含 > 别名包含 > tags > description。
 *
 * 查询词按空白切分后逐词累加得分，全部词都未命中的组件被过滤。
 * 别名（aliases）是人工维护的同义词：同一外观在 Element / Ant / MUI 里的叫法、中英文同义词、
 * UI 稿上的样子（"红点""胶囊标签"）。中文查询常常不分词（"状态标签"），所以别名匹配是双向包含：
 * 别名含查询词，或查询词含别名（别名至少 2 个字符，防止"点""框"这类单字把全库都命中）。
 */
export function searchComponents(
  entries: KbIndexEntry[],
  query: string,
): Array<KbIndexEntry & { score: number }> {
  const phrase = query.trim().toLowerCase();
  const terms = phrase.split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  // 多词查询（"toggle group""radio button"）还要整句对别名匹配一次：
  // 拆成单词后 toggle 会落到 Switch、button 会落到 Button，整句命中才把它拉回正确的组件
  const multiWord = terms.length > 1;

  const scored: Array<KbIndexEntry & { score: number }> = [];
  for (const e of entries) {
    const id = e.id.toLowerCase();
    const title = (e.title ?? "").toLowerCase();
    const aliases = (e.aliases ?? []).map((a) => a.toLowerCase());
    const tags = (e.tags ?? []).map((t) => t.toLowerCase());
    const description = (e.description ?? "").toLowerCase();

    // 整句原样命中一条多词别名（"floating action button"）比单词各自命中可信得多，给 100：
    // 否则 button 一个词就能让 Button 靠 id / title / tag / 别名叠分压过 Fab
    let score = multiWord ? aliasScore(aliases, phrase, 100) : 0;
    for (const term of terms) {
      if (id === term) score += 100;
      else if (id.includes(term)) score += 40;
      if (title === term) score += 60;
      else if (title.includes(term)) score += 30;
      score += aliasScore(aliases, term);
      if (tags.includes(term)) score += 20;
      else if (tags.some((t) => t.includes(term))) score += 10;
      if (description.includes(term)) score += 8;
    }
    if (score > 0) scored.push({ ...e, score });
  }

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * 一个查询词对一组别名的得分：取最高的一条，不累加（多条别名都沾边不代表更相关）。
 * 别名精确命中给 70，要高于「title 包含 30 + 别名包含 30」：
 * 搜「标签」时 Badge（别名就是「标签」）要压过 Tabs（title「标签页」与别名「标签页」都只是包含）。
 */
function aliasScore(aliases: string[], term: string, exact = 70): number {
  let best = 0;
  for (const alias of aliases) {
    if (alias === term) return exact;
    if (alias.includes(term)) best = Math.max(best, 30);
    else if (alias.length >= 2 && term.includes(alias)) best = Math.max(best, 25);
  }
  return best;
}

// ===== 设计稿节点 → 组件映射 =====

/** 一个设计稿节点：MasterGo / Figma 的实例名、变体值、直接子节点名 */
export interface DesignNodeInput {
  name: string;
  /** 变体属性（{"属性 1": "已选", "已登录": true}）或一段状态文字；只匹配值，不匹配属性名 */
  variant?: Record<string, string | number | boolean> | string;
  /** 直接子节点名，只在节点名本身没有命中任何规则时才参与匹配 */
  children?: string[];
  /** 所属区块；同一区块里的图廊、主图、箭头会被合并提示 */
  group?: string;
  /** 同名实例个数；缺省按本次输入里同名同区块的节点数统计 */
  count?: number;
  /**
   * 节点的填充是图片（位图 / image fill）。设计稿里的图片图层多半是自动命名的「矩形 58848」「容器 129436」，
   * 名字匹配不到图片规则，会被当成排版容器；标了 image 时，名字没命中组件规则（或只命中容器类规则）就按图片处理。
   */
  fill?: "image";
}

export type DesignMatchStatus = "pattern" | "search" | "ignore" | "custom" | "unmapped";

export interface DesignNodeMatch {
  name: string;
  group?: string;
  count: number;
  status: DesignMatchStatus;
  component: string | null;
  with: string[];
  patternId?: string;
  pattern?: string;
  confidence?: "high" | "low";
  recipe?: string;
  uses?: KbDesignPattern["uses"];
  pitfalls?: string[];
  /** 与主组件不同名的子组件文件（RebornTabPane），Nuxt 自动导入会改名，须显式 import */
  subcomponents?: string[];
  imports?: string[];
  alternatives?: Array<{ id: string; title?: string; score: number }>;
  /** 同区块同名实例的变体在「选中 / 未选中」间切换：整组是一个选择类组件，候选见 alternatives */
  selectionGroup?: boolean;
  note?: string;
}

export interface DesignMatchResult {
  matches: DesignNodeMatch[];
  summary: {
    total: number;
    byStatus: Record<DesignMatchStatus, number>;
    unmapped: string[];
  };
  hints: string[];
}

/** 把 match 里的一项编译成判断函数：/.../flags 为正则（默认不分大小写），其余为子串 */
export function compileMatcher(term: string): (text: string) => boolean {
  const regex = /^\/(.+)\/([a-z]*)$/.exec(term);
  if (regex) {
    const flags = regex[2].includes("i") ? regex[2] : `${regex[2]}i`;
    const re = new RegExp(regex[1], flags);
    return (text) => re.test(text);
  }
  const needle = term.toLowerCase();
  return (text) => text.includes(needle);
}

/** 从组件源码文件清单推导子组件名：目录里与主组件不同名的 .vue 文件（RebornTabPane、RebornStep） */
export function subcomponentsOf(component: KbComponent | null | undefined, platform: "web" | "uniapp" = "web"): string[] {
  if (!component) return [];
  const main = component.id.replace(/(^|-)([a-z0-9])/g, (_m, _s, c: string) => c.toUpperCase());
  const refs = component.sourceRefs?.[platform] ?? component.sourceRefs?.web ?? [];
  const names = new Set<string>();
  for (const ref of refs) {
    const file = ref.split(/[\\/]/).pop() ?? "";
    if (!file.endsWith(".vue")) continue;
    const name = file.slice(0, -4);
    if (name !== main && /^[A-Z]/.test(name)) names.add(name);
  }
  return [...names].sort();
}

const ARROW_LIKE = /箭头|箭頭|arrow|chevron|prev|next|翻页|翻頁/i;

/** 变体值里表示「当前选中」与「未选中」的说法；两类同时出现在同名实例上，才算一组互斥选择 */
const SELECTED_VALUE = /^(?:已?[选選]中?|激活|当前|當前|高亮|active|selected|current|checked|on)$/i;
const UNSELECTED_VALUE = /^(?:未[选選]中?|未激活|默认|默認|常规|常規|正常|inactive|unselected|default|normal|off)$/i;

/** 互斥选择组的候选组件，按稿面排布挑一个 */
const SELECTION_GROUP_CANDIDATES: Array<{ id: string; when: string }> = [
  { id: "reborn-menu", when: "纵向列表、侧栏分类、带下级的导航" },
  { id: "reborn-tabs", when: "一排页签 + 下方随之切换的内容面板" },
  { id: "reborn-segmented", when: "一条里滑动切换的短控件" },
  { id: "reborn-radio", when: "表单里从几个选项中取一个值" },
];

/**
 * 把一批设计稿节点落到组件：先按配方表（具体规则在前）匹配节点名与变体值，
 * 没命中再用子节点名试一次，仍没命中退回别名检索，最后标为 unmapped。
 * 图廊、主图、箭头这组关系在节点级别看不出来，命中图廊规则后再做一次整体提示。
 */
export function matchDesignNodes(
  patterns: KbDesignPattern[],
  entries: KbIndexEntry[],
  nodes: DesignNodeInput[],
  options: { platform?: "web" | "uniapp"; getComponent?: (id: string) => KbComponent | null } = {},
): DesignMatchResult {
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const compiled = patterns.map((p) => ({ pattern: p, tests: p.match.map(compileMatcher) }));

  // 同名同区块的实例数：缩略图 ×7、问题 ×5 这类规则要看数量
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const key = `${node.group ?? ""}\u0000${node.name.trim().toLowerCase()}`;
    counts.set(key, (counts.get(key) ?? 0) + (node.count ?? 1));
  }

  const ownTextOf = (node: DesignNodeInput): string => {
    // MasterGo 的变体值可能是布尔（已登录: true）或数字，统一转成文字参与匹配
    const variantValues =
      typeof node.variant === "string" ? [node.variant] : Object.values(node.variant ?? {}).map(String);
    return [node.name.trim(), ...variantValues].join(" ").toLowerCase();
  };

  // minCount 看的是同一区块里命中这条规则的节点数（三条不同的问句才构成问答列表），
  // 不是同名节点数；按规则 × 区块惰性统计一次
  const hitCounts = new Map<string, number>();
  const hitCountFor = (patternIndex: number, group: string | undefined): number => {
    const key = `${patternIndex}\u0000${group ?? ""}`;
    const cached = hitCounts.get(key);
    if (cached !== undefined) return cached;
    const tests = compiled[patternIndex].tests;
    let total = 0;
    for (const other of nodes) {
      if ((other.group ?? "") !== (group ?? "")) continue;
      if (tests.some((test) => test(ownTextOf(other)))) total += other.count ?? 1;
    }
    hitCounts.set(key, total);
    return total;
  };

  const findPattern = (text: string, group: string | undefined, skipIgnore: boolean): KbDesignPattern | null => {
    for (let i = 0; i < compiled.length; i++) {
      const { pattern, tests } = compiled[i];
      // 子节点兜底时不认 ignore 规则：容器里有个图标不代表容器本身是图标
      if (skipIgnore && pattern.ignore) continue;
      if (!tests.some((test) => test(text))) continue;
      if (pattern.minCount && hitCountFor(i, group) < pattern.minCount) continue;
      return pattern;
    }
    return null;
  };

  const matches: DesignNodeMatch[] = [];
  for (const node of nodes) {
    const name = node.name.trim();
    const count = counts.get(`${node.group ?? ""}\u0000${name.toLowerCase()}`) ?? 1;
    const own = findPattern(ownTextOf(node), node.group, false);
    // 节点名没命中，或命中的是「排版容器」这类自身不是组件的规则时，再看它装着什么
    const byChildren =
      (!own || own.container) && node.children?.length
        ? findPattern(node.children.join(" ").toLowerCase(), node.group, true)
        : null;
    // 图片填充优先于「排版容器」：自动命名的图片图层、带叠加内容（点赞胶囊、来源图标）的图片框都是一张图
    const imagePattern =
      node.fill === "image" && (!own || own.container || own.ignore) ? patterns.find((p) => p.id === "image") ?? null : null;
    const pattern = imagePattern ?? byChildren ?? own;

    const base: DesignNodeMatch = { name, group: node.group, count, status: "unmapped", component: null, with: [] };

    if (pattern) {
      const match: DesignNodeMatch = {
        ...base,
        patternId: pattern.id,
        pattern: pattern.pattern,
        confidence: pattern.confidence,
        recipe: pattern.recipe,
        pitfalls: pattern.pitfalls,
      };
      if (pattern.ignore || !pattern.component) {
        match.status = pattern.ignore ? "ignore" : "custom";
        matches.push(match);
        continue;
      }
      const entry = entryById.get(pattern.component);
      if (options.platform && entry?.platforms && !entry.platforms.includes(options.platform)) {
        // 规则命中了，但组件在目标端不存在：不能把 web 组件塞给 uniapp 项目
        const alternatives = searchComponents(entries, name)
          .filter((h) => h.id !== pattern.component && h.platforms?.includes(options.platform!))
          .slice(0, 3)
          .map(({ id, title, score }) => ({ id, title, score }));
        matches.push({
          ...match,
          status: "unmapped",
          note: `${pattern.component} 仅 ${entry.platforms.join(" / ")} 端可用，${options.platform} 端没有这个组件`,
          alternatives,
        });
        continue;
      }
      match.status = "pattern";
      match.component = pattern.component;
      match.with = pattern.with ?? [];
      match.uses = pattern.uses;
      const subcomponents = subcomponentsOf(options.getComponent?.(pattern.component), options.platform);
      if (subcomponents.length) {
        match.subcomponents = subcomponents;
        match.imports = [
          ...(pattern.imports ?? []),
          `${subcomponents.join(" / ")} 是与主组件不同名的子组件文件：Nuxt 自动导入在 pathPrefix: true（默认）下会给它加上目录前缀，模板里按文件名写会解析不到；显式 import ${subcomponents[0]} from '<componentsDir>/${pattern.component}/${subcomponents[0]}.vue'，或把该目录的 components 配置改成 pathPrefix: false`,
        ];
      } else if (pattern.imports?.length) {
        match.imports = pattern.imports;
      }
      matches.push(match);
      continue;
    }

    // 配方表没覆盖：退回别名检索，给出候选但不下结论
    let hits = searchComponents(entries, name);
    if (options.platform) hits = hits.filter((h) => h.platforms?.includes(options.platform!));
    const alternatives = hits.slice(0, 3).map(({ id, title, score }) => ({ id, title, score }));
    // 只有节点名整个等于某组件的 id / 名称 / 别名才值得当候选报出来；
    // 「顶部」沾到「返回顶部」这种包含关系叠分也能过 60，但按它去选组件就是错的
    const exact = (entry: KbIndexEntry | undefined): boolean => {
      if (!entry) return false;
      const key = name.toLowerCase();
      return entry.id.toLowerCase() === key
        || (entry.title ?? "").toLowerCase() === key
        || (entry.aliases ?? []).some((alias) => alias.toLowerCase() === key);
    };
    if (alternatives.length && exact(entryById.get(alternatives[0].id))) {
      matches.push({
        ...base,
        status: "search",
        component: alternatives[0].id,
        alternatives,
        note: "配方表没有覆盖这个节点名，按别名检索给出候选；用 get_component 核对 whenToUse / whenNotToUse 后再定，不确定就按稿面自写并在清单里说明",
      });
    } else {
      matches.push({
        ...base,
        status: "unmapped",
        alternatives,
        note: "没有对应组件：纯文字、排版容器直接用 Tailwind 自写；若它其实是某个组件，把节点名补进 knowledge/design-patterns.json 的 match",
      });
    }
  }

  // 整体提示：图廊 = 主图 + 缩略图 + 箭头，节点各自命中的规则拼不出这个整体
  const hints: string[] = [];
  const galleryGroups = new Set(matches.filter((m) => m.patternId === "product-gallery").map((m) => m.group ?? ""));
  if (galleryGroups.size) {
    const sameGroup = (m: DesignNodeMatch) => galleryGroups.has(m.group ?? "") || galleryGroups.has("");
    for (const m of matches) {
      if (m.patternId === "image" && sameGroup(m)) {
        m.note = "与「缩略图」同属一个图廊：这张主图不是独立的 reborn-image，而是 reborn-carousel 默认插槽里的一张 slide";
      }
      if (m.status === "ignore" && m.patternId === "icon" && ARROW_LIKE.test(m.name) && sameGroup(m)) {
        m.note = "图廊两侧的翻页箭头：放进 reborn-carousel 的 #prev / #next 插槽，按钮加 pointer-events-auto，素材仍用导出的原始 SVG";
      }
    }
    hints.push(
      "检测到商品图廊（缩略图 + 主图 + 箭头）：整组用一个 reborn-carousel（thumbs 联动缩略图，#prev / #next 放箭头），不要把缩略图做成一列 RebornButton + img",
    );
  }
  // 整体提示：同一区块里多个同名实例、变体在「选中 / 未选中」之间切换 = 一组互斥选择。
  // 设计师给这类实例起的名字五花八门（分類列表、筛选项、左侧栏目），配方表按名字认不全；
  // 名字没命中时靠结构兜底，否则 AI 会把它们当成九个互不相干的链接逐个手写。
  const selectionGroups = new Map<string, { names: Set<string>; selected: boolean; unselected: boolean; indexes: number[] }>();
  nodes.forEach((node, i) => {
    const match = matches[i];
    if (match.status === "pattern" || match.status === "ignore") return;
    const values = typeof node.variant === "string" ? [node.variant] : Object.values(node.variant ?? {}).map(String);
    const selected = values.some((value) => SELECTED_VALUE.test(value.trim()));
    const unselected = values.some((value) => UNSELECTED_VALUE.test(value.trim()));
    if (!selected && !unselected) return;
    const key = `${node.group ?? ""}\u0000${node.name.trim().toLowerCase()}`;
    const entry = selectionGroups.get(key) ?? { names: new Set<string>(), selected: false, unselected: false, indexes: [] };
    entry.names.add(node.name.trim());
    entry.selected ||= selected;
    entry.unselected ||= unselected;
    entry.indexes.push(i);
    selectionGroups.set(key, entry);
  });
  for (const entry of selectionGroups.values()) {
    // 至少两个实例且两种状态都出现过：单个带「正常」变体的按钮不是选择组
    if (entry.indexes.length < 2 || !entry.selected || !entry.unselected) continue;
    const candidates = SELECTION_GROUP_CANDIDATES.filter(({ id }) => {
      const candidate = entryById.get(id);
      return candidate && (!options.platform || candidate.platforms?.includes(options.platform));
    });
    if (!candidates.length) continue;
    const choices = candidates.map(({ id, when }) => `${when} → ${id}`).join("；");
    const name = [...entry.names][0];
    for (const index of entry.indexes) {
      const match = matches[index];
      match.selectionGroup = true;
      match.alternatives = candidates.map(({ id }) => ({ id, title: entryById.get(id)?.title, score: 0 }));
      match.note = `同一区块里 ${entry.indexes.length} 个同名实例、变体在 选中 / 未选中 之间切换，是一组互斥选择而不是 ${entry.indexes.length} 个独立元素：${choices}。按稿面排布选定后用 get_component 核对，选中态交给组件的 v-model，不要逐项手写 a / li / button 再自己切样式`;
    }
    hints.push(
      `检测到互斥选择组「${name}」×${entry.indexes.length}（变体 选中 / 未选中）：整组用一个选择类组件实现（${choices}），并把「${name}」补进 knowledge/design-patterns.json 对应规则的 match，下次按名字直接命中`,
    );
  }

  const subcomponentNotes = new Set(matches.flatMap((m) => m.subcomponents ?? []));
  if (subcomponentNotes.size) {
    hints.push(`用到子组件 ${[...subcomponentNotes].join("、")}：显式 import 或把 components 配置改成 pathPrefix: false，否则 Nuxt 自动导入的名字带目录前缀`);
  }

  const byStatus: Record<DesignMatchStatus, number> = { pattern: 0, search: 0, ignore: 0, custom: 0, unmapped: 0 };
  for (const m of matches) byStatus[m.status]++;
  return {
    matches,
    summary: {
      total: matches.length,
      byStatus,
      unmapped: [...new Set(matches.filter((m) => m.status === "unmapped").map((m) => m.name))],
    },
    hints,
  };
}
