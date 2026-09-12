# 前端布局与展示组件

标准列表页之外的页面结构写法，是代码模板、度量数字与组件机理的**唯一事实源**；
「必须 / 禁止」与豁免清单归 [constraints-frontend.md](./constraints-frontend.md)，本文不复述规则原文，
只在各节链接对应约束。标准列表页模板见 [crud-frontend.md](./crud-frontend.md)。

| 需求 | 章节 |
| --- | --- |
| 页面最外层是多个业务 Tab | [页面级多 Tab 布局](#页面级多-tab-布局) |
| 左侧列表 / 筛选树 + 右侧详情 | [左右分栏（MasterDetailLayout）](#左右分栏masterdetaillayout) |
| 左侧是平铺列表（分类 / 文件 / 分组） | [左侧平铺列表（NavListPanel）](#左侧平铺列表navlistpanel) |
| 页面主体用 List 渲染分页数据 | [List 列表页分页（ListPagination）](#list-列表页分页listpagination) |
| 指标卡、图表分栏、卡片栅格、表单多列 | [统计卡片与自适应栅格](#统计卡片与自适应栅格) |
| 表格列宽：弹性主列与 `scroll.x` | [表格列宽](#表格列宽) |
| 给操作列定 `width` / 选内联动作 | [操作列](#操作列) |
| 列表数据量 > 500 条 | [虚拟化表格](#虚拟化表格) |

---

## 页面级多 Tab 布局

```tsx
const [activeTab, setActiveTab] = useUrlTabState(['list', 'stats'] as const, 'list');

return (
  <div className="page-container page-tabs-page">
    <Tabs collapsible="auto" activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)} type="line" lazyRender keepDOM={false}>
      <TabPane tab="列表" itemKey="list">
        <SearchToolbar>{/* 当前 tab 的筛选与操作按钮 */}</SearchToolbar>
        <ConfigurableTable bordered ... />
      </TabPane>
      <TabPane tab="统计分析" itemKey="stats">
        <StatsPanel />
      </TabPane>
    </Tabs>
  </div>
);
```

- **激活态统一用 `hooks/useUrlTabState.ts`**（`?tab=` 深链定位），约束与豁免清单见
  [constraints-frontend.md → 布局与响应式](./constraints-frontend.md#布局与响应式)；
  切换需附带副作用（清勾选、重置页码）时包一层：`onChange={(k) => { setActiveTab(k as typeof activeTab); setPage(1); }}`
- 每个 `TabPane` 内承载该 tab 的完整内容：工具栏（标准列表 `ListSearchToolbar`、即时过滤 `InstantFilterToolbar`、纯操作按钮 `SearchToolbar`）、
  空状态、表格或统计面板
- tab 相关操作按钮（「全部标记为已读」「清理日志」）放在对应 `TabPane` 内的工具栏，
  不要放在 TabBar 右侧
- `page-tabs-page` 只用于页面最外层业务 Tabs；抽屉、弹窗、卡片内代码示例、左右分栏内部小 tabs 不使用
- 非激活 tab 的查询用 `enabled: activeTab === 'xxx'` 门控，切换时懒加载并缓存
- `collapsible="auto"` 的溢出机理（要求见 [constraints-frontend.md → 布局与响应式](./constraints-frontend.md#布局与响应式)）：
  它把 TabBar 包进 `ResizeObserver`，按「是否折行 + `scrollWidth` 超出」判定溢出，
  仅在真放不下时折叠，空间恢复后自动退出，不占用固定空间

---

## 左右分栏（MasterDetailLayout）

适用于消息中心、智能对话、AI 侧边栏、数据库表浏览、日志文件等结构。
组件路径 `components/MasterDetailLayout.tsx`。

### 标准模式：页面直接作为 Outlet 根节点

页面从 `admin-content`（已分配确定高度的 flex 容器）继承高度，直接返回组件，无需外层 wrapper：

```tsx
<MasterDetailLayout
  defaultSize={260}        // 左栏默认宽度
  minSize={200}
  maxSize={480}
  persistKey="xxx-page"    // localStorage 持久化（宽度 + 左右位置）
  master={(
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* 顶部固定区域 */}
      <div style={{ padding: 12, borderBottom: '1px solid var(--semi-color-border)', flexShrink: 0 }}>…</div>
      {/* 滚动列表区域 */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>…</div>
    </div>
  )}
  detail={<div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>…</div>}
/>
```

master 位置调换按钮由 `MasterDetailLayout.Header` / `NavListPanel` 自动渲染，
规则（不得重复渲染、`sideSwitchable` 关闭）见 [constraints-frontend.md → 布局与响应式](./constraints-frontend.md#布局与响应式)。

### 主侧在右（`side="right"`）

页面左侧为主内容区、右侧为可收起辅助面板（如 AI 侧边栏）时：宽内容放 `detail`，
窄面板放 `master`，并设 `side="right"`。

```tsx
<MasterDetailLayout
  side="right"
  defaultSize={380} minSize={300} maxSize={600}
  collapsed={!panelVisible}
  persistKey="xxx-sidebar"
  detail={<MainContent />}    // 宽的主体内容（左侧）
  master={<SidePanel />}      // 窄的辅助面板（右侧，可调整宽度）
/>
```

### 嵌套在 Semi Tabs 内

`semi-tabs-pane-motion-overlay` 会打断高度继承链，**高度链四条缺一不可**：

1. 页面根 div：`height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden'`
2. `<Tabs>`：`className="tabs-fill-height"`（已在 `global.css` 定义）+
   `style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}` +
   `contentStyle={{ flex: 1, minHeight: 0, overflow: 'hidden' }}`
3. 需要全高的 `<TabPane>`：`style={{ height: '100%' }}`
4. TabPane 内层 wrapper div：`style={{ height: '100%' }}`

```tsx
<div style={{ height: '100%', boxSizing: 'border-box', padding: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
  <Tabs
    collapsible="auto"
    className="tabs-fill-height"
    style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    contentStyle={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
    tabBarStyle={{ marginBottom: 8 }}
  >
    <TabPane tab="列表" itemKey="list" style={{ height: '100%' }}>
      <div style={{ height: '100%' }}>
        <MasterDetailLayout persistKey="xxx-list" master={…} detail={…} />
      </div>
    </TabPane>
    {/* 无高度限制需求的 tab 不需要 style={{ height: '100%' }} */}
  </Tabs>
</div>
```

### 窄屏单栏（响应式）

容器宽度小于 `responsiveBreakpoint`（默认 720）时自动切换为单栏，一次只渲染一侧。
**该断点比较的是容器宽度而非视口宽度**——后台内容区还要扣除侧边栏，勿按视口断点估算。

**A 类「列表 → 详情」**：master 是列表（根视图），窄屏先显示 master，选中后进入 detail，
返回条由组件渲染在 detail 侧。

```tsx
<MasterDetailLayout
  showDetail={selected !== null}
  onBack={() => setSelected(null)}
  master={<List onSelect={setSelected} />}
  detail={<Detail record={selected} />}
/>
```

**B 类「筛选树 + 主体内容」**：master 是分类 / 部门筛选器，detail 才是页面主体（表格）。
窄屏先显示 detail，返回条由组件渲染在 master 侧；进入 master 的入口由页面自己放进工具栏。

```tsx
<MasterDetailLayout
  showDetail={!showTree}
  onMasterBack={() => setShowTree(false)}
  masterBackLabel="返回用户列表"        // 缺省为「返回」
  master={<DeptTree />}
  detail={<ConfigurableTable ... />}
/>
```

完整窄屏契约（返回入口、禁止自动选中首项、`onResponsiveChange` 区分）见
[constraints-frontend.md → 布局与响应式](./constraints-frontend.md#布局与响应式)。

### 选中项同步到 URL（useUrlSelectionState）

「列表 → 详情」型分栏页的选中项用 `hooks/useUrlSelectionState.ts` 同步到 URL，
深链 / 刷新 / 页签导航可直达某一项（是否持久写回由偏好「页面状态同步到地址栏」决定，
hook 已内置，页面代码不感知）。选中对象在渲染期按 key 派生：显式选中（URL 有参）优先，
无参时**仅双栏**回退首项——默认选中不入 URL，显式点选与深链才入；
布局形态用 state 保存并参与派生，窄屏与双栏的行为差异随之自动成立：

```tsx
const [selectedKey, setSelectedKey] = useUrlSelectionState('dict'); // 参数名 = 所选实体的领域名词
const [isNarrowLayout, setIsNarrowLayout] = useState(false);

// URL 深链值优先；无深链时桌面端回退首项（默认选中不入 URL），窄屏不自动选中。
// 分页列表：深链目标可能不在当前页，不在页内时按 id 拉详情兜底，
// 仅确认无效（非法 id / 404）才清参——成员资格不可当存在性判据
const explicitId = selectedKey !== null ? Number(selectedKey) : undefined;
const idValid = explicitId !== undefined && Number.isInteger(explicitId) && explicitId > 0;
const inPage = idValid ? list.find((x) => x.id === explicitId) ?? null : null;
const fallbackQuery = useXxxDetail(explicitId, idValid && !inPage);
const explicit = inPage ?? (fallbackQuery.data?.id === explicitId ? fallbackQuery.data : null);
const selected = explicit ?? (isNarrowLayout ? null : list[0] ?? null);

useEffect(() => {
  if (selectedKey === null) return;
  if (!idValid || fallbackQuery.isError) setSelectedKey(null);
}, [selectedKey, idValid, fallbackQuery.isError, setSelectedKey]);

<MasterDetailLayout
  showDetail={!!selected}
  onBack={() => setSelectedKey(null)}
  onResponsiveChange={setIsNarrowLayout}
/>
```

不分页的数据源（全量列表 / 树）没有详情接口兜底时，仍须等数据落定
（`query.data && !query.isFetching`）再判目标不存在并清参，避免在途误清。

**上下文相关的 id 用 `useUrlSelectionParams` 复合成组**（何时必须成组、单实例原子管理等硬规则见
[constraints-frontend.md → 布局与响应式](./constraints-frontend.md#布局与响应式)）：

```tsx
const [urlSelection, setUrlSelection] = useUrlSelectionParams(['site', 'channel']);
// 上下文分两层：URL 层（深链/盖章）优先，本地层承接选择器恢复与手动切换；上下文默认值不入 URL
const siteId = urlSelection.site !== null ? Number(urlSelection.site) : localSiteId;

// 点选时把上下文一并盖章；关闭时先把上下文降级回本地层再整组清参，避免树/列表意外切换
onSelect: (record) => setUrlSelection({ site: String(siteId), channel: String(record.id) });
onClose:  () => { setLocalSiteId(siteId); setUrlSelection({ site: null, channel: null }); };
// 手动切换上下文（非首次恢复）时整组清参；深链应用共享上下文（写 localStorage 的 setCurrentId 等）
// 需按参数值追踪只应用一次，避免手动切换被 URL 旧值回滚（参考 MpMessagesPage）
```

选中切换需要重置伴随状态（筛选、搜索词、实时流）时，点选路径在点击处理器里重置；
深链 / 前进后退等 URL 驱动路径的重置与业务回退（如日志轮转改选 `.gz` 归档、`?level=`
伴随参数）写在按参数值追踪的 effect 里，参考 `LogFilesPage`。

### 常见陷阱

- master 内需要「头部 + 滚动列表」时必须用 flex column 容器包裹：搜索头 `flexShrink: 0`，
  列表 `flex: 1` + `overflow: auto` + `minHeight: 0`
- **不要把 master 的 div 写成 Fragment（`<>`）**：Fragment 无法接受 `height: '100%'`，列表将无高度约束
- Tabs 嵌套时漏加 `className="tabs-fill-height"`：动画层破坏高度链，列表撑满后无滚动
- `gap` 默认为 0：不需要间距且无边框时保持默认
- B 类页面漏传 `onMasterBack`：窄屏切到 master 后无返回入口，用户只能靠浏览器后退
- **外层套 `page-container` 时必须加 `page-container--stretch`**，并给组件传
  `style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}`：普通 `page-container` 没有高度约束，
  分栏会撑到内容高度、由 `.admin-content` 整体滚动，两侧无法各自滚动
- **detail 是「工具栏 + 表格」时，包裹层要 `overflow: auto`（或让 Tabs 的 `contentStyle` 滚动）**，
  不能 `overflow: hidden`：高度链建立后 hidden 会在矮窗口把表格尾部与分页裁掉

---

## 左侧平铺列表（NavListPanel）

左侧 master 是**平铺列表**（分类 / 文件 / 分组，非树形）时使用 `NavListPanel<T>` + `NavListItem`
（`components/NavListPanel.tsx`）。底层由 Semi `List` / `List.Item` 实现。
树形数据（需展开 / 折叠节点）改用 Semi `Tree`，例如用户管理的部门树。

- `NavListPanel<T>` 核心 props：`title`、`headerExtra`、`search`（搜索框配置）、`loading`、
  `emptyText`、`footer`（分页等）
- **dataSource 模式（默认）**：`<NavListPanel dataSource={items} renderItem={(item) => <NavListItem key={item.id} … />} />`，
  空数组时自动显示 `emptyText`
- **children 模式**：`<NavListPanel>{items.map(fn)}</NavListPanel>`，空数组不触发 emptyContent
  （需 `childCount > 0` 判断）；`rawBody` 场景必须走此路径
- **分组 / Collapse 场景**（如 DbAdmin）：传 `rawBody bodyNoPadding`，在 `children` 内自行渲染
  Collapse + 内嵌 `<List split={false} className="nav-list-panel__list">`
- `NavListItem` props：`active`、`onClick`、`icon`（左侧图标或彩色圆点）、`primary`、`secondary`、
  `meta`（底部元信息）、`extra`（hover 显示的操作区，`extraAlwaysVisible` 让其常驻）
- extra 含多个操作时用 `Dropdown`（`trigger="click"` + `clickToHide`）+ `MoreHorizontal` 按钮包裹
- meta 区域**禁止**使用 `<Tag color="...">` 内联标签（会渲染颜色指示器色块），改用 styled span

---

## List 列表页分页（ListPagination）

页面主体用 Semi `List` 渲染分页数据（收件箱、公告等消息流形态）时，分页条用
`components/ListPagination.tsx`，与 `ConfigurableTable`（Semi Table 内置分页）的形态对齐。
约束与豁免清单见 [constraints-frontend.md → 搜索栏与表格](./constraints-frontend.md#搜索栏与表格)。

```tsx
const { page, pageSize, setPage, buildPagination } = usePagination();
const pagination = buildPagination(total);

<List dataSource={list} renderItem={...} />
<ListPagination pagination={pagination} />

// 翻页需附带副作用（清勾选等）时包装回调再传入：
<ListPagination
  pagination={{
    ...pagination,
    onPageChange: (p) => { pagination.onPageChange(p); setSelectedIds([]); },
    onPageSizeChange: (s) => { pagination.onPageSizeChange(s); setSelectedIds([]); },
  }}
/>
```

机理与形态：

- 独立 `<Pagination>` 的 `showTotal` 只显示「总页数：N」，**没有条数信息**；
  「显示第 x 条-第 y 条，共 z 条」是 Semi Table 内置分页（`TablePagination`）拼装的 `pageText`，
  独立组件拿不到。`ListPagination` 在分页器左侧补齐同款文案（14px、`--semi-color-text-2`），
  布局与 `.semi-table-pagination-outer` 一致（两端对齐）
- 移动端与 `ConfigurableTable` 的移动端分页同策略：隐藏条数信息、总页数与每页条数选择器，
  分页器右对齐并用小尺寸；组件内部已用 `useIsMobile` 处理，页面无需再分支
- 入参就是 `usePagination().buildPagination(total)` 返回的 `PaginationConfig`，
  `pageSizeOpts` 固定 `TABLE_PAGE_SIZE_OPTIONS`，与表格一致
- 列表为空时页面通常整体切换到 `Empty`，分页条随之不渲染，无需在组件外再判 `total > 0`

---

## 统计卡片与自适应栅格

### StatCard / StatGrid

```tsx
// 无图表的页面直接引具体文件，不经桶文件（constraints-frontend → 布局与响应式）
import { StatCard, StatGrid } from '@/components/charts/StatCard';
// 页面本来就有图表时可从桶文件一起引：
// import { LineChart, chartOptions, StatCard, StatGrid } from '@/components/charts';

<StatGrid minItemWidth={180}>
  <StatCard title="今日 PV" value={stats.pv} icon={<Eye size={19} />} accent="#3b82f6" />
  {/* 环比：absolute 展示差值，ratio 按比率渲染成百分比（0.12 → +12.0%） */}
  <StatCard title="今日 UV" value={stats.uv} delta={stats.uvDelta} deltaFormat="absolute" />
  {/* 可点击筛选卡：渲染为 button，自动带 aria-pressed；选中态为底部 2px 强调条（无边框） */}
  <StatCard
    title="审批中" value={stats.running}
    accent="var(--semi-color-primary)"
    onClick={() => applySearch({ status: 'running' })}
    active={draftParams.status === 'running'}
  />
</StatGrid>
```

`StatGrid` 用 `auto-fit` + `minmax(min(minItemWidth, 100%), 1fr)`，容器变窄自动降列，
`min()` 保证容器比单列还窄时也不溢出。
`StatCard` 视觉上**不是卡片**：无底色、无边框、无圆角，分隔交给 StatGrid 的竖向细线，
与首页 `.dashboard-stat-item` 同一套语言。

### 无卡片面板（`.zx-flat-panels`）

统计 / 仪表盘页的图表、榜单、明细区不用「带边框的卡片盒」，而是与首页 `.dashboard-section`
一致的**扁平面板**：顶部一条细线起头 + 标题，无底色 / 边框 / 圆角 / 阴影。

```tsx
{/* 页面根挂一次即可，页内所有 Semi Card 自动脱壳（保留 title / extra 结构能力） */}
<div className="page-container zx-flat-panels">
  <StatGrid minItemWidth={180}>…</StatGrid>
  <Card title="访问趋势" bodyStyle={{ padding: 16 }}><LineChart {...spec} /></Card>
</div>
```

- 面板代码**仍写 Semi `<Card>`**，脱壳由 `.zx-flat-panels` 的样式统一接管——不要为扁平化
  手写替代容器；独立一块面板也可直接用 `.zx-panel` 类
- **抽屉 / 弹窗走 portal**，页面根的类覆盖不到，需在弹层内容层再挂一次
  （例：`ShortLinkStatsDrawer`）
- 个别页面需保留卡片外观时在页面 CSS 内覆盖并注明理由（例：`ChannelDashboardPage.css`）

### 图表分栏（`.chart-grid`）

配合 `.zx-flat-panels` 使用：行首通栏横线起头，行内面板之间竖向细线分隔（与首页
`.dashboard-charts-row` 一致）。**不挂** `.zx-flat-panels` 时 Card 保留自身边框，不呈现无卡片面板形态。

```tsx
{/* 等宽多图：最小 380px，xl 以上锁两列（三列以上横轴过密） */}
<div className="chart-grid">
  <Card title="趋势"><LineChart {...spec} /></Card>
  <Card title="分布"><PieChart {...spec} /></Card>
</div>

{/* 主图 + 侧栏的非对称布局：宽屏 1.6fr / 0.9fr，lg 以下收敛单列 */}
<div className="chart-grid chart-grid--aside">
  <Card title="事件脉冲"><AreaChart {...spec} /></Card>
  <Card title="热门页面">…</Card>
</div>
```

`.chart-grid` 的两列锁定走**视口**断点。若栅格位于抽屉、弹窗或分栏面板等**比视口窄得多的容器**内，
改用 `StatGrid`（纯容器自适应，不看视口）。

### 通用自适应栅格（`.auto-grid`，`global.css`）

固定列数的卡片栅格、表单多列、选择器画廊用它。轨道下限取「内容最小宽」与「N 等分宽」的较大者：
宽屏由 N 等分宽占优，恰好 N 列；窄屏由 `--auto-grid-min` 接管，自动降列。

```tsx
{/* 弹窗内两列表单：宽屏 2 列，窄到放不下 220px 时收敛单列 */}
<div className="auto-grid" style={{ ['--auto-grid-min']: '220px', ['--auto-grid-cols']: 2 } as CSSProperties}>
  <Form.Select field="channel" label="渠道" style={{ width: '100%' }} optionList={channelOptions} />
  <Form.Select field="payMethod" label="支付方式" style={{ width: '100%' }} optionList={methodOptions} />
</div>
```

| 变量 | 含义 |
| --- | --- |
| `--auto-grid-min` | 单列内容最小宽，低于此值即降列（默认 220px） |
| `--auto-grid-cols` | **设计列数上限**（默认 4）。不可省——纯 `auto-fit` 会在宽屏多拆一列 |
| `--auto-grid-gap` | 列间距，**必须是单个长度**（同时参与列数计算），默认 16px |
| `--auto-grid-row-gap` | 行间距，省略时跟随 `--auto-grid-gap` |

### 抽屉 / 弹窗宽度

窄屏适配已由 `global.css` 全局兜底，页面**无需**再写 `width={isMobile ? '100%' : 720}`：

| 断点 | 规则 |
| --- | --- |
| `--sm-down` | `.semi-modal` → `width/max-width: 95vw` |
| `--lg-down` | `.semi-sidesheet-inner` → `max-width: 95vw` |
| `--xs-down` | `.semi-sidesheet-inner` → `width: 100vw` |

固定 `width={860}` 的 SideSheet 在 390px 下同样满宽，加 `isMobile` 判断是无效代码。

### SideSheet 页脚

Semi 的 `footer` 槽**不带任何对齐样式**——裸 `<Space>` 会让按钮靠左。带操作按钮的页脚
统一用 `components/ModalFooter.tsx`（取消在左、主操作在右且 `theme="solid"`）：

```tsx
// 配合 useEditModal：提交、loading、详情加载中禁用一次接好
footer={<ModalFooter {...modal.footerProps} okText="保存" />}

// 自行管理提交状态时
footer={<ModalFooter onCancel={onClose} onOk={handleSave} loading={saving} okText="确定" />}
```

- **按钮次序**由组件固定：次要动作（取消 / 关闭）在左，主操作在右；危险确认传 `okType="danger"`
- **左侧需要独立次要动作**（如「测试连接」「下载模板」）传 `extra`，组件自动两端对齐；
  工作流域直接用 `components/workflow/WorkflowSideSheet.tsx` 的
  `footerLeft` / `footerRight` 两段式，**禁止**在工作流抽屉里重新手写 footer 布局
- 纯展示抽屉传 `footer={null}` 或不传，不放孤立的「关闭」主按钮
- **禁止**再手写 `<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>` + 两个 `Button` 的 footer

---

## 表格列宽

Semi Table 只要有任一列 `fixed` / `ellipsis`（或设置了 `scroll.y`）就切换到 `table-layout: fixed`，并给
`<table>` 加 `min-width: 100%`。此时若所有列都写了固定 `width` 且总和小于容器，浏览器会把多余空间按比例
分给**每一列**——`fixed: 'right'` 的操作列会被拉宽到配置值的一到三倍。规则见
[constraints-frontend.md → 搜索栏与表格](./constraints-frontend.md#搜索栏与表格)，机理与写法如下。

### 弹性主列

`ConfigurableTable` 的列定义在 `ColumnProps` 之上扩展了 `minWidth`（`components/table-flex-columns.ts`）：
弹性主列写 `minWidth`、其余列写固定 `width`，组件把各列 `width` 与弹性列 `minWidth`（加上勾选列 / 展开列各 48）
求和写入 `scroll.x`——容器更宽时弹性列吸收全部剩余空间，容器更窄时出现横向滚动而不是把弹性列压到 0。

```tsx
const columns: ColumnProps<Xxx>[] = [
  { title: '名称', dataIndex: 'name', minWidth: 200 },          // 弹性主列：minWidth，不写 width
  { title: '描述', dataIndex: 'description', width: 260, render: renderEllipsis },
  createdAtColumn,
  { title: '状态', dataIndex: 'status', width: 80, fixed: 'right', render: … },
  createOperationColumn<Xxx>({ width: 150, actions: … }),
];

<ConfigurableTable bordered columns={columns} … />           // 不传 scroll.x
```

`minWidth` 取该列内容的典型宽度（名称类 160–220、路径 / 描述类 240–300）；`copyableNoColumn(title, key, { flex: true })`
可把可复制编号列声明为弹性主列。

### 用户可拖拽列宽（resizable）

`resizable` 表格由 Semi 自行管理列宽，组件只剥离 `minWidth` 不介入布局。

---

## 操作列

`createOperationColumn` 的 `width` 是手写数值，与按钮内容无任何关联——加了动作却没同步宽度时
**不会报错**。单元格没有 `overflow: hidden`，所以症状不是按钮消失，而是先吃掉两侧 padding、
再挤压相邻的 `fixed: 'right'` 列。开发期 `ConfigurableTable` 会在内容宽超过列内可用宽时给出一次控制台告警；
新增或调整动作后必须按下式复核。

### 度量常量

均取自 `semi.min.css` 与 `ResponsiveTableActions` 的实际渲染，不是经验值：

| 项 | 值 | 来源 |
| --- | --- | --- |
| 文字按钮左右 padding | 12 + 12 = 24 | `.semi-button-size-small` |
| 按钮字号 | 14px / 600 | 同上 |
| 「更多」图标按钮 | 24 | `.semi-button-with-icon-only.semi-button-size-small` |
| 按钮间距 | 4 | `<Space spacing={4}>` |
| 单元格左右 padding | 16 + 16 = 32 | `.semi-table-row-cell` |

文字宽度：**汉字 14px/字**（全角即 1em），ASCII 约 7.8px/字、大写字母约 9px/字。

### 计算方式

```text
按钮宽 = 24 + 文字宽              // 2 字 52、3 字 66、4 字 80、5 字 94
内容宽 = Σ 内联按钮宽 + 4 × (按钮数 − 1)
        （有动作可能进「更多」时，再加 4 + 24 的「更多」按钮）
列宽   = 内容宽 + 40，向上取整到 10   // 40 = 32 单元格 padding + 8 留白
```

内容宽按**能同时出现的内联动作**取最大值：

- 权限条件（`hasPermission(...)`）**按全部为真**计算——超管会同时拿到所有动作
- 状态条件（`status === 'draft'` 与 `status !== 'draft'`）互斥，取各分支的最大值，不要相加
- `label` 随状态变化（`启用 / 停用`、`发布 / 申请发布`）时按最长文案计

判定口径：

| 关系 | 结论 |
| --- | --- |
| 列宽 < 内容宽 + 32 | **溢出**，禁止 |
| 列宽 − (内容宽 + 32) > 60 | **过宽**，收窄或把动作收进「更多」 |

### 内联动作的选择

规则（内联上限、按状态取舍、按 Tab 分状态、纯文字 `label`）见
[constraints-frontend.md → 搜索栏与表格](./constraints-frontend.md#搜索栏与表格)；落地参考：

- 推荐内联 2 个高频动作，其余经 `desktopInlineKeys` 收进「更多」（危险动作移入后仍是红色，`renderActionMenu` 已映射 `danger`）
- 状态互斥的动作让各状态行的内容宽接近，例：告警事件的 `认领 / 标记已处理` 内联，`查看日志 / 撤销认领` 进「更多」
- 「设为默认」「测试连接」「重置密钥」这类一次性 / 低频动作进「更多」

### 常用组合参考

| 动作 | 内容宽 | 列宽 |
| --- | --- | --- |
| 单个 2 字动作（详情 / 删除） | 52 | **100** |
| 单个 4 字动作 / 2 字 + 更多 | 80 | 120 |
| 编辑 / 删除 | 108 | **150** |
| 2 字 + 4 字（查看详情 / 删除） | 136 | 180 |
| 编辑 / 删除 + 更多 | 136 | **180** |
| 三个 2 字动作 | 164 | 210 |
| 2 字 + 4 字 + 更多 | 164 | 210 |
| 三个 2 字动作 + 更多 | 192 | 240 |
| 两个 2 字 + 一个 4 字（编辑 / 重置令牌 / 删除） | 192 | 240 |
| 两个 2 字 + 一个 4 字 + 更多 | 220 | 260 |

---

## 虚拟化表格

列表数据量较大（通常 > 500 条，如地区省市县、菜单树、日志）时为 `ConfigurableTable` 开启 `virtualized`。
`scroll.y` 是虚拟化生效的**必要条件**；列定义仍按[表格列宽](#表格列宽)写：一个弹性主列 `minWidth`、其余固定 `width`、
不写 `scroll.x`。

```tsx
const columns: ColumnProps<Region>[] = [
  { title: '地区名称', dataIndex: 'name', minWidth: 400 },   // 弹性主列（树形表格含缩进，最小宽度给足）
  { title: '区划代码', dataIndex: 'code', width: 140 },
  { title: '级别',    dataIndex: 'level', width: 90 },
  { title: '状态',    dataIndex: 'status', width: 90, fixed: 'right' },
  createOperationColumn<Region>({ width: 150, actions: (record) => [ … ] }),
];

<ConfigurableTable
  bordered
  virtualized
  scroll={{ y: tableHeight }}          // 只设 y；高度由页面按视口计算
  columns={columns}
  dataSource={list}
  rowKey="id"
  pagination={false}
  onRefresh={() => void treeQuery.refetch()}
  refreshLoading={treeQuery.isFetching}
/>
```

虚拟化模式下 Semi 把 `scroll.x` 直接写成 wrapper 的宽度、body 行宽取各列之和、纵向滚动条又占在 body 内部；
`ConfigurableTable` 量取容器宽度为弹性列计算显式宽度并锁定表头 `<table>` 宽度，页面不需要也不应再监听容器尺寸。

数据量小（< 200 条）且有复杂自定义渲染器的树形表格（如部门管理）**不建议**开启 `virtualized`。
开启后受控 `expandedRowKeys` 仍正常工作。
