/**
 * 设计实例 → Reborn 组件映射表（纯数据与匹配逻辑，浏览器端的提示词查看页也会打包它，不能引入 node 模块）。
 * 规则保存在目标项目 docs/design/component-map.json，预读后拿 manifest 里的组件实例名逐条匹配：
 * 命中的实例必须按表实现，未命中的登记到实现清单，用户补一次规则后长期复用，不再依赖模型每轮自行选型。
 * 文件读写见 componentMapStore.ts。
 */
import type { BlockComponent } from './reader.ts'

export const COMPONENT_MAP_PATH = 'docs/design/component-map.json'

/** 一条映射规则：实例名命中 match 任一项时，按 component 与配方实现。 */
export interface ComponentRule {
  /** 设计模式说明，给人读。 */
  pattern: string
  /** 实例名匹配项：普通字符串按子串匹配（不分大小写），形如 /正则/i 的按正则匹配。 */
  match: string[]
  /** Reborn 组件标识（reborn-xxx）；ignore 规则留空。 */
  component: string
  /** 命中的实例不是组件（图标、素材、纯布局）：既不要求组件标签，也不算待映射。 */
  ignore?: boolean
  /** 模板上的 props 写法配方，如 shape="circle" :show-dropdown="false"。 */
  props?: string
  /** 允许调整的 ui 键及用途。 */
  ui?: string
  /** 插槽用法。 */
  slots?: string
  /** 其他注意事项。 */
  notes?: string
  /** 伴随组件：命中实例除 component 外还必须出现这些组件标签（如签到按钮上的角标）。 */
  with?: string[]
  /** 也匹配非实例的区块名与规格节点名（文字节点的 data-name 即文案），用于设计稿里没有做成组件的签到、常见问题等。 */
  deep?: boolean
  /** 深匹配时同一区块里至少要有这么多节点命中才算（如问答列表要有多行问题），避免页脚里的「常見問題」链接之类单个文字误命中。 */
  minPerBlock?: number
}

/**
 * 默认表：历次还原里验证过的配方。按顺序取第一条命中的规则，所以忽略规则与具体模式放在通用模式之前。
 * 只列双端或 Web 可用、已在知识库中的组件；项目里已有同类封装时仍以项目组件优先。
 */
export const defaultRules: readonly ComponentRule[] = [
  { pattern: '图标实例', match: ['/^icon[\\/-]/i', '/^图标/', '/^圖標/'], component: '', ignore: true, notes: '下载并使用该节点导出的原始 SVG，不旋转、不从截图裁切，不用图标库的相似图标替换' },
  // 设计库常把按钮类实例命名为 btn-<用途>：「btn-宣传banner」是 banner 里的按钮，「btn-首页站点标签」是一排可切换的页签，
  // 放在 banner / 标签 等通用规则之前，避免按名字里的字样被认成轮播或徽标。
  { pattern: '一排可切换的胶囊页签：同一容器里多个 btn-…标签 / tab 实例，变体在 选中 / 未选中 之间切换', match: ['/^btn[-_].*(?:标签|標籤|tab)/i'], component: 'reborn-tabs', props: 'type="text" color="neutral"，v-model:active-key 管当前项，每个实例一个 RebornTabPane（标题插槽写文案与 data-design）', ui: 'ui.list 写间距；ui.tab 写高度、内边距、圆角、描边与 aria-[selected=true] / aria-[selected=false] 两态颜色；ui.indicator 设 hidden', notes: '整组是互斥选择，不得逐个手写 button / a 再自己切选中样式' },
  { pattern: '以 btn- 命名的按钮实例（宣传 banner 里的按钮、文字按钮、站点入口等）', match: ['/^btn[-_]/i'], component: 'reborn-button', props: 'round / circle / variant / color / size 按稿面取', notes: '名字里带 banner、站点、下拉等字样也是按钮本身，不是轮播或下拉；黑底胶囊用 round + variant="filled" color="neutral"；宽度由文字与内边距撑开，ui.base 只写高度与 px-[…]（取规格表 padding），不写 w-[…]' },
  { pattern: '签到入口（点击区 + 右上角角标）', match: ['签到', '簽到', 'check-in', 'checkin', 'sign-in'], component: 'reborn-button', with: ['reborn-chip'], deep: true, props: 'variant / color / size 按稿面取；40×40 粉底描边块用 ui.base 补尺寸与圆角', slots: '角标用 reborn-chip 的 text + inset 挂在按钮上', notes: '不得用 div / NuxtLink + span 自绘点击区与角标' },
  { pattern: '常见问题、可展开收起的问答或折叠列表', match: ['问题列表', '問題列表', '折叠', '折疊', '展开收起', '展開收起', '/\\bfaq\\b/i', 'collapse', 'accordion', '/[？?]\\s*$/'], component: 'reborn-collapse', deep: true, minPerBlock: 3, props: '每条问答一个 reborn-collapse，标题区放题号、题目与右侧箭头图标，内容区放答案', notes: '同一区块里至少三行以问号结尾的问题文字才视为问答列表；不得用静态列表或自写展开逻辑代替' },
  { pattern: '加载更多、查看更多', match: ['加载更多', '加載更多', '查看更多', '查看全部', 'load-more', 'loadmore', '/\\bmore\\b/i'], component: 'reborn-button', props: 'variant="soft" color="neutral"', slots: '#trailing 放对应节点导出的原始图标，不旋转导出图标' },
  { pattern: '带站点或分类选择与搜索键的搜索框', match: ['搜索', '搜尋', 'search'], component: 'reborn-search-box', props: '站点选择组合 Dropdown，确认 search 事件与插槽；形状、尺寸和是否显示下拉由节点决定，如 shape="circle" :show-dropdown="false"', ui: '高度经 ui.control，内边距经 ui.inputWrapper / leadingWrapper / trailingWrapper', slots: '#leading 放 RebornDropdown 触发器与分割线，#trailing="{ search }" 放 RebornButton round color="primary"', notes: '不自写 input' },
  { pattern: '单行输入框、密码框', match: ['输入框', '輸入框', '密码', '密碼', 'input'], component: 'reborn-input' },
  { pattern: '表单里的下拉选择', match: ['选择器', '選擇器', 'select'], component: 'reborn-select' },
  // 排在下拉规则之前：「导航菜单」「分类菜单」含「菜单」，放后面会被下拉规则先认走。
  { pattern: '分类列表、侧边导航菜单：同一容器里排成一列（或一行）的多个同名实例，变体为 选中 / 未选中，点击切换当前项', match: ['分类列表', '分類列表', '分类导航', '分類導航', '分类菜单', '分類菜單', '类目列表', '類目列表', '侧边导航', '側邊導航', '侧边菜单', '側邊菜單', '导航菜单', '導航菜單', '多级菜单', '多級菜單', '/\\bside[ -]?(?:bar[ -]?)?(?:menu|nav)\\b/i', '/\\bnav[ -]?(?:menu|list)\\b/i', '/\\bcategory[ -]?(?:list|menu|nav)\\b/i'], component: 'reborn-menu', props: '整组一个 RebornMenu：纵向 mode="vertical"（顶部横排用 horizontal），color 按稿面取 neutral 或 primary，v-model:selected-keys 绑定当前项，不折叠时 :tooltip="false"；每个实例一个 RebornMenuItem :index，有下级的用 RebornSubMenu 或传 items', ui: '面板底色 / 描边 / 圆角 / 内边距经 ui.root，条目间距经 ui.menu，行高 / 圆角 / 内边距经 ui.menuItem，字号字重经 ui.menuItemTitle；选中项底色用 RebornMenuItem 自己的 :ui 按选中态给', slots: '默认插槽放文字（需要可聚焦、可新开的链接时放 a 并 @click.prevent，由菜单的选中事件接管），#extra 放右侧箭头等节点导出的原始图标，#icon 放左侧图标', notes: '不要把每一项写成原生 a / li / button 再自己管选中态；RebornMenu 与 RebornMenuItem 显式 import；各项节点 ID 用 :data-design 逐项绑定' },
  { pattern: '点击展开的菜单、地区或语言切换', match: ['下拉', '菜单', '菜單', '语言', '語言', '地区', '地區', '站点选择', '站點選擇', 'dropdown', 'menu'], component: 'reborn-dropdown', props: ':options', slots: '默认插槽放触发器 RebornButton variant="text"' },
  { pattern: '角标、未读数、签到标记等右上角小标签', match: ['角标', '角標', '未读', '未讀', '数量', '數量', 'chip'], component: 'reborn-chip', props: 'text + inset 挂在宿主上', ui: '圆角与尺寸只经 ui.base，ui.label 写字号后接 leading-none', notes: 'Chip 本身是角标，不能冒充整个签到按钮；签到点击区仍用 reborn-button' },
  { pattern: '悬浮操作按钮、右侧购物车与计算器操作组', match: ['悬浮', '懸浮', '浮动', '浮動', '侧边栏', '側邊欄', 'fab', 'float'], component: 'reborn-fab', props: '按节点确定位置、展开方式及触发器，Web 常用 variant="capsule" :expandable="false" position="right-top" :top :right', ui: 'ui.capsuleWrapper 改白底与阴影', slots: '#trigger 放纵向图标按钮', notes: '数量角标组合 Chip；核对 Web 的实际 API，Web 无 items / size' },
  { pattern: '状态标签、分类标签', match: ['标签', '標籤', '/\\btags?\\b/i', 'badge'], component: 'reborn-badge' },
  { pattern: '优惠券、带缺口或撕线的卡券', match: ['优惠券', '優惠券', '卡券', 'coupon'], component: 'reborn-coupon', props: '缺口、分割线、方向与左右插槽按节点参数设置，如 type="perforated" direction="vertical"（vertical 即左右排布）position="start" :offset=缺口中心 x :radius=缺口半径（整数 ≥ 1，撕线带宽 = 2·radius）split="dashed" :size="[线宽, 段长]" :gap=段距 split-color', ui: 'ui.root 设底色与圆角', slots: '#left / #right 放票面内容', notes: '不要用 CSS 拼缺口' },
  { pattern: '轮播、跑马灯、banner 滑动', match: ['轮播', '輪播', 'banner', '跑马灯', '跑馬燈', 'carousel', 'swiper'], component: 'reborn-carousel', props: '轮播数量、间距、初始项、循环与指示器以设计和交互为准，如 slides-per-view="auto" centered-slides loop :initial-slide arrow="always" :pagination="{ type: \'dot\', indicatorBackground: false }"', ui: 'ui.slideInactive 设 opacity-100；箭头尺寸、底色与描边改 ui.arrow', slots: '箭头使用原素材，用 prev / next 插槽时按钮保证 pointer-events-auto' },
  { pattern: '头像', match: ['头像', '頭像', 'avatar'], component: 'reborn-avatar' },
  { pattern: '商品图、头像外的图片', match: ['图片', '圖片', '海报', '海報', '商品图', '商品圖', 'image', '/\\bimg\\b/i'], component: 'reborn-image', props: ':width / :height 传稿面尺寸（不传按 120×120），mode="aspectFill" 对应 cover', notes: '图片填充节点不一定是组件实例（常见名字是「矩形 …」），以规格表 bitmap 为准：位图一律用 RebornImage，不用原生 img 或 CSS 背景图' },
  { pattern: '标签页、分段切换', match: ['标签页', '標籤頁', '分段', '/\\btabs?\\b/i', 'segmented'], component: 'reborn-tabs' },
  { pattern: '分页器', match: ['分页', '分頁', 'pagination', 'pager'], component: 'reborn-pagination' },
  { pattern: '步骤条', match: ['步骤条', '步驟條', 'steps', 'stepper'], component: 'reborn-steps' },
  { pattern: '数据表格', match: ['表格', '/\\btable\\b/i'], component: 'reborn-table', notes: '不用 Button 与 CSS 拼出完整控件' },
  { pattern: '树形层级', match: ['树形', '樹形', '/\\btree\\b/i'], component: 'reborn-tree' },
  { pattern: '日期选择', match: ['日期', 'date-picker', 'datepicker', '/\\bdate\\b/i'], component: 'reborn-date-picker' },
  { pattern: '表单校验', match: ['表单', '表單', '/\\bform\\b/i'], component: 'reborn-form' },
  { pattern: '按钮、链接样式按钮、圆形图标按钮', match: ['按钮', '按鈕', '/\\bbtn\\b/i', 'button'], component: 'reborn-button', props: 'round / circle / variant / color / size', notes: '灰底无描边用 variant="soft" color="neutral"；有文字的按钮不写死宽度，宽度由内容与 padding 撑开' },
  { pattern: '弹窗', match: ['弹窗', '彈窗', '对话框', '對話框', 'dialog', 'modal'], component: 'reborn-dialog' },
  { pattern: '抽屉', match: ['抽屉', '抽屜', 'drawer'], component: 'reborn-drawer' },
  { pattern: '气泡', match: ['气泡', '氣泡', 'popover', 'tooltip'], component: 'reborn-popover' },
  { pattern: '提示条', match: ['提示条', '提示條', 'alert'], component: 'reborn-alert' },
  { pattern: '公告栏、通知栏', match: ['公告', '通知栏', '通知欄', 'notice'], component: 'reborn-notice-bar' },
]

const componentId = /^reborn-[a-z]+(?:-[a-z]+)*$/
const regexForm = /^\/(.+)\/([a-z]*)$/

/** 与 project.ts 的 object / text 同义，这里不引入它们以免把 node 模块带进浏览器包。 */
function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(where + '需要 JSON 对象')
  return value as Record<string, unknown>
}
function string(value: unknown, where: string, max: number): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new Error(where + '的文字无效或超长')
  return value
}

/** 校验映射表文件：版本、规则数量、匹配项与组件标识；正则写错时指出是哪一条。 */
export function componentRules(input: unknown): ComponentRule[] {
  const value = record(input, '映射表')
  if (value.schemaVersion !== 1) throw new Error('映射表版本不受支持，schemaVersion 需为 1')
  if (!Array.isArray(value.rules) || value.rules.length > 500) throw new Error('映射规则需要是数组且不超过 500 条')
  return value.rules.map((item, index) => {
    const where = '第 ' + (index + 1) + ' 条规则', row = record(item, where)
    const pattern = string(row.pattern, where, 256).trim()
    if (!pattern) throw new Error(where + '缺少 pattern')
    if (!Array.isArray(row.match) || row.match.length === 0 || row.match.length > 50) throw new Error(where + '的 match 需要 1–50 个匹配项')
    const match = row.match.map(entry => {
      const value = string(entry, where, 256).trim()
      if (!value) throw new Error(where + '含空匹配项')
      const regex = regexForm.exec(value)
      if (regex) { try { new RegExp(regex[1]!, regex[2]) } catch (error) { throw new Error(where + '的正则无效：' + value) } }
      return value
    })
    const ignore = row.ignore === true
    const component = string(row.component ?? '', where, 128).trim()
    if (!ignore && !componentId.test(component)) throw new Error(where + '的 component 需要 reborn-xxx 形式')
    const optional = (key: 'props' | 'ui' | 'slots' | 'notes') => row[key] === undefined ? {} : { [key]: string(row[key], where, 2000) }
    const companions = row.with === undefined ? [] : (Array.isArray(row.with) ? row.with : [row.with]).map(entry => { const id = string(entry, where, 128).trim(); if (!componentId.test(id)) throw new Error(where + '的 with 需要 reborn-xxx 形式'); return id })
    const minPerBlock = row.minPerBlock === undefined ? undefined : Number(row.minPerBlock)
    if (minPerBlock !== undefined && (!Number.isInteger(minPerBlock) || minPerBlock < 1 || minPerBlock > 50)) throw new Error(where + '的 minPerBlock 需要 1–50 的整数')
    return { pattern, match, component: ignore ? '' : component, ...(ignore ? { ignore: true } : {}), ...optional('props'), ...optional('ui'), ...optional('slots'), ...optional('notes'), ...(companions.length ? { with: companions } : {}), ...(row.deep === true ? { deep: true } : {}), ...(minPerBlock !== undefined ? { minPerBlock } : {}) }
  })
}

/** 按顺序取第一条命中的规则；子串比较不分大小写。 */
export function matchInstance(rules: readonly ComponentRule[], name: string): ComponentRule | undefined {
  const lower = name.toLowerCase()
  return rules.find(rule => rule.match.some(entry => {
    const regex = regexForm.exec(entry)
    return regex ? new RegExp(regex[1]!, regex[2]).test(name) : lower.includes(entry.toLowerCase())
  }))
}

export interface MappingGroup { name: string; nodeIds: string[] }
export interface MappingHit extends MappingGroup { rule: ComponentRule }
/** 预读实例与映射表的匹配结果：同名实例合并，保留全部节点 ID。 */
export interface MappingResult {
  /** 去重后的实例数。 */
  total: number
  matched: MappingHit[]
  ignored: MappingHit[]
  unmatched: MappingGroup[]
}

/** 只需区块里的组件实例：manifest、预读选出的区块或测试构造的对象都能传。 */
export interface BlocksWithComponents { blocks: readonly { nodeId?: string; name?: string; components?: readonly BlockComponent[]; spec?: readonly { id: string; name?: string }[] }[] }

/**
 * 把 manifest 里每个区块的组件实例按名称匹配映射表；旧版 manifest 没有 components 时结果为空。
 * 标 deep 的规则还匹配区块名与规格节点名（文字节点名即文案），用于稿面里没做成组件的签到、常见问题等；
 * 同一规则的多个深匹配节点合并为一组。
 */
export function matchManifest(rules: readonly ComponentRule[], manifest: BlocksWithComponents): MappingResult {
  const groups = new Map<string, MappingGroup & { rule?: ComponentRule }>()
  const seen = new Set<string>()
  for (const block of manifest.blocks) for (const instance of block.components ?? []) {
    seen.add(instance.nodeId)
    const group = groups.get(instance.name) ?? { name: instance.name, nodeIds: [], rule: matchInstance(rules, instance.name) }
    if (!group.nodeIds.includes(instance.nodeId)) group.nodeIds.push(instance.nodeId)
    groups.set(instance.name, group)
  }
  const deepRules = rules.filter(rule => rule.deep && !rule.ignore)
  if (deepRules.length) for (const block of manifest.blocks) {
    const nodes = [...(block.nodeId ? [{ id: block.nodeId, name: block.name }] : []), ...(block.spec ?? [])]
    // 先按区块收集命中，再按 minPerBlock 过滤：问答列表要多行问题同时命中，单个标题或链接不算。
    const perRule = new Map<ComponentRule, string[]>()
    for (const node of nodes) {
      if (!node.name || seen.has(node.id)) continue
      const rule = matchInstance(deepRules, node.name)
      if (!rule) continue
      perRule.set(rule, [...(perRule.get(rule) ?? []), node.id])
    }
    for (const [rule, ids] of perRule) {
      if (ids.length < (rule.minPerBlock ?? 1)) continue
      const key = '深匹配：' + rule.pattern
      const group = groups.get(key) ?? { name: key, nodeIds: [], rule }
      for (const id of ids) { seen.add(id); if (!group.nodeIds.includes(id)) group.nodeIds.push(id) }
      groups.set(key, group)
    }
  }
  const result: MappingResult = { total: seen.size, matched: [], ignored: [], unmatched: [] }
  for (const group of groups.values()) {
    if (!group.rule) result.unmatched.push({ name: group.name, nodeIds: group.nodeIds })
    else if (group.rule.ignore) result.ignored.push({ name: group.name, nodeIds: group.nodeIds, rule: group.rule })
    else result.matched.push({ name: group.name, nodeIds: group.nodeIds, rule: group.rule })
  }
  return result
}

/** 交给提示词的映射信息：表本身与本次预读的匹配结果。 */
export interface PromptMapping { path: string; source: 'project' | 'default'; rules: readonly ComponentRule[]; result?: MappingResult }

/** 骨架文件内容：默认表加上格式说明，用户在项目里直接改。 */
export function componentMapSkeleton(): object {
  return {
    schemaVersion: 1,
    description: '设计实例名 → Reborn 组件映射表。match 为实例名匹配项（子串不分大小写，或 /正则/i）；预读后按顺序取第一条命中的规则，具体规则放在通用规则前面。命中的实例必须按 component 与 props / ui / slots 配方实现；ignore: true 表示命中的实例不是组件（图标、素材）。补充规则后下次预读自动生效，实现清单「待映射组件」列出的名称就是需要补的。',
    /** 为真时工作室升级后新增的默认规则会自动补到表末尾；完全自定义的表可改为 false。 */
    inheritDefaults: true,
    rules: defaultRules,
  }
}

/** 一条规则的配方文字：组件（props 写法；ui 键；插槽；注意事项）。 */
export function ruleRecipe(rule: ComponentRule): string {
  const parts = [rule.props, rule.ui && 'ui：' + rule.ui, rule.slots && '插槽：' + rule.slots, rule.with?.length && '伴随：' + rule.with.join(' + '), rule.notes && '注意：' + rule.notes].filter(Boolean)
  return rule.component + (parts.length ? '（' + parts.join('；') + '）' : '')
}

/** 提示词【组件】段的映射部分：映射表全文、本次命中与待映射实例；原生控件禁令等通用要求由提示词自身接在后面。 */
export function componentSection(map: PromptMapping): string {
  const table = map.rules.filter(rule => !rule.ignore).map(rule => rule.pattern + '（实例名含 ' + rule.match.join(' / ') + '）→ ' + ruleRecipe(rule)).join('；')
  const ignored = map.rules.filter(rule => rule.ignore).map(rule => rule.pattern + '（' + rule.match.join(' / ') + '）' + (rule.notes ? '：' + rule.notes : ''))
  const lines = [
    '【组件】设计实例 → Reborn 组件映射表（' + map.path + (map.source === 'project' ? '，项目已维护' : '，本次使用默认表，预读时已写出骨架供项目维护') + '；项目已有同类组件优先）：' + table + '。' + (ignored.length ? '不映射组件的实例：' + ignored.join('；') + '。' : ''),
  ]
  const result = map.result
  if (result) {
    const hits = result.matched.map(hit => '「' + hit.name + '」（' + hit.nodeIds.join('、') + '）→ ' + ruleRecipe(hit.rule))
    const pending = result.unmatched.map(group => '「' + group.name + '」（' + group.nodeIds.join('、') + '）')
    lines.push('预读命中（' + result.matched.length + ' 种实例）：' + (hits.length ? hits.join('；') : '无') + '。命中的实例必须按表中的组件与配方实现，不得改用其他组件或自写；design_review(stage=plan) 对命中实例不接受 source=custom 或原生标签，只有用户在需求里写「允许自定义 <节点名>」才放行，缺失的组件由工作室在实现前安装；带「伴随」的规则要求伴随组件也出现在同一实现文件里。表里的 props 配方是最低要求，实际取值仍以项目内已安装组件的 config 为准，design_review(stage=check) 会按 data-design 定位到渲染该实例的文件核对标签与取值。'
      + '待映射实例（' + result.unmatched.length + ' 种，未命中映射表）：' + (pending.length ? pending.join('、') : '无') + '。只有这些实例才允许按上面的通用规则与项目已有组件选型；选定后在实现清单「待映射组件」写明所选组件，并建议把规则补进 ' + map.path + ' 供下次复用。'
      + (result.ignored.length ? '已按忽略规则跳过：' + result.ignored.map(group => group.name).join('、') + '。' : ''))
  }
  return lines.join('')
}

/** 实现清单里的「待映射组件」段落正文。 */
export function unmappedSection(result: MappingResult, path = COMPONENT_MAP_PATH): string {
  const lines = ['预读在设计稿里找到 ' + result.total + ' 个组件实例，' + result.matched.length + ' 种已命中 ' + path + '，' + result.unmatched.length + ' 种待映射。', '']
  if (result.unmatched.length) {
    lines.push('待映射（实现时填写所选组件，并把规则补进映射表）：')
    for (const group of result.unmatched) lines.push('- ' + group.name + '（' + group.nodeIds.join('、') + '）：')
  } else lines.push('全部实例名已命中映射表。')
  if (result.matched.length) lines.push('', '已命中：' + result.matched.map(hit => hit.name + ' → ' + hit.rule.component).join('；'))
  if (result.ignored.length) lines.push('', '已忽略（图标 / 素材）：' + result.ignored.map(hit => hit.name).join('、'))
  return lines.join('\n')
}
