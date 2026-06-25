# 核心规范约束

按 CRUD 开发阶段分组，实现过程中随时对照。带 Step 标注的约束表示该阶段必须检查。

---

## Schema 层（Step 1）

- **审计列必加**（Step 1, Step 10）：所有业务主表必须展开 `...auditColumns()`；例外：纯关联表（`xxx_yyys`）、追加型日志（`*_logs`）、临时凭证（`*_tokens`）、IM 消息等"作者天然就是当前用户"的实体
- **审计字段统一拦截**（Step 1, Step 5, Step 10）：`created_by` / `updated_by` 由 `packages/server/src/db/index.ts` 的 Proxy 自动写入，**禁止**在 service、route、seed 中手动赋值；需指定操作人时用 `runAsUser(userId, fn)` 包裹；DTO 中使用 `...auditFields`（来自 `lib/dtos/_audit.ts`）
- **枚举三端同步**（Step 1）：`pgEnum` / TS union type / Zod enum 保持完全一致
- **updatedAt 自动维护**（Step 1）：schema 中所有表的 `updatedAt` 已配置 `.$onUpdate(() => new Date())`，**禁止**在 `db.update().set({})` 中手动传入 `updatedAt: new Date()`
- **数据权限字段**（Step 1）：`department_id` 字段只添加到需要按部门隔离查看的业务数据表（如员工、订单、客户等）；配置类表、日志表、公共数据表均不需要
- **多租户字段**（Step 1）：业务数据表添加 `tenantId` 字段，查询用 `tenantCondition(table, user)`，创建用 `getCreateTenantId(user)`

---

## Shared 层（Step 3-4）

- **Zod Schema 位置**（Step 3）：创建/更新 schema 定义在 `packages/shared/src/validation.ts`，前后端共用，**禁止**在 server/web 中重复定义
- **update = create.partial()**（Step 3）：`updateXxxSchema = createXxxSchema.partial()` 是标准模式；若有不可更改字段，用 `.omit({ field: true })`

---

## Service 层（Step 5）

- **Service 层职责**（Step 5）：业务逻辑、数据映射（`mapXxx`）、前置校验（`ensureXxx`）放在 `packages/server/src/services/xxx.service.ts`；route handler 只负责取参数、调 service、返回响应
- **Service 禁止事项**（Step 5）：**禁止**在 service 中调用 `c.json()`、直接引用 Hono 上下文 `c`、使用 `console.*`
- **HTTPException 抛出**（Step 5）：Service 层业务校验失败统一 `throw new HTTPException(statusCode, { message })`（来自 `hono/http-exception`），由全局 `onError` 统一处理
- **DB 唯一约束**（Step 5）：PG 错误码 `23505` 统一在 service 的写入 `try-catch` 中通过 `rethrowPgUniqueViolation(err, msg)` 映射为 `HTTPException(400)`
- **事务**（Step 5）：多步写操作（replace 模式 delete+insert、写主表+关联表）必须用 `db.transaction()`；辅助写函数接受 `executor: DbTransaction | typeof db` 参数；副作用（WebSocket、邮件）不放入事务
- **计数查询**（Step 5）：单表计数统一使用 `db.$count(table, where)`，禁止 `db.select({ total: count() }).from(table).where(where)`
- **并行查询**（Step 5）：分页列表中 count 和 list 是独立操作，**必须**用 `const [total, rows] = await Promise.all([db.$count(...), db.select()...])` 并行执行，禁止串行 `await`
- **RQB 优先**（Step 5）：关联数据查询优先使用 Drizzle RQB（`db.query.tableName.findMany/findFirst({ with: { relation: true } })`）

---

## Route 层（Step 6-7）

- **薄路由约定**（Step 6）：**禁止在路由 handler 中直接调用 `db.*`**。所有 DB 访问与业务逻辑必须放在 `services/xxx.service.ts`
- **DTO 中心化**（Step 6）：实体 DTO 必须定义在 `packages/server/src/lib/dtos/` 对应子文件，通过 `packages/server/src/lib/openapi-dtos.ts` 统一导出；**严禁**在路由文件内本地声明带 `.openapi('EntityName')` 的实体 DTO
- **响应辅助函数**（Step 6）：路由 `responses:` 中的 200 响应统一使用展开语法：`...ok(DTO, desc)`（单对象）、`...okPaginated(DTO, desc)`（分页列表）、`...okMsg(desc)`（仅 message 无 data）；**禁止**直接写 `200: { content: jsonContent(apiResponse(DTO)), description }`
- **响应码规范**（Step 6）：响应体统一使用 `okBody(data, msg?)` / `errBody(msg, code?)` 构造（来自 `'../lib/openapi-schemas'`），**禁止内联写** `{ code: 0 as const, message, data }` / `{ code: 400, message, data: null }` 字面量对象；每个 `c.json(...)` 第二参数必须显式带状态码 `, 200)` / `, 404)` 等
- **commonErrorResponses**（Step 6）：所有路由的 `responses:` 块必须包含 `...commonErrorResponses`（涵盖 400/401/403/404/500），从 `'../lib/openapi-schemas'` 导入
- **Path Param 规范**（Step 6）：数值型 `id` 参数统一使用 `IdParam`（`import { IdParam } from '../lib/openapi-schemas'`）；字符串型或自定义名参数必须在字段上添加 `.openapi({ param: { name: '...', in: 'path' }, example: '...' })`
- **分页查询规范**（Step 6）：列表接口的查询参数统一用 `PaginationQuery.extend({ ... })` 扩展额外字段，**禁止**内联声明 `page: z.coerce.number().optional()`
- **批量操作路由顺序**（Step 6）：`DELETE /batch` 必须注册在 `DELETE /{id}` 之前，防止路由冲突
- **LIKE 查询转义**（Step 5, Step 6）：所有使用 `like()` / `ilike()` 的模糊查询，**必须**通过 `escapeLike(keyword)` 转义用户输入中的 `%`、`_`、`\\`，防止 LIKE 通配符注入；`escapeLike` 来自 `'../lib/where-helpers'`
- **外呼 HTTP 调用**（Step 5, Step 6）：服务端任何对外 HTTP 请求**必须**通过 `packages/server/src/lib/http-client.ts` 的 `httpRequest` / `httpGet` / `httpPost` 等；**禁止**直接使用全局 `fetch()`

---

## 前端层（Step 8）

- **操作列固定**（Step 8）：所有表格操作列必须 `fixed: 'right'`
- **状态列固定**（Step 8）：状态列必须紧靠操作列左侧，并同样设置 `fixed: 'right'`
- **搜索栏布局**（Step 8）：使用 `SearchToolbar` 组件（`packages/web/src/components/SearchToolbar.tsx`）。简单页面可继续使用 children 写法；筛选/操作较多时必须使用结构化模式（`primary` / `filters` / `actions`，必要时用 `mobilePrimary` / `mobileFilters` / `mobileActions` 覆盖移动端）。移动端默认只露出关键词搜索、查询、新增等高频入口，其他筛选放入底部筛选抽屉，导出/导入/批量等低频操作放入更多菜单。参考 `packages/web/src/pages/system/positions/PositionsPage.tsx`
- **表格样式**（Step 8）：统一 `<ConfigurableTable bordered ... />`
- **表格列公共工具**（Step 8）：`createdAtColumn`（创建时间预置列）和 `renderEllipsis`（省略列 render）从 `'../../utils/table-columns'` 导入；**禁止**内联写 `<Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>`
- **操作按钮样式**（Step 8）：`theme="borderless" size="small"`，删除加 `type="danger"`
- **无图标文字按钮**（Step 8）：操作列按钮只用纯文字，不加图标
- **弹窗表单布局**（Step 8）：`Form` 必须加 `labelPosition="left"`；`labelWidth` 按标签字数选取（≤3字→ 72，4-5字→ 90，≥6字→ 110+）；有 3 对以上可并排的普通字段时用双列布局（`Row gutter={16}` + `Col span={12}`，`Modal width={660}`），否则单列（`width` 480-520 酌情）；TreeSelect / TextArea 等宽字段不包 `Col` 直接全宽占一行；所有 `Modal` 必须加 `closeOnEsc`
- **树形表格展开控制**（Step 8）：使用 `children` 字段渲染树形表格时，必须在搜索栏添加「全部展开/全部折叠」按钮，使用受控 `expandedRowKeys` + `onExpandedRowsChange`；图标：已展开用 `ChevronsDownUp`，未展开用 `ChevronsUpDown`
- **批量按钮显示时机**（Step 8）：批量操作按钮仅在 `selectedRowKeys.length > 0` 时显示，放在查询/重置按钮之后
- **ConfigurableTable 刷新按钮**（Step 8）：所有使用 `ConfigurableTable` 的列表页均必须传入 `onRefresh` 和 `refreshLoading`
- **左右分栏布局**（Step 8）：需要「左侧列表 + 右侧详情」结构时，统一使用 `packages/web/src/components/MasterDetailLayout.tsx`，**禁止**手写 flex 两栏布局。master 内部必须用 `display:flex; flexDirection:column; height:100%; overflow:hidden` 的 div 包裹（**禁止**用 Fragment），顶部固定区域 `flexShrink:0`，列表区域 `flex:1; overflow:auto; minHeight:0`。嵌套在 Semi Design Tabs 中时，必须加 `className="tabs-fill-height"` 并给 Tabs/TabPane 设置正确的 height/flex 属性
- **左侧平铺列表（NavListPanel）**（Step 8）：当左侧 master 是**平铺列表**（分类/文件/分组等，非树形）时，统一使用 `NavListPanel<T>` + `NavListItem`（来自 `packages/web/src/components/NavListPanel.tsx`）。底层由 Semi `List`/`List.Item` 实现，已对齐 Semi"带筛选器"最佳实践。
  - `NavListPanel<T>` 核心 props：`title`、`headerExtra`、`search`（搜索框配置）、`loading`、`emptyText`、`footer`（分页等）
  - **推荐用法（dataSource 模式）**：`<NavListPanel dataSource={items} renderItem={(item) => <NavListItem key={item.id} .../>} />`，空数组时自动显示 `emptyText`。
  - **兼容用法（children 模式）**：`<NavListPanel>{items.map(fn)}</NavListPanel>`，需注意空数组不触发 emptyContent（需 `childCount > 0` 判断）；rawBody 场景（Collapse 分组）必须用此路径。
  - 分组/Collapse 场景（如 DbAdmin）：传 `rawBody bodyNoPadding`，在 `children` 内自行渲染 Collapse + 内嵌 `<List split={false} className="nav-list-panel__list">`。
  - `NavListItem` props：`active`、`onClick`、`icon`（左侧图标或彩色圆点）、`primary`（主标题）、`secondary`（副标题）、`meta`（底部元信息）、`extra`（hover 显示的操作区；`extraAlwaysVisible` 让 extra 始终可见）
  - 当 extra 含多个操作时，用 `Dropdown`（`trigger="click"` + `clickToHide`）+ `MoreHorizontal` 按钮包裹，参考字典管理/日志文件页面
  - meta 区域**禁止**使用 `<Tag color="...">` 内联标签（会渲染颜色指示器色块），改用 styled span（见日志文件页实现）
  - 树形数据（需要展开/折叠节点）使用 `Semi Tree` 组件，不适合 `NavListPanel`（例：用户管理部门树）

---

## 时间格式（全局）

- **统一格式**：API 响应、入参、前端显示、MSW Mock 统一使用 `YYYY-MM-DD HH:mm:ss`
- **前端**：用 `formatDateTime()` / `formatDateTimeForApi()`（来自 `@/utils/date`）
- **后端**：用 `packages/server/src/lib/datetime.ts` 的 `formatDateTime()` / `formatNullableDateTime()` / `parseDateTimeInput()` 等
- **Mock**：用 `mockDateTime()`（来自 `packages/web/src/mocks/utils/date.ts`）
- **禁止**：`toISOString()` / 原生 `toLocaleString()` / `toLocaleDateString()` 等

---

## 图标库（全局）

- 统一使用 `lucide-react`，禁止 `@douyinfe/semi-icons`

---

## 分页格式（全局）

- 列表接口返回 `{ list, total, page, pageSize }`
- SQL-builder 分页统一使用 `withPagination(query.$dynamic(), page, pageSize)`
- RQB 分页统一使用 `offset: pageOffset(page, pageSize)`
- 禁止手写 `(page - 1) * pageSize`
