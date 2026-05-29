# 核心规范约束

每步实现时必须遵守，这些约束在 AGENTS.md 中有完整说明。

- **Service 层职责**：业务逻辑、数据映射（`mapXxx`）、前置校验（`ensureXxx`）放在 `packages/server/src/services/xxx.service.ts`；route handler 只负责取参数、调 service、返回响应；**禁止**在 service 中调用 `c.json()`、访问 Hono 上下文 `c`、使用 `console.*`

- **HTTPException 抛出**：Service 层业务校验失败统一 `throw new HTTPException(statusCode, { message })`（来自 `hono/http-exception`），由全局 `onError` 统一处理；DB 唯一约束（PG 23505）统一在 service 中通过 `rethrowPgUniqueViolation(err, msg)` 映射

- **commonErrorResponses**：所有路由的 `responses:` 块必须包含 `...commonErrorResponses`（涵盖 400/401/403/404/500），从 `'../lib/openapi-schemas'` 导入

- **枚举三端同步**：`pgEnum` / TS union type / Zod enum 保持完全一致

- **操作列固定**：所有表格操作列必须 `fixed: 'right'`

- **状态列固定**：状态列必须紧靠操作列左侧，并同样设置 `fixed: 'right'`

- **弹窗表单布局**：`Form` 必须加 `labelPosition="left"`；`labelWidth` 按标签字数选取（≤3字→ 72，4-5字→ 90，♥6字→ 110+）；有 3 对以上可并排的普通字段（Input / Select / InputNumber）时用双列布局（`Row gutter={16}` + `Col span={12}`， `Modal width={660}`），否则单列（`width` 480-520 酷情）； TreeSelect / TextArea 等宽字段不包 `Col` 直接全宽占一行；所有 `Modal` 必须加 `bodyStyle={{ paddingBottom: 24 }}` 和 `closeOnEsc`

- **树形表格展开控制**：使用 `children` 字段渲染树形表格时，必须在搜索栏添加「全部展开/全部折叠」按钮，使用受控 `expandedRowKeys` + `onExpandedRowsChange`；图标：已展开用 `ChevronsDownUp`，未展开用 `ChevronsUpDown`

- **时间格式**：API 响应、入参、前端显示、MSW Mock 统一使用 `YYYY-MM-DD HH:mm:ss`；前端用 `formatDateTime()` / `formatDateTimeForApi()`，后端用 `packages/server/src/lib/datetime.ts`，Mock 用 `mockDateTime()`；禁止 `toISOString()` / 原生 `toLocaleString()` 等

- **图标库**：统一使用 `lucide-react`，禁止 `@douyinfe/semi-icons`

- **操作按钮样式**：`theme="borderless" size="small"`，删除加 `type="danger"`

- **无图标文字按钮**：操作列按钮只用纯文字，不加图标

- **搜索栏布局**：使用 `SearchToolbar` 组件（`packages/web/src/components/SearchToolbar.tsx`），参考 `packages/web/src/pages/users/UsersPage.tsx`

- **表格样式**：统一 `<Table bordered>`

- **响应码规范**：响应体统一使用 `okBody(data, msg?)` / `errBody(msg, code?)` 构造（来自 `'../lib/openapi-schemas'`），**禁止内联写** `{ code: 0 as const, message, data }` / `{ code: 400, message, data: null }` 字面量对象；每个 `c.json(...)` 第二参数必须显式带状态码 `, 200)` / `, 404)` 等

- **分页格式**：列表接口返回 `{ list, total, page, pageSize }`

- **数据权限**：业务数据模块在 Step 0 必须询问是否需要 dataScope 过滤；配置数据（角色/菜单/字典）无需过滤。**`department_id` 字段只添加到需要按部门隔离查看的业务数据表**（如员工、订单、客户等）；配置类表（菜单/角色/字典/系统配置）、日志表、公共数据表（公告/地区）均不需要。当前系统中 `users` 和 `user_groups` 已有该字段，无需补加

- **多租户隔离**：业务数据表添加 `tenantId` 字段，查询用 `tenantCondition(table, user)`，创建用 `getCreateTenantId(user)`；关闭多租户时两者均返回 `null`/`undefined`，无需额外判断

- **批量操作路由顺序**：`DELETE /batch` 必须注册在 `DELETE /{id}` 之前，防止路由冲突

- **批量按钮显示时机**：批量操作按钮仅在 `selectedRowKeys.length > 0` 时显示，放在查询/重置按钮之后

- **updatedAt 自动维护**：schema 中所有表的 `updatedAt` 已配置 `.$onUpdate(() => new Date())`，**禁止**在 `db.update().set({})` 中手动传入 `updatedAt: new Date()`

- **审计字段统一拦截**：业务主表必须在 schema 展开 `...auditColumns()`；DTO 中使用 `...auditFields`（来自 `lib/dtos/_audit.ts`）。`created_by` / `updated_by` 由 `packages/server/src/db/index.ts` 的 Proxy 在 `insert` / `update` / `insert().onConflictDoUpdate({set})` 时根据 `audit-context` 自动写入，**禁止**在 service、route、seed 中手动赋值；需指定操作人时用 `runAsUser(userId, fn)` 包裹。关联表 / `*_logs` / `*_tokens` / IM 消息等**不要**加审计列

- **计数查询**：单表计数统一使用 `db.$count(table, where)`，禁止 `db.select({ total: count() }).from(table).where(where)`

- **并行查询**：分页列表中 count 和 list 是独立操作，**必须**用 `const [total, rows] = await Promise.all([db.$count(...), db.select()...])` 并行执行，禁止串行 `await`

- **事务**：多步写操作（replace 模式 delete+insert、写主表+关联表）必须用 `db.transaction()`；辅助写函数接受 `executor: DbTransaction | typeof db` 参数；副作用（WebSocket、邮件）不放入事务

- **DTO 中心化**：实体 DTO 必须定义在 `packages/server/src/lib/dtos/` 对应子文件，通过 `packages/server/src/lib/openapi-dtos.ts` 统一导出；**严禁**在路由文件内本地声明带 `.openapi('EntityName')` 的实体 DTO

- **响应辅助函数**：路由 `responses:` 中的 200 响应统一使用展开语法：`...ok(DTO, desc)`（单对象）、`...okPaginated(DTO, desc)`（分页列表）、`...okMsg(desc)`（仅 message 无 data）；**禁止**直接写 `200: { content: jsonContent(apiResponse(DTO)), description }`

- **Path Param 规范**：数值型 `id` 参数统一使用 `IdParam`（`import { IdParam } from '../lib/openapi-schemas'`）；字符串型或自定义名参数（如 `tokenId`、`provider`、`key`）必须在字段上添加 `.openapi({ param: { name: '...', in: 'path' }, example: '...' })`

- **分页查询规范**：列表接口的查询参数统一用 `PaginationQuery.extend({ ... })` 扩展额外字段，**禁止**内联声明 `page: z.coerce.number().optional()`

- **LIKE 查询转义**：所有使用 `like()` / `ilike()` 的模糊查询，**必须**通过 `escapeLike(keyword)` 转义用户输入中的 `%`、`_`、`\\`，防止 LIKE 通配符注入；`escapeLike` 来自 `'../lib/where-helpers'`

- **外呼 HTTP 调用**：服务端任何对外 HTTP 请求（OAuth、第三方 API、链接抓取等）**必须**通过 `packages/server/src/lib/http-client.ts` 的 `httpRequest` / `httpGet` / `httpPost` / `httpPut` / `httpPatch` / `httpDelete` 发出；**禁止**直接使用全局 `fetch()`。失败统一抛 `HttpClientError`；需要超时/重试/代理时通过参数 `{ timeout, retries, proxy }` 在代码中显式声明，代理**不从环境变量读取**；详见 [docs/backend/http-client.md](../../../docs/backend/http-client.md)

- **左右分栏布局**：需要「左侧列表 + 右侧详情」结构时，统一使用 `packages/web/src/components/MasterDetailLayout.tsx`，**禁止**手写 flex 两栏布局。master 内部必须用 `display:flex; flexDirection:column; height:100%; overflow:hidden` 的 div 包裹（**禁止**用 Fragment），顶部固定区域 `flexShrink:0`，列表区域 `flex:1; overflow:auto; minHeight:0`。嵌套在 Semi Design Tabs 中时，必须加 `className="tabs-fill-height"`（`global.css` 已定义）并给 Tabs/TabPane 设置正确的 height/flex 属性，否则高度链断裂导致列表无法滚动。详见 [crud-frontend.md 左右分栏布局](./crud-frontend.md#左右分栏布局masterdetaillayout)
