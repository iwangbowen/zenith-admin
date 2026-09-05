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
  // keyPrefix: ['workflow', 'automations'], // 本域需被纳入某个跨域失效前缀时指定
  // onSaved: (qc) => invalidateCurrentUserAccess(qc), // 跨域联动的额外失效
});
```

工厂已覆盖的失效契约：保存后失效 `detail(id)` + `lists` +（契约有 `all` 时）`lookup`；
删除后 `removeQueries(detail(id))` + 失效 `lists` +（有 `all` 时）`lookup`。
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

```tsx
import { useState } from 'react';
import { Form, Input, Select, Spin, Toast, Modal, Switch, Row, Col } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { DateRangeFilter, KeywordInput, StatusSelect } from '@/components/search-filters';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import AppModal from '@/components/AppModal';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { useDictItems } from '@/hooks/useDictItems';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { confirmDelete } from '@/utils/confirm';
// 有日期时间范围筛选时：import { formatDateTimeRangeForApi } from '@/utils/date';
// beforeSave 需要中断提交时：import { abortSubmit } from '@/lib/abort-submit';
import { useDeleteXxxs, useSaveXxx, useXxxDetail, useXxxList, xxxKeys } from '@/hooks/queries/xxxs';
import { enumValueOf } from '@zenith/shared/core';
import { XXX_STATUSES, type CreateXxxInput, type Xxx } from '@zenith/shared/{业务域}';

interface SearchParams {
  keyword: string;
  /** 枚举筛选字段一律可选：undefined = 不过滤 */
  status?: string;
  // timeRange: [Date, Date] | null;
}

const defaultSearchParams: SearchParams = { keyword: '', status: undefined };

export default function XxxPage() {
  const { hasPermission } = usePermission();

  // ─── 搜索状态：draft 绑输入框，submitted 进 query key ────────────────────
  // useListSearch 内部整合 usePagination，并保证「查询 / 重置」必定失效 listKey
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: xxxKeys.lists });

  // ─── 列表查询（key 驱动：page/pageSize/submittedParams 变化自动请求）────
  const listQuery = useXxxList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    // 契约查询参数按枚举声明，筛选控件的 string 值先收窄
    status: enumValueOf(XXX_STATUSES, submittedParams.status),
    // 标准 startTime / endTime 范围（Date → 字符串后再进 params）：
    // ...formatDateTimeRangeForApi(submittedParams.timeRange),
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  // ─── 新增 / 编辑弹窗 ────────────────────────────────────────────────────
  // 表单值类型取契约创建入参的部分形态；保存 mutation 的 values 类型与之一致
  const modal = useEditModal<Xxx, Partial<CreateXxxInput>>({
    entityName: '示例',              // 自动生成标题「新增示例 / 编辑示例」
    save: useSaveXxx(),
    useDetail: useXxxDetail,         // 编辑时懒加载详情，必须是模块级稳定函数
    defaults: { status: 'enabled' }, // 仅新增时使用
    toValues: (r) => ({              // 记录 → 表单值：null 归一为未填
      name: r.name,
      description: r.description ?? undefined,
      status: r.status,
      // 多对多：yyyIds: r.yyyIds ?? [],
    }),
    // 表单值 → 提交载荷，也是做跨字段校验的地方
    // beforeSave: (values) => {
    //   if (!values.expireAt) { Toast.warning('请选择过期时间'); abortSubmit(); }
    //   return { ...values, expireAt: formatDateTimeForApi(values.expireAt) };
    // },
    // onSaved: (saved, { isEdit }) => { ... },   // 保存后的副作用（展示初始密码、跳转…）
    // successMessage: () => null,                // 保存后另有更强反馈时抑制默认提示
    // labelWidth: 90,                            // 偏离默认值时才传
  });

  // ─── 其余变更 hooks ─────────────────────────────────────────────────────
  const toggleStatusMutation = useSaveXxx();  // 行级 Switch 专用实例，便于按行显示 pending
  const deleteMutation = useDeleteXxxs();
  const togglingId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  const { items: statusItems } = useDictItems('common_status');

  const buildExportQuery = (): Record<string, unknown> => ({
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(XXX_STATUSES, submittedParams.status),
  });

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync([id]);
    Toast.success('删除成功');
  }

  // status 字段为 'enabled'|'disabled' 时用此模式；boolean 字段改为 { isEnabled: checked }
  function handleToggleStatus(record: Xxx, checked: boolean) {
    const doToggle = () => {
      toggleStatusMutation.mutate(
        { id: record.id, values: { status: checked ? 'enabled' : 'disabled' } },
        { onSuccess: () => Toast.success(checked ? '已启用' : '已停用') },
      );
    };
    // 停用是非破坏性确认，用原生 Modal.confirm（不加 danger）
    if (checked) doToggle();
    else Modal.confirm({
      title: '确认停用',
      content: `停用后「${record.name}」将不再可用，确认停用？`,
      onOk: doToggle,
    });
  }

  // ─── 表格列 ─────────────────────────────────────────────────────────────
  // 有且只有一个弹性主列（minWidth、不写 width），其余列固定 width；不传 scroll.x
  const columns: ColumnProps<Xxx>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 200 },
    { title: '描述', dataIndex: 'description', width: 260, render: renderEllipsis },
    createdAtColumn,                              // 创建时间预置列（自动格式化）
    {
      // 状态列紧靠操作列左侧，同样 fixed: 'right'
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (_: unknown, record: Xxx) => (
        <Switch
          checked={record.status === 'enabled'}
          loading={togglingId === record.id}
          disabled={!hasPermission('system:xxx:update')}
          onChange={(checked) => handleToggleStatus(record, checked)}
          size="small"
        />
      ),
    },
    createOperationColumn<Xxx>({
      width: 150,                                 // 编辑 / 删除：内容宽 108 + 40 → 150（ui-patterns.md → 操作列）
      desktopInlineKeys: ['edit', 'delete'],      // 只把高频动作内联（≤ 3 个），其余进更多菜单
      actions: (record) => [
        ...(hasPermission('system:xxx:update') ? [{
          key: 'edit', label: '编辑', onClick: () => modal.openEdit(record),
        }] : []),
        ...(hasPermission('system:xxx:delete') ? [{
          key: 'delete', label: '删除', danger: true,
          onClick: () => confirmDelete({
            title: `确定要删除「${record.name}」吗？`,
            content: '删除后不可恢复',
            onOk: () => handleDelete(record.id),
          }),
        }] : []),
      ],
    }),
  ];

  // ─── 工具栏片段（筛选控件与公共按钮一律走公共组件）───────────────────────
  const renderKeywordSearch = () => (
    <KeywordInput
      placeholder="搜索名称..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      onSearch={handleSearch}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={statusItems}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  // const renderTimeRangeFilter = () => (
  //   <DateRangeFilter value={draftParams.timeRange}
  //     onChange={(v) => setDraftParams((p) => ({ ...p, timeRange: v }))} />
  // );

  const renderCreateButton = () => hasPermission('system:xxx:create')
    ? <CreateButton onClick={modal.openCreate} /> : null;

  const renderExportButtons = () => hasPermission('system:xxx:export')
    ? <ExportButton entity="system.xxxs" query={buildExportQuery()} /> : null;

  // mobileActions 里的按钮用无边框视觉；导出用 ExportButton variant="flat"
  const renderMobileExportActions = () => hasPermission('system:xxx:export')
    ? <ExportButton entity="system.xxxs" query={buildExportQuery()} label="导出" variant="flat" /> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>
          {renderKeywordSearch()}
          {renderStatusFilter()}
          <SearchButton onClick={handleSearch} />
          <ResetButton onClick={handleReset} />
        </>}
        actions={<>
          {renderExportButtons()}
          {renderCreateButton()}
        </>}
        // 移动端至少露出一个高频筛选项 + 查询 + 新增，其余进筛选抽屉与更多菜单
        mobilePrimary={<>
          {renderKeywordSearch()}
          <SearchButton onClick={handleSearch} />
          {renderCreateButton()}
        </>}
        mobileFilters={renderStatusFilter()}
        mobileActions={renderMobileExportActions()}
        filterTitle="筛选条件"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无数据"
        onRefresh={() => void listQuery.refetch()}    // 必传，否则工具栏无刷新按钮
        refreshLoading={listQuery.isFetching}         // 必传
        pagination={buildPagination(total)}           // 翻页由 key 驱动，无需回调
      />

      {/* 新增 / 编辑共用一个弹窗 */}
      <AppModal {...modal.modalProps} width={660}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          {/* formProps 已含 key（详情到达时重挂载）、getFormApi、allowEmpty、
              initValues、labelPosition 与 labelWidth */}
          <Form {...modal.formProps}>
            {/* 全宽字段（树形选择、长文本）：直接写，不包 Col */}
            <Form.TreeSelect field="parentId" label="上级" style={{ width: '100%' }}
              treeData={[]} placeholder="请选择上级" filterTreeNode showClear />
            {/* 双列：Row gutter={16} + Col span={12} */}
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="name" label="名称" placeholder="请输入名称"
                  rules={[{ required: true, message: '名称不能为空' }]} />
              </Col>
              <Col span={12}>
                <Form.Input field="code" label="编码" placeholder="请输入编码" />
              </Col>
            </Row>
            {/* 奇数个字段时最后一个单独占左半列 */}
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select field="status" label="状态" style={{ width: '100%' }}
                  optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
                  rules={[{ required: true, message: '请选择状态' }]} />
              </Col>
            </Row>
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
```

---

## 搜索参数与分页联动

`useListSearch` 可选项：

| 选项 | 用途 |
| --- | --- |
| `extraKeys` | 一个页面同时驱动多个列表时，一并失效它们的 key |
| `pageSize` | 覆盖默认页大小（默认取用户偏好） |
| `onSearch` / `onReset` | 查询 / 重置后的额外副作用，如清空已选中的行 |
| `defaults` 传函数 | 「最近 7 天」这类相对当前时间的默认条件，每次重置重新求值 |

**不经输入框直接筛选**（点部门树 / 标签 / 收藏开关 / 应用保存的视图）用 `applySearch(params)`，
它同步更新 draft 与 submitted、回到第 1 页并失效列表：

```tsx
const { draftParams, applySearch } = useListSearch<SearchParams>({ ... });

onSelect={(deptId) => applySearch({ ...draftParams, departmentId: deptId })}
```

## 搜索工具栏筛选控件

| 组件 | 内置默认 | 覆盖方式 |
| --- | --- | --- |
| `KeywordInput` | 放大镜前缀、`showClear`、宽度 220 | `width` / `style` / 其余 props 原样穿透 |
| `FilterSelect` | 单选枚举筛选：`showClear`、宽度 120、清空回调 `undefined` | `placeholder`（必填，写「全部 X」）/ `width` / `items` 或 `groups` / `filter` 等 Select props 穿透 |
| `StatusSelect` | `FilterSelect` 的状态特化，占位固定「全部状态」 | `width` / `items` |
| `DateRangeFilter` | `dateTimeRange`、占位「开始时间/结束时间」、宽度 360 | `type="dateRange"`（宽度自动 260）/ `placeholder` / `width` |

- 只收敛**装饰性属性**，业务属性（`value` / `onChange` / `items` / `placeholder`）仍显式传入
- 列表页搜索栏（含 Tab / 抽屉 / 展开行内的子列表）里所有「全部 X」形态的单选枚举筛选都用 `FilterSelect`，状态用 `StatusSelect`；
  `items` 取 shared 导出的 `XXX_OPTIONS` 或 `useDictItems(...).items`，动态数据自行映射为 `{ value, label }`，需分组时传 `groups`
- 空值统一为 `undefined`（`SearchParams` 中声明为可选字段、`defaults` 写 `undefined`）；选项里不放「全部」哨兵项，占位不写「请选择 X」
- 多选筛选、必选的上下文选择（视图切换、所属应用等没有「全部」语义的下拉）不属于枚举筛选，用原生 `Select`
- `DateRangeFilter` 把 Semi 宽松的 `onChange` 收窄为 `[Date, Date] | null`，
  页面不必再写 `Array.isArray(v) && v.length >= 2` 之类的判断

## 危险操作确认

```ts
import { confirmDanger, confirmDangerAsync, confirmDelete } from '@/utils/confirm';

// 删除：优先写明对象的具体文案
confirmDelete({ title: '确定要删除该标签吗？', content: '删除后不可恢复', onOk });
// 省略 title 时用默认标题「确定要删除吗？」
confirmDelete({ onOk: () => handleDelete(row.id) });

// 其它破坏性操作
confirmDanger({ title: `重置「${name}」的签名密钥？`, content: '旧密钥将立即失效', onOk });

// async 流程里需要在确认后继续执行（如停用前二次确认）
if (!(await confirmDangerAsync({ title: `确认停用「${name}」？`, okText: '确认停用' }))) return;
```

三者都会注入红色实心确认按钮，其余选项原样透传给 `Modal.confirm`，调用点不要再写 `okButtonProps: { type: 'danger' }`；
需要弱化样式时可覆盖 `okButtonProps: { theme: 'borderless' }`。

## 弹窗表单布局

`labelPosition="left"`、`closeOnEsc` 与表单重挂载 `key` 均由 `useEditModal` 的
`formProps` / `modalProps` 提供，不要在页面重复书写。不经 `useEditModal` 的弹窗（纯展示、确认类）
仍需自行加 `closeOnEsc`。

**Modal 宽度与表单列数**（`width` 由页面按内容决定，展开 `modalProps` 后单独传）：

- 有 **3 对及以上可并排的普通字段**（Input / Select / InputNumber）→ 双列布局，`width={660}`
- 字段较少，或主要是 TreeSelect / TextArea 等不适合并排的字段 → 单列布局，`width` 取 480–520

**`labelWidth` 选取**（在 `useEditModal({ labelWidth })` 里传，同一个 Form 内保持统一）：

| 标签文字 | 取值 |
| --- | --- |
| ≤3 字（名称、状态、邮箱） | 72 |
| 4–5 字（部门名称、联系电话） | 90（默认） |
| ≥6 字（上级部门名称、所属租户） | 110 或 120 |

## 权限控制

```tsx
const { hasPermission } = usePermission();

{hasPermission('system:xxx:create') && <CreateButton onClick={modal.openCreate} />}
```

## 批量操作（Step 0 确认需要时）

```tsx
const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

const handleBatchDelete = () => {
  confirmDelete({
    title: `确认删除选中的 ${selectedRowKeys.length} 条记录？`,
    content: '删除后无法恢复，请谨慎操作。',
    onOk: async () => {
      await deleteMutation.mutateAsync(selectedRowKeys);   // 复用 useDeleteXxxs
      Toast.success('批量删除成功');
      setSelectedRowKeys([]);
    },
  });
};

// 工具栏：仅选中时显示，放在查询 / 重置按钮之后
{selectedRowKeys.length > 0 && hasPermission('system:xxx:delete') && (
  <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
    批量删除 ({selectedRowKeys.length})
  </Button>
)}

<ConfigurableTable
  rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys as number[]) }}
  bordered
  onRefresh={() => void listQuery.refetch()}
  refreshLoading={listQuery.isFetching}
  ...
/>
```

`useDeleteXxxs` 内部按 ids 长度自动选择 `remove` / `removeBatch`（契约未声明 `removeBatch` 时并发逐条删除）。

## 状态与时间的展示

- 状态选项用 `useDictItems('common_status')`；表格中用
  `<DictTag dictCode="common_status" value={status} />` 或手动 `find` 映射
- 列渲染用 `createdAtColumn`（自动格式化 + 省略 tooltip）与 `renderEllipsis`（`utils/table-columns`）
- 非列渲染场景可直接 `formatDateTime()`（`utils/date`）
