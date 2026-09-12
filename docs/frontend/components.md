# 公共组件指南

本页按用途列出 `packages/web/src/components/` 中的公共组件。新页面优先复用这些组件，并按 [UI 规范](/frontend/ui-conventions)、[数据获取与服务端状态](/frontend/data-fetching) 组合。

---

## 列表页基础组件

### ConfigurableTable

`ConfigurableTable` 是标准列表表格组件，基于 Semi `Table`，透传 `TableProps`，并内置列显隐、刷新、表格尺寸、边框/斑马纹与全屏展示。

| 扩展 Prop | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `columnSettings` | `boolean` | `true` | 是否显示列设置入口；同时受用户偏好 `showTableColumnSettings` 控制 |
| `columnSettingsKey` | `string` | 当前路径 + 列 key 自动生成 | 自定义列显隐与显示设置的 localStorage key |
| `columnSettingsLabel` | `string` | `列设置` | 列设置按钮的 `aria-label` 与标题 |
| `onRefresh` | `() => void` | — | 传入后显示刷新按钮 |
| `refreshLoading` | `boolean` | `false` | 刷新按钮 loading / 禁用状态 |

列定义在 Semi `ColumnProps` 之上扩展了 `minWidth`：每个表格**有且只有一个弹性主列**（通常是名称 / 标题列）不写 `width`、改写 `minWidth`，
其余列照常写 `width`。`ConfigurableTable` 按各列宽度之和自动推导 `scroll.x`（页面传入的 `scroll.x` 会被忽略并在开发期告警），
容器更宽时由弹性主列吸收剩余空间，操作列等固定宽度列不会被拉伸；虚拟化表格（`virtualized` + `scroll.y`）同样适用，
组件内部负责表头与行的对齐。

```tsx
const columns: ColumnProps<User>[] = [
  { title: '用户名', dataIndex: 'username', minWidth: 200 },   // 弹性主列
  { title: '邮箱', dataIndex: 'email', width: 220 },
  createdAtColumn,
  createOperationColumn<User>({ width: 150, actions: … }),
];

<ConfigurableTable
  bordered
  columns={columns}
  dataSource={listQuery.data?.list ?? []}
  loading={listQuery.isFetching}
  onRefresh={() => void listQuery.refetch()}
  refreshLoading={listQuery.isFetching}
  rowKey="id"
  pagination={buildPagination(listQuery.data?.total ?? 0)}
/>
```

`createOperationColumn` 创建的操作列带内部标记，列设置中不可隐藏；移动端宽度固定为 64。
开发期若操作列内容宽超过列内可用宽，控制台会给出一次告警。

### ResponsiveTableActions / createOperationColumn

`ResponsiveTableActions` 负责表格操作按钮的桌面内联与移动端更多菜单。列表页通常直接使用 `createOperationColumn`。

| 字段 | 说明 |
| --- | --- |
| `actions(record)` | 返回动作数组 |
| `width` | 必填。取值 = 最宽内联组合的内容宽 + 40，向上取整到 10（「编辑 / 删除」为 150，单个 2 字动作为 100）；度量常量与常用组合见 skill 的 `ui-patterns.md → 操作列` |
| `title` | 列标题，默认 `操作` |
| `desktopInlineKeys` | 桌面端内联展示的动作 key（不超过 3 个），其余进「更多」菜单；未传时全部内联 |
| `menuAriaLabel` | 更多菜单按钮可访问名称，默认 `更多操作` |
| `emptyContent` | 没有可见动作时的内容，默认 `—`；可传函数按行计算 |

动作字段：`key`、`label`、`onClick`、`danger`、`type`、`loading`、`disabled`、`disabledReason`、`hidden`、`dividerBefore`。
动作随行状态变化时，只把各状态都存在或宽度相近的高频动作放进 `desktopInlineKeys`，状态特有 / 低频动作进「更多」，
避免按最宽状态配宽导致常见行大片留白。

```tsx
const operationColumn = createOperationColumn<User>({
  width: 150,
  desktopInlineKeys: ['edit', 'delete'],
  actions: (record) => [
    { key: 'edit', label: '编辑', onClick: () => modal.openEdit(record) },
    { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(record.id) },
  ],
});
```

### SearchToolbar

`SearchToolbar` 是列表页顶部搜索区。简单页面可用 `children`；筛选项或操作多时使用结构化 props，以便移动端折叠。

| Prop | 说明 |
| --- | --- |
| `children` | 简单模式内容，自动包裹 `<Space wrap>` |
| `className` | 外层 class |
| `primary` / `filters` / `actions` | 桌面端核心搜索区、筛选区、操作区 |
| `mobilePrimary` / `mobileFilters` / `mobileActions` | 移动端覆盖内容；未传时分别复用桌面端对应内容 |
| `filterTitle` | 筛选抽屉标题，默认 `筛选条件` |
| `actionTitle` | 更多操作标题，默认 `更多操作` |
| `onFilterApply` / `onFilterReset` | 移动端筛选抽屉底部查询 / 重置回调 |

```tsx
<SearchToolbar
  primary={<><KeywordInput {...bindKeyword('keyword')} /><SearchButton onClick={handleSearch} /><ResetButton onClick={handleReset} /></>}
  filters={<StatusSelect items={statusItems} {...bind('status')} />}
  actions={<CreateButton onClick={modal.openCreate} />}
  mobilePrimary={<><KeywordInput {...bindKeyword('keyword')} /><SearchButton onClick={handleSearch} /><CreateButton onClick={modal.openCreate} /></>}
  onFilterApply={handleSearch}
  onFilterReset={handleReset}
/>
```

### toolbar-controls

`@/components/toolbar-controls` 提供标准按钮：

| 组件 | 视觉 | 默认文案 |
| --- | --- | --- |
| `SearchButton` | `type="primary"` + `Search` 图标 | 查询 |
| `ResetButton` | `type="tertiary"` + `RotateCcw` 图标 | 重置 |
| `RefreshButton` | `type="tertiary"` + `RotateCcw` 图标 | 刷新 |
| `CreateButton` | `type="primary"` + `Plus` 图标 | 新增 |
| `BatchDeleteButton` | `type="danger"` + `theme="light"` + `Trash2` 图标，文案带选中数 | 批量删除 (N) |
| `BatchEnableButton` / `BatchDisableButton` | `theme="light"` + `CircleCheck` / `Ban` 图标，文案带选中数；停用侧 `warning`，传 `danger` 变红 | 批量启用 (N) / 批量停用 (N) |
| `BatchStatusButtons` | 上面两个按钮的成对形态，`onChange(status)` 通常接 `components/list-page` 的 `batchStatusHandler(...)` | — |

前四者 props 一致：`onClick`、`disabled`、`loading`、`children`。文案不同时用 `children` 覆盖；批量按钮的是否渲染仍由调用方按「有选中 && 有权限」判断。

### search-filters

`@/components/search-filters` 收敛列表页筛选控件的装饰性属性。

| 组件 | 关键 props | 默认行为 |
| --- | --- | --- |
| `KeywordInput` | `value`、`onChange(value)`、`onSearch`、`width` | 放大镜前缀、`showClear`、宽度 220、回车触发 `onSearch` |
| `FilterSelect` | `placeholder`（「全部 X」）、`items` 或 `groups`、`value`、`onChange(value)`、`width` | 单选枚举筛选：`showClear`、宽度 120、清空回调 `undefined`；其余 Select props 穿透 |
| `StatusSelect` | `items`、`value`、`onChange(value)`、`width` | `FilterSelect` 的状态特化，占位固定 `全部状态` |
| `DateRangeFilter` | `value`、`onChange(range)`、`type`、`width` | 默认 `dateTimeRange`、宽度 400（`DATE_TIME_RANGE_FILTER_WIDTH`）；`type="dateRange"` 时宽度 280（`DATE_RANGE_FILTER_WIDTH`）。默认宽度是不截断内容的下限，`width` 只用于 `100%` 之类自适应场景 |

标准列表页的工具栏用 `@/components/list-page` 的 `ListSearchToolbar`（关键字 / 筛选 / 查询 / 重置 / 新增 / 低频操作按桌面与移动端排布）；
边输边筛、没有「查询」按钮语义的即时过滤页用同目录的 `InstantFilterToolbar`（`primary` / `filters` / `onRefresh` / `onReset` / `actions` / `extra`）。

---

## 表单与展示组件

| 组件 | 用途 |
| --- | --- |
| `AppModal` | 带全屏/还原按钮的 Semi `Modal` 封装，默认 `closeOnEsc`；扩展 props 为 `fullscreenable`、`fullscreen`、`onToggleFullscreen` |
| `ImageUploadField` | 单图上传字段，封装上传、缩略图预览与删除 |
| `FormTimezoneSelect` | 表单内时区选择字段，默认必填；可传 `field`、`label`、`required` |
| `SliderInput` / `FormSliderInput` | 滑块 + 精确输入联动；适合有明确上下界的数值配置 |
| `ColorPickerInput` | Semi `ColorPicker` 表单封装，值为颜色字符串 |
| `PasswordStrengthMeter` | 密码强度与策略达标提示 |
| `DictTag` | 按 `dictCode` + `value` 渲染字典 Tag；支持 `fallback`、`size` 与其他 Tag props |
| `DictSelect` | 按字典编码加载字典项，支持单选/多选 |
| `DepartmentSelect` | 启用部门树选择，支持单选/多选 |
| `UserSelect` | 用户下拉选择，支持单选/多选 |
| `UserTransferSelect` | 用户穿梭选择器，支持按部门组织展示 |
| `MemberSelect` | 会员远程搜索下拉 |
| `RegionSelect` | 省市区 Cascader；props 包含 `value`、`onChange`、`placeholder`、`disabled`、`showClear`、`changeOnSelect`、`style`、`className` |
| `SignaturePad` | Canvas 手写签名板，输出 PNG data URL |
| `JsonBlock` | JSON 内容块展示 |
| `UserAvatar` | 用户头像展示，缺省头像按名称生成稳定色块 |
| `UserDisplay` | 用户展示组件，组合头像、昵称/用户名等信息 |
| `UserPreviewCell` | 表格用户/成员列，头像组 + 数量；传 `scope` 后可打开成员名单 |

```tsx
<DictTag dictCode="common_status" value={record.status} />

<RegionSelect value={regionCodes} onChange={setRegionCodes} changeOnSelect={false} />
```

---

## 布局、导航与状态组件

| 组件 | 用途 |
| --- | --- |
| `MasterDetailLayout` | 主从分栏布局；支持左右切换、拖拽宽度、折叠、`persistKey` 持久化、容器宽度响应式、`onBack` / `onMasterBack` 返回条 |
| `MasterDetailLayout.Header` / `Body` / `SideToggle` | 分栏内部标题、内容区与左右切换按钮 |
| `NavListPanel` | 左侧平铺列表面板；props 包含 `title`、`headerExtra`、`search`、`loading`、`emptyText`、`footer`、`dataSource`、`renderItem`、`bodyNoPadding`、`rawBody` |
| `NavListItem` | 平铺列表项；支持 `active`、`primary`、`secondary`、`meta`、`icon`、`extra`、`extraAlwaysVisible` |
| `NavListItemActions` | 列表项 / 面板头部的「更多」菜单（`items: { key, label, icon?, danger?, hidden?, disabled?, onClick }[]`），触发按钮阻止冒泡，全部隐藏时不渲染 |
| `BreadcrumbMenuPopover` | 面包屑菜单 Popover，支持目录层级跳转 |
| `MenuSearchInput` | 顶栏菜单搜索触发器 |
| `MenuCommandPalette` | 菜单命令面板，支持搜索和快速跳转 |
| `NProgress` | 顶部路由切换进度条 |
| `PageLoading` | 页面级或内联加载态 |
| `PageErrorBoundary` / `RouteErrorBoundary` | 页面错误边界，动态 chunk 加载失败时提供整页刷新 |
| `FullPageRetry` | 全屏失败重试页，支持离线说明、重试中状态与次要操作 |
| `MaintenanceOverlay` | 维护模式覆盖层 |
| `LockScreen` | 后台锁屏界面 |
| `ForceChangePasswordModal` | 强制修改密码弹窗 |
| `TaskTray` | 顶栏全局异步任务托盘 |
| `FeedbackWidget` | 意见反馈弹层 |
| `QuickChatButton` | 快捷聊天悬浮入口 |
| `ElectronTitleBar` | Electron 自定义标题栏 |
| `Watermark` | 页面水印覆盖层 |
| `ThemedReactFlow` | 跟随应用主题的 React Flow 画布封装 |

---

## 数据可视化与报表组件

| 组件 | 用途 |
| --- | --- |
| `charts/StatCard` | 指标卡，展示标题、数值、趋势、图标等 |
| `charts/StatGrid` | 指标卡响应式网格 |
| `charts/EmptyChart` | 图表空态 |
| `charts/builders.ts` | VChart spec 构建工具 |
| `charts/palette.ts` | 图表统一色板 |
| `data-viz/MetricMeter` | 有界度量条；props 包含 `value`、`label`、`min`、`max`、`valueText`、`tone`、`height` |
| `data-viz/DataBar` | 相对数据条；props 包含 `value`、`max`、`minPercent`、`color` |
| `ReportEmbed` | 报表看板嵌入组件，支持受控筛选值 |
| `ReportParamDialog` | 报表参数填写对话框 |

---

## 文件与预览组件

| 组件 | 用途 |
| --- | --- |
| `FileAttachment` | 附件上传/展示组件，支持 `uploadPath` 覆盖上传接口 |
| `FileNameCell` | 表格文件名单元格：类型图标、省略、Tooltip |
| `FilePreviewModal` | 统一文件预览弹窗，详见[文件预览组件](/frontend/file-preview) |
| `FilePreviewLayer` + `useFilePreview` | 图集预览、非图片预览、不可预览文件新窗口打开与鉴权下载的组合方案 |
| `PDFPreviewPanel` | PDF 预览面板（`@embedpdf/react-pdf-viewer`） |
| `FileViewerPreviewPanel` | Office、OFD、压缩包、邮件、XMind、图形、数据资产、地理数据预览面板 |
| `JsonPreviewPanel` | JSON 只读预览 |
| `MarkdownPreviewPanel` | Markdown 只读预览 |
| `MonacoPreviewPanel` | 代码和纯文本只读预览 |

---

## 业务弹层与媒体组件

| 组件 | 用途 |
| --- | --- |
| `AnnouncementDetailModal` | 公告详情弹窗，支持上一条/下一条 |
| `ApprovalTimeline` | 审批流时间线 |
| `AsyncTaskProgress` | 异步任务进度展示；确定进度用进度条，不定进度用 Spin |
| `AvatarCropperModal` | 头像裁剪弹窗 |
| `PresetAvatarPickerModal` | 预设头像选择弹窗 |
| `CronBuilderModal` | 6 字段 Cron 可视化编辑弹窗 |
| `CronBuilderPopover` | Cron 快速选择 Popover |
| `ExportButton` | 导出任务按钮；props 包含 `entity`、`query`、`resolveQuery`、`label`、`formats`、`raw`、`watermark`、`executionMode`、`variant` |
| `IconPicker` | lucide 图标选择器 |
| `MediaPickerModal` | 媒体库选择器，支持搜索与就地上传 |
| `MonthCalendar` | 月视图日历 |
| `CursorContextDropdown` | 光标上下文菜单 |

---

## 权限、日志与工作流组件

| 组件 | 用途 |
| --- | --- |
| `permissions/MenuPermissionPanel` | 菜单权限树面板 |
| `permissions/DataScopePanel` | 数据权限范围面板 |
| `logs/LoginLogsTable` | 登录日志表格 |
| `logs/OperationLogsTable` | 操作日志表格 |
| `logs/ClearLogsControl` | 日志清理入口 |
| `logs/ModuleOperationPie` | 模块操作分布饼图 |
| `workflow/SavedViewsBar` | 列表筛选条件保存视图条 |
| `workflow/BusinessFormHost` | 工作流自定义业务表单宿主，按 pages 组件路径加载 |
| `workflow/WorkflowApprovalChainPanel` | 发起态审批链路预览面板 |
| `workflow/WorkflowApprovalDetailSheet` | 审批详情抽屉 |
| `workflow/WorkflowGraphView` | 流程图只读预览 |
| `workflow/WorkflowInstanceCell` | 流程实例列展示 |
| `workflow/WorkflowInstanceDetailPanel` | 流程实例详情面板 |
| `workflow/WorkflowInstanceDetailSheet` | 流程实例详情抽屉 |
| `workflow/WorkflowLaunchForm` | 流程发起表单 |
| `workflow/WorkflowNodeListView` | 流程节点线性列表 |
| `workflow/WorkflowPriorityTag` | 流程优先级 Tag |
| `workflow/WorkflowProcessLayout` | 流程处理页布局 |
| `workflow/WorkflowSideSheet` | 工作流侧边抽屉 |
| `workflow/WorkflowSLATag` | SLA / 超时展示 Tag |
| `workflow/WorkflowSummaryLine` | 流程摘要行 |
| `workflow/workflow-task-columns.tsx` | 任务表格列工厂：任务编号、节点、类型、状态、处理人、意见、耗时等 |
| `workflow/workflow-runtime.ts` | 工作流运行态标签、节点状态与审批人辅助函数 |

---

## 组件子目录库

- **`charts/`**：指标卡、空图表、VChart spec 构建工具和统一调色板。页面只需要指标卡时直接从 `@/components/charts/StatCard` 导入，避免桶文件带入 VChart 依赖。
- **`data-grid/`**：db-admin 数据浏览用虚拟滚动可编辑表格，包含单元格编辑、选择、剪贴板、列宽、本地排序与 xlsx 导出工具。
- **`data-viz/`**：轻量条形可视化组件 `MetricMeter` 与 `DataBar`。
- **`logs/`**：日志列表、清理和统计图组件。
- **`permissions/`**：菜单权限与数据权限面板。
- **`workflow/`**：工作流运行态、详情、审批链路、任务列与流程布局组件。
