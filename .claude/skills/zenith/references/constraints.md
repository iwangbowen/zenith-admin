# 核心规范约束

每步实现时必须遵守，这些约束在 AGENTS.md 中有完整说明。

| 约束 | 规则 |
| --- | --- |
| **Service 层职责** | 业务逻辑、数据映射（`mapXxx`）、前置校验（`ensureXxx`）放在 `packages/server/src/services/xxx.service.ts`；route handler 只负责取参数、调 service、返回响应；**禁止**在 service 中调用 `c.json()`、访问 Hono 上下文 `c`、使用 `console.*` |
| **HTTPException 抛出** | Service 层业务校验失败统一 `throw new HTTPException(statusCode, { message })`（来自 `hono/http-exception`），由全局 `onError` 统一处理；DB 唯一约束（PG 23505）统一在 service 中通过 `rethrowPgUniqueViolation(err, msg)` 映射 |
| **commonErrorResponses** | 所有路由的 `responses:` 块必须包含 `...commonErrorResponses`（涵盖 400/401/403/404/500），从 `'../lib/openapi-schemas'` 导入 |
| **枚举三端同步** | `pgEnum` / TS union type / Zod enum 保持完全一致 |
| **操作列固定** | 所有表格操作列必须 `fixed: 'right'` |
| **状态列固定** | "状态"列必须紧靠"操作"列左侧，并同样设置 `fixed: 'right'` |
| **树形表格展开控制** | 使用 `children` 字段渲染树形表格时，必须在搜索栏添加「全部展开/全部折叠」按钮，使用受控 `expandedRowKeys` + `onExpandedRowsChange`；图标：已展开用 `ChevronsDownUp`，未展开用 `ChevronsUpDown` |
| **时间格式** | API 响应、入参、前端显示、MSW Mock 统一使用 `YYYY-MM-DD HH:mm:ss`；前端用 `formatDateTime()` / `formatDateTimeForApi()`，后端用 `packages/server/src/lib/datetime.ts`，Mock 用 `mockDateTime()`；禁止 `toISOString()` / 原生 `toLocaleString()` 等 |
| **图标库** | 统一使用 `lucide-react`，禁止 `@douyinfe/semi-icons` |
| **操作按钮样式** | `theme="borderless" size="small"`，删除加 `type="danger"` |
| **无图标文字按钮** | 操作列按钮只用纯文字，不加图标 |
| **搜索栏布局** | 使用 `SearchToolbar` 组件（`packages/web/src/components/SearchToolbar.tsx`），参考 `packages/web/src/pages/users/UsersPage.tsx` |
| **表格样式** | 统一 `<Table bordered>` |
| **响应码规范** | 响应体统一使用 `okBody(data, msg?)` / `errBody(msg, code?)` 构造（来自 `'../lib/openapi-schemas'`），**禁止内联写** `{ code: 0 as const, message, data }` / `{ code: 400, message, data: null }` 字面量对象；每个 `c.json(...)` 第二参数必须显式带状态码 `, 200)` / `, 404)` 等 |
| **分页格式** | 列表接口返回 `{ list, total, page, pageSize }` |
| **数据权限** | 业务数据模块在 Step 0 必须询问是否需要 dataScope 过滤；配置数据（角色/菜单/字典）无需过滤 |
| **多租户隔离** | 业务数据表添加 `tenantId` 字段，查询用 `tenantCondition(table, user)`，创建用 `getCreateTenantId(user)`；关闭多租户时两者均返回 `null`/`undefined`，无需额外判断 |
| **批量操作路由顺序** | `DELETE /batch` 必须注册在 `DELETE /{id}` 之前，防止路由冲突 |
| **批量按钮显示时机** | 批量操作按钮仅在 `selectedRowKeys.length > 0` 时显示，放在查询/重置按钮之后 |
| **updatedAt 自动维护** | schema 中所有表的 `updatedAt` 已配置 `.$onUpdate(() => new Date())`，**禁止**在 `db.update().set({})` 中手动传入 `updatedAt: new Date()` |
| **审计字段统一拦截** | 业务主表必须在 schema 展开 `...auditColumns()`；DTO 中使用 `...auditFields`（来自 `lib/dtos/_audit.ts`）。`created_by` / `updated_by` 由 `packages/server/src/db/index.ts` 的 Proxy 在 `insert` / `update` / `insert().onConflictDoUpdate({set})` 时根据 `audit-context` 自动写入，**禁止**在 service、route、seed 中手动赋值；需指定操作人时用 `runAsUser(userId, fn)` 包裹。关联表 / `*_logs` / `*_tokens` / IM 消息等**不要**加审计列 |
| **计数查询** | 单表计数统一使用 `db.$count(table, where)`，禁止 `db.select({ total: count() }).from(table).where(where)` |
| **并行查询** | 分页列表中 count 和 list 是独立操作，**必须**用 `const [total, rows] = await Promise.all([db.$count(...), db.select()...])` 并行执行，禁止串行 `await` |
| **事务** | 多步写操作（replace 模式 delete+insert、写主表+关联表）必须用 `db.transaction()`；辅助写函数接受 `executor: DbTransaction \| typeof db` 参数；副作用（WebSocket、邮件）不放入事务 |
| **DTO 中心化** | 实体 DTO 必须定义在 `packages/server/src/lib/dtos/` 对应子文件，通过 `packages/server/src/lib/openapi-dtos.ts` 统一导出；**严禁**在路由文件内本地声明带 `.openapi('EntityName')` 的实体 DTO |
| **响应辅助函数** | 路由 `responses:` 中的 200 响应统一使用展开语法：`...ok(DTO, desc)`（单对象）、`...okPaginated(DTO, desc)`（分页列表）、`...okMsg(desc)`（仅 message 无 data）；**禁止**直接写 `200: { content: jsonContent(apiResponse(DTO)), description }` |
| **Path Param 规范** | 数值型 `id` 参数统一使用 `IdParam`（`import { IdParam } from '../lib/openapi-schemas'`）；字符串型或自定义名参数（如 `tokenId`、`provider`、`key`）必须在字段上添加 `.openapi({ param: { name: '...', in: 'path' }, example: '...' })` |
| **分页查询规范** | 列表接口的查询参数统一用 `PaginationQuery.extend({ ... })` 扩展额外字段，**禁止**内联声明 `page: z.coerce.number().optional()` |
| **LIKE 查询转义** | 所有使用 `like()` / `ilike()` 的模糊查询，**必须**通过 `escapeLike(keyword)` 转义用户输入中的 `%`、`_`、`\`，防止 LIKE 通配符注入；`escapeLike` 来自 `'../lib/where-helpers'` |
