# 前端硬约束（Step 8）

前端层的「必须 / 禁止」清单，与 [constraints.md](./constraints.md)（后端与全局）互补。

与写法文档的分工（同一内容只在一处维护）：本文只写**规则**——必须 / 禁止、判定依据与豁免清单；
代码模板、度量数字与组件机理归写法文档（[crud-frontend.md](./crud-frontend.md)、
[query-cache.md](./query-cache.md)、[ui-patterns.md](./ui-patterns.md)），本文以链接指向，不复述细节。
两边同时描述同一事实即视为缺陷，发现后收敛到单侧。

| 改动涉及 | 章节 |
| --- | --- |
| 域 hooks、弹窗、搜索状态、提交与确认 | [必须复用的公共 hook / 工具](#必须复用的公共-hook--工具) |
| mutation 失效、query key、下拉源、回填 | [缓存与 query key](#缓存与-query-key) |
| 搜索栏、筛选控件、表格、List 分页与操作列 | [搜索栏与表格](#搜索栏与表格) |
| 弹窗表单、敏感字段、枚举标签、上传、时区、Cron、进度条、滑块、分割线 | [表单与展示组件](#表单与展示组件) |
| 多 Tab、左右分栏、统计卡、栅格、抽屉宽度、行内成组间距 | [布局与响应式](#布局与响应式) |
| 新增页面文件、引入重库 / 图标 / 插画、改启动链路、预算失败 | [打包与首屏性能](#打包与首屏性能) |
| 拖拽 / 调整尺寸手势、图表或卡片列表重渲染、`useQueries` 聚合 | [渲染性能](#渲染性能拖拽手势--大列表--查询聚合) |

---

## 必须复用的公共 hook / 工具

漏写这些封装焊死的契约时**不会报错**，只会表现为界面行为异常，因此一律不得手抄等价实现。

| 场景 | 必须使用 | 禁止的手写实现 | 漏写的代价 |
| --- | --- | --- | --- |
| 服务端调用 | `lib/contract-query.ts`：`api(op, input)` / `useApiQuery(op, input)` / `useApiMutation(op)`，`op` 来自 `@zenith/shared/{域}` 的契约 | `request.get<T>('/api/...')` 等路径字面量与响应泛型（`api-conformance.test.ts` 对照服务端路由表守住残留字面量） | 路径写错线上 404 而 Demo 全绿；响应类型与服务端漂移 |
| 标准 CRUD 域 hooks | `lib/contract-query.ts` 的 `createResourceQueries(xxxContract)` | 手抄 `xxxKeys` 与列表 / 详情 / 保存 / 删除 / 下拉源 | 保存后列表不变；已删记录重新打开弹窗时闪出旧数据 |
| 非标准命名的新增 / 编辑对（`createRule` / `updateRule`、`slotCreate` / `slotUpdate`…） | `lib/contract-query.ts` 的 `useSaveMutation(createOp, updateOp, { invalidate, requestOptions })`，变量 `{ id?, values }` | 手写 `useMutation({ mutationFn: ({ id, values }) => id === undefined ? api(create, …) : api(update, …), onSuccess })` | create / update 的 requestOptions 与失效各写一份，两处漂移 |
| 新增 / 编辑弹窗 | `hooks/useEditModal.ts` | `useRef<FormApi>` + `editingRecord` + `try { validate() } catch` + `Toast` + 关闭四件套 | 确定按钮永远转圈；异步详情进不了表单；下次「新增」带出上次记录 |
| 弹窗 / 抽屉自定义页脚 | `components/ModalFooter.tsx`（`<ModalFooter {...modal.footerProps} okText="保存" />`，独立提交状态传 `onCancel` / `onOk` / `loading`；左侧次要动作传 `extra`） | `<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>` + 取消 / 确认两个 `Button` | 按钮次序、主次样式与间距各页不一；详情加载中未禁用提交 |
| Excel / CSV 导入入口 | `components/ImportButton.tsx`；自定义导入面板用 `hooks/useImportUpload.tsx`（隐藏 file input → 上传文件中心 → 提交任务，正式 / 预检） | 手写 `<input type="file">` + `useUploadFile` + `useSubmitImportJob` 串联 | 预检标记与 loading 归属错乱；上下文参数漏传 |
| 列表页搜索状态 | `hooks/useListSearch.ts`；受控筛选控件一律整体绑定：`<StatusSelect items={statusItems} {...bind('status')} />`，控件回传比字段宽时 `bind('status', (v) => enumValueOf(STATUSES, v))`，关键字输入框用 `{...bindKeyword('keyword')}`（额外接回车查询）；`Checkbox` 等非 `value` / `onChange` 形态的控件才用 `setField`，一次改多个字段才用 `setDraftParams`；控件直接写在 `ListSearchToolbar` 槽位里。筛选字段的空值一律 `undefined`（可选字段、`defaults` 写 `undefined`，不用 `null` 或 `''` 哨兵），`null` 形态的字段会迫使页面写 `value={x ?? undefined}` + `setField(...)(v ?? null)` 往返；必选区间等不允许清空的字段用 `bind('range', (v) => v ?? defaultRange())` 兜底。合法保留：选中即查询的 `value={draftParams.x}` + `onChange={(v) => applySearch({ ...draftParams, x: v })}`、多字段联动的 `setDraftParams((p) => ({ ...p, a: v, b: undefined }))`（ESLint 封禁单字段 `setDraftParams({ x })` 与 `onChange={setField('x')}`） | `draftParams` / `submittedParams` 双状态 + `handleSearch` / `handleReset`；手写 `value={draftParams.x} onChange={setField('x')} onSearch={handleSearch}` 三件套或 `onChange={(v) => setField('x')(v as T)}` 断言；`const renderKeyword = () => (...)` 之类只调用一次的渲染闭包；单字段写入手写 `setDraftParams((p) => ({ ...p, x: v }))`；数字 id 筛选用字符串 Select 再 `String()` / `Number()` 往返（应 `FilterSelect<number>` + 数字 `items`）；布尔筛选在草稿存 `boolean` 再 `String(v)`（应存 `'true' \| 'false'`，提交时收窄） | 条件未变时点「查询」不回源，且列表仍有数据、不报错；关键字漏接 `onSearch` 回车不查询；下拉控件误接 `onSearch` 会把 Semi 的下拉搜索回调当成查询触发 |
| 导出 / 深链等对象参数的空值过滤 | `lib/query.ts` 的 `compactQuery({ ... })`（丢弃 `undefined` / `null` / 空串），时间区间直接展开 `...formatDateTimeRangeForApi(range)`（日期级选择器用 `formatDateRangeForApi` / `formatDateRangeValuesForApi`，写法见 [crud-frontend.md → 搜索工具栏筛选控件](./crud-frontend.md#搜索工具栏筛选控件)） | `...(x ? { x } : {})` 条件展开、`x || undefined` 逐字段手写、`const [ds, de] = range ?? []` + `ds ? formatDateForApi(ds) : undefined` 逐端点手写 | 各页对空串 / `0` / `false` 的取舍不一致；日期级区间误用秒级 helper 漏掉终止日 |
| 列表页工具栏排布 | `components/list-page` 的 `ListSearchToolbar`（`keyword` / `filters` / `create` / `actions` 槽位 + `onSearch` / `onReset`） | 手写 `SearchToolbar` 的 `primary` / `mobilePrimary` / `mobileFilters` 双份 JSX、`renderKeywordSearch` 之类的渲染闭包 | 桌面 / 移动排布各页不一致；移动端漏掉查询或新增 |
| 状态开关列 | `components/list-page` 的 `useStatusToggle({ toggle, confirmDisable, disabled })` → `status.column()` | `togglingId = mutation.isPending ? mutation.variables?.id : null` + 手写 `Switch` + `Modal.confirm` + `Toast.success('已启用')` | 行内 loading 与载荷形状耦合；停用确认样式各页不一 |
| 列表删除动作 | `components/list-page` 的 `deleteAction`（操作列）/ `confirmAndDelete`（批量按钮） | 操作列里手写 `{ key: 'delete', danger: true, onClick: () => confirmDelete({ onOk: async () => { await mutateAsync(); Toast.success('删除成功'); } }) }` | 漏 Toast / 漏 danger / 成功后忘清选中 |
| 列表表格接线 | `components/list-page` 的 `listTableProps(listQuery, { pagination: buildPagination })` 展开到 `ConfigurableTable` | 手写 `dataSource` / `loading` / `onRefresh` / `refreshLoading` / `rowKey` / `size` / `bordered` 七件套 | 漏 `onRefresh` 没有刷新按钮；分页 total 取错 |
| 树形表格展开态 | `hooks/useTreeExpansion.ts` | 递归收集节点 key + `isAllExpanded` 计数比较 + `onExpandedRowsChange` 行→key 映射 | 传未筛选数据时按钮显示「全部展开」却点不动（死按钮）；数据清空后空表格显示「全部折叠」 |
| 元素尺寸测量（表格 / 画布填满剩余高度） | `hooks/useElementSize.ts`（`const { ref, height } = useElementSize({ height: 500 })`） | `useRef` + `useState` + `new ResizeObserver(...)` + `observe` / `disconnect` effect | 漏 `disconnect` 泄漏观察器；各页取整与初始占位不一致 |
| 头像选文件 → 裁剪 → 上传 → 落库 | `hooks/useAvatarCropUpload.ts`（`fileInputProps` 展开到隐藏 `<input>`，`cropperProps` 展开到 `AvatarCropperModal`，落库动作放 `onUploaded`） | 手写 `handleAvatarFileSelect` / `FormData.append('file', blob, 'avatar.jpg')` / 上传失败 Toast | 上传错误提示与失败后是否关闭裁剪弹窗各处不一致 |
| React Flow 关系图点选高亮 | `hooks/useGraphSelectionHighlight.ts`（返回 `nodes` / `edges` / `onNodesChange` / `handleNodeClick` / `handlePaneClick`） | 手写 `useNodesState` + 同步 effect + `related` / `relatedEdges` 集合 + `dimmed` 回写 | 输入变化时选中态未清空；淡化规则各图漂移 |
| 异步任务表格列 | `components/async-task-columns.tsx` 的 `asyncTaskStatusColumn()`（含「取消中 / 等待重试」派生态）与 `asyncTaskItemColumns()` | 页面内联状态 `render` 与任务项五列 | 派生态文案 / 颜色两页不一致 |
| 人员选择器 | `components/UserSelect.tsx`：系统全量用户用默认导出 `UserSelect`；其它权限范围的数据源（工作流可选人员等）各自取数后交给 `UserSelectBase({ users, loading, ...props })` 渲染 | 复制一份 `Select` + `optionList` 映射再换 hook | 「昵称（部门）」标签、加载中禁用、`maxTagCount` 等交互各处漂移 |
| 用户下拉选项（筛选 `FilterSelect` / 表单 `Form.Select` 的 `optionList`） | `hooks/queries/users.ts` 的 `toUserOptions(users)`（标签取昵称，空则回退用户名） | `users.map((u) => ({ value: u.id, label: u.nickname \|\| u.username }))` | 回退规则各页不一 |
| 报表资源页的负责人 / 目录筛选与下拉源 | `pages/report/report-lookups.ts` 的 `useReportOwnerFolderOptions(resourceType)` 取全量用户 + 目录树平铺，`pages/report/report-filters.tsx` 的 `ReportOwnerFilter` / `ReportFolderFilter` 渲染（`items` / `width` / `placeholder` 可覆盖） | 逐页 `useAllUsers` + `flattenReportFolders(useReportFolderTree(...))` + 手写 `FilterSelect placeholder="全部负责人"` | 宽度、可搜索与占位各页漂移 |
| 网盘空间列表列 | `pages/drive/drive-space-columns.tsx` 的 `driveSpaceNameColumn(navigate)` / `driveSpaceTypeColumn` / `driveSpaceOwnerColumn({ orphanTag })` / `driveSpaceDefaultRoleColumn` / `driveSpaceUsageColumn({ width, customQuotaMark })` | 「我的空间」与「空间治理」各抄一份名称 / 类型 / 用量列 | 用量进度条阈值与类型标签颜色两页不一致 |
| 网盘外链列表列 | `pages/drive/drive-share-link-columns.tsx` 的 `shareLinkFileColumn(onOpen)` / `shareLinkCapabilitiesColumn` / `shareLinkAccessColumn` / `shareLinkExpireColumn` / `shareLinkStateColumn({ fixed })` 与操作项 `shareLinkCopyAction(link)`（地址经 `shareLinkAbsoluteUrl` 带部署子路径） | 「我的外链」与「外链治理」各抄一份文件 / 权限 / 访问下载 / 过期 / 状态列，复制链接手拼 `location.origin + url` | 子路径部署下复制出的链接缺 `BASE_URL`；密码标记与计数格式两页不一致 |
| 会员流水页（积分 / 钱包）骨架 | `pages/member/member-ledger.tsx` 的 `useMemberLedgerSearch(listKey)`（`useListSearch` + `?memberKeyword=` 深链）、`MemberLedgerToolbar`（会员关键字 + 类型筛选 + 带权限门的导出）、列 `ledgerMemberColumn()` / `ledgerTypeColumn(labels, colors)` / `ledgerTailColumns()`、选项 `ledgerTypeOptions(labels)` | 两页各抄一份工具栏、导出按钮与会员 / 类型 / 业务类型 / 备注 / 时间列 | 深链、导出参数与列文案两页漂移 |
| 表单启用 / 禁用单选 | `components/FormStatusRadioGroup.tsx`（选项来自字典 `common_status`，支持 `field` / `label` / `disabled` / `type` / `extraText`） | `useDictItems('common_status')` + `Form.RadioGroup field="status"` + `items.map(<Form.Radio>)` 五行块 | 字典为空 / 加载中的处理各页不一 |
| IoT 表单的产品 / 设备选择 | `pages/iot/components/IotSelectors.tsx` 的 `IotProductSelectField({ isEdit })`（编辑态锁定 + 「不可变更」说明）/ `IotDeviceSelectField({ productId, placeholder })` | 逐页 `useIotProductOptions()` + `Form.Select field="productId" … rules={isEdit ? [] : [...]}` 六行块 | 必填 / 锁定文案与设备加载条件各页漂移 |
| 子列表 / Tab 内的分页状态 | `hooks/usePagination.ts` 的 `usePagination(pageSize?)` → `page` / `pageSize` / `setPage` / `buildPagination`（含总数收缩后的页码钳制） | `useState(1)` + `useState(10)` + 手写 `pagination: (total) => ({ currentPage, pageSize, total, onPageChange, onPageSizeChange })` | 删除 / 筛选后停留在空页；页大小切换不回首页 |
| 仪表盘查看态（登录 / 嵌入 / 公开链接） | `pages/report/widgets/dashboard-runtime.tsx`（`defaultFilterValues` / `useDashboardWidgetQueries` / `exportDashboardPng` / `downloadDataUrl` / `dashboardMobileActions` / `widgetClickPayload` / `drilldownPayload` / `openDrilldownUrl` / `widgetStateFromDataMap`）+ `DashboardCanvasView.tsx`；数据源、筛选状态机与鉴权留在各入口 | 在新入口里再抄 `toPng` 导出、下钻载荷、`ScreenCanvas` 空态 / 等比容器 | 桥接事件载荷字段两端不一致；导出背景 / 像素比不同 |
| 会员前台统计数值 / 表单行 | `member/components/StatCard.tsx`（`--m-*` 令牌，与后台 `components/charts/StatCard` 是不同体系）、`member/components/FieldRow.tsx` | 页面内再定义同名局部组件 | 会员端视觉令牌与字号漂移 |
| 支付域表单 / 筛选控件 | `pages/payment/payment-form-fields.tsx` 的 `PaymentAppField`（选中后由调用方重置依赖字段）/ `PaymentMerchantConfigField` / `PaymentCurrencyField` / `PaymentAppFilterSelect`；应用 + 绑定商户配置联动取数用 `payment-app-options.ts` 的 `useAppMerchantConfigLookup(selectedAppId)`；按应用给出可用支付方式用 `useAppPaymentMethodOptions(selectedApp, candidates)`（含权限门、渠道能力查询与退化策略）；提交前校验「应用 ↔ 商户配置」绑定用 `resolveAppConfigBinding(lookup, applicationId, channelConfigId)` | 逐页手写 `Form.Select field="applicationId"` / `channelConfigId` / `currency` 与 `[{ value: 'CNY', … }]`；逐页复制 ~35 行「启用方式 ∩ 渠道能力」memo 与 `paymentAppConfigId` | 必填文案、可搜索、宽度各页不一；能力退化策略两页漂移 |
| 报表资源页表单字段 / 批量启停 | `pages/report/report-form-fields.tsx` 的 `ReportOwnerFolderFields({ userOptions, folderOptions, layout })`、`useReportBatchStatus({ selectedRowKeys, setSelectedRowKeys, mutation, confirmEntity?, confirmContent? })` + `ReportBatchStatusButtons({ visible, onChange })` | 逐页手写 `ownerId` / `folderId` 两个 `Form.Select`、`handleBatchStatus`（Modal.confirm + mutate + 清选中 + Toast）与「批量启用 / 停用」按钮闭包 | 确认文案、Toast 与是否清空选中各页不一 |
| CMS 模型字段动态控件 | `pages/cms/model-field-renderer.tsx` 的 `CmsModelFieldControl({ field, common, richtext?, media? })` 与 `cmsModelFieldOptions(field)` | 内容编辑页 / 站点扩展各写一份 `switch (field.fieldType)` | 新增字段类型只改一处，另一处漏渲染成普通输入框 |
| 消息模板编辑表单 / 发送日志页 | `pages/system/message-template-form.tsx` 的 `TemplateNameCodeRow` / `TemplateVariablesRemarkRows`；发送日志筛选对 `send-log-ui.tsx` 的 `SendLogStatusSourceFilters`，共用列 `send-log-columns.tsx` 的 `sendLogSourceColumn` / `sendLogOperatorColumn` / `sendLogErrorColumn` / `sendLogStatusColumn` | 邮件 / 短信 / 站内信页各抄一份名称编码行、变量备注行、状态来源筛选与列 | 三页字段校验文案与列宽漂移 |
| 中断表单提交 | `lib/abort-submit.ts` 的 `abortSubmit()`（先给用户提示再调用） | `return`、`throw new Error('多词消息')` | 按钮一直转圈；或多弹一个「操作失败：xxx」并向 `/api/frontend-errors` 灌入假告警 |
| 破坏性操作确认 | `utils/confirm.ts` 的 `confirmDelete` / `confirmDanger`；async 流程用 `confirmDangerAsync` 取布尔结果 | `Modal.confirm({ okButtonProps: { type: 'danger' } })`、`new Promise<boolean>` 包 `Modal.confirm`、在 `confirmDelete` 调用里再传 `okButtonProps: { type: 'danger' }` | 「确定删除」与「确定提交」渲染成同一个蓝色主按钮 |
| 防抖 / 节流 | `@tanstack/react-pacer`：值防抖 `useDebouncedValue`，回调防抖 `useDebouncedCallback`（需手动 `cancel` / `flush` 时用 `useDebouncer`），节流 `useThrottledCallback`；`useEffect` 内等非 hook 上下文用 `Debouncer` / `Throttler` 类 | `setTimeout` + `clearTimeout` 手写防抖、`Date.now()` 差值手写节流、timer ref + 卸载清理样板 | 各处 wait / 边沿语义不一致；漏写卸载清理导致组件卸载后仍 setState / 发请求 |
| 复制 / 读取剪贴板 | `utils/clipboard.ts` 的 `copyText` / `copyTextWithToast` / `readClipboardText` / `canWriteClipboardItems` | 裸调 `navigator.clipboard.writeText` / `readText`（ESLint 已封禁）、自写 textarea + `execCommand` | 内网 `http://ip` 访问不是安全上下文，`navigator.clipboard` 为 undefined，点复制直接 TypeError |
| 带鉴权的非 JSON 请求（流式 / SSE / 二进制 / 第三方上传组件） | `request.fetchRaw(url, init)` 拿原生 Response；纯文本流 `streamText`、SSE 流 `readSseStream`（`utils/streaming.ts`）；二进制 `request.getBlob(url, init?)` / `request.download`；Semi `Upload` / wangEditor 等组件的 `headers` 传 `request.authHeaders()` | 裸 `fetch` + `localStorage.getItem(TOKEN_KEY)` 手拼 `Authorization`、自写 `getReader()` 循环与 `event:` / `data:` 帧解析 | token 过期不刷新直接 401、失败没有统一提示、Demo 模式拦不住；SSE 帧被拆到两个 chunk 时事件丢失 |
| 树形数据转换 | `@zenith/shared/core` 的 `buildTree` / `mapTree` / `flattenTree`（用法见 [constraints.md → 通用工具函数](./constraints.md#通用工具函数zenithsharedcore)）；CMS 栏目树用 `pages/cms/channel-tree.ts` 的 `channelsToTree` / `channelsToSelectTree` / `flattenChannels` | 手写 `Map` + `parent.children.push` 挂接、`nodes.map((n) => ({ ..., children: n.children ? fn(n.children) : undefined }))` 递归、`nodes.flatMap((n) => [n, ...flatten(n.children)])` | 各处对孤儿节点 / 空 children 的处理不一致，禁用规则（仅列表型栏目可选）漏抄 |
| 图表 X 轴 / 趋势表的短日期标签（`YYYY-MM-DD` → `MM-DD`） | `utils/date.ts` 的 `shortDate`（`axis: { xLabel: shortDate }`） | 页面内 `function shortDate`、`xLabel: (v) => v.slice(5)` | 各页对短串 / 非日期串的处理不一 |
| 秒级时长 / 运行时长展示 | `utils/format.ts` 的 `formatSecondsHuman(seconds)`（「3天2小时5分」，不足 1 分显示秒）、`formatUptime(seconds)`（0 / 负值视为未知 → 占位符）、`formatSecondsBetween(start, end)`；毫秒耗时用 `formatDurationMs`，播放 / 通话计时用 `formatClock` | 页面内 `function formatUptime` 手算 天 / 小时 / 分并各自拼文案 | 「3天 2小时」「2 天 5 小时」「< 1 分」各页文案不一 |
| React Flow 自动布局 | `utils/graph-layout.ts` 的 `layoutWithDagre(nodes, edges, { rankdir, nodesep, ranksep, nodeSize })` | 页面内 `new dagre.graphlib.Graph()` + `setNode` / `setEdge` / `layout` + 中心点换算 | 中心点 → 左上角换算漏写导致节点整体偏移 |
| 文件扩展名 → Monaco 语言 | `utils/monaco-language.ts` 的 `monacoLanguageByExt(ext)` | 组件内自维护 `LANGUAGE_MAP` | 预览与编辑器识别的语言集合不一致 |
| 工作流单任务动作（同意 / 驳回 / 转办 / 委派 / 加减签 / 退回） | `hooks/queries/workflow-tasks.ts` 的 `runWorkflowTaskAction(vars, options)`（幂等键前缀与请求实例经 `options` 传入） | 各端手写 `switch (vars.action)` → `api(workflowTaskContract.xxx)` | 新增动作只改一端，另一端漏接 |
| 日志统计的周分布 / Cron 趋势图 | `components/logs/LogStatsScaffold.tsx` 的 `weekdayBuckets(dailyStats)`；`pages/system/cron-jobs/cron-dashboard-shared.tsx` 的 `buildCronTrendSpec(data, palette)` | 页面内 `new Array(7).fill(0)` 归桶、逐页复制 `makeMixedBarLineSpec({...})` | 周几起点（周一 / 周日）与图例颜色两页漂移 |
| 整页错误态（403 / 404） | `components/ErrorStatePage.tsx`（插画 + 文案 + 返回按钮 + 语义事件上报） | 页面内复制 `Empty` + 两个 `Button` + `trackEvent` effect | 按钮次序与埋点字段各页不一 |
| 读取 / 编辑运行时设置 | `hooks/queries/settings.ts` 的 hooks（按场景选型见 [settings.md → 前端读取规则](./settings.md#d-前端读取规则)）；模块编辑表单用 `components/settings/SchemaForm.tsx`（由模块 Zod schema 渲染控件、约束、标签） | 手写 `useQuery` 取 `/api/settings/*`、每个页面单独请求模块信封拿一个开关、把默认值抄进页面、为每个设置字段手写 `Switch` / `InputNumber` 与 min / max | 同一开关多处请求且保存后彼此不一致；默认值 / 范围约束与 schema 漂移 |

各症状的完整诊断见 [troubleshooting.md](./troubleshooting.md)。

补充判定：

- `createResourceQueries` 覆盖契约的 `list` / `detail` / `create` / `update` / `remove` / `removeBatch` / `all`；
  非标准命名的新增 / 编辑对用 `useSaveMutation(createOp, updateOp, { invalidate })`（`values` 接受 create / update 入参的部分形态，
  路径参数固定为 `id`；带父级路径参数的成对操作拆成两个 `useApiMutation`，由页面按有无 id 选择），域内其余操作用
  `useApiMutation(xxxContract.op, { invalidate })` / `useApiQuery(xxxContract.op, input, { enabled, select, … })`，失效用工厂导出的 `keys`
  或 `contractKey(op)`。mutation 变量即契约输入 `{ params?, query?, headers?, body? }`；空响应而失效需要额外上下文时用
  `useApiMutation<typeof op, InputOf<typeof op> & { 上下文 }>`（额外字段只进 `invalidate`，不发请求），
  **禁止**再包一层手写 `useMutation`。`src/hooks/queries/**` 直接 import `useQuery` / `useMutation` 被 ESLint 拦截，
  仅组合多次请求、非契约通道（`request.getBlob` / SSE）、按参数在多个契约操作间分派、上传进度、`apiRaw` 读信封、`useInfiniteQuery`
  可在 import 行 `eslint-disable` 并注明理由，其 key 仍由 `contractKey` 生成
- 需要读取响应信封（结果 `message`、非零 `code` 分支、限流倒计时等）的调用用 `apiRaw(op, input, options)`，
  **禁止**用 `request.post<T>(urlOf(op), body)` 手写响应泛型；`urlOf(op)` 只用于上传 / 下载 / SSE 等非 JSON 通道
- `useEditModal` 的表单值类型取契约的创建入参：`useEditModal<Xxx, Partial<CreateXxxInput>>`；记录里的 `null`
  经 `toValues` / `beforeSave` 归一为未填，**禁止**把实体类型直接当表单值类型
- 筛选控件的宽类型值（`string`）交给按枚举声明的契约查询参数前用 `enumValueOf(XXX_VALUES, value)`（`@zenith/shared/core`）收窄
- `useEditModal` 的例外（页面级全局配置表单、认证流程、工作流设计器与运行时表单、db-admin 行编辑器、
  保存后不关闭的搭建器工作区）需写注释说明理由；若该表单同时配了详情查询，`<Form>` 的 `key`
  **必须**用 `formRemountKey(id, detail)`
- 不经输入框直接筛选（点部门树 / 标签 / 收藏 / 保存的视图）用 `useListSearch` 的 `applySearch(params)`；
  **禁止**暴露 `submittedParams` 的裸 setter（会绕过页码重置与失效）
- **非破坏性确认**（提交、发布、启用、退出、导出）继续用原生 `Modal.confirm`，不加 danger；
  删除文案**不做统一**，指明对象的具体文案比通用文案更能防误操作
- **Pacer 只接管「重复触发」语义**（防抖 = 突发取最后、节流 = 限频）。一次性定时器不属于此范围
  （DOM 就绪等待、倒计时、到期清理、重连退避、可中止 sleep），继续用原生 `setTimeout`；
  按 key 分组的定时器集合（如 typing 每用户过期）属专用逻辑，不强制迁移
- **前沿节流**（立即执行 + 冷却窗口内丢弃）显式传 `{ leading: true, trailing: false }`；
  Pacer hooks 卸载时自动 cancel，**禁止**再写 timer ref + 卸载清理样板
- **Pacer 仅限 web 端**：服务端限流走自研 Redis 限流中间件（`middleware/rate-limit.ts`）等既有设施（进程内存节流在多实例下失效），
  `analytics-sdk` 保持零依赖，两者**禁止**引入 Pacer
- **非安全上下文只 polyfill 能等价实现的 API**：`crypto.randomUUID` 由入口 `polyfills.ts` 用
  `@zenith/shared/core` 的 `uuidV4` 补齐，业务代码直接写 `crypto.randomUUID()`，**禁止**再写
  `?.randomUUID?.() ?? Math.random()` 之类兜底；`analytics-sdk` 嵌入第三方页面不能改宿主全局，
  只能调用 `@zenith/shared/core` 的 `randomUUID()`（ESLint 已封禁裸调）。`navigator.clipboard`
  **禁止** polyfill——残缺对象会误导 `@univerjs/ui` 等库的特征检测，读文本 / 写图片由调用方降级；
  `getUserMedia`、Service Worker、Notification 无法兜底，需 HTTPS 或浏览器策略 `OverrideSecurityRestrictionsOnInsecureOrigin`

## 缓存与 query key

判定推论、策略表与 key 树设计见 [query-cache.md](./query-cache.md)，硬约束：

- **精确失效**：`onSuccess` 按真实副作用失效，**禁止**无条件 `invalidateQueries({ queryKey: xxxKeys.all })`；
  判据是「有没有已挂载的查询读了这次被改动的状态」。删除用 `removeQueries(detail(id))`；
  确需全域失效（批量覆盖、切租户、全量导入）须在注释写明理由
- **key 结构**：一切 key 由 `contractKey(op, input)` = `[resourceKeyOf(basePath), 操作名, input?]` 生成；`createResourceQueries` 的
  `keys.lists / list(params) / detail(id) / lookup` 与对应操作的 `contractKey` 同键（`/api/tenants` → `['tenants', 'list', { query: params }]` /
  `['tenants', 'detail', { params: { id } }]` / `['tenants', 'all']`）。**禁止**手写字面量 key 树与域根广播（`['workflow']` 之类在契约 key 下匹配不到任何查询）；
  按意图失效导出具名 helper（`invalidateAfterXxx(qc, …)`）列出精确前缀，别的域调用 helper 而不是拼对方 key；
  输入子集即前缀（`contractKey(op, { params: { id } })` 覆盖该 id 的全部 query 变体），空输入 `{ query: {} }` 是所有同操作 key 的前缀，只想打掉它自己时 `exact: true`；
  独立生命周期的子资源另起契约操作；静态 lookup、数据库元数据与昂贵派生取数是独立操作，不与列表同前缀
- **下拉源归属所有者域**：**禁止**用本域 key 请求别域资源（所有者域增删改时无人失效它，界面静默显示旧列表），
  一律复用 `useAllRoles` / `useFlatDepartments` / `useAllUsers` / `useAllPositions` / `useDictItems` 等共享 lookup hook
- **手写 mutation 的回填红线**：`setQueryData(detail(id), saved)` 仅限写接口与详情接口同源；脱敏口径不一致（`unmasked` 端点 /
  非契约通道的响应）、详情多出关联数据、写接口不回传编辑过的关联字段、列表 / 树含聚合字段这四种情形**必须**改为失效 `detail(id)`
- **失效行为需可证伪**：测试用 `test-utils/query-harness.ts` 断言实际请求数、进入 fetching 的查询与缓存新鲜度
  （`countOf(prefix)` 与 `invalidateQueries` 同一套部分匹配语义，断言「另一组参数未被波及」传 `{ exact: true }`）；
  **禁止**只 spy「调用了 `invalidateQueries(某 key)`」——广播写法与被改坏的精确写法下同样通过
- **轮询**用 `refetchInterval`，禁止手写 `setInterval` 拉数据

## 搜索栏与表格

- **搜索栏布局**：标准列表页统一用 `components/list-page` 的 `ListSearchToolbar`（`keyword` / `filters` / `create` / `actions`），
  它已按规则排布桌面与移动端：移动端主区 关键词 + 查询 + 新增，其余筛选进底部抽屉、低频操作进更多菜单。
  非标准页（无查询语义的工具面板、多套筛选区）才直接用 `components/SearchToolbar.tsx` 的结构化模式
  （`primary` / `filters` / `actions` + `mobilePrimary` / `mobileFilters` / `mobileActions`）。
  工具栏会同时渲染桌面与移动两套控件（CSS 决定显隐），页面测试取控件一律用 `test-utils/toolbar.ts` 的
  `desktopToolbar(container).getByText('查询')`，**禁止** `screen.getByPlaceholderText(...)` 直取（jsdom 下命中两个元素）
- **筛选控件**：关键字 / 枚举 / 状态 / 数字 / 时间范围统一用 `components/search-filters.tsx` 的
  `KeywordInput` / `FilterSelect` / `StatusSelect` / `NumberFilter` / `DateRangeFilter`，**禁止**手写 `prefix={<Search size={14} />}`、
  `showClear`、`hideButtons`、`style={{ width: N }}` 这类装饰性属性，也**禁止**手写 InputNumber 的
  `v !== '' && v != null ? Number(v) : null` 归一；业务属性仍显式传入。
  筛选字段的空值一律 `undefined`（`SearchParams` 声明为可选，不用 `null`），这样控件能直接 `{...bind('字段')}`。
  **例外**：面板 / 弹窗内需跟随容器自适应的搜索框（如 `NavListPanel` 的 List header）不套用
- **时间范围筛选**：一律 `DateRangeFilter`（秒级默认 `dateTimeRange`，日期级 `type="dateRange"`），弹窗 / 抽屉 / 统计卡里的区间查询同样适用；
  **禁止**手写 `DatePicker type="date(Time)Range"`，**禁止**用两个 `type="dateTime"` 单选拼「开始 / 结束」；
  **禁止**传小于默认的 `width`（默认 400 / 280 是不截断内容的下限，Semi 把两个输入框均分剩余宽度，改小就会截掉秒数或日期），
  只允许 `width="100%"`、`style={{ flex: 1 }}` 这类自适应覆盖。表单里的 `Form.DatePicker` 区间字段不在此列
- **枚举筛选下拉**：列表页搜索栏（含 Tab / 抽屉 / 展开行内的子列表）里的单选枚举筛选一律 `FilterSelect`，
  状态用 `StatusSelect`；占位必须是「全部 X」（描述空值含义），**禁止**「请选择 X」或裸「X」，**禁止**在选项里放
  `{ value: '', label: '全部' }` 之类哨兵项；空值即 `undefined`（`SearchParams` 字段声明为可选、`defaults` 写 `undefined`），
  宽度用默认 120，只在占位或选项文案放不下时传 `width`。多选筛选与没有「全部」语义的必选下拉（视图切换、所属应用）用原生 `Select`
- **公共按钮**：查询 / 重置 / 新增 / 刷新统一用 `components/toolbar-controls.tsx` 的
  `SearchButton` / `ResetButton` / `CreateButton` / `RefreshButton`，文案不同时用 children 覆盖；
  批量删除用 `BatchDeleteButton`（`count` 拼进文案，是否渲染仍由调用方按「有选中 && 有权限」判断）。
  **例外**：仅复用同一图标的独立操作（「测试发送」「生成链接」）及视觉本就不同的写法保持原生 `Button`
- **移动端更多菜单**：`mobileActions` 只放低频操作；普通按钮用 `theme="borderless"`
  （危险操作保留 `type="danger"`），导出优先 `ExportButton variant="flat"`
- **表格样式**：统一 `<ConfigurableTable columns={columns} {...listTableProps(listQuery, { pagination: buildPagination })} />`
  （`components/list-page`；默认 `bordered` / `rowKey="id"` / `size="small"`，并接好 `dataSource` / `loading` / `onRefresh` / `refreshLoading`）。
  非分页包络的数据源或树形表格才手写这些属性，但仍必须传 `onRefresh` 与 `refreshLoading`（统一取 `listQuery.isFetching`）
- **弹性主列**：每个表格**有且只有一个**弹性主列（通常是名称 / 标题 / 描述列）——不写 `width`，
  改写 `minWidth` 声明最小宽度；其余列一律写固定 `width`。**禁止**页面传 `scroll.x`
  （`ConfigurableTable` 按各列宽度之和自动推导，传入值会被忽略并在开发期告警）；
  虚拟化表格只传 `scroll.y`。所有列都写 `width` 时组件会挑一列兜底并告警，不得依赖兜底
- **操作列**：一律经 `components/ResponsiveTableActions.tsx` 的 `createOperationColumn` 创建；
  动作只用纯文字 `label`（不加图标、不包 `Popconfirm`；删除用 `deleteAction`，其它确认走 `Modal.confirm` / `confirmDanger`），
  危险操作加 `danger: true`；桌面端内联动作**不超过 3 个**，其余用 `desktopInlineKeys` 收进「更多」菜单
- **操作列宽度**：`width` 必填，取值 = 最宽内联组合的内容宽 + 40，向上取整到 10；新增 / 修改动作后必须复核。
  **禁止**列宽小于内容宽——单元格无 `overflow: hidden`，不报错也不截断，而是吃掉 padding 并挤压相邻固定列
  （开发期控制台会告警）。动作随行状态变化时，只把各状态都存在或宽度相近的高频动作留在内联，
  状态特有 / 低频动作进「更多」，**禁止**按最宽的罕见状态配宽让常见行大片留白；
  按 Tab 分状态的列表可按 `activeTab` 分别给 `width` / `desktopInlineKeys`。
  度量常量、计算方式与常用组合宽度见 [ui-patterns.md → 操作列](./ui-patterns.md#操作列)
- **状态列**：启停开关列一律 `useStatusToggle(...).column()`（默认「状态」/ 80 / `fixed: 'right'`），只读状态用 `renderEnabledStatusTag` / `DictTag`；
  状态列必须紧靠操作列左侧，并同样 `fixed: 'right'`
- **列公共工具**：`createdAtColumn` 与 `renderEllipsis` 从 `utils/table-columns` 导入；
  **禁止**内联写 `<Typography.Text ellipsis={{ showTooltip: true }} …>`（裸写法一律 `renderEllipsis(v)`，
  空值统一 `EMPTY_PLACEHOLDER`；只有需要 `link` / `strong` / `type` / `onClick` 等附加属性时才保留内联 `Typography.Text`）
- **时间 / 日期列**：一律用 `utils/table-columns` 的 `dateTimeColumn(title, dataIndex, options?)`
  （日期时间，宽 180）或 `dateColumn(...)`（纯日期，宽 120）创建，`createdAt` / `updatedAt`
  直接用预置的 `createdAtColumn` / `updatedAtColumn`。工厂已内建格式化与空值兜底，
  **禁止**再手写 `width` 与 `render: (v) => formatDateTime(v)` / `v ? formatDateTime(v) : '-'`。
  语义化空值（「永久」「不限」「未发布」）传 `empty`；unix 秒时间戳传 `unit: 'second'`；
  紧凑表格的字号 / 弱化色传 `className`（`table-cell-compact` / `table-cell-muted`），
  **禁止**为此包一层 `Typography.Text size="small"`；`sorter` / `fixed` 等直接透传。
  判定依据是**字段语义**而非列标题：`xxxAt` / `xxxTime` 一律走工厂，
  哪怕标题是「最近活跃」「下次执行」这类业务措辞。
  时间列不承载副文案与装饰：图标 / 等宽字体一律去掉，「清理 N 行」这类附加信息拆成独立列。
  只有时间**区间**（一格渲染起止两个值）与真正的复合列可保留自定义 `render`，
  此时 `width` 也必须取 `DATE_TIME_COLUMN_WIDTH`
- **可复制列**：列值需要一键复制时一律用 `utils/table-columns` 的
  `copyableNoColumn(title, dataIndex, options?)`（省略 tooltip + 恒定复制按钮 + 空值 `—` 已内建），
  **禁止**在列 `render` 里手写 `<Typography.Text copyable …>` 或自拼「文本 + 复制按钮」，
  也**禁止**在同一个 `Typography.Text` 上同时挂 `ellipsis` 与 `copyable`（Semi 合并测量会误截断）。
  展示与复制默认都取字段原值；打码展示、紧凑展示复制完整值、拼接派生值等分离场景传
  `displayText` / `copyContent`（均为纯文本转换），不要因此退回手写 `render`。
  仅以下场景保留自定义 `render`：复制之外还有其他节点 / 按钮的复合单元格、
  复制内容并非本列展示语义（如点击数列附带复制短链）、空值需按业务态区分占位文案的多态列，
  以及非 Semi Table 的原生表格。详情面板 / 弹窗内的 `Descriptions` / `Paragraph` 复制不是列，不适用本条
- **空值占位统一**：用 `utils/table-columns` 的 `EMPTY_PLACEHOLDER`（`—`），**禁止**混用 `-` / `–`
- **树形表格展开控制**：用 `children` 渲染树形表格时必须在搜索栏加「全部展开 / 全部折叠」按钮，
  展开态一律用 `hooks/useTreeExpansion.ts`（受控 `expandedRowKeys` + `onExpandedRowsChange` 由它提供）；
  图标已展开用 `ChevronsDownUp`，未展开用 `ChevronsUpDown`。
  **传入的必须是表格实际渲染的数据**（筛选后的那份），传全量树会让筛选后的按钮点不动。
  只有部分行可展开或行 key 不是 `id` 时，用 `collectKeys` / `getRowKey` 覆盖
- **批量按钮显示时机**：仅 `selectedRowKeys.length > 0` 时显示，放在查询 / 重置按钮之后
- **List 列表页分页**：页面主体用 Semi `List` 渲染分页数据时，分页条一律用
  `components/ListPagination.tsx`（左侧条数信息 + 右侧分页器，对齐表格分页形态；
  移动端策略组件内置）；**禁止**手排独立 `<Pagination>` —— 其 `showTotal` 只显示总页数，
  没有「显示第 x 条-第 y 条，共 z 条」的条数信息。模板与机理见
  [ui-patterns.md → List 列表页分页](./ui-patterns.md#list-列表页分页listpagination)。
  **例外**：窄面板 / 弹窗内的内嵌分页（`NavListPanel` 的 footer、选择器弹窗）保持紧凑形态，不套用

## 表单与展示组件

- **弹窗表单**：`Form` 必须 `labelPosition="left"`，所有 `Modal` 必须 `closeOnEsc`
  （经 `useEditModal` 时已由 `formProps` / `modalProps` 提供）；`labelWidth` 与单列 / 双列的选取规则见
  [crud-frontend.md](./crud-frontend.md)
- **SideSheet 页脚**：Semi 的 `footer` 槽无对齐样式，**禁止**裸 `<Space>` 放按钮（会靠左）；
  操作按钮一律右对齐，写法、按钮次序与例外见
  [ui-patterns.md → SideSheet 页脚](./ui-patterns.md#sidesheet-页脚)
- **敏感字段（契约 `sensitive()` 声明）的表单与展示**：编辑表单用 `components/sensitive` 的 `SensitiveFormInput` +
  `useSensitiveFormFields`（锁定掩码值、点「修改」再输入、`strip()` 剔除未修改字段），表格 / 详情用 `SensitiveText`
  （按需查看明文按钮，服务端逐次审计）；**禁止**用普通 `Form.Input` 回填并把掩码值原样提交（出口边界会 400）
- **枚举标签与选项统一来源**：**禁止**在页面 / 组件 / 导出定义中内联 `{ value, label }` 数组或
  `Record<value, label>` 中文映射；下拉 / 单选组的选项数组用各来源导出的 `XXX_OPTIONS`（由 `createLabelOptionsFromMap(XXX_LABELS)` 派生），
  **禁止**在页面里 `Object.entries(XXX_LABELS).map(([value, label]) => ({ value, label }))`，页面本地标签表同样经
  `createLabelOptionsFromMap` 派生。按优先级取：

  | 枚举性质 | 来源 |
  | --- | --- |
  | 运营可扩展的自由文本枚举 | 字典 `useDictItems('code')`（种子在 `shared/src/seed/platform.ts`）：筛选栏 `items` 直接用 `.items`，表单 `Form.Select` / `Select` 的 `optionList` 用 `.options`，**禁止**页面里 `items.map((i) => ({ value: i.value, label: i.label }))` |
  | 通用启用 / 禁用 | `useDictItems('common_status')`（前端）/ `COMMON_STATUS_LABELS`（server，`@zenith/shared/core`）；表单单选组用 `components/FormStatusRadioGroup.tsx` |
  | 代码耦合枚举（pg enum / 状态机 / 协议值） | `shared/src/{业务域}/constants.ts` 的 `XXX_LABELS` / `XXX_OPTIONS` |
  | 工作流实例 / 任务状态 | `components/workflow/workflow-runtime.ts` 的 `INSTANCE_STATUS_MAP` / `TASK_STATUS_MAP` |

  Tag 颜色、图表色板、CSS 变量留在使用方；外部协议值（如微信 `sex: '1'/'2'`）
  与视角特化文案（如「我已同意」）不做统一
- **单图上传字段**：统一用 `components/ImageUploadField.tsx`，**禁止**重新拼
  `<Upload action headers>` + 预览 `<img>` + 删除按钮
- **时区表单字段**：统一用 `components/FormTimezoneSelect.tsx`；默认必填，自定义字段名 / 标签传
  `field` / `label`，允许留空并回退默认时区时传 `required={false}`。页面内的默认值、提交兜底和比较逻辑
  统一复用 `utils/timezones.ts` 的 `DEFAULT_TIMEZONE`；**禁止**使用 `Form.Input`、自行拼
  `Form.Select optionList`、直接调用 `Intl.supportedValuesOf('timeZone')` 或硬编码 `Asia/Shanghai`
- **Cron 表达式字段**：**禁止**裸 `Form.Input` 手输——一律在输入框 `addonAfter` 挂
  `components/CronBuilderPopover.tsx` 可视化构建器：`value` 传当前表达式，`onApply` 用
  `formApi.setValue` 回填。当前值的取法按表单形态：render-prop 表单直读 `formState.values`；
  普通表单用局部 state（打开弹窗时初始化 + `onValueChange` 同步 + `onApply` 双写）。
  构建器输出 6 段（含秒）表达式，服务端 `cron-parser` 5/6 段通吃，直接存储；
  仅服务端明确只收 5 段的域在调用方边界转换（现存 IotSchedules / WorkflowSchedules 的
  `toSixField` / `toFiveField` 写法），不要新增段数假设
- **进度与度量条语义**：前三类**禁止**手写 `width: '${percent}%'` / `scaleX(percent)` 轨道

  | 数据性质 | 用 |
  | --- | --- |
  | 真实进度（上传、异步执行、目标完成） | Semi `Progress`；任务中心优先 `AsyncTaskProgress` |
  | 有界测量（CPU / 内存 / 配额 / 评分） | `components/data-viz/MetricMeter` |
  | 相对数据条（排行、占比、分布） | `components/data-viz/DataBar`，且必须有相邻可见数值文本 |
  | 无确定百分比 | `Spin`；路由顶部不定加载用 `NProgress` |

  分段构成、时间轴、漏斗等本身承载结构的可视化不套用本条
- **滑块与精确输入联动**：有明确上下界、适合拖动预览且仍需精确输入的数值字段统一用
  `components/SliderInput` 的 `FormSliderInput`（表单内）/ `SliderInput`（受控）。
  金额、ID、配额、Cron、重试次数、保留天数及需 0.01 精度的费率 / 分账比例继续用 `InputNumber`
- **分割线**：统一用 Semi `Divider`，**禁止**用 `<hr>`、空 `<div>` 配 `borderTop` / `borderBottom`、
  `height: 1px` + `background`，或 `::before` / `::after` 伪元素手绘线条

  | 形态 | 写法 |
  | --- | --- |
  | 横向分隔 | `<Divider />`。上下间距对称用 `margin={16}`；不对称才用 `style={{ margin: '14px 0 10px' }}`——`margin` prop 只接受单值并同时写上下 |
  | 竖向分隔（工具栏、行内元素之间） | `<Divider layout="vertical" margin="4px" />`。默认高 20px，要别的高度传 `style={{ height: 16 }}` |
  | 线 + 文字 + 线（分区小标题） | `<Divider align="left">标题</Divider>`（`left` 前导线 40px / `center` 居中 / `right`），**禁止**用三段 `span` 或 flex 拼 |
  | 下拉菜单项之间 | `<Dropdown.Divider />`，不是 `Divider` |

  换配色 / 字号时覆盖 Semi 类名（`.semi-divider-with-text::before` / `::after` 的
  `border-bottom-color`，文字用 `.semi-divider_inner-text`），**禁止**因为要改样式就退回手写。
  **不适用**（这些不是分割线，改用 `Divider` 反而会坏）：面板 header / footer 自身的分区边框
  （`borderTop` + `padding` 且元素内部有内容）、时间轴 / 步骤条的连接线、需要绝对定位或按相邻
  状态条件隐藏的分隔符

## 布局与响应式

写法见 [ui-patterns.md](./ui-patterns.md)。

| 场景 | 必须使用 | 关键判定 |
| --- | --- | --- |
| 页面最外层是多个业务 Tab | `<div className="page-container page-tabs-page">` | 每个 `TabPane` 内自带该 tab 的工具栏、操作按钮、空状态与表格；**禁止**把 TabPane 留空后在 Tabs 外部按 `activeTab` 渲染共用表格 / 按钮。抽屉、弹窗、卡片内代码示例、分栏内部小 tabs 不用 |
| 左侧列表 / 筛选树 + 右侧详情 | `components/MasterDetailLayout.tsx` | **禁止**手写 flex 两栏 |
| 左侧 master 是平铺列表（非树形） | `NavListPanel<T>` + `NavListItem` | 树形数据（需展开 / 折叠）改用 Semi `Tree` |
| 指标卡（数值 + 标题） | `components/charts/StatCard.tsx` 的 `StatCard` + `StatGrid` | **禁止**再写 `<Card>` + 大字号数值 + tertiary 标签的组合 |
| 统计 / 仪表盘页的图表、榜单、明细面板 | 页面根容器挂 `.zx-flat-panels`，面板仍写 Semi `<Card title / extra>`（外壳由它统一脱掉，呈「顶部细线起头」的无卡片面板） | 抽屉 / 弹窗走 portal，根类覆盖不到，需在弹层内容层再挂一次；**禁止**自定义 sectionStyle 卡片盒子，也**禁止**在此类页面渲染带边框圆角的裸 `Card`。写法见 [ui-patterns.md → 无卡片面板](./ui-patterns.md#无卡片面板zx-flat-panels) |

- **页面级 Tabs 的激活态必须走 `hooks/useUrlTabState.ts`**（`?tab=` 深链直达、切换 `replace`
  写回、默认 Tab 不写参数、非法值回退默认、前进后退跟随）；**禁止**用本地 `useState` 管理页面
  顶层 activeTab，也**禁止**手写 `searchParams.get('tab')` 等价实现。写法见
  [ui-patterns.md → 页面级多 Tab 布局](./ui-patterns.md#页面级多-tab-布局)。
  写回受偏好 `syncPageStateToUrl`（「页面状态同步到地址栏」，默认关）控制，hook 已内置：
  关闭时深链进入仍生效一次、参数消费后移除，切换不写 URL；页面代码不感知该偏好。
  **不适用**：弹窗 / 抽屉 / 分栏面板内部 Tabs 与页面二级 Tabs；tab 集合来自动态数据的场景
  （SDK 示例语言、OAuth 提供商列表）；登录方式切换；以及 db-admin 的 `tab`+`table` 联合
  原子写回（拆入 hook 会造成双 effect 竞写 searchParams，保持手写实现，但须同样读取
  `syncPageStateToUrl` 保证全站行为一致）。
  需要「记住上次停留 Tab」的页面（如监控页）把偏好值作为 `defaultTab` 传入即可与 URL 定位共存
- **分栏页的选中项必须走 `hooks/useUrlSelectionState.ts`**（深链直达、replace 写回、
  未选中删参、外部导航跟随，同受 `syncPageStateToUrl` 偏好控制）；参数名取所选实体的领域名词
  （`dict` / `channel` / `file` / `openid`…），**禁止** `id` / `item` 这类无信息量的通用名，
  也**禁止**手写 `searchParams.get` 等价实现。硬规则：
  - **同页已有 `useUrlTabState` 时选中项不入 URL（以 tab 为准）**：同一页面两个写 URL 的
    hook 实例会双 effect 竞写 searchParams（react-router 的 setSearchParams 含函数式都基于
    渲染期快照），且 tab 切换即使选中失效，深链语义含糊。选中项退回本地 `useState`
  - **上下文相关的 id 必须带上下文成组入 URL**：选中项 id 只在某上下文内唯一或可解析时
    （站点下的栏目、公众号下的会话 openid），用 `useUrlSelectionParams(['site', 'channel'])`
    单实例原子管理两参数；**禁止**为每个参数各挂一个 hook 实例。上下文默认值（localStorage
    恢复的站点 / 账号）不入 URL，选中时一并盖章写入
  - **分页列表禁止拿「当前页成员资格」当存在性判据**：深链目标可能在其他页，不在页内时
    按 id 拉详情兜底，仅确认无效（非法 id / 404）才清参；数据在途（isFetching）时等待
  - 「桌面端自动选中首项」作为渲染期派生回退实现，**不写回 URL**
  写法见 [ui-patterns.md → 选中项同步到 URL](./ui-patterns.md#选中项同步到-urluseurlselectionstate)。
  **不适用**：wiki 文档中心 `spaceId`+`docId` 联合写回（跨页跳转契约成熟，保持手写实现，
  同样读取 `syncPageStateToUrl`）；「消费即焚」的一次性激活参数（聊天 `?conv=` 选中即触发
  已读等副作用、列表筛选深链走 `useListDeepLink`）；master 为筛选树的页面（部门 / 分类是
  查询条件而非选中项，入 URL 应使用领域筛选参数，单独评估）
- **Tabs 自动溢出折叠**：所有 `<Tabs>` 必须带 `collapsible="auto"`——宽度充足时渲染与不加时一致，
  仅在真放不下时折叠，因此**没有「这个页面标签少所以不用加」的例外**（溢出判定机理见
  [ui-patterns.md → 页面级多 Tab 布局](./ui-patterns.md#页面级多-tab-布局)）。
  **禁止**裸写 `collapsible`（等价 `true`，无论宽度是否够都常驻箭头）。
  **不适用**：`tabPosition="left"` / `"right"` 的纵向 Tabs——折叠实现是横向
  `OverflowList`，套到纵向布局上会坏掉
- **分栏的窄屏契约**：窄屏（**容器**宽度 < `responsiveBreakpoint`，默认 720）自动转单栏，
  必须提供返回入口——master 为列表传 `onBack`，master 为筛选树、detail 才是主体时传 `onMasterBack`；
  且**禁止**在单栏下自动选中首项（否则根视图落在详情），用 `onResponsiveChange` 区分
- **分栏位置切换**：桌面端默认允许调换 master 左右位置；master 使用 `MasterDetailLayout.Header` 或
  `NavListPanel` 时按钮自动出现，业务页面**禁止**重复渲染 `SideToggle`。窄屏自动隐藏；
  传 `persistKey` 时宽度与位置一并持久化；明确不允许调换的页面传 `sideSwitchable={false}`
- **StatCard 的导入路径**：页面无图表时从 `@/components/charts/StatCard` 直接导入——
  桶文件 `@/components/charts` 会连带引入约 2MB 的 vchart
- **栅格禁止内联写死列数**：**禁止** `style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}` 或 `'1fr 1fr'`——
  内联样式无法被媒体查询覆盖，窄屏会把内容压到竖排。按场景选：统计卡片 → `StatGrid`；
  图表分栏 → `.chart-grid`；其余固定列数栅格 / 表单多列 / 选择器 → `global.css` 的 `.auto-grid`
  （`--auto-grid-cols` 不可省，变量含义与写法见
  [ui-patterns.md → 通用自适应栅格](./ui-patterns.md#通用自适应栅格auto-gridglobalcss)）。
  确需保留的 `repeat(auto-*, minmax(Npx, 1fr))` 必须写成 `minmax(min(Npx, 100%), 1fr)`。
  **不适用**：固定像素列的标签 / 值布局、等分小方块缩略图、本身处于固定宽容器内的微指标
- **抽屉 / 弹窗宽度**：窄屏适配已由 `global.css` 全局兜底，**无需**再写
  `width={isMobile ? '100%' : 720}`（断点规则见
  [ui-patterns.md → 抽屉 / 弹窗宽度](./ui-patterns.md#抽屉--弹窗宽度)）
- **表面底色按层级取语义变量**：卡片 / 面板底色一律写 `var(--surface-card)`，
  **禁止**直接写 `var(--semi-color-bg-1)`——该变量在 Modal / SideSheet 内会自动提升一档，
  同一组件在页面与弹层中都能与所在表面拉开层次；写死 `bg-1` 则在弹层内与弹层同色、只剩边框。
  画布 / 底衬用 `var(--color-content-bg)`（跟随深色底色档位偏好）。
  **与容器同色时不要声明背景**——继承即可，复制一份色值会在容器改动时集体失配。
  仅这几类需要显式声明：布局四区（侧边栏 / 顶栏 / 头部 / 内容区）、
  必须遮挡下层的元素（portal 弹层、sticky 表头）、以及为覆盖组件自带底色而写的
  `transparent`（如 Semi Nav 的 `--semi-color-nav-bg`）。
  **不适用**：数据大屏固定皮肤、打印白底、二维码 / 签名板、视频 letterbox 等功能性色值
- **行内成组间距用 `Space`；禁止拿它改写已有的 flex 布局**：新写「图标 + 文字」
  「头像 + 姓名」「若干小按钮」这类行内成组时用 `<Space spacing={n}>`（表格操作列固定
  `spacing={4}`，见 [ui-patterns.md → 度量常量](./ui-patterns.md#度量常量)）。
  已有的 `style={{ display: 'flex', gap }}` **一律不动**——`Space` 只吸收 `display` /
  `gap` / `alignItems` / `flexDirection` / `flexWrap` 五个属性，换不掉的情况占绝大多数：

  | 情况 | 为什么不能换 |
  | --- | --- |
  | 样式里有 `justifyContent` | `Space` **没有** `justify` prop，`space-between` / 靠右都表达不了 |
  | 原本是块级 `display: 'flex'` | `Space` 是 `inline-flex`，会从撑满变收缩包裹；补 `style={{ display: 'flex' }}` 等于把省下的又写回去 |
  | 还留着 `padding` / `margin` / 背景 / 字号 | `style` 照样在，只少三个属性，收益不抵回归风险 |
  | 元素带 `aria-*` | `Space` 只透传 `data-*`（`getDataAttr`），`aria-label` 会被**静默丢掉** |
  | flex 样式挂在 `Typography.Text` 等组件上 | 换 `Space` 要么丢组件语义，要么多套一层，反而更长 |

  两处默认值差异必须显式处理：`Space` 默认 `align="center"`，而原生 flex 不写 `alignItems`
  时是 `stretch`——纵向布局下 `stretch`（子元素撑满宽度）与 `center` 观感完全不同，
  这种情况传 `align="start"`。`spacing` 预设只有 `tight` 8 / `medium` 16 / `loose` 24，
  其余直接写 `spacing={6}` 这类数字；`flexWrap: 'nowrap'` 无需映射（`Space` 默认即不换行）

---

## 打包与首屏性能

chunk 分层机理、度量脚本与预算数字见 [docs/frontend/bundle-performance.md](../../../../docs/frontend/bundle-performance.md)；
本节只列改动时必须遵守的规则。违规不会报错，只会表现为 `npm run check:bundle` 预算失败或首屏请求数 / 体积回退。

- **页面文件命名即注册，两张注册表分离**：`utils/page-registry.ts` 收 `src/pages/**/*Page.tsx`（后台菜单路由页，仅后台
  `App.tsx` 消费）；`utils/business-form-registry.ts` 收 `pages/biz/**`、`*BusinessForm.tsx`、`*ApprovalView.tsx`
  （工作流业务表单，供 `BusinessFormHost` 解析）。glob 命中的每个文件都是独立动态入口：页面私有的子组件 / Tab / 面板 / 弹窗
  **禁止**用 `Page.tsx` 后缀（会被拆成独立 chunk 并多一次请求）；能被菜单 `component` 或工作流 `customForm` 引用的组件**必须**符合对应命名
- **非后台入口禁止触达后台注册表**：会员端 / 审批端 / 任何新入口**禁止**直接或间接 import `utils/page-registry.ts` 与后台 `App.tsx`，
  业务表单只经 `business-form-registry` 取——否则整套后台页面会被复制进该入口的 `assetsDir`。
  新增入口在 `entries.json` 登记后须跑 `npm run analyze:bundle -w @zenith/web`，按实测给 `bundle-budget.json` 补预算
- **公共层禁止静态引入重库**：`src/hooks/`、`src/lib/`、`src/utils/`、`src/providers/`、`src/config/` 以及被 ≥ 10 个页面共享的
  `src/components/**` 模块进入公共 chunk（`app-shared` / `vendor-common`），任何一处静态 `import` 了
  `@visactor/*`、`@douyinfe/semi-illustrations`、`pinyin-pro`、`lottie-web`、`@wangeditor*`、`monaco-editor`、`@xyflow/*`、
  `@formily/*`、`html2canvas`、`jspdf`、`xlsx`、`three`、`echarts`、`@mastra/*`、`react-markdown`、`prismjs` 等重库，
  就会把整库拖进 `AdminLayout` 关键路径。重库只能在页面 / 功能组件内使用，或经 `lazy(() => import())` 边界隔离；
  图表主题这类「配置 + 重库」放在 `components/charts/`，不放 `lib/`
- **图标只走 `utils/icons.tsx` 的投递策略**：按名称渲染图标（菜单树、工作流模板、表单配置等任何来自数据的图标名）一律用
  `components/DynamicIcon.tsx` 的 `DynamicIcon` 或 `utils/icons.tsx` 的 `renderLucideIcon`，**禁止**在业务代码 `import * as icons from 'lucide-react'`
  或引入 `lucide-react/dynamicIconImports` 自建映射；静态已知的图标继续按名具名 `import { X } from 'lucide-react'`
- **插画一律懒加载**：`@douyinfe/semi-illustrations` 只能经 `components/EmptyIllustration.tsx` 的
  `emptyIllustration(name, size?)` 使用（返回 Semi `Empty` 的 `image` / `darkModeImage` 一对，内部 `lazy` + `Suspense` 且按名缓存）：
  `<Empty {...emptyIllustration('Idle', 120)} description="…" />`；**禁止**静态引入，也**禁止**在页面 / 组件里再写一份
  `lazy(() => import('@douyinfe/semi-illustrations')…)` + `Suspense` 样板
- **Demo Mock 只在 Demo 模式进入产物**：`src/mocks/` 只能经入口文件的 `if (import.meta.env.VITE_DEMO_MODE === 'true') await import('./mocks')`
  引入，任何业务模块**禁止**静态 `import` `mocks/**`
- **启动链路的新增网络请求必须并行**：认证后壳层所需的数据（当前用户菜单树、个人设置等）通过 `lib/shell-prefetch.ts`
  与 `/api/auth/me` 并行预取，**禁止**再往 `AdminRouteLoader` 首载 gate 里串行新增查询；
  只在错误 / 兜底路径使用的数据（如完整菜单树）由对应组件自行拉取
- **提交前必须通过**：`npm run check:bundle -w @zenith/web`（`bundle-budget.json`：每入口关键路径预算与
  `maxTotalJsChunks` / `maxTotalJsMB` 总量门禁）与 `npm run smoke -w @zenith/web`（demo 产物真实启动 `entries.json`
  全部入口 + 登录链路）。预算只能因明确的产品决策上调，上调时同步更新 `bundle-performance.md` 的记录表；不得为让 CI 通过而放宽

---

## 渲染性能（拖拽手势 / 大列表 / 查询聚合）

违规不会报错，只表现为拖拽卡顿、图表闪烁、无关组件成批重渲染。

- **拖拽手势期间禁止提交业务状态**：列宽 / 位置 / 尺寸等连续手势只更新组件本地的临时状态（或仅改 DOM），
  `mouseup` / `pointerup` 时**一次**提交（一步撤销、一次 `onChange`）；同一整数结果不重复 `setState`；
  `window` 上的 `blur` 也要结束手势。**禁止**在 `mousemove` 里调用 `onChange` / 写历史栈 / 触发校验
  （`FormCanvas.startColResize` 为参考实现）。`ResizeObserver` 回调已按帧合并，只需
  `setSize(prev => 尺寸相同 ? prev : next)` 让相同尺寸直接跳过，不需要再包 rAF
- **被父级高频重渲染的重型子项必须 `memo`，且 props 只能是值与稳定引用**：图表 / 编辑器 / 卡片列表项用 `memo` 包裹，
  props 传 `data` / `loading` / `error` / 切片值而不是 `getXxx(item)` getter 或 `state` 整对象；
  父级内联回调用 `useEventCallback`（`hooks/useEventCallback.ts`）换成稳定引用，是否存在回调仍按原 prop 判定；
  子项内部依赖 item 的回调用 `useCallback` / `useMemo` 派生（`report/widgets/ScreenCanvas.tsx` 的 `WidgetFrame`）。
  `useMemo` 的依赖里**禁止**放只在无数据时才影响输出的标志（如 `loading`），先派生成 `showLoading = loading && !data`
- **`useQueries` 的 `combine`**：`useCallback` 记忆化 + 返回普通对象 / 数组，见 [data-fetching.md](../../../../docs/frontend/data-fetching.md#域-hooks-约定)；
  **禁止**内联函数或返回 `Map` / `Set`
- **只在事件里用到的派生值不进渲染期**：`JSON.stringify(整份 schema)` 这类昂贵序列化按需在事件处理器里计算，
  **禁止** `useMemo([fields])` 在每次编辑时重算一份没人读取的结果

---
