# 公共组件指南

本页列出 `packages/web/src/components/` 中的公共组件，说明其用途与使用方式。所有新页面应优先使用这些组件，保持全站交互一致性。

---

## ConfigurableTable

所有 CRUD 列表页面的标准数据表格组件，在 Semi Design `Table` 基础上封装了**列显隐配置**功能。

### ConfigurableTable 功能特点

- 右上角内置「列设置」下拉菜单，用户可勾选/取消勾选各列的显示状态
- 列显隐配置自动持久化到 `localStorage`（key 默认根据页面路径 + 列 key 自动生成）
- 通过 `createOperationColumn` 创建的操作列默认不可隐藏，并会在移动端自动收窄
- 可选展示刷新按钮，并内置表格尺寸、边框/斑马纹显示设置和全屏展示按钮
- 分页配置会自动补充 `showTotal`、`showSizeChanger` 和 `[10, 20, 50, 100]` 页大小选项
- 完全透传 Semi Design `TableProps`，使用方式与 `<Table>` 一致

### ConfigurableTable 扩展 Props

| Prop | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `columnSettings` | `boolean` | `true` | 是否显示列设置按钮 |
| `columnSettingsKey` | `string` | 自动生成 | 自定义 localStorage 存储 key |
| `columnSettingsLabel` | `string` | `'列设置'` | 列设置按钮文字 |
| `onRefresh` | `() => void` | — | 传入后显示右上角刷新按钮 |
| `refreshLoading` | `boolean` | `false` | 刷新按钮 loading 状态 |

### ConfigurableTable 使用示例

```tsx
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';

const columns = [
  { title: '名称', dataIndex: 'name' },
  createOperationColumn<User>({
    width: 160,
    desktopInlineKeys: ['edit', 'delete'],
    actions: (record) => [
      { key: 'edit', label: '编辑', onClick: () => openEdit(record) },
      { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(record.id) },
    ],
  }),
];

// 标准分页列表
<ConfigurableTable
  bordered
  columns={columns}
  dataSource={data?.list ?? []}
  loading={loading}
  onRefresh={() => void fetchList()}
  refreshLoading={loading}
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
- 操作列请使用 `createOperationColumn` 创建；它会统一处理右固定、列设置不可隐藏、移动端列宽收窄和更多菜单
- `createOperationColumn` 默认在桌面端内联展示全部动作；动作较多时可通过 `desktopInlineKeys` 指定高频内联按钮，其余动作进入更多菜单；移动端始终只显示更多按钮
- 若需关闭列设置功能（如只有 1-2 列的简单表格），传 `columnSettings={false}`

---

## SearchToolbar

搜索工具栏组件，用于所有 CRUD 列表页面的顶部筛选区域。

### SearchToolbar Props

- `children?: ReactNode`：简单工具栏内容，自动用 `<Space wrap>` 包裹
- `className?: string`：附加 CSS 类名，应用到外层容器
- `primary?: ReactNode`：结构化模式下的桌面端主搜索区
- `filters?: ReactNode`：结构化模式下的桌面端筛选区
- `actions?: ReactNode`：结构化模式下的桌面端操作区
- `mobilePrimary?: ReactNode`：移动端默认露出的核心区域；不传时使用 `primary`
- `mobileFilters?: ReactNode`：移动端底部筛选抽屉内容；不传时使用 `filters`
- `mobileActions?: ReactNode`：移动端更多菜单内容；不传时使用 `actions`
- `filterTitle?: ReactNode`：移动端筛选抽屉标题，默认 `筛选条件`
- `actionTitle?: string`：移动端更多菜单标题，默认 `更多操作`
- `onFilterApply?: () => void`：移动端筛选抽屉底部 `查询` 按钮回调
- `onFilterReset?: () => void`：移动端筛选抽屉底部 `重置` 按钮回调

### SearchToolbar 使用示例

简单页面继续使用 children 写法：

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

筛选项或操作按钮较多时使用结构化写法，让移动端只露出高频入口：

```tsx
<SearchToolbar
  primary={(
    <>
      <Input
        prefix={<Search size={14} />}
        placeholder="请输入名称"
        value={keyword}
        onChange={setKeyword}
        onEnterPress={handleSearch}
        showClear
        style={{ width: 220 }}
      />
      <Select
        placeholder="请选择状态"
        value={status}
        onChange={(v) => setStatus(v as string)}
        showClear
        style={{ width: 120 }}
      />
      <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
      <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
    </>
  )}
  actions={(
    <>
      <Button type="primary" icon={<Download size={14} />} onClick={handleExport}>导出</Button>
      <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
    </>
  )}
  mobilePrimary={(
    <>
      <Input
        prefix={<Search size={14} />}
        placeholder="请输入名称"
        value={keyword}
        onChange={setKeyword}
        onEnterPress={handleSearch}
        showClear
        style={{ width: 220 }}
      />
      <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
      <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
    </>
  )}
  mobileFilters={(
    <Select
      placeholder="请选择状态"
      value={status}
      onChange={(v) => setStatus(v as string)}
      showClear
      style={{ width: 120 }}
    />
  )}
  mobileActions={(
    <Button icon={<Download size={14} />} onClick={handleExport}>导出</Button>
  )}
  filterTitle="筛选条件"
  onFilterApply={handleSearch}
  onFilterReset={handleReset}
/>
```

### SearchToolbar 注意事项

- 按钮文案统一为**「查询」「重置」「新增」**
- 简单工具栏使用 `children` 即可；复杂工具栏优先使用结构化 props
- 移动端不要把页面导航、筛选项和顶部常用功能混在一起；筛选属于当前列表页，应放在 SearchToolbar 的底部筛选抽屉中
- 移动端默认只露出关键词、查询、新增等高频操作；低频操作通过更多菜单承载

---

## RegionSelect

省市区三级联动选择组件，基于 Semi Design Cascader 封装，数据来源为后端行政区划接口，组件挂载后一次性拉取完整的三级地区树。

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

**使用场景**：用于通知公告内容编辑和工作流表单富文本字段。

公共组件 `RichTextEditor` 使用 [wangEditor](https://www.wangeditor.com/) 作为富文本编辑器，支持：

- 文字格式化（粗体、颜色、字号等）
- 图片上传（通过 `POST /api/files/upload` 上传，自动插入编辑器）
- 编辑器上传请求携带 `Authorization: Bearer <token>` 头

**图片上传集成**：编辑器配置了自定义上传函数，上传成功后将返回的 URL 插入到编辑器内容中。相关配置在 `RichTextEditor` 组件内部实现。

---

## DictTag

根据字典编码和字典项值，自动渲染带颜色的 Semi Design `Tag`。颜色来源于字典项的 `color` 字段，内部使用 `useDictItems` hook 按需拉取字典数据（带内存缓存，同一 `dictCode` 只请求一次）。

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

---

## 其他通用基础组件

| 组件 | 用途 |
| --- | --- |
| `AppModal` | 带全屏/还原按钮的 Semi `Modal` 封装，表单弹窗和文件预览弹窗复用 |
| `AppLogo` | 应用 Logo，支持不同尺寸和样式 |
| `AnnouncementDetailModal` | 公告详情弹窗，支持加载态和上一条/下一条导航 |
| `ApprovalTimeline` | 审批流时间线，展示发起、审批任务和流程结束节点 |
| `ColorPickerInput` | Semi `ColorPicker` 表单封装，值统一为颜色字符串 |
| `CronBuilderModal` | 6 字段 Cron 表达式可视化编辑弹窗 |
| `CronBuilderPopover` | Cron 快速选择 Popover |
| `IconPicker` | lucide 图标选择器，用于菜单图标等配置 |
| `PasswordStrengthMeter` | 密码强度与策略达标提示 |
| `SignaturePad` | Canvas 手写签名板，输出 PNG data URL |
| `UserAvatar` | 用户头像展示，缺省头像按名称生成稳定色块 |
| `Watermark` | 页面水印覆盖层 |

## 业务选择与权限组件

| 组件 | 用途 |
| --- | --- |
| `DepartmentSelect` | 从 `GET /api/departments` 拉取启用部门树，支持单选/多选 |
| `DictSelect` | 按 `dictCode` 拉取字典项，支持单选/多选 |
| `UserSelect` | 从 `GET /api/users/all` 拉取用户选项，支持单选/多选 |
| `UserTransferSelect` | 用户穿梭选择器，支持按部门组织展示 |
| `MenuPermissionPanel` | 菜单权限树面板，角色和用户授权场景复用 |
| `DataScopePanel` | 数据权限范围面板，角色和用户数据权限场景复用 |

## 布局、导航与状态组件

| 组件 | 用途 |
| --- | --- |
| `MasterDetailLayout` | 主从分栏布局，支持拖拽宽度和本地持久化 |
| `NavListPanel` | 带标题、搜索、加载、空状态和底部插槽的列表面板 |
| `BreadcrumbMenuPopover` | 面包屑中的菜单 Popover，支持目录层级跳转 |
| `MenuSearchInput` | 菜单搜索入口，配合全局快捷键使用 |
| `MenuCommandPalette` | 菜单命令面板，支持搜索和快速跳转 |
| `NProgress` | 顶部路由切换进度条 |
| `PageErrorBoundary` | 页面级错误边界和路由错误边界 |
| `LockScreen` | 后台锁屏界面，支持密码校验后解锁 |
| `ForceChangePasswordModal` | 强制修改密码弹窗 |
| `MaintenanceOverlay` | 维护模式覆盖层 |
| `QuickChatButton` | 快捷聊天悬浮入口 |
| `ElectronTitleBar` | Electron 环境自定义标题栏 |

## 文件与预览组件

| 组件 | 用途 |
| --- | --- |
| `FileAttachment` | 附件上传/展示组件 |
| `FilePreviewModal` | 全站统一文件预览弹窗 |
| `DocxPreviewPanel` | Word `.docx` 只读预览 |
| `ExcelPreviewPanel` | Excel/CSV 的 Univer 只读预览 |
| `JsonPreviewPanel` | JSON 只读预览 |
| `MarkdownPreviewPanel` | Markdown 只读预览 |
| `MonacoPreviewPanel` | 代码和纯文本只读预览 |
| `ZipPreviewPanel` | ZIP 目录树预览 |

## 日志与工作流组件

| 组件 | 用途 |
| --- | --- |
| `LoginLogsTable` | 登录日志表格 |
| `OperationLogsTable` | 操作日志表格 |
| `SavedViewsBar` | 列表筛选条件保存视图条 |
| `WorkflowApproverPreview` | 提交前审批链路预览 |
| `WorkflowGraphView` | 流程图只读预览 |
| `WorkflowInstanceDetailPanel` | 流程实例详情面板 |
| `WorkflowInstanceDetailSheet` | 流程实例详情抽屉 |
| `WorkflowNodeListView` | 流程节点线性列表 |
