# CRUD 前端实现参考（Step 8）

标准列表页的代码模板，以「xxx管理」为范例。参考实现：
`packages/web/src/pages/system/tenant-packages/TenantPackagesPage.tsx`（标准列表页）、
`packages/web/src/pages/users/UsersPage.tsx`（复杂页面）。

前置阅读：[query-cache.md](./query-cache.md)（数据获取与失效策略）。
约束条目见 [constraints-frontend.md](./constraints-frontend.md)；页面结构超出标准列表页（多 Tab、左右分栏、统计卡、
虚拟化表格、自适应栅格）见 [ui-patterns.md](./ui-patterns.md)。

```text
packages/web/src/hooks/queries/xxxs.ts     # 域 hooks（查询 + 变更）
packages/web/src/pages/xxx/XxxPage.tsx     # 页面组件
```

---

## Step 8a：域 hooks（`hooks/queries/xxxs.ts`）

标准 CRUD 的 keys、列表、详情、保存、删除与下拉源由 `createResourceQueries(xxxContract)` 按契约派生：
契约声明了 `all` 就有 `useLookup`，声明了 `removeBatch` 多条删除就走 `/batch`。URL、参数与响应类型全部来自契约，
hooks 文件里不出现路径字面量。

```ts
import { useMutation, useQuery } from '@tanstack/react-query';
import { xxxContract } from '@zenith/shared/{业务域}';
import { apiQueryOptions, apiRaw, createResourceQueries, useApiMutation } from '@/lib/contract-query';
import { unwrap } from '@/lib/query';

export const {
  keys: xxxKeys,
  useList: useXxxList,
  useDetail: useXxxDetail,
  useSave: useSaveXxx,
  useDelete: useDeleteXxxs,
  useLookup: useAllXxxs,        // 契约声明 all 时才有意义
} = createResourceQueries(xxxContract, {
  // onSaved: (qc) => invalidateCurrentUserAccess(qc), // 跨域联动的额外失效
});
```

工厂的 `keys` 与对应契约操作的 `contractKey` 同键（`keys.detail(id)` ≡ `contractKey(xxxContract.detail, { params: { id } })`），
工厂之外用 `useApiQuery` / `apiQueryOptions` 预取或失效同一操作时天然命中同一缓存。

工厂的失效行为见 [query-cache.md → 标准 CRUD 与手写 mutation 的边界](./query-cache.md#标准-crud-与手写-mutation-的边界)。
列表参数类型即契约查询参数（`QueryOf<typeof xxxContract.list>`），无需单独声明参数接口。

**非标准操作**同样由契约驱动：mutation 变量就是契约输入 `{ params?, query?, headers?, body? }`，
用工厂导出的 `keys` 做失效，并注释说明为何只失效这些：

```ts
/** 分配菜单：menuIds 只存在于详情，列表与下拉源都不含，故不失效它们 */
export const useAssignXxxMenus = () =>
  useApiMutation(xxxContract.assignMenus, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: xxxKeys.detail(params.id) });
    },
  });

/** 非标准命名的新增 / 编辑对（createRule / updateRule、slotCreate / slotUpdate…）：无 id 走前者、有 id 走后者 */
export const useSaveXxxRule = () =>
  useSaveMutation(xxxContract.createRule, xxxContract.updateRule, {
    invalidate: (qc, saved) => {
      void qc.invalidateQueries({ queryKey: xxxKeys.ruleDetail(saved.id) });
      void qc.invalidateQueries({ queryKey: xxxKeys.ruleLists });
    },
  });

/** 单个只读操作 */
export const useXxxStats = (id?: number) =>
  useQuery(apiQueryOptions(xxxContract.stats, { params: { id: id ?? 0 } }, { enabled: id !== undefined }));

/** 结果文案在信封 message 里（如「已清理 N 条」）：用 apiRaw 读取信封，unwrap 负责 code !== 0 抛错 */
export const usePurgeXxxs = () =>
  useMutation({
    mutationFn: async (days: number) => {
      const res = await apiRaw(xxxContract.purge, { query: { days } });
      unwrap(res);
      return res.message;
    },
  });
```

单操作的 query key 用 `contractKey(op, input)`；省略 input 得到该操作的公共前缀。非 JSON 通道（上传 `request.postForm` /
`<Upload action>`、下载 `request.download`、SSE `request.fetchRaw`）只需要地址：`urlOf(op, { params?, query? })`。

会员端 / 审批端用同一套函数，通过 `requestOptions: { client: memberRequest }` 指定请求实例。

> 关联下拉源属于**所有者域**：需要全量 Yyy 列表时，在 Yyy 契约声明 `all` 并实现服务端与 Mock，
> 随后从 Yyy 域 hooks 导出 `useAllYyys`。

---

## Step 8b：完整页面模板

列表页「每页都一样」的机制一律走 `components/list-page`：契约派生的工具栏（`ListSearchToolbar page={…} filters={[…]}`）、
标准操作列（`useCrudOperationColumn`）、状态开关列（`useStatusToggle`）、表格接线（`useListPage` 返回的 `tableProps`）。
搜索状态 → 列表查询 → 表格 props 由 `hooks/useListPage` **契约模式**一次接好：筛选状态类型 = 契约 list query 去分页键，
`defaults` / `toQuery` / `listKey` 不再由页面书写；筛选控件由契约 query 的 `x-filter` 语义派生（keyword → 搜索框，
enum → 下拉，bool → 是 / 否，id → 数字，成对时间端点 → 范围选择器）。页面只显式声明筛选键序、列、表单字段、权限与文案。

```tsx
import { Form, Row, Col } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { ListSearchToolbar, useCrudOperationColumn, useStatusToggle } from '@/components/list-page';
import { CreateButton } from '@/components/toolbar-controls';
import { EditFormModal } from '@/components/EditFormModal';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { useDictItems } from '@/hooks/useDictItems';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { useListPage } from '@/hooks/useListPage';
// beforeSave 需要中断提交时：import { abortSubmit } from '@/lib/abort-submit';
import { useDeleteXxxs, useSaveXxx, useXxxDetail, useXxxList } from '@/hooks/queries/xxxs';
import { xxxContract, type CreateXxxInput, type Xxx } from '@zenith/shared/{业务域}';

export default function XxxPage() {
  const { hasPermission } = usePermission();

  // ─── 契约模式：筛选状态即 xxxContract.list 的 query（去 page / pageSize），listKey = contractKey(contract.list) ──
  // useListPage 内部组合 useListSearch（draft / submitted 双状态 + 查询 / 重置必回源）、useFilterQuery（compactParams 后
  // 按内容稳定引用）、useList（契约派生的域 hook）与 listTableProps；结构上不可能漏 ...filterQuery、误传草稿或漏分页。
  const page = useListPage({
    contract: xxxContract,
    useList: useXxxList,                     // 必须是模块级稳定 hook（createResourceQueries 派生）
    // defaults: { status: 'enabled' },      // 初始筛选（重置回到这里）；缺省为空
    // params: { siteId },                   // 契约必填的作用域参数：原样传给 useList，不经 compact
    // enabled: siteId !== undefined,        // 作用域未就绪时不发请求
    // table: { rowSelection, empty: '暂无数据', loadingMode: 'always' },   // rowSelection / empty / rowKey / loadingMode → listTableProps
  });

  // ─── 新增 / 编辑弹窗 ────────────────────────────────────────────────────
  // 表单值类型取契约创建入参的部分形态；保存 mutation 的 values 类型与之一致
  const modal = useEditModal<Xxx, Partial<CreateXxxInput>>({
    entityName: '示例',              // 自动生成标题「新增示例 / 编辑示例」
    save: useSaveXxx(),
    useDetail: useXxxDetail,         // 编辑时懒加载详情，必须是模块级稳定函数
    // 父级绑定的子资源（字典项 / 节点外链）：详情查询还需要父 id 时，写一个模块级包装
    //   const useItemModalDetail: DetailHook<Item> = (id, enabled, record) => useItemDetail(record?.dictId ?? 0, id, enabled);
    defaults: { status: 'enabled' }, // 仅新增时使用
    toValues: (r) => ({              // 记录 → 表单值：null 归一为未填
      name: r.name,
      description: r.description ?? undefined,
      status: r.status,
    }),
    // beforeSave: (values) => { ... },           // 表单值 → 提交载荷，也是做跨字段校验的地方（中断用 abortSubmit()）
    // onSaved: (saved, { isEdit }) => { ... },   // 保存后的副作用（展示初始密码、跳转…）
    // labelWidth: 90,                            // 偏离默认值时才传
  });

  // ─── 其余变更 hooks ─────────────────────────────────────────────────────
  const toggleStatusMutation = useSaveXxx();  // 行级 Switch 专用实例，与弹窗保存互不影响 pending
  const deleteMutation = useDeleteXxxs();

  // 状态开关列：行内 loading、停用确认、成功提示由 hook 收口；载荷形状由 toggle 决定
  const status = useStatusToggle<Xxx>({
    toggle: (record, enabled) => toggleStatusMutation.mutateAsync({ id: record.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (record) => ({ title: '确认停用', content: `停用后「${record.name}」将不再可用，确认停用？` }),
    disabled: !hasPermission('system:xxx:update'),
  });

  // 标准操作列：[...extra, 编辑, ...extraBetween, 删除, ...extraAfter]；权限门控（:update / :delete）、删除确认 + 执行 + 提示都按约定接好
  const operationColumn = useCrudOperationColumn<Xxx>({
    permission: 'system:xxx',                   // 不按约定的资源传 permissions: { edit, remove }；页面已算好的布尔门控传 allow
    edit: modal,                                // useEditModal 的返回（取 openEdit）或 (record) => …
    remove: deleteMutation,                     // useDelete() 的 mutation（按 [record.id] 调用）或 (record) => …
    label: (r) => r.name,                       // 「确定要删除「xxx」吗？」；完全自定义标题用 title
    content: '删除后不可恢复',
    // hidden: { remove: (r) => r.isBuiltin },    // 行级隐藏；disabled: { remove, reason } 行级禁用
    // extra: (r) => [{ key: 'test', label: '测试', onClick: () => … }],   // 附加动作
    // width: 210, desktopInlineKeys: ['test', 'edit', 'delete'],           // 缺省 150，每组附加动作 +60
  });

  // options（{ value, label }[]）直接给表单 Form.Select 的 optionList；筛选栏的状态下拉已由契约派生，不再取 items
  const { options: statusOptions } = useDictItems('common_status');

  // ─── 表格列 ─────────────────────────────────────────────────────────────
  // 有且只有一个弹性主列（minWidth、不写 width），其余列固定 width；不传 scroll.x
  const columns: ColumnProps<Xxx>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 200 },
    { title: '描述', dataIndex: 'description', width: 260, render: renderEllipsis },
    createdAtColumn,                              // 创建时间预置列（自动格式化）
    status.column(),                              // 状态列：默认「状态」/ 80 / fixed right，紧靠操作列
    operationColumn,
  ];

  return (
    <div className="page-container">
      {/* 桌面：关键词 → 筛选 → 查询 / 重置 → 新增 → 低频操作；移动：主区 关键词 + 查询 + 新增，筛选进抽屉，低频操作进更多菜单 */}
      {/* filters 只声明契约 query 的键序（成对时间端点写 ['startTime', 'endTime']）；专用控件用 overrides，契约之外的手写控件放 extraFilters */}
      <ListSearchToolbar
        page={page}
        filters={['keyword', 'status', ['startTime', 'endTime']]}
        // overrides={{ deptId: (p) => <DeptPicker {...p.bind('deptId')} /> }}
        create={<CreateButton permission="system:xxx:create" onClick={modal.openCreate} />}
        {/* 导出：query 直接给 page.filterQuery（与列表同源）；权限门交给组件的 permission，不再手写 hasPermission ? : null */}
        actions={<ExportButton entity="system.xxxs" query={page.filterQuery} permission="system:xxx:export" />}
      />

      {/* 数据源 / loading / 刷新 / 分页（/ 多选）由 useListPage 的 tableProps 接好；默认 rowKey id · size small · bordered；
          标准列表页在 table 选项传 loadingMode: 'always'，查询 / 刷新 / 翻页期间显示整表 loading */}
      <ConfigurableTable<Xxx>
        columns={columns}
        {...page.tableProps}
      />
      {/* 新增 / 编辑共用一个弹窗：EditFormModal = AppModal({...modal.modalProps}) > Spin(detailLoading) > Form(key=formKey, formProps)，
          title / okText / width 直接作为属性覆盖；Form 之前的说明传 header，Form 额外属性传 formProps；抽屉形态用 EditFormSheet */}
      <EditFormModal modal={modal} width={660}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Input field="name" label="名称" placeholder="请输入名称"
              rules={[{ required: true, message: '名称不能为空' }]} />
          </Col>
          <Col span={12}>
            <Form.Select field="status" label="状态" style={{ width: '100%' }}
              optionList={statusOptions}
              rules={[{ required: true, message: '请选择状态' }]} />
          </Col>
        </Row>
        {/* 全宽字段（树形选择、长文本）直接写，不包 Col；奇数个字段时最后一个单独占左半列 */}
        <Form.TextArea field="description" label="描述" placeholder="请输入描述" />
      </EditFormModal>
    </div>
  );
}
```

契约派生的前提：契约 list query 用 `keywordQuery('名称 / 编码', { max? })` / `entityStatusQuery` / `queryEnum(VALUES, { dict | options })` /
`queryBool(desc, { labels? })` / `idQuery()` / `requiredIdQuery()` / `dictQuery('字典编码')` / `...dateRangeQuery('创建时间')` 声明
（crud-backend.md Step 4）——枚举下拉的标签来源（字典编码或 shared 的 `XXX_OPTIONS`）与布尔文案在契约里声明一次，OpenAPI 与筛选控件共用。
关联选择器（按产品 / 流程 / 标签下拉选 id）、带 `groups` / `filter` 等额外属性的控件在 `overrides` 里给出：
`overrides={{ productId: (p) => <FilterSelect items={productOptions} {...p.bind('productId')} /> }}`（键仍写进 `filters`，控件按声明位置渲染）；
不绑定筛选状态的控件（站点 / 账号切换）放 `extraFilters`。

**操作模式**：列表是契约的分页子操作（`contract.events` / `contract.accessLogs` / `contract.adminList` / `contract.recycle`…）时
`useListPage({ op: xxxContract.events, useList: useXxxEventList })`，筛选状态、`listKey` 与 `filterSchema` 同样由该操作的 query 派生。

**映射模式**（搜索状态不是契约 query 形状：客户端派生条件、字段改名、日期只到天…）保留
`useListPage({ defaults, listKey: xxxKeys.lists, useList, toQuery: (s) => ({ ... }) })` 与工具栏槽位写法
`<ListSearchToolbar keyword={<KeywordInput {...bindKeyword('keyword')} />} filters={...} onSearch={handleSearch} onReset={handleReset} />`；
新页面优先契约模式。

## 搜索参数与分页联动

`useListPage` 除 `contract` / `useList` / `toQuery` / `params` / `enabled` / `table` 外，其余选项与 `useListSearch` 相同（契约模式下 `defaults` 可选、`listKey` 由契约派生）：

| 选项 | 用途 |
| --- | --- |
| `extraKeys` | 一个页面同时驱动多个列表时，一并失效它们的 key |
| `refetchOnSearch: false` | 关闭「查询 / 重置」的回源：仅用于一次取全量、只在客户端过滤、随发布才变化的静态数据集（接口目录这类 `staleTime: Infinity` 的查询），查询只重新过滤不重新下载；`listKey` 仍用作「记住筛选条件」的标识 |
| `pageSize` / `pageSizeOpts` | 覆盖默认页大小（默认取用户偏好）/ 每页条数候选 |
| `resetKey` | 外部作用域（当前站点 / 公众号…）变化时回到第 1 页 |
| `onSearch` / `onReset` | 查询 / 重置后的额外副作用，如清空已选中的行 |
| `defaults` 传函数 | 「最近 7 天」这类相对当前时间的默认条件，每次重置重新求值 |

**不经输入框直接筛选**（点部门树 / 标签 / 收藏开关 / 应用保存的视图）用 `applySearch(params)`，
它同步更新 draft 与 submitted、回到第 1 页并失效列表：

```tsx
const { draftParams, applySearch } = useListPage({ ... });

onSelect={(deptId) => applySearch({ ...draftParams, departmentId: deptId })}
```

**非标准形态退一层用 `useListSearch` + `useFilterQuery`**：树形 / 不分页 / 客户端过滤的列表（菜单树、部门树、模板全量列表）、
一页多个列表、列表 hook 第二实参不是 `enabled`（轮询选项 / 作用域枚举）、会员端 `requestOptions`、`pagination` 需要翻页回调等。
`useListSearch` 的 `listKey` 传该数据的查询 key（如 `menuKeys.tree`），`submittedParams` 经
`const filterQuery = useFilterQuery({ ... })` 映射（compactParams 后按内容稳定引用，不写依赖数组）后进请求参数或客户端过滤谓词，
表格仍用 `listTableProps(listQuery, { pagination: buildPagination, loadingMode: 'always' })`。
它收口的「草稿 / 已提交双状态 + 查询必回源」与是否分页无关，
不要退回手写 `pendingKeyword` / `keyword` 两个 `useState` + `invalidateQueries`（参考 `DepartmentsPage`）。
只有**边输边筛、没有「查询」按钮语义**的即时过滤才不属于这两个 hook。

## 搜索工具栏筛选控件

| 组件 | 内置默认 | 覆盖方式 |
| --- | --- | --- |
| `KeywordInput` | 放大镜前缀、`showClear`、宽度 220 | `width` / `style` / 其余 props 原样穿透 |
| `FilterSelect` | 单选枚举筛选：`showClear`、宽度 120、清空回调 `undefined` | `placeholder`（必填，写「全部 X」）/ `width` / `items` 或 `groups` / `filter` 等 Select props 穿透 |
| `StatusSelect` | `FilterSelect` 的状态特化，占位固定「全部状态」 | `width` / `items` |
| `NumberFilter` | 单个数字筛选（ID / 阈值 / 金额上下界）：隐藏步进按钮、宽度 130、清空或非法输入回调 `undefined` | `placeholder`（必填，写明语义如「耗时 ≥ (ms)」）/ `width` / `min` / `max` / `precision` 等 InputNumber props 穿透 |
| `DateRangeFilter` | `dateTimeRange`、占位「开始时间/结束时间」、宽度 400（`DATE_TIME_RANGE_FILTER_WIDTH`） | `type="dateRange"`（占位「开始日期/结束日期」，宽度 280 = `DATE_RANGE_FILTER_WIDTH`）/ `placeholder` / `width`（只用于 `"100%"`、`style={{ flex: 1 }}` 这类自适应场景，**不要改小**） |

- 只收敛**装饰性属性**，业务属性（`items` / `placeholder`）仍显式传入；`value` / `onChange` 一律由
  `useListPage` / `useListSearch` 的 `bind('字段')` 展开（关键字用 `bindKeyword`，额外接回车触发的 `onSearch`），
  控件回传类型比字段宽时传 `parse`：`bind('status', (v) => enumValueOf(STATUSES, v))`
- 适用范围、占位 / 哨兵 / 空值规则见 [constraints-frontend.md → 搜索栏与表格](./constraints-frontend.md#搜索栏与表格)；
  `items` 取 shared 导出的 `XXX_OPTIONS` 或 `useDictItems(...).items`，表单 `Form.Select` 的 `optionList` 取 `useDictItems(...).options`，
  动态数据自行映射为 `{ value, label }`，需分组时传 `groups`
- `DateRangeFilter` 把 Semi 宽松的 `onChange` 收窄为 `[Date, Date] | null`，
  页面不必再写 `Array.isArray(v) && v.length >= 2` 之类的判断；区间状态统一声明为 `[Date, Date] | null`（或 `?: [Date, Date]`），
  提交时用 `utils/date` 的区间 helper（`...` 展开进参数对象）：
  秒级 `formatDateTimeRangeForApi(range)` → `{ startTime, endTime }`；日期级（`type="dateRange"`）`formatDateRangeForApi(range)`
  → `YYYY-MM-DD` 的 `{ startTime, endTime }`；契约端点键名不同（`startDate` / `endDate`、`dateStart` / `dateEnd`）时取元组形态
  `const [startDate, endDate] = formatDateRangeValuesForApi(range)` / `formatDateTimeRangeValuesForApi(range)`。
  日期级选择器**不要**套秒级 helper——终点会变成 `00:00:00`，服务端只对纯日期终点补到当天末尾
- 时间范围**只**用 `DateRangeFilter`：不手写 `DatePicker type="dateTimeRange"`，也不用两个 `type="dateTime"` 单选拼「开始 / 结束」。
  默认宽度是按内容算出的下限（Semi 把两个输入框均分剩余宽度，360 时末位秒数就会被截掉），
  确需自定义宽度的控件（如报表筛选条）以 `DATE_RANGE_FILTER_WIDTH` / `DATE_TIME_RANGE_FILTER_WIDTH` 作下限

## 危险操作确认

列表页里的删除一律用 `components/list-page` 的 `deleteAction`（操作列）/ `confirmAndDelete`（批量删除等按钮），
它们内部走 `confirmDelete` 并统一「执行 + 删除成功提示 + 收尾回调」。其它场景直接用 `utils/confirm`：

```ts
import { confirmDanger, confirmDangerAsync, confirmDelete } from '@/utils/confirm';

// 删除（非列表页场景）：优先写明对象的具体文案
confirmDelete({ title: '确定要删除该标签吗？', content: '删除后不可恢复', onOk });

// 其它破坏性操作
confirmDanger({ title: `重置「${name}」的签名密钥？`, content: '旧密钥将立即失效', onOk });

// async 流程里需要在确认后继续执行
if (!(await confirmDangerAsync({ title: `确认停用「${name}」？`, okText: '确认停用' }))) return;
```

三者都会注入红色实心确认按钮，其余选项原样透传给 `Modal.confirm`；
需要弱化样式时可覆盖 `okButtonProps: { theme: 'borderless' }`。状态开关的停用确认不要手写：
在 `useStatusToggle({ confirmDisable })` 里返回弹窗配置，破坏性语义加 `danger: true`。

## 弹窗表单布局

`labelPosition` / `closeOnEsc` 的要求与豁免见 [constraints-frontend.md → 表单与展示组件](./constraints-frontend.md#表单与展示组件)。

**Modal 宽度与表单列数**（`width` 由页面按内容决定，作为 `EditFormModal` 的属性单独传）：

- 有 **3 对及以上可并排的普通字段**（Input / Select / InputNumber）→ 双列布局，`width={660}`
- 字段较少，或主要是 TreeSelect / TextArea 等不适合并排的字段 → 单列布局，`width` 取 480–520

**`labelWidth` 选取**（在 `useEditModal({ labelWidth })` 里传，同一个 Form 内保持统一）：

| 标签文字 | 取值 |
| --- | --- |
| ≤3 字（名称、状态、邮箱） | 72 |
| 4–5 字（部门名称、联系电话） | 90（默认） |
| ≥6 字（上级部门名称、所属租户） | 110 或 120 |

## 多选下拉展示

先区分集合选择和必须核对顺序的编辑，再决定展示上限。普通表单可参考 2–3 项，窄筛选栏可参考 1–2 项；
数量是按字段宽度和标签长度选择的展示预算，不是业务限制。固定且短的枚举可把展示上限设为全部选项数，
以接入单行布局而不刻意隐藏标签。

```tsx
<Form.Select field="roleIds" label="角色" multiple filter
  maxTagCount={2} showRestTagsPopover
  style={{ width: '100%' }} optionList={roleOptions} />

// TreeSelect 默认在下拉面板搜索，保持该模式以使用现有树形多选适配。
<Form.TreeSelect field="departmentIds" label="部门" multiple filterTreeNode
  maxTagCount={3} showRestTagsPopover
  style={{ width: '100%' }} treeData={departmentTreeData} />
```

「偏好设置 → 通用 → 多选框布局」默认保持单行，可选择自动换行。`styles/global.css` 根据 body 上的
`data-multi-select-layout` 处理已折叠标签的布局：普通 Select 使用直接 TagGroup 子节点，TreeSelect 仅适配
下拉面板搜索的数量受限标签组。不要为了接入偏好逐页添加 `ellipsisTrigger`：它会切换到另一套渲染结构，
需要单独验证。未设置上限、`expandRestTagsOnClick` 显式展开、TreeSelect 触发器内搜索不在该规则范围内。

人员、字典、部门选择分别复用 `UserSelect` / `UserSelectBase`、`DictSelect`、`DepartmentSelect`；
工作流动态表单的普通 `multiSelect` 由共享 `FieldRenderer` 统一设置展示属性，不改字段值或保存协议。
主后台经 `PreferencesProvider` 应用偏好；独立移动审批经 `ApprovalPreferencesBoundary` 使用自己的请求实例
读取个人偏好和系统策略。会员身份与管理员隔离，不能复用管理员偏好客户端。

顺序会签名单、摘要字段顺序、自由路径编辑和禁用画布占位预览可保留完整标签；不要为统一外观隐藏业务顺序。
仅限制数量但永远不会隐藏选项的字段不必添加剩余项浮层。触控端不能仅靠 hover 查看隐藏项，应能在下拉内核对和移除选择；
Semi 的普通 Select 剩余标签有延迟生成逻辑，不要未经触控验证就将 Popover 改为纯 click。

验证重点是选择、打开、搜索、清空、收起的高度一致，以及 `+N`、输入光标和完整已选项可访问；
同时核对自动换行偏好仍恢复组件原行为。用实际浏览器检查这些布局行为，纯 DOM 单测不能证明没有换行。

## 权限控制

```tsx
const { hasPermission } = usePermission();

// 工具栏新增 / 导出：权限门交给组件自身的 permission，无权限时不渲染
<CreateButton permission="system:xxx:create" onClick={modal.openCreate} />
<ExportButton entity="system.xxxs" query={filterQuery} permission="system:xxx:export" />

// 其它按钮 / 操作列条目：仍用 hasPermission 判断（或 createOperationColumn 条目的 hidden）
{hasPermission('system:xxx:update') && <Button onClick={...}>同步</Button>}
```

## 批量操作（Step 0 确认需要时）

多选状态走 `components/list-page` 的 `useRowSelection`（Semi 回传的 keys 归一、`clear` 引用稳定、`rowSelection` 直接接线），
在 `useListPage` **之前**声明，这样 `onSearch: clearSelection` 与 `table: { rowSelection }` 可直接引用：

```tsx
const { selectedRowKeys, hasSelection, clear: clearSelection, rowSelection } = useRowSelection();
// 行键为字符串时 useRowSelection<string>()；行级禁用传 { extra: { getCheckboxProps: (r) => ({ disabled: … }) } }
const { ..., tableProps } = useListPage({ defaults, listKey: xxxKeys.lists, useList: useXxxList, toQuery, onSearch: clearSelection, table: { rowSelection } });

const handleBatchDelete = () => confirmAndDelete({
  title: `确认删除选中的 ${selectedRowKeys.length} 条记录？`,
  content: '删除后无法恢复，请谨慎操作。',
  run: () => deleteMutation.mutateAsync(selectedRowKeys),   // 复用 useDeleteXxxs
  successMessage: '批量删除成功',
  onDeleted: clearSelection,
});

// 工具栏 actions 槽：仅「有选中 && 有权限」时渲染（工具栏据此决定移动端是否出现更多菜单）
{hasSelection && hasPermission('system:xxx:delete') && <BatchDeleteButton count={selectedRowKeys.length} onClick={handleBatchDelete} />}

<ConfigurableTable<Xxx> columns={columns} {...tableProps} />
```

`useDeleteXxxs` 内部按 ids 长度自动选择 `remove` / `removeBatch`（契约未声明 `removeBatch` 时并发逐条删除）。

**批量启用 / 停用**同样不手写确认→提交→清选中→Toast 流程：

```tsx
import { batchStatusHandler } from '@/components/list-page';
import { BatchStatusButtons } from '@/components/toolbar-controls';

// 默认只有停用弹确认；启用 / 停用都要确认传 confirm: 'always'，禁用账号之类的破坏性停用加 danger: true（红色实心确认）
const handleBatchStatus = batchStatusHandler({
  selectedRowKeys, clearSelection,
  run: (ids, status) => batchStatusMutation.mutateAsync({ body: { ids, status } }),   // 载荷形状在此适配（{ ids, enabled } / 两个 mutation 亦可）
  entity: '个示例',                                                                   // 「确认批量停用选中的 N 个示例？」
  confirmContent: (status, count) => (status === 'disabled' ? `停用后 ${count} 个示例将不可用` : undefined),
});

// 工具栏 actions 槽：仍由调用方按「有选中 && 有权限」判断是否渲染；文案为「禁用」时传 disableLabel="批量禁用"
{hasSelection && canUpdate && <BatchStatusButtons count={selectedRowKeys.length} onChange={handleBatchStatus} />}
```

## 即时过滤页（无「查询」按钮）

进程 / 服务 / 容器 / 端口这类一次取全量、在客户端边输边筛的页面不用 `useListSearch`，工具栏用 `components/list-page` 的
`InstantFilterToolbar`：控件仍由页面创建并直接受控，刷新与重置由组件按桌面 / 移动排布：

```tsx
<InstantFilterToolbar
  primary={<KeywordInput placeholder="搜索服务名 / 描述" value={keyword} onChange={setKeyword} />}
  filters={<StatusSelect items={SERVICE_STATE_OPTIONS} value={state} onChange={setState} />}
  onRefresh={() => void listQuery.refetch()}
  refreshing={listQuery.isFetching}
  onReset={() => setState(undefined)}
  actions={canManage && <CreateButton onClick={openCreate} />}
  extra={<Typography.Text type="tertiary" size="small">共 {filtered.length} 项</Typography.Text>}   // 仅桌面展示
/>
```

## 状态与时间的展示

- 状态选项用 `useDictItems('common_status')`：筛选栏用 `items`，表单 `Form.Select` 用 `options`；表格中用
  `<DictTag dictCode="common_status" value={status} />` 或手动 `find` 映射；当前用户不可切换的只读启停列直接放
  `enabledStatusColumn()`（`utils/table-columns`，与 `useStatusToggle().column()` 同位同宽）
- 时间列用 `utils/table-columns` 的列工厂（`dateTimeColumn` / `dateColumn`，`createdAt` / `updatedAt` 直接用预置的
  `createdAtColumn` / `updatedAtColumn`），长文本列用 `renderEllipsis`
- 非列渲染场景可直接 `formatDateTime()`（`utils/date`）
