import type { KbComponent, KbDesignLint, KbIndexEntry } from "./kb.js";

/**
 * 模板用法检查：对一段 Vue 模板（或整份 SFC）里的 Reborn 组件标签做静态核对。
 *
 * 只查能从知识库里确定的三类问题，不做风格判断：
 * 1. ui 对象里写了组件没有的键——这类键不会报错，只是静默无效，样式改了等于没改；
 * 2. 写死的枚举取值不在组件的可选值里（variant="ghost"）；
 * 3. 知识库登记的绕行写法（design-patterns.json 的 lint）：组件有现成的变体或另有专门组件，
 *    模板却用 ui 覆盖、手写状态硬拼出来（去掉外框再另画一条底线、按钮 + aria-expanded 充当折叠面板）。
 *
 * 绑定到变量、运行时才知道的取值不猜；解析不了就跳过，宁可漏报也不误报。
 */

export interface UsageFinding {
  /** 组件 id（子组件归到所属主组件，如 RebornMenuItem → reborn-menu） */
  component: string;
  /** 模板里实际写的标签名 */
  tag: string;
  /** 标签所在行（从 1 起，按传入文本计） */
  line: number;
  level: "error" | "warn";
  /** 规则：ui-key / prop-value，或知识库 lint 规则的 id */
  rule: string;
  message: string;
}

export interface UsageReport {
  /** 检查过的 Reborn 标签数 */
  checked: number;
  findings: UsageFinding[];
}

/** 检查用到的知识库读取能力（KnowledgeBase 满足它；设计工作室可以按知识库目录自行实现） */
export interface UsageKnowledge {
  list: () => KbIndexEntry[];
  get: (id: string) => KbComponent | null;
  designLint: () => KbDesignLint[];
}

interface TagAttr {
  /** 属性名，已去掉 : / v-bind: 前缀，保留原始连字符写法 */
  name: string;
  /** 是否绑定写法（:name / v-bind:name） */
  bound: boolean;
  /** 等号后的原文（不含引号）；没有等号时为 undefined */
  value?: string;
}

interface TagUse {
  tag: string;
  offset: number;
  attrs: TagAttr[];
}

/** 把注释替换成等长空白：位置与行号不变，注释里的标签不参与检查 */
function blankComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, (text) => text.replace(/[^\n]/g, " "));
}

/** 从 open 处的括号找到配对的闭括号，跳过字符串；找不到返回 -1 */
function closing(source: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{" || char === "[" || char === "(") depth++;
    else if (char === "}" || char === "]" || char === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 对象字面量的顶层键与字符串取值；取值不是字符串字面量的键只记键名 */
export function objectLiteralEntries(literal: string): Map<string, string | undefined> {
  const entries = new Map<string, string | undefined>();
  const open = literal.indexOf("{");
  const close = open < 0 ? -1 : closing(literal, open);
  if (open < 0 || close < 0) return entries;
  const body = literal.slice(open + 1, close);
  let depth = 0;
  let quote = "";
  let start = 0;
  const push = (piece: string) => {
    const match = /^\s*(?:"([^"]*)"|'([^']*)'|([A-Z_$][\w$]*))\s*:/i.exec(piece);
    if (!match) {
      // 简写属性 { root } 也算写了这个键
      const shorthand = /^\s*([A-Z_$][\w$]*)\s*$/i.exec(piece);
      if (shorthand) entries.set(shorthand[1], undefined);
      return;
    }
    const value = piece.slice(match[0].length).trim();
    const text = /^(["'`])([\s\S]*)\1$/.exec(value);
    entries.set(match[1] ?? match[2] ?? match[3], text && !text[2].includes("${") ? text[2] : undefined);
  };
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{" || char === "[" || char === "(") depth++;
    else if (char === "}" || char === "]" || char === ")") depth--;
    else if (char === "," && depth === 0) {
      push(body.slice(start, i));
      start = i + 1;
    }
  }
  push(body.slice(start));
  return entries;
}

/**
 * 逐个读出标签上的属性。按「名字 [= 引号值]」顺序走，而不是用正则在整段里找：
 * 事件与插槽表达式（@click="open = !open"、#trailing="{ ui }"）的引号里常有形似属性名的词，
 * 整段匹配会把它们误认成属性。事件（@ / v-on:）、插槽（# / v-slot）与指令不是 props，读完即丢。
 */
function parseAttrs(text: string): TagAttr[] {
  const attrs: TagAttr[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /[\s/]/.test(text[i])) i++;
    const start = i;
    while (i < text.length && !/[\s=/]/.test(text[i])) i++;
    const raw = text.slice(start, i);
    if (!raw) {
      i++;
      continue;
    }
    let value: string | undefined;
    let next = i;
    while (next < text.length && /\s/.test(text[next])) next++;
    if (text[next] === "=") {
      next++;
      while (next < text.length && /\s/.test(text[next])) next++;
      const quote = text[next];
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, next + 1);
        value = text.slice(next + 1, close < 0 ? text.length : close);
        i = close < 0 ? text.length : close + 1;
      } else {
        const from = next;
        while (next < text.length && !/\s/.test(text[next])) next++;
        value = text.slice(from, next);
        i = next;
      }
    }
    const bound = raw.startsWith(":") || raw.startsWith("v-bind:");
    const name = raw.replace(/^(?::|v-bind:)/, "");
    if (/^[A-Z_][\w.-]*$/i.test(name) && !name.startsWith("v-")) attrs.push({ name, bound, value });
  }
  return attrs;
}

/** 扫描模板里的 Reborn 标签及其属性；引号内的 > 不会截断标签 */
function scanTags(template: string): TagUse[] {
  const uses: TagUse[] = [];
  for (const match of template.matchAll(/<(Reborn[A-Z][A-Za-z0-9]*|reborn-[a-z][a-z0-9-]*)(?=[\s/>])/g)) {
    const from = match.index + match[0].length;
    let end = from;
    let quote = "";
    while (end < template.length) {
      const char = template[end];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
      end++;
    }
    uses.push({ tag: match[1], offset: match.index, attrs: parseAttrs(template.slice(from, end)) });
  }
  return uses;
}

const camel = (name: string): string => name.replace(/-([a-z])/g, (_m, letter: string) => letter.toUpperCase());
const kebab = (name: string): string => name.replace(/[A-Z]/g, (letter, index: number) => (index ? "-" : "") + letter.toLowerCase());
const pascal = (id: string): string => id.replace(/(^|-)([a-z0-9])/g, (_m, _s, letter: string) => letter.toUpperCase());

/**
 * 从 ui prop 的说明里取出可用键：「可用键（从源码抽取，以此为准）——Web：a、b*。UniApp：c。」，
 * 一个目录导出多个带 ui 的组件时是「Web：RebornMenu → menu、root；RebornMenuItem → menuItem」。
 * 主组件的 ui 会下发给子组件，所以这里取该平台下全部组件的并集；取不到任何键时返回空集（跳过检查）。
 */
export function uiKeysOf(component: KbComponent, platform: "web" | "uniapp"): Set<string> {
  const keys = new Set<string>();
  const label = platform === "web" ? "Web" : "UniApp";
  for (const prop of component.props ?? []) {
    if (prop.name !== "ui" || (prop.platform && prop.platform !== platform)) continue;
    const text = prop.description ?? "";
    const from = text.indexOf("可用键");
    if (from < 0) continue;
    for (const section of text.slice(from).matchAll(/(Web|UniApp|两端)：([^。]*)。/g)) {
      if (section[1] !== "两端" && section[1] !== label) continue;
      for (const part of section[2].split("；")) {
        const list = part.includes("→") ? part.slice(part.indexOf("→") + 1) : part;
        for (const key of list.split("、")) {
          const name = key.trim().replace(/\*$/, "");
          if (/^[A-Z]\w*$/i.test(name)) keys.add(name);
        }
      }
    }
  }
  return keys;
}

/**
 * 检查一段模板或整份 SFC。
 * @param source 模板片段或 .vue 全文；全文时只看 <template>，并到 <script> 里解析 :ui 绑定的对象常量
 */
export function lintTemplate(source: string, kb: UsageKnowledge, options: { platform?: "web" | "uniapp" } = {}): UsageReport {
  const platform = options.platform ?? "web";
  const sfc = /<template(?:\s[^>]*)?>/.exec(source);
  const templateEnd = sfc ? source.lastIndexOf("</template>") : -1;
  const templateStart = sfc && templateEnd > sfc.index ? sfc.index + sfc[0].length : 0;
  const template = blankComments(templateStart ? source.slice(templateStart, templateEnd) : source);
  const script = templateStart ? source.slice(0, sfc!.index) + source.slice(templateEnd) : "";
  const lineOf = (offset: number): number => source.slice(0, templateStart + offset).split("\n").length;

  // 标签 → 组件：先按 id，再按源码文件名找子组件所属的主组件（RebornTabPane → reborn-tabs）
  const entries = kb.list();
  const ids = new Set(entries.map((entry) => entry.id));
  let owners: Map<string, string> | undefined;
  const componentOf = (tag: string): KbComponent | null => {
    const id = tag.startsWith("reborn-") ? tag : kebab(tag);
    if (ids.has(id)) return kb.get(id);
    if (!owners) {
      owners = new Map();
      for (const entry of entries) {
        if (!entry.id.startsWith("reborn-")) continue;
        const refs = kb.get(entry.id)?.sourceRefs;
        for (const ref of [...(refs?.web ?? []), ...(refs?.uniapp ?? [])]) {
          const file = ref.split(/[\\/]/).pop() ?? "";
          if (file.endsWith(".vue")) owners.set(file.slice(0, -4), entry.id);
        }
      }
    }
    const owner = owners.get(tag.startsWith("reborn-") ? pascal(tag) : tag);
    return owner ? kb.get(owner) : null;
  };

  /** :ui 的对象内容：行内字面量，或脚本里同名的 const 对象常量；其余写法（computed、函数调用）不解析 */
  const uiEntries = (attr: TagAttr | undefined): Map<string, string | undefined> | null => {
    if (!attr?.bound || !attr.value) return null;
    const value = attr.value.trim();
    if (value.startsWith("{")) return objectLiteralEntries(value);
    if (!/^[A-Z_$][\w$]*$/i.test(value)) return null;
    const declared = new RegExp(`\\bconst\\s+${value.replace(/\$/g, "\\$")}\\s*(?::[^=]+)?=\\s*\\{`).exec(script);
    return declared ? objectLiteralEntries(script.slice(declared.index + declared[0].length - 1)) : null;
  };

  /** 属性的静态取值：非绑定写法的原文，或绑定值是字符串字面量；其余返回 undefined */
  const staticValue = (attr: TagAttr | undefined): string | undefined => {
    if (!attr || attr.value === undefined) return undefined;
    if (!attr.bound) return attr.value;
    const literal = /^\s*(?:'([^']*)'|"([^"]*)")\s*$/.exec(attr.value);
    return literal ? literal[1] ?? literal[2] : undefined;
  };

  const rules = kb.designLint();
  const findings: UsageFinding[] = [];
  const tags = scanTags(template);
  for (const use of tags) {
    const component = componentOf(use.tag);
    if (!component) continue;
    const isMain = (use.tag.startsWith("reborn-") ? use.tag : kebab(use.tag)) === component.id;
    const report = (level: UsageFinding["level"], rule: string, message: string) =>
      findings.push({ component: component.id, tag: use.tag, line: lineOf(use.offset), level, rule, message });
    const attr = (name: string) => use.attrs.find((item) => camel(item.name) === camel(name));

    // 1. ui 键必须是源码实际消费的键
    const ui = uiEntries(attr("ui"));
    const allowed = uiKeysOf(component, platform);
    if (ui && allowed.size) {
      const unknown = [...ui.keys()].filter((key) => !allowed.has(key));
      if (unknown.length) {
        report("error", "ui-key", `<${use.tag}> 的 ui 没有键 ${unknown.map((key) => `「${key}」`).join("、")}：这些键不会报错，只是静默无效。${platform === "web" ? "Web" : "UniApp"} 端可用键：${[...allowed].sort().join("、")}`);
      }
    }

    // 2. 写死的枚举取值（只查主组件：子组件的 props 不在主组件的知识条目里）
    if (isMain) {
      for (const item of use.attrs) {
        const value = staticValue(item);
        if (value === undefined) continue;
        const candidates = (component.props ?? []).filter((prop) => prop.name === camel(item.name) && (!prop.platform || prop.platform === platform));
        const options = candidates.find((prop) => prop.options?.length)?.options;
        if (options && !options.includes(value)) {
          report("error", "prop-value", `<${use.tag}> 的 ${item.name}="${value}" 不在可选值里（${options.join(" / ")}）`);
        }
      }
    }

    // 3. 知识库登记的绕行写法
    for (const rule of rules) {
      if (rule.component !== component.id || !isMain) continue;
      const when = rule.when;
      if (when.attr && !attr(when.attr)) continue;
      if (when.prop) {
        const value = staticValue(attr(when.prop.name));
        if (when.prop.in && (value === undefined || !when.prop.in.includes(value))) continue;
        // 绑定到变量的取值无从判断，不能当成「没写这个值」来报
        if (when.prop.notIn && (attr(when.prop.name) && value === undefined || (value !== undefined && when.prop.notIn.includes(value)))) continue;
      }
      if (when.classAll?.length) {
        if (!ui) continue;
        const text = when.uiKey ? ui.get(when.uiKey) ?? "" : [...ui.values()].filter(Boolean).join(" ");
        if (!text || !when.classAll.every((pattern) => new RegExp(pattern, "i").test(text))) continue;
      }
      report(rule.level, rule.id, rule.message);
    }
  }
  return { checked: tags.length, findings };
}
