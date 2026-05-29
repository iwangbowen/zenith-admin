# UI 规范

前端采用 **Semi Design** 作为组件库，并在页面结构与交互方式上保持统一。

## 组件与图标

- UI 组件统一使用 `@douyinfe/semi-ui`
- 图标统一使用 `lucide-react`
- 不引入 `@douyinfe/semi-icons`

## 列表页布局规范

所有 CRUD 列表页面采用无卡片（Cardless）设计方案。

### 搜索区与操作按钮

- 所有元素（搜索输入框、下拉筛选、查询/重置按钮、操作按钮）统一通过 `SearchToolbar` 组件排列
- `SearchToolbar` 内部使用 `<Space wrap>` 包裹，子元素从左到右依次排列，按需换行
- 按钮文案统一为：`查询`、`重置`、`新增`
- 工具栏中所有功能性操作按钮（导出、全部展开/折叠等）统一使用 `type="primary"`，仅「重置」使用 `type="tertiary"`

### 表格

- 数据表格必须使用 `ConfigurableTable` 组件（`@/components/ConfigurableTable`），并保持带边框属性：`bordered`
- `ConfigurableTable` 在 `Table` 基础上内置了列显隐配置功能（右上角「列设置」下拉菜单），用户选择会持久化到 `localStorage`
- "操作"列必须右侧固定：`fixed: 'right'`
- "状态"列必须放在"操作"列左侧（紧靠操作列），并同样添加 `fixed: 'right'`

### 表格公共列工具（`@/utils/table-columns`）

```ts
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
```

- `createdAtColumn`：预置的"创建时间"列对象（`width: 180`，自动 `formatDateTime`），直接放入 `columns` 数组
- `renderEllipsis`：用于文本溢出省略列的 `render` 函数，自动加 Tooltip、空值显示 `—`

```ts
const columns = [
  { title: '描述', dataIndex: 'description', render: renderEllipsis },
  createdAtColumn,
];
```

### 操作列按钮

- 使用纯文字无图标按钮
- `theme="borderless"`
- `size="small"`
- 删除按钮额外使用 `type="danger"`

## 虚拟化表格（大数据量）

当列表数据量较大（通常 > 500 条）时，应为表格开启虚拟滚动以提升渲染性能。

### 使用条件

- **适用场景**：地区管理（省/市/县 3000+ 条）、字典项等数据量大的树形或平铺列表
- **不适用场景**：菜单管理（<200 条，且有复杂自定义渲染器）

### 基本用法

```tsx
<ConfigurableTable
  bordered
  virtualized                              // 开启虚拟滚动
  scroll={{ y: 'calc(100vh - 260px)' }}   // 必须设置 scroll.y
  columns={columns}
  dataSource={data}
  rowKey="id"
/>
```

- `scroll.y` 是虚拟化生效的必要条件，推荐使用 `calc(100vh - 260px)` 减去页头 + 工具栏高度
- **所有列建议设置显式 `width`**，确保表头与数据行对齐

### 全宽自适应（推荐做法）

若需要表格填满容器宽度，**让一列不设 `width`**（通常是名称/标题列），该列自动弹性填充剩余空间：

```tsx
const columns = [
  { title: '名称', dataIndex: 'name' },          // 无 width — 弹性列，填满剩余宽度
  { title: '编码', dataIndex: 'code', width: 140 },
  // ... 其他固定宽度列
  { title: '操作', fixed: 'right', width: 160 }, // 操作列保持右固定
];

<Table
  virtualized
  scroll={{ y: 'calc(100vh - 260px)' }}   // 不设 scroll.x
  columns={columns}
/>
```

> **注意**：采用弹性列时，`fixed: 'right'` 的**状态列可省略**（去掉 `fixed`），仅操作列保留右固定。若所有列均设置显式宽度，则必须同时设置 `scroll.x`（等于各列宽度之和），但这会导致表格宽度固定不填满宽屏。

### 两种模式对比

| 模式     | 配置                                          | 效果                               |
| -------- | --------------------------------------------- | ---------------------------------- |
| 弹性全宽 | 一列不设 `width`，不设 `scroll.x`             | 表格填满容器，宽屏无留白           |
| 固定宽度 | 所有列设 `width`，`scroll.x` = 各列宽度之和   | 宽度固定，宽屏有留白，横向滚动正常 |

## 时间格式规范

所有前端展示与提交到 API 的日期时间统一使用：`YYYY-MM-DD HH:mm:ss`

要求：

- 使用 `dayjs`
- 展示统一通过 `packages/web/src/utils/date.ts` 中的 `formatDateTime(date)` 处理
- 查询/表单提交的日期时间参数统一使用 `formatDateTimeForApi(date)`；仅日期参数使用 `formatDateForApi(date)`
- 禁止在页面组件中直接使用原生 `toISOString()`、`toLocaleString()` 等方法

## 弹窗表单

使用 Semi Design `Modal` + `Form` 组合处理新增/编辑弹窗。所有 `Modal` 必须加 `closeOnEsc`。

### 布局选择原则

| 场景 | Modal 宽度 | Form 布局 |
| ---- | ---------- | --------- |
| 简单配置（字段少，包含 TextArea 等宿字段） | 480–520 | 单列 |
| 标准业务表单（有 3+ 对可并排的普通字段） | 660 | **双列** |
| 复杂表单（多字段含特殊控件） | 720+ | 混合 |

### 表单必备属性

- `labelPosition="left"`：实现 label 与输入框同行
- `labelWidth`：按标签字数选取（≤3字→ 72，4-5字→ 90，♥6字→ 110+），同一 Form 内保持统一
- `key={editingXxx?.id ?? 'new'}`：切换新增/编辑时强制重置 Form 内部状态

### 双列布局写法

```tsx
<Row gutter={16}>
  <Col span={12}>
    <Form.Input field="name" label="名称" ... />
  </Col>
  <Col span={12}>
    <Form.Input field="code" label="编码" ... />
  </Col>
</Row>

{/* 全宽字段（TreeSelect / TextArea 等）不包 Col，直接占满一行 */}
<Form.TreeSelect field="parentId" label="上级" style={{ width: '100%' }} ... />

{/* 奇数个字段时最后一个单独占左半列 */}
<Row gutter={16}>
  <Col span={12}>
    <Form.Select field="status" label="状态" style={{ width: '100%' }} ... />
  </Col>
</Row>
```

- `getFormApi` 回调获取 `FormApi`，**禁止用 `any` 类型**
- 编辑时通过 `initValues` 回填表单

## 按钮权限控制

使用 `usePermission` hook 控制前端按钮级别的权限：

```tsx
import { usePermission } from '../../hooks/usePermission';

const { hasPermission } = usePermission();

{hasPermission('user:create') && (
  <Button onClick={openCreate}>新增</Button>
)}
```

权限标识符需与菜单管理中配置的按钮权限 `perms` 字段保持一致。

## 分页规范

分页统一使用 `Table` 内置 `pagination` 配置，不单独放置 `Pagination` 组件：

```tsx
<Table
  bordered
  dataSource={list}
  columns={columns}
  pagination={{
    currentPage: page,
    pageSize,
    total,
    showSizeChanger: true,
    pageSizeOpts: [10, 20, 50, 100],
    onChange: (p, size) => { setPage(p); setPageSize(size); },
  }}
/>
```

## 搜索区代码示例

```tsx
import { SearchToolbar } from '../../components/SearchToolbar';

<SearchToolbar>
  <Input prefix={<Search size={14} />} placeholder="搜索..." showClear
    value={keyword} onChange={setKeyword} />
  <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
</SearchToolbar>
```

## 页面设计原则

- 信息层次清晰，高频操作易于触达
- 列表页优先考虑操作效率，不过度装饰
- 保持后台系统稳定感，新页面尽量沿用已有布局与交互节奏
- 表单验证错误信息使用 Semi Form 的 `rules` 属性声明式配置
