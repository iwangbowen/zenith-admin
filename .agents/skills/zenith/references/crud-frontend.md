# CRUD 前端实现参考（以「xxx管理」为范例）

本文档提供前端页面的完整代码模板，对照 `packages/web/src/pages/users/UsersPage.tsx` 的实际实现。

> **占位符约定**：`xxx` = 小写（表名、API 路径、文件名）；`Xxx` = 大驼峰（TypeScript 类型、组件名）；替换时请将所有 `xxx`/`Xxx` 替换为实际实体名。

---

## 文件位置

```text
packages/web/src/pages/xxx/XxxPage.tsx
```

---

## 完整页面模板

```tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button, Form, Input, Select, Spin,
  Toast, Modal, Switch,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { useDictItems } from '@/hooks/useDictItems';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import type { Xxx, PaginatedResponse } from '@zenith/shared';

// ─── 搜索参数类型 ────────────────────────────────────────────────────────
interface SearchParams {
  keyword: string;
  status: string;
  // 如有时间范围筛选：
  // timeRange: [Date, Date] | null;
}

const defaultSearchParams: SearchParams = {
  keyword: '',
  status: '',
};

// ════════════════════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════════════════════
export default function XxxPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);

  // ─── 状态 ──────────────────────────────────────────────────────────────
  const [data, setData] = useState<PaginatedResponse<Xxx> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  // ⚠️ ref 同步最新搜索参数，避免 fetchXxxs 将 searchParams 放入 deps 导致输入时自动触发搜索
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;

  // 弹窗状态
  const [modalVisible, setModalVisible] = useState(false);
  const [editingXxx, setEditingXxx] = useState<Xxx | null>(null);  // null=新增，有值=编辑
  const [submitting, setSubmitting] = useState(false);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);

  // 状态切换 loading（per-row）
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());

  // 字典数据（使用 useDictItems 加载）
  const { items: statusItems } = useDictItems('common_status');

  // 如需加载下拉选项（如关联实体列表），在此初始化：
  // const [allYyys, setAllYyys] = useState<Yyy[]>([]);

  // ─── 初始化（并行加载下拉数据）──────────────────────────────────────────
  useEffect(() => {
    // 如需关联数据，在此并行加载：
    // Promise.all([
    //   request.get<Yyy[]>('/api/yyys'),
    // ]).then(([yyyRes]) => {
    //   if (yyyRes.code === 0) setAllYyys(yyyRes.data);
    // });
  }, []);

  // ─── 数据加载 ──────────────────────────────────────────────────────────
  // params 为可选：不传时从 ref 读取最新值（避免 stale closure）；
  // 显式传 defaultSearchParams 时用于重置后立即刷新
  const fetchXxxs = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const activeParams = params ?? searchParamsRef.current;
      setLoading(true);
      try {
        const queryObj: Record<string, string> = {
          page: String(p),
          pageSize: String(ps),
        };
        if (activeParams.keyword) queryObj.keyword = activeParams.keyword;
        if (activeParams.status) queryObj.status = activeParams.status;
        // 如有时间范围：
        // if (activeParams.timeRange) {
        //   queryObj.startTime = formatDateTimeForApi(activeParams.timeRange[0]);
        //   queryObj.endTime = formatDateTimeForApi(activeParams.timeRange[1]);
        // }

        const query = new URLSearchParams(queryObj).toString();
        const res = await request.get<PaginatedResponse<Xxx>>(`/api/xxxs?${query}`);
        if (res.code === 0) {
          setData(res.data);
          setPage(res.data.page);
          setPageSize(res.data.pageSize);
        }
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, pageSize],  // 不加 searchParams，靠 ref 读取最新值
  );

  useEffect(() => {
    void fetchXxxs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // 仅首次加载，后续通过 handleSearch / handlePageChange 触发

  // ─── 搜索 / 重置 ────────────────────────────────────────────────────────
  function handleSearch() {
    setPage(1);
    void fetchXxxs(1, pageSize);  // 从 ref 读取最新 searchParams，无需传参
  }

  function handleReset() {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchXxxs(1, pageSize, defaultSearchParams);  // 重置后立即传入默认值
  }

  // ─── 导出（导出中心）──────────────────────────────────────────────────
  function buildExportQuery(): Record<string, unknown> {
    const params = searchParamsRef.current;
    return {
      keyword: params.keyword || undefined,
      status: params.status || undefined,
    };
  }

  // ─── 新增 / 编辑 ──────────────────────────────────────────────────────
  function openCreate() {
    setEditingXxx(null);
    setModalVisible(true);
  }

  async function openEdit(record: Xxx) {
    setEditingXxx(record);
    setModalVisible(true);
    setModalDetailLoading(true);
    const res = await request.get<Xxx>(`/api/xxxs/${record.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) {
      setEditingXxx(res.data);
    } else {
      Toast.error(res.message || '获取信息失败');
    }
  }

  function closeModal() {
    setModalVisible(false);
    setEditingXxx(null);
    setModalDetailLoading(false);
  }

  // Form 初始值（编辑时回填，新增时清空）
  const formInitValues = editingXxx
    ? {
        name: editingXxx.name,
        description: editingXxx.description,
        status: editingXxx.status,
        // 多对多字段示例：yyyIds: editingXxx.yyyIds ?? [],
      }
    : { status: 'enabled' };

  async function handleModalOk() {
    let values: any;
    try {
      values = await formApi.current?.validate();
    } catch {
      throw new Error('validation');  // 阻止 Modal 关闭
    }

    setSubmitting(true);
    try {
      const res = editingXxx
        ? await request.put(`/api/xxxs/${editingXxx.id}`, values)
        : await request.post('/api/xxxs', values);

      if (res.code === 0) {
        Toast.success(editingXxx ? '更新成功' : '创建成功');
        closeModal();
        void fetchXxxs();
      } else {
        throw new Error(res.message);  // 阻止 Modal 关闭
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ─── 删除 ──────────────────────────────────────────────────────────────
  async function handleDelete(id: number) {
    const res = await request.delete(`/api/xxxs/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchXxxs();
    }
  }

  // ─── 状态切换（Switch 直接修改）────────────────────────────────────────
  // status 字段为 'enabled'|'disabled' 时使用此模式
  // boolean 字段时改为 { isEnabled: checked }
  function handleToggleStatus(record: Xxx, checked: boolean) {
    const doToggle = async () => {
      setTogglingIds((prev) => new Set(prev).add(record.id));
      try {
        await request.put(`/api/xxxs/${record.id}`, { status: checked ? 'enabled' : 'disabled' });
        Toast.success(checked ? '已启用' : '已停用');
        void fetchXxxs();
      } catch (err: unknown) {
        Toast.error((err as { message?: string })?.message || '操作失败');
      } finally {
        setTogglingIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; });
      }
    };
    if (checked) {
      void doToggle();
    } else {
      Modal.confirm({
        title: '确认停用',
        content: `停用后「${record.name}」将不再可用，确认停用？`,
        onOk: () => void doToggle(),
      });
    }
  }

  // ─── 表格列定义 ────────────────────────────────────────────────────────
  const columns: ColumnProps<Xxx>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 200,
    },
    {
      title: '描述',
      dataIndex: 'description',
      width: 260,
      render: (val) => val || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (t) => formatDateTime(t),  // 必须用 formatDateTime，禁止原生方法
    },
    {
      // 状态列：放在操作列左侧紧靠操作列，必须 fixed: 'right'
      // 使用 Switch 直接切换，停用时弹二次确认
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right',
      render: (_: unknown, record: Xxx) => (
        <Switch
          checked={record.status === 'enabled'}
          loading={togglingIds.has(record.id)}
          disabled={!hasPermission('system:xxx:update')}
          onChange={(checked) => handleToggleStatus(record, checked)}
          size="small"
        />
      ),
    },
    createOperationColumn<Xxx>({
      width: 160,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        ...(hasPermission('system:xxx:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(record),
        }] : []),
        ...(hasPermission('system:xxx:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除吗？',
              content: '删除后不可恢复',
              onOk: () => handleDelete(record.id),
            });
          },
        }] : []),
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索名称..."
      value={searchParams.keyword}
      onChange={(v) => setSearchParams((p) => ({ ...p, keyword: v }))}
      showClear
      style={{ width: 220 }}
      onEnterPress={handleSearch}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={searchParams.status || undefined}
      onChange={(v) =>
        setSearchParams((p) => ({ ...p, status: (v as string) ?? '' }))
      }
      showClear
      style={{ width: 120 }}
      optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  );

  const renderCreateButton = () => hasPermission('system:xxx:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  ) : null;

  const renderExportButtons = () => hasPermission('system:xxx:export') ? (
    <ExportButton entity="system.xxxs" query={buildExportQuery()} />
  ) : null;

  const renderMobileExportActions = () => hasPermission('system:xxx:export') ? (
    <ExportButton entity="system.xxxs" query={buildExportQuery()} label="导出" />
  ) : null;

  // ════════════════════════════════════════════════════════════════════════
  // 渲染
  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="page-container">
      {/* 搜索区：筛选/操作较多时使用结构化 SearchToolbar，移动端自动精简 */}
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        actions={(
          <>
            {renderExportButtons()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderStatusFilter()}
          </>
        )}
        mobileActions={renderMobileExportActions()}
        filterTitle="筛选条件"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {/* 数据表格 */}
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={loading}
        rowKey="id"
        size="small"
        empty="暂无数据"
        onRefresh={() => void fetchXxxs()}
        refreshLoading={loading}
        pagination={buildPagination(data?.total ?? 0, fetchXxxs)}
      />

      {/* 新增/编辑弹窗（共用一个） */}
      {/*
        AppModal 宽度规则：
        - 有 3 对以上可并排的普通字段 → width={660}，双列布局
        - 字段较少或含 TreeSelect/TextArea 等宽字段 → width 480-520，单列布局
      */}
      <AppModal
        title={editingXxx ? '编辑XXX' : '新增XXX'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: submitting, disabled: modalDetailLoading }}
        width={660}
        closeOnEsc
      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
          <Form
            key={editingXxx?.id ?? 'new'}  // key 变化时强制重置 Form 内部状态
            getFormApi={(api) => {
              formApi.current = api;
            }}
            allowEmpty
            initValues={formInitValues}
            labelPosition="left"
            labelWidth={90}  {/* 3字标签→ 72，4-5字→ 90，6字+→ 110+ */}
          >
            {/* 全宽字段（跨两列，如树形选择、长文本）：直接写，不包裹 Col */}
            <Form.TreeSelect
              field="parentId"
              label="上级"
              style={{ width: '100%' }}
              treeData={[]}
              placeholder="请选择上级"
              filterTreeNode
              showClear
            />
            {/* 双列布局：Row gutter={16} + Col span={12}，每行放 2 个字段 */}
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input
                  field="name"
                  label="名称"
                  placeholder="请输入名称"
                  rules={[{ required: true, message: '名称不能为空' }]}
                />
              </Col>
              <Col span={12}>
                <Form.Input
                  field="code"
                  label="编码"
                  placeholder="请输入编码"
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select
                  field="status"
                  label="状态"
                  style={{ width: '100%' }}
                  optionList={statusItems.map((i) => ({
                    value: i.value,
                    label: i.label,
                  }))}
                  rules={[{ required: true, message: '请选择状态' }]}
                />
              </Col>
              {/* 奇数个字段时，最后一个 Col span={12} 单独占左半列 */}
            </Row>
            {/* 如需关联选择，在此添加 Form.Select 多选等 */}
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
```

---

## 关键规范说明

### 弹窗表单布局规范

**必须在 Form 中加 `labelPosition="left"` 以实现 label 与输入框同行。**

**Modal 宽度与表单列数：**

- 有 **3 对及以上可并排的普通字段**（Input / Select / InputNumber 等）→ 使用双列布局，`width={660}`
- 字段较少，或主要是 TreeSelect / TextArea 等不适合并排的字段 → 使用单列布局，`width` 在 480–520 之间酌情选取

所有 Modal 必须加 `closeOnEsc`。

**双列布局规则（用 `Row` + `Col`，来自 `@douyinfe/semi-ui`）：**

```tsx
import { Row, Col } from '@douyinfe/semi-ui';

// 每行两个字段：Row gutter={16} + Col span={12}
<Row gutter={16}>
  <Col span={12}>
    <Form.Input field="name" label="名称" ... />
  </Col>
  <Col span={12}>
    <Form.Input field="code" label="编码" ... />
  </Col>
</Row>

// 全宽字段（树形选择、长文本、多行输入等）：不包 Col，直接写
<Form.TreeSelect field="parentId" label="上级" style={{ width: '100%' }} ... />

// 奇数个字段时最后一个单独占左半列（不强制凑满一行）
<Row gutter={16}>
  <Col span={12}>
    <Form.Select field="status" label="状态" style={{ width: '100%' }} ... />
  </Col>
</Row>
```

**labelWidth 选取原则：**

- 标签文字 ≤3 字（名称、状态、邮箱）→ `labelWidth={72}`
- 标签文字 4–5 字（部门名称、联系电话）→ `labelWidth={90}`
- 标签文字 ≥6 字（上级部门名称、所属租户等）→ `labelWidth={110}` 或 120
- 同一个 Form 内保持统一

### 状态字段显示

- 使用 `useDictItems('common_status')` 获取字典选项
- 表格中用 `<DictTag dictCode="common_status" value={status} />` 或手动 `find` 映射

### 时间格式化与省略文本

```ts
// ✅ 正确：使用预置列（自动格式化+省略 tooltip）
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
// 使用：columns = [..., createdAtColumn];
// 省略列：render: renderEllipsis

// ✅ 仍可直接调用（非列 render 场景）
import { formatDateTime } from '../../utils/date';
formatDateTime(someDate)

// ❌ 禁止：不要在组件中使用原生 locale 或 ISO 时间格式化 API
```

### 操作列按钮样式

```tsx
// ✅ 正确：使用 createOperationColumn。默认桌面端内联全部动作；
// 设置 desktopInlineKeys 后，只把高频动作作为内联按钮展示，其余动作进入更多菜单。
// 移动端会自动收窄操作列，并将全部动作收进更多菜单。
createOperationColumn<Xxx>({
  width: 160,
  desktopInlineKeys: ['edit', 'delete'],
  actions: (record) => [
    { key: 'edit', label: '编辑', onClick: () => openEdit(record) },
    { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(record.id) },
  ],
})
```

### 搜索参数与分页联动

```ts
// ✅ 正确：handleSearch 和 handleReset 直接传参，不等 state 异步更新
function handleSearch() {
  setPage(1);
  void fetchXxxs(1, pageSize);  // 直接传入 page=1
}

function handleReset() {
  setSearchParams(defaultSearchParams);
  void fetchXxxs(1, pageSize, defaultSearchParams);  // 直接传入重置后的 params
}
```

### 权限控制

```tsx
// 使用 hasPermission() 控制按钮显示
const { hasPermission } = usePermission();

{hasPermission('system:xxx:create') && <Button>新增</Button>}
{hasPermission('system:xxx:update') && <Button>编辑</Button>}
{hasPermission('system:xxx:delete') && <Button>删除</Button>}
```

---

## 批量操作前端模板

> 仅在用户确认需要批量操作时添加，并非所有列表都需要。

```tsx
// 1. 状态声明
const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

// 2. 批量删除 handler
const handleBatchDelete = () => {
  Modal.confirm({
    title: `确认删除选中的 ${selectedRowKeys.length} 条记录？`,
    content: '删除后无法恢复，请谨慎操作。',
    okButtonProps: { type: 'danger', theme: 'solid' },
    onOk: async () => {
      const res = await request.delete<null>('/api/xxxs/batch', { ids: selectedRowKeys });
      if (res.code === 0) {
        Toast.success('批量删除成功');
        setSelectedRowKeys([]);
        void fetchXxxs();
      }
    },
  });
};

// 3. 工具栏中的批量按钮（仅选中时显示，放在查询/重置按钮之后）
{selectedRowKeys.length > 0 && hasPermission('system:xxx:delete') && (
  <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
    批量删除 ({selectedRowKeys.length})
  </Button>
)}

// 4. ConfigurableTable 增加 rowSelection
<ConfigurableTable
  rowSelection={{
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys as number[]),
  }}
  bordered
  onRefresh={() => void fetchXxxs(page, pageSize)}
  refreshLoading={loading}
  ...
/>
```

> `request.delete(url, body)` 支持传请求体（`packages/web/src/utils/request.ts` 已实现）。

---

## 虚拟化表格（大数据量）

当列表数据量较大（通常 > 500 条，如地区省市县、日志等）时，为 `ConfigurableTable` 开启 `virtualized`。

### 弹性全宽方案（推荐）

让**一列不设 `width`**（通常是名称/标题主列），表格自动填满容器。`fixed: 'right'` 仅保留操作列，状态列等其他列去掉 `fixed`。

```tsx
const columns: ColumnProps<Region>[] = [
  {
    title: '地区名称',
    dataIndex: 'name',
    // 不设 width — 弹性列，填满剩余宽度
  },
  { title: '区划代码', dataIndex: 'code', width: 140 },
  { title: '级别',     dataIndex: 'level', width: 90 },
  {
    title: '状态',
    dataIndex: 'status',
    width: 90,
    // 注意：不加 fixed: 'right'，否则必须设 scroll.x 导致宽度固定
  },
  createOperationColumn<Region>({
    width: 160,
    actions: (record) => [
      { key: 'edit', label: '编辑', onClick: () => openEdit(record) },
    ],
  }),
];

<ConfigurableTable
  bordered
  virtualized
  scroll={{ y: 'calc(100vh - 260px)' }}  // 只设 y，不设 x
  columns={columns}
  dataSource={data}
  rowKey="id"
  pagination={false}
  onRefresh={fetchData}
  refreshLoading={loading}
/>
```

### 固定宽度方案

所有列都有显式 `width` 时（含 `fixed: 'right'` 的状态列），必须设 `scroll.x` = 各列宽度之和，否则表头与数据行错位：

```tsx
<ConfigurableTable
  virtualized
  scroll={{ x: 1050, y: 'calc(100vh - 260px)' }}
  columns={columns}
/>
```

> 缺点：`scroll.x` 固定后表格在宽屏不填满容器。

### 注意事项

- `scroll.y` 是虚拟化生效的**必要条件**，`calc(100vh - 260px)` 适配大多数管理页面布局（260px ≈ 顶栏 + 工具栏 + 内边距）
- 菜单管理等数据量小（< 200 条）且有复杂自定义渲染器的树形表格，**不建议**开启 `virtualized`
- 开启 `virtualized` 后，`expandedRowKeys` 受控展开仍正常工作，无需额外处理

---

## ConfigurableTable 刷新按钮（必须实现）

**所有使用 `ConfigurableTable` 的列表页均必须传入 `onRefresh` 和 `refreshLoading`**，否则表格工具栏不会显示刷新按钮。

```tsx
<ConfigurableTable
  bordered
  columns={columns}
  dataSource={list}
  loading={loading}
  rowKey="id"
  onRefresh={() => void fetchXxxs(page, pageSize)}   // ← 必须传
  refreshLoading={loading}                            // ← 必须传
  pagination={{ ... }}
/>
```

规则：

- `onRefresh`：刷新当前页数据，保持分页位置不变；若组件无独立数据加载（如结构/上下文驱动的表格），可不传
- `refreshLoading`：通常与 `loading` 保持一致，按钮转圈期间防重复点击
- SideSheet / Modal 内的**次级**表格（投递记录、操作历史等）同样需要传入对应的刷新函数

---

## 左右分栏布局（MasterDetailLayout）

适用于消息中心、智能对话、AI 侧边栏、数据库管理表浏览、日志文件等具有「左侧列表 + 右侧详情」结构的页面。统一使用 `MasterDetailLayout` 组件，路径：`packages/web/src/components/MasterDetailLayout.tsx`。

### 标准模式：页面直接作为 Outlet 根节点

页面直接从 `admin-content`（flex 容器，分配了确定高度）继承高度，**直接返回 MasterDetailLayout**，无需外层 wrapper：

```tsx
import MasterDetailLayout from '@/components/MasterDetailLayout';

export default function XxxPage() {
  return (
    <MasterDetailLayout
      defaultSize={260}        // 左栏默认宽度
      minSize={200}
      maxSize={480}
      persistKey="xxx-page"    // localStorage 持久化键
      master={(
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          {/* 顶部固定区域（搜索/工具栏） */}
          <div style={{ padding: 12, borderBottom: '1px solid var(--semi-color-border)', flexShrink: 0 }}>
            ...
          </div>
          {/* 滚动列表区域 */}
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            ...
          </div>
        </div>
      )}
      detail={(
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          ...
        </div>
      )}
    />
  );
}
```

### 嵌套在 Semi Design Tabs 内时

Semi Design 的 `semi-tabs-pane-motion-overlay` 会打断高度继承链，必须采用以下完整写法：

**高度链约束**（缺一不可）：

1. 页面根 div：`height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden'`
2. `<Tabs>` 加 `className="tabs-fill-height"`（已在 `global.css` 定义）、`style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}`、`contentStyle={{ flex: 1, minHeight: 0, overflow: 'hidden' }}`
3. 需要全高的 `<TabPane>` 加 `style={{ height: '100%' }}`
4. TabPane 内层 wrapper div：`style={{ height: '100%' }}`

```tsx
export default function XxxPage() {
  return (
    <div style={{ height: '100%', boxSizing: 'border-box', padding: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Tabs
        className="tabs-fill-height"
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        contentStyle={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
        tabBarStyle={{ marginBottom: 8 }}
      >
        <TabPane tab="列表" itemKey="list" style={{ height: '100%' }}>
          <div style={{ height: '100%' }}>
            <MasterDetailLayout
              defaultSize={300}
              minSize={220}
              maxSize={520}
              persistKey="xxx-list"
              master={(
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  <div style={{ padding: 12, borderBottom: '1px solid var(--semi-color-border)', flexShrink: 0 }}>
                    {/* 搜索/过滤 */}
                  </div>
                  <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                    {/* 列表内容 */}
                  </div>
                </div>
              )}
              detail={<div>详情区域</div>}
            />
          </div>
        </TabPane>
        <TabPane tab="其他" itemKey="other">
          {/* 其他 tab 无高度限制需求时不需要加 style={{ height: '100%' }} */}
        </TabPane>
      </Tabs>
    </div>
  );
}
```

### 主侧在右时（`side="right"`）

某些页面左侧为主内容区，右侧为可收起的辅助面板（如 AI 侧边栏）：

- 将宽的内容放在 `detail`（左侧，`flex:1`）
- 将窄的可调整面板放在 `master`（右侧，`flexShrink:0`）
- 设置 `side="right"` 使 master 渲染在右边

```tsx
<MasterDetailLayout
  side="right"
  defaultSize={380}
  minSize={300}
  maxSize={600}
  collapsed={!panelVisible}
  persistKey="xxx-sidebar"
  detail={<MainContent />}    // 宽的主体内容（左侧）
  master={<SidePanel />}      // 窄的辅助面板（右侧，可调整宽度）
/>
```

### 常见陷阱

- **master 内需要头部 + 滚动列表**：必须在 master 内用 flex column 容器包裹，搜索头固定（`flexShrink: 0`），列表 flex: 1 + overflow: auto + minHeight: 0
- **不要把 master 的 div 写成 Fragment（`<>`）**：Fragment 无法接受 `height: '100%'`，列表将无高度约束
- **Tabs 嵌套时不加 `className="tabs-fill-height"`**：会导致 Semi Design 的动画层破坏高度链，列表内容撑满后无滚动
- **MasterDetailLayout 的 `gap` 默认为 0**：如不需要间距且无边框，保持默认即可

---

## 导出规范（导出中心）

- 若模块需要导出，后端统一在 `packages/server/src/lib/export-center/definitions/` 中新增 `defineExport` 实体定义，并在 `definitions/index.ts` 注册。
- 导出字段、Excel / CSV 格式、权限、同步 / 异步策略、文件留存、合并表头与自定义样式均写在导出实体定义中。
- 前端统一使用 `ExportButton`，通过 `entity` 指定导出实体编码，通过 `query` 传递当前提交的筛选条件。
- 列表页默认同步明文导出；大数据或特殊敏感场景由实体定义的 `execution` 策略调整。
- 若导出需带筛选条件，统一使用“当前提交查询参数”（通常来自 `searchParamsRef.current`）构造 query，避免 stale closure。
