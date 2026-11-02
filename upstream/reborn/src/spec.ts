import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ===== 写作规范正文定位 =====
//
// 规范正文的唯一真源在仓库 docs/authoring/ 下，范本是各自的参考实现文件。
// 发布到 npm 时由 scripts/snapshot-spec.ts 拷进包内 spec/ 目录（扁平命名），
// 因此这里与 kb.ts:resolveKbDir() 同构：仓库内读真源，发布包读包内快照。

export type SpecKind = "doc" | "demo";

interface SpecSource {
  /** 人类可读名称，用于返回体与报错 */
  label: string;
  /** 规范正文在仓库内的相对路径 */
  repoSpec: string;
  /** 唯一参考范本在仓库内的相对路径 */
  repoTemplate: string;
  /** 发布包 spec/ 目录内的正文文件名 */
  packedSpec: string;
  /** 发布包 spec/ 目录内的范本文件名 */
  packedTemplate: string;
  /** 范本内容的语言标注，便于调用方按语言渲染 */
  templateLang: string;
}

/** 两类写作规范的源文件清单，snapshot-spec.ts 也消费这份配置 */
export const SPEC_SOURCES: Record<SpecKind, SpecSource> = {
  doc: {
    label: "组件文档写作规范",
    repoSpec: "docs/authoring/component-doc.md",
    repoTemplate: "content/2.components/button/reborn-button.md",
    packedSpec: "component-doc.md",
    packedTemplate: "template-component-doc.md",
    templateLang: "markdown",
  },
  demo: {
    label: "组件 Demo 写作规范",
    repoSpec: "docs/authoring/component-demo.md",
    repoTemplate: "app/components/reborn/examples/reborn-button/RebornButtonDemo.vue",
    packedSpec: "component-demo.md",
    packedTemplate: "template-component-demo.vue",
    templateLang: "vue",
  },
};

export const SPEC_KINDS = Object.keys(SPEC_SOURCES) as SpecKind[];

/** 规范文件的定位结果：仓库真源或包内快照 */
export interface SpecLocation {
  mode: "repo" | "packed";
  /** repo 模式为仓库根；packed 模式为包内 spec/ 目录 */
  dir: string;
}

/**
 * 解析规范目录，优先级：
 * 1. --spec-dir 命令行参数（指向快照目录，便于本地验证发布物）
 * 2. REBORN_SPEC_DIR 环境变量
 * 3. 向上查找 pnpm-workspace.yaml（monorepo 内开发场景）→ 仓库根
 * 4. 包内快照 spec/（npm 发布产物，prepack 时拷贝）
 */
export function resolveSpecLocation(argv: string[] = process.argv.slice(2)): SpecLocation {
  const flagIndex = argv.indexOf("--spec-dir");
  if (flagIndex !== -1 && argv[flagIndex + 1]) {
    const dir = path.resolve(argv[flagIndex + 1]!);
    assertPackedDir(dir, "--spec-dir 参数");
    return { mode: "packed", dir };
  }

  if (process.env.REBORN_SPEC_DIR) {
    const dir = path.resolve(process.env.REBORN_SPEC_DIR);
    assertPackedDir(dir, "REBORN_SPEC_DIR 环境变量");
    return { mode: "packed", dir };
  }

  // monorepo 内：从当前文件向上找仓库根
  const here = path.dirname(fileURLToPath(import.meta.url));
  let current = here;
  for (;;) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      if (isRepoRoot(current)) return { mode: "repo", dir: current };
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // 包内快照：dist/index.js 的上一级是包根，源码运行时上两级是包根
  for (const candidate of [
    path.resolve(here, "..", "spec"),
    path.resolve(here, "..", "..", "spec"),
  ]) {
    if (isPackedDir(candidate)) return { mode: "packed", dir: candidate };
  }

  throw new Error(
    "未找到写作规范正文：请通过 --spec-dir 或 REBORN_SPEC_DIR 指定 spec/ 快照目录，" +
      "或在仓库内运行（正文位于 docs/authoring/）。",
  );
}

function isRepoRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, SPEC_SOURCES.doc.repoSpec));
}

function isPackedDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, SPEC_SOURCES.doc.packedSpec));
}

function assertPackedDir(dir: string, from: string): void {
  if (!isPackedDir(dir)) {
    throw new Error(
      `${from} 指定的目录不是有效规范快照（缺 ${SPEC_SOURCES.doc.packedSpec}）：${dir}`,
    );
  }
}

// ===== 规范文件路径与读取 =====

/** 某一类规范的正文与范本在当前定位模式下的绝对路径 */
export function specPaths(kind: SpecKind, location: SpecLocation) {
  const source = SPEC_SOURCES[kind];
  if (location.mode === "repo") {
    return {
      spec: path.join(location.dir, source.repoSpec),
      template: path.join(location.dir, source.repoTemplate),
      specRef: source.repoSpec,
      templateRef: source.repoTemplate,
    };
  }
  return {
    spec: path.join(location.dir, source.packedSpec),
    template: path.join(location.dir, source.packedTemplate),
    specRef: source.repoSpec,
    templateRef: source.repoTemplate,
  };
}

/** 统一按 LF 读取，屏蔽检出时的换行差异 */
function readText(file: string): string {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

export interface SpecPayload {
  kind: SpecKind;
  label: string;
  /** 正文在仓库中的相对路径（无论从哪读到，都回报真源路径，便于调用方进一步查看） */
  specPath: string;
  spec: string;
  /** 唯一参考范本，仅 includeTemplate 时返回 */
  templatePath?: string;
  templateLang?: string;
  template?: string;
}

/** 读取某一类写作规范；includeTemplate 才附带范本原文（体积大，默认不返） */
export function readSpec(
  kind: SpecKind,
  options: { includeTemplate?: boolean; location?: SpecLocation } = {},
): SpecPayload {
  const source = SPEC_SOURCES[kind];
  const location = options.location ?? resolveSpecLocation();
  const paths = specPaths(kind, location);

  if (!fs.existsSync(paths.spec)) {
    throw new Error(`${source.label}正文缺失：${paths.spec}`);
  }

  const payload: SpecPayload = {
    kind,
    label: source.label,
    specPath: paths.specRef,
    spec: readText(paths.spec),
  };

  if (options.includeTemplate) {
    if (!fs.existsSync(paths.template)) {
      throw new Error(`${source.label}的参考范本缺失：${paths.template}`);
    }
    payload.templatePath = paths.templateRef;
    payload.templateLang = source.templateLang;
    payload.template = readText(paths.template);
  }

  return payload;
}
