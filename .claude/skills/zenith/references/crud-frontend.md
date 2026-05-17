# CRUD 前端实现参考（以「用户管理」为范例）

本文档提供前端页面的完整代码模板，对照 `packages/web/src/pages/users/UsersPage.tsx` 的实际实现。

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
  Button, Form, Input, Select, Space,
  Modal, Toast, Popconfirm,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus, Trash2 } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { request } from '@/utils/request';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { useDictItems } from '@/hooks/useDictItems';
import { usePermission } from '@/hooks/usePermission';
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);

  // 弹窗状态
  const [modalVisible, setModalVisible] = useState(false);
  const [editingXxx, setEditingXxx] = useState<Xxx | null>(null);  // null=新增，有值=编辑
  const [submitting, setSubmitting] = useState(false);

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
  const fetchXxxs = useCallback(
    async (p = page, ps = pageSize, params = searchParams) => {
      setLoading(true);
      try {
        const queryObj: Record<string, string> = {
          page: String(p),
          pageSize: String(ps),
        };
        if (params.keyword) queryObj.keyword = params.keyword;
        if (params.status) queryObj.status = params.status;
        // 如有时间范围：
        // if (params.timeRange) {
        //   queryObj.startTime = formatDateTimeForApi(params.timeRange[0]);
        //   queryObj.endTime = formatDateTimeForApi(params.timeRange[1]);
        // }

        const query = new URLSearchParams(queryObj).toString();
        const res = await request.get<PaginatedResponse<Xxx>>(`/api/xxxs?${query}`);
        if (res.code === 0) {
          setData(res.data);
          setPage(res.data.page);
        }
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, searchParams],
  );

  useEffect(() => {
    void fetchXxxs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // 仅首次加载，后续通过 handleSearch / handlePageChange 触发

  // ─── 搜索 / 重置 ────────────────────────────────────────────────────────
  function handleSearch() {
    setPage(1);
    void fetchXxxs(1, pageSize);  // 直接传参，不等 state 异步更新
  }

  function handleReset() {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchXxxs(1, pageSize, defaultSearchParams);
  }

  // ─── 新增 / 编辑 ──────────────────────────────────────────────────────
  function openCreate() {
    setEditingXxx(null);
    setModalVisible(true);
  }

  function openEdit(record: Xxx) {
    setEditingXxx(record);
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditingXxx(null);
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
      title: '状态',
      dataIndex: 'status',
      width: 100,
      fixed: 'right',
      render: (status) => {
        const item = statusItems.find((i) => i.value === status);
        return item?.label ?? status;
        // 若使用 DictTag 组件：<DictTag dictCode="common_status" value={status} />
      },
    },
    {
      // 操作列：必须 fixed: 'right'；纯文字按钮，无图标
      title: '操作',
      fixed: 'right',
      width: 160,
      render: (_, record) => (
        <Space>
          {hasPermission('system:xxx:update') && (
            <Button
              theme="borderless"
              size="small"
              onClick={() => openEdit(record)}
            >
              编辑
            </Button>
          )}
          {hasPermission('system:xxx:delete') && (
            <Popconfirm
              title="确定要删除吗？"
              content="删除后不可恢复"
              onConfirm={() => handleDelete(record.id)}
            >
              <Button theme="borderless" type="danger" size="small">
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  // ════════════════════════════════════════════════════════════════════════
  // 渲染
  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="page-container">
      {/* 搜索区：使用 SearchToolbar 组件 */}
      {/* 具体写法参考 packages/web/src/pages/users/UsersPage.tsx */}
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索名称..."
          value={searchParams.keyword}
          onChange={(v) => setSearchParams((p) => ({ ...p, keyword: v }))}
          showClear
          style={{ width: 220 }}
          onEnterPress={handleSearch}
        />
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
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('system:xxx:create') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
        )}
      </SearchToolbar>

      {/* 数据表格 */}
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={loading}
        rowKey="id"
        size="small"
        empty="暂无数据"
        pagination={{
          currentPage: page,
          pageSize,
          total: data?.total ?? 0,
          onPageChange: (p) => {
            setPage(p);
            void fetchXxxs(p, pageSize);
          },
          onPageSizeChange: (s) => {
            setPageSize(s);
            void fetchXxxs(1, s);
          },
          showTotal: true,
          showSizeChanger: true,
        }}
      />

      {/* 新增/编辑弹窗（共用一个） */}
      <Modal
        title={editingXxx ? '编辑XXX' : '新增XXX'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: submitting }}
        width={520}
        maskClosable={false}
      >
        <Form
          key={editingXxx?.id ?? 'new'}  // key 变化时强制重置 Form 内部状态
          getFormApi={(api) => {
            formApi.current = api;
          }}
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={80}
        >
          <Form.Input
            field="name"
            label="名称"
            placeholder="请输入名称"
            rules={[{ required: true, message: '名称不能为空' }]}
          />
          <Form.TextArea
            field="description"
            label="描述"
            placeholder="请输入描述（可选）"
          />
          <Form.Select
            field="status"
            label="状态"
            optionList={statusItems.map((i) => ({
              value: i.value,
              label: i.label,
            }))}
            rules={[{ required: true, message: '请选择状态' }]}
          />
          {/* 如需关联选择，在此添加 Form.Select 多选等 */}
        </Form>
      </Modal>
    </div>
  );
}
```

---

## 关键规范说明

### 状态字段显示

- 使用 `useDictItems('common_status')` 获取字典选项
- 表格中用 `<DictTag dictCode="common_status" value={status} />` 或手动 `find` 映射

### 时间格式化

```ts
// ✅ 正确
import { formatDateTime } from '../../utils/date';
render: (t) => formatDateTime(t)

// ❌ 禁止：不要在组件中使用原生 locale 或 ISO 时间格式化 API
```

### 操作列按钮样式

```tsx
// ✅ 正确：纯文字，无图标，borderless
<Button theme="borderless" size="small">编辑</Button>
<Button theme="borderless" type="danger" size="small">删除</Button>

// ❌ 禁止：带图标
<Button theme="borderless" size="small" icon={<Edit size={14} />}>编辑</Button>
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

### 翻页处理

```tsx
// ✅ 正确：翻页时同步更新 page state 并触发请求
onPageChange: (p) => {
  setPage(p);
  void fetchXxxs(p, pageSize);
},
onPageSizeChange: (s) => {
  setPageSize(s);
  void fetchXxxs(1, s);
},
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
  {
    title: '操作',
    fixed: 'right',   // 仅操作列保留右固定
    width: 160,
    render: ...
  },
];

<ConfigurableTable
  bordered
  virtualized
  scroll={{ y: 'calc(100vh - 260px)' }}  // 只设 y，不设 x
  columns={columns}
  dataSource={data}
  rowKey="id"
  pagination={false}
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
