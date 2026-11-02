import type { KbIndexEntry } from "./kb.js";

/**
 * 组件加权检索：id 精确 > id 包含 > title > tags > description。
 * 查询词按空白切分后逐词累加得分，全部词都未命中的组件被过滤。
 */
export function searchComponents(
  entries: KbIndexEntry[],
  query: string,
): Array<KbIndexEntry & { score: number }> {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return [];

  const scored: Array<KbIndexEntry & { score: number }> = [];
  for (const e of entries) {
    const id = e.id.toLowerCase();
    const title = (e.title ?? "").toLowerCase();
    const tags = (e.tags ?? []).map((t) => t.toLowerCase());
    const description = (e.description ?? "").toLowerCase();

    let score = 0;
    for (const term of terms) {
      if (id === term) score += 100;
      else if (id.includes(term)) score += 40;
      if (title === term) score += 60;
      else if (title.includes(term)) score += 30;
      if (tags.includes(term)) score += 20;
      else if (tags.some((t) => t.includes(term))) score += 10;
      if (description.includes(term)) score += 8;
    }
    if (score > 0) scored.push({ ...e, score });
  }

  return scored.sort((a, b) => b.score - a.score);
}
