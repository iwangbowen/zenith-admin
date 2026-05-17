# 公共组件指南

本页列出 `packages/web/src/components/` 中的公共组件，说明其用途与使用方式。所有新页面应优先使用这些组件，保持全站交互一致性。

---

## ConfigurableTable

所有 CRUD 列表页面的标准数据表格组件，在 Semi Design `Table` 基础上封装了**列显隐配置**功能。

**文件位置**：`packages/web/src/components/ConfigurableTable.tsx`

### ConfigurableTable 功能特点

- 右上角内置「列设置」下拉菜单，用户可勾选/取消勾选各列的显示状态
- 列显隐配置自动持久化到 `localStorage`（key 默认根据页面路径 + 列 key 自动生成）
- 操作列（key/title 为 `action`/`actions`/`operation`/`operations`/`操作`）默认不可隐藏
- 完全透传 Semi Design `TableProps`，使用方式与 `<Table>` 一致

### ConfigurableTable 扩展 Props

| Prop | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `columnSettings` | `boolean` | `true` | 是否显示列设置按钮 |
| `columnSettingsKey` | `string` | 自动生成 | 自定义 localStorage 存储 key |
| `alwaysVisibleColumnKeys` | `string[]` | `[]` | 额外指定不可隐藏的列 key |
| `columnSettingsLabel` | `string` | `'列设置'` | 列设置按钮文字 |

### ConfigurableTable 使用示例

```tsx
import ConfigurableTable from '@/components/ConfigurableTable';

// 标准分页列表
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
    onPageChange: (p) => { setPage(p); void fetchList(p, pageSize); },
    onPageSizeChange: (s) => { setPageSize(s); void fetchList(1, s); },
    showTotal: true,
    showSizeChanger: true,
  }}
/>

// 虚拟化大数据量列表
<ConfigurableTable
  bordered
  virtualized
  scroll={{ y: 'calc(100vh - 260px)' }}
  columns={columns}
  dataSource={data}
  rowKey="id"
  pagination={false}
/>
```

### ConfigurableTable 注意事项

- 所有 CRUD 列表页**必须**使用 `ConfigurableTable` 替代裸 `Table`，并保留 `bordered` 属性
- 操作列自动不可隐藏，无需额外配置 `alwaysVisibleColumnKeys`
- 若需关闭列设置功能（如只有 1-2 列的简单表格），传 `columnSettings={false}`

---

## SearchToolbar

搜索工具栏组件，用于所有 CRUD 列表页面的顶部筛选区域。

### SearchToolbar Props

- `children: ReactNode`：工具栏内容（搜索输入框、下拉筛选、查询/重置按钮、新增等操作按钮），自动用 `<Space wrap>` 包裹
- `className: string`：附加 CSS 类名，应用到外层容器

### SearchToolbar 使用示例

```tsx
import { SearchToolbar } from '../../components/SearchToolbar';
import { Input, Button, Select } from '@douyinfe/semi-ui';
import { Search, RotateCcw, Plus } from 'lucide-react';

<SearchToolbar>
  <Input
    prefix={<Search size={14} />}
    placeholder="请输入名称"
    value={keyword}
    onChange={setKeyword}
    showClear
    style={{ width: 200 }}
  />
  <Select
    placeholder="请选择状态"
    value={status}
    onChange={(v) => setStatus(v as string)}
    allowClear
    style={{ width: 120 }}
  >
    <Select.Option value="enabled">启用</Select.Option>
    <Select.Option value="disabled">禁用</Select.Option>
  </Select>
  <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
</SearchToolbar>
```

### SearchToolbar 注意事项

- 按钮文案统一为**「查询」「重置」「新增」**
- `children` 内的元素会自动换行（`wrap`），响应式友好

---

## RegionSelect

省市区三级联动选择组件，基于 Semi Design Cascader 封装，数据来源为后端行政区划接口，组件挂载后一次性拉取完整的三级地区树。

**文件位置**：`packages/web/src/components/RegionSelect.tsx`

### RegionSelect 功能特点

- 支持省 → 市 → 区/县三级行政区划
- 组件挂载时请求 `GET /api/regions`，并在当前组件实例中复用已加载的地区树数据
- 返回所选区划的完整 code 路径（如 `['110000', '110100', '110101']`）
- 内置搜索过滤（`filterTreeNode`）

### RegionSelect Props

| Prop | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `string[]` | — | 当前选中的区划代码路径 |
| `onChange` | `(value: string[] \| undefined) => void` | — | 选中变化回调，清空时传 `undefined` |
| `placeholder` | `string` | `'请选择省/市/区'` | 占位文字（加载中自动替换为"加载中..."） |
| `disabled` | `boolean` | `false` | 是否禁用 |
| `showClear` | `boolean` | `true` | 是否显示清空按钮 |
| `changeOnSelect` | `boolean` | `true` | `true`：可选中任意层级（省/市/区均可）；`false`：必须选到最底层（区/县） |
| `style` | `CSSProperties` | — | 行内样式 |
| `className` | `string` | — | 附加 CSS 类名 |

### RegionSelect 使用示例

基础用法（可选到任意层级）：

```tsx
import RegionSelect from '@/components/RegionSelect';
import { useState } from 'react';

const [regionCodes, setRegionCodes] = useState<string[]>();

<RegionSelect
  value={regionCodes}
  onChange={setRegionCodes}
  style={{ width: 320 }}
/>
```

必须选到县级（`changeOnSelect={false}`）：

```tsx
<RegionSelect
  value={regionCodes}
  onChange={setRegionCodes}
  changeOnSelect={false}
  placeholder="请选择到县/区级"
  style={{ width: 320 }}
/>
```

禁用状态：

```tsx
<RegionSelect disabled placeholder="禁用" style={{ width: 320 }} />
```

此组件已在用户管理的「省市区」字段使用，也可在任何需要行政区划选择的表单中复用。

---

## 富文本编辑器（wangEditor）

**使用场景**：仅用于**通知公告**的内容编辑，其他场景不建议使用富文本。

通知公告编辑页使用 [wangEditor](https://www.wangeditor.com/) 作为富文本编辑器，支持：

- 文字格式化（粗体、颜色、字号等）
- 图片上传（通过 `POST /api/files/upload` 上传，自动插入编辑器）
- 编辑器上传请求携带 `Authorization: Bearer <token>` 头

**图片上传集成**：编辑器配置了自定义上传函数，上传成功后将返回的 URL 插入到编辑器内容中。相关配置在 `packages/web/src/pages/system/notices/` 的通知编辑组件中实现。

---

## DictTag

根据字典编码和字典项值，自动渲染带颜色的 Semi Design `Tag`。颜色来源于字典项的 `color` 字段，内部使用 `useDictItems` hook 按需拉取字典数据（带内存缓存，同一 `dictCode` 只请求一次）。

**文件位置**：`packages/web/src/components/DictTag.tsx`

### DictTag Props

| Prop | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `dictCode` | `string` | — | 字典编码，如 `'common_status'` |
| `value` | `string \| undefined \| null` | — | 字典项的值，`null`/空串时渲染 `—` |
| `fallback` | `string` | — | 找不到字典项时的兜底文本，默认显示原始 `value` |
| `size` | `TagProps['size']` | `'small'` | Tag 尺寸，继承 Semi Design TagProps |
| 其他 TagProps | — | — | 透传给底层 `<Tag>`（除 `color` 和 `children`） |

### DictTag 使用示例

```tsx
import DictTag from '@/components/DictTag';

// 渲染状态 Tag（字典编码 common_status）
<DictTag dictCode="common_status" value={record.status} />

// 渲染性别 Tag，找不到时显示"未知"
<DictTag dictCode="user_gender" value={record.gender} fallback="未知" />
```

### 配合 `useDictItems` 使用

如果页面需要字典数据做下拉选项，可直接使用 `useDictItems` hook：

```tsx
import { useDictItems } from '@/hooks/useDictItems';

const { items, loading, getLabel } = useDictItems('common_status');

// items: DictItem[]，每项包含 { value, label, color, ... }
// getLabel('enabled') => '启用'
```
