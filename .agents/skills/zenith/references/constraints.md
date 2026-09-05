# 核心规范约束（后端与全局）

**所有代码改动的硬约束单一来源**，前端部分在 [constraints-frontend.md](./constraints-frontend.md)。
每条都是一句话可机械核对的「必须 / 禁止」，括号内是漏写的代价或适用 Step。
代码模板与展开说明在各主题文件，本文件只给指针，不放示例。

**按改动涉及的层读取对应章节即可，无需通读：**

| 改动涉及 | 章节 |
| --- | --- |
| 建表、加字段、枚举、审计列 | [Schema 层](#schema-层step-1) |
| 契约、实体 schema、Zod 校验、常量、新增业务域 | [Shared 层](#shared-层step-3-4) |
| 业务逻辑、查询条件、事务、时间解析 | [Service 层](#service-层step-5) |
| 路由、中间件、响应构造、审计快照 | [Route 层](#route-层step-6-7) |
| 菜单条目、权限码、种子数据 | [菜单与权限配置](#菜单与权限配置step-9-10) |
| MSW mock handler | [MSW Mock 层](#msw-mock-层step-11) |
| 时间格式、图标、分页、依赖引入、异步任务 | [全局约束](#全局约束) |
| 页面、域 hooks、组件、布局 | → [constraints-frontend.md](./constraints-frontend.md) |

---

## Schema 层（Step 1）

- **主键统一 identity**：自增主键一律 `integer().primaryKey().generatedAlwaysAsIdentity()`
  （大表用 `bigint({ mode: 'number' })` 同理），**禁止** `serial` / `bigserial`；
  需要显式插入 id 的场景（仅限 seed）必须链式加 `.overridingSystemValue()`。
  唯一例外是分区时序明细表 `iot_telemetry`（无主键，分区 DDL 由迁移手写），
  **禁止**给它加回 `id` 或改动分区键列，见 [docs/backend/database.md](../../../../docs/backend/database.md)「分区表」
- **列名自动派生**：drizzle 已配置 `casing: 'snake_case'`，**禁止**写与派生结果一致的显式列名
  （`varchar('user_name')` 一律写成 `varchar()`）；仅当派生名与目标列名不一致时才显式指定。
  做列名反射（结构断言、漂移对比）必须用 `dbColumnName()`（`db/types.ts`），
  **禁止**直接读 `column.name`——未命名列的该属性是驼峰 key 而非真实列名
- **unique 约束命名**：驼峰多词列（`orderNo` 等）的唯一约束**必须**显式蛇形命名——
  列级 `.unique('xxxs_order_no_unique')`、表级 `unique('xxxs_tenant_code_unique').on(...)`，
  否则会从驼峰 key 派生出混合大小写约束名；单词列（`code` / `name` / `token`）的裸 `.unique()`
  派生结果即蛇形，可省略
- **审计列必加**：业务主表必须展开 `...auditColumns()`。例外（不要加）：纯关联表（`xxx_yyys`）、
  追加型日志（`*_logs`）、临时凭证（`*_tokens`）、IM 消息等「作者天然就是当前用户」的实体
- **审计字段禁止手写**：`created_by` / `updated_by` 由 `db/index.ts` 的 Proxy 自动写入，
  **禁止**在 service / route / seed 中手动赋值；需指定操作人时用 `runAsUser(userId, fn)` 包裹；
  契约实体 schema 用 `...auditFieldsSchema`（`@zenith/shared/core`）
- **枚举三端同步**：`pgEnum` / TS union type / Zod enum 完全一致
- **updatedAt 自动维护**：schema 已配 `.$onUpdate(() => new Date())`，
  **禁止**在 `db.update().set({})` 中手动传 `updatedAt: new Date()`
- **relations 集中**：`xxxRelations` 一律写在 `db/schema/relations.ts`；缺失时 `db.query.xxx` 无法识别关联
- **数据权限字段**：`department_id` 只加到需按部门隔离查看的业务数据表；配置表、日志表、公共数据表不加
- **多租户字段**：业务数据表加 `tenantId`，查询用 `tenantCondition(table, user)`，创建用 `getCreateTenantId(user)`

## Shared 层（Step 3-4）

- **域子路径导入**：**禁止**从 `@zenith/shared` 根入口导入（ESLint 报错）。一律用
  `@zenith/shared/{业务域}`（`core` / `identity` / `platform` / `messaging` / `workflow` / `payment` /
  `member` / `report` / `analytics` / `ai` / `chat` / `mp` / `cms` / `open-platform` / `rules` / `ops` /
  `tasks` / `biz` / `settings`），种子数据用 `@zenith/shared/seed`
- **Zod Schema 位置**：创建 / 更新 schema 定义在 `shared/src/{业务域}/validation.ts`，前后端共用，
  **禁止**在 server / web 中重复定义
- **枚举 SSOT 在 constants**：`XXX_TYPES` 常量数组 + 派生 union type + `XXX_LABELS` / `XXX_OPTIONS`
  一并写在 `shared/src/{业务域}/constants.ts`，`validation.ts` 通过 `z.enum(XXX_TYPES)` 引用。
  **禁止**把会被其他域 `z.enum()` 引用的常量数组放在 `validation.ts`——validation 互引形成 ESM 值环，
  `z.enum()` 在初始化期取到 `undefined` 直接崩溃
- **API 契约是唯一真相**：实体形状与全部操作定义在 `shared/src/{业务域}/contracts/xxxs.ts`——
  `xxxSchema = z.object({...}).meta({ id: 'Xxx' })` + `type Xxx = z.infer<typeof xxxSchema>` +
  `xxxContract = defineContract('/api/xxxs', { list: op.get(...), ... })`（`@zenith/shared/core`）。
  **禁止**手写 `interface Xxx`、**禁止**在 server 定义实体 DTO、**禁止**在 web / mock 书写 `/api/...` 路径字面量
- **契约操作命名**：标准 CRUD 固定为 `list` / `detail` / `create` / `update` / `remove`，可选 `all`（下拉源）/
  `removeBatch`（`DELETE /batch`）——web 的 `createResourceQueries` 按此约定派生 hooks；其余操作按业务动词命名
- **契约积木**：路径 `{id}` 用 `idParam`；列表查询 `paginationQuery.extend({...})`；分页响应 `paginated(xxxSchema)`；
  时间范围端点 `dateRangeBound()`；查询串布尔 `queryBool()`、查询串枚举筛选 `queryEnum(XXX_VALUES)`（空串 = 未筛选）；
  批量 ID `batchIdsBody`；审计列 `...auditFieldsSchema`；业务请求头 `headers: z.object({...})`；
  上传 `multipart(z.object({ file: fileField() }))`；非 JSON 响应 `kind: 'excel' | 'csv' | 'file' | 'sse'`
- **OpenAPI 元数据用 `.meta()`**：组件名 `.meta({ id })`、说明 `.meta({ description, example })`；shared **禁止**依赖
  `@hono/zod-openapi`、**禁止**调用 `.openapi()`
- **新增业务域**：建 `shared/src/{新域}/{contracts/,validation,constants,index}.ts`（`contracts/index.ts` 汇总各资源契约，
  域 `index.ts` 导出 `constants` / `contracts` / `types` / `validation`），并在 `shared/package.json` 的 `exports` 登记
  `"./{新域}"`；域 `index.ts` **不得**导出 seed。`types.ts` 只放无法由 schema 推导的类型（UI 视图模型、联合类型别名）
- **update = partialForUpdate(create)**：部分更新 schema 一律用 `partialForUpdate()`（`shared/core/validation`）
  由 create schema 派生，不可更改字段用 `partialForUpdate(create.omit({ field: true }))`；
  **禁止**直接调用 `.partial()`（ESLint 封禁）——Zod 的 `.partial()` 保留 `.default()`，字段省略时会填入默认值
  并被服务层 `.set({ ...data })` 写库，覆盖从未提交的字段。契约层由 `app.contract.test.ts` 兜底：
  PUT / PATCH 请求体属性不得携带 `default`，全量替换 / upsert 端点须在其例外清单登记理由
- **全量集合赋值端点**（`PUT /{id}/roles`、`/{id}/members` 等）：集合字段必填（`z.array(...)`），
  **禁止** `.default([])`——字段缺失应返回 400，而不是静默清空
- **运行时设置进模块注册表**：可在后台修改、影响系统行为的开关 / 阈值 / 策略一律定义为
  `shared/src/settings/modules/{module}.ts` 的字段（`defineSettingsModule`，新模块在 `registry.ts` 与 `contracts.ts` 各登记一行），
  **禁止**新建 KV 配置表、逐项种子、环境变量兜底或在字典里存开关。叶子字段**必须** `.default()`、嵌套对象**必须** `.prefault({})`、
  标签说明写 `.meta({ title, description })`（通用设置页据此渲染）；字符串 / 数组叶子字段名**禁止**含
  `password` / `secret` / `token` / `apiKey` / `credential`（设置文档进审计快照与前端缓存，密钥走各自的加密存储）；
  被后台任务 / 无租户上下文中间件读取的模块 `scope` **必须**是 `platform`；匿名 / 登录可见字段在 `visibility` 与
  `publicSettingsSchema` / `mySettingsSchema` 两处同步声明（`settings.test.ts` 锁定）。见 [docs/backend/settings.md](../../../../docs/backend/settings.md)

## Service 层（Step 5）

- **职责边界**：业务逻辑、数据映射（`mapXxx`）、前置校验（`ensureXxx`）放
  `services/{业务域}/xxx.service.ts`；route handler 只取参数、调 service、返回响应
- **禁止事项**：service 中**禁止** `c.json()`、直接引用 Hono 上下文 `c`、`console.*`
- **HTTPException 抛出**：业务校验失败统一 `throw new HTTPException(statusCode, { message })`
  （`hono/http-exception`），由全局 `onError` 处理
- **DB 唯一约束**：PG 错误码 `23505` 在写入 `try-catch` 中用 `rethrowPgUniqueViolation(err, msg)`
  映射为 `HTTPException(400)`
- **事务**：多步写操作（replace 模式 delete+insert、写主表+关联表）必须 `db.transaction()`；
  辅助写函数接受 `executor: DbExecutor` 参数；副作用（WebSocket、邮件）不放入事务
- **事务内禁止走全局池读取**：`db.transaction()` 回调内**禁止**调用 `getSettings*`（`lib/settings`）及任何走全局 `db` 的读取——
  它们占用第二个连接，并发事务达到池上限时互相等待直到超时。设置在事务外读取后以参数传入
  （`services/drive/drive-transactions.test.ts` 静态扫描守住）；事务内的查询一律用 `tx`
- **运行时设置读取**：`getSettings('{module}', { tenantId? })`（`lib/settings`）返回类型化生效文档，进程内缓存 + LISTEN/NOTIFY 失效；
  **禁止**直接查 `system_settings`、**禁止**自建设置缓存或读取环境变量兜底；默认值只在模块 schema 出现，调用点**禁止**用 `??` 再抄一份默认值
- **计数查询**：单表计数用 `db.$count(table, where)`，禁止 `db.select({ total: count() })`
- **并行查询**：分页列表的 count 与 list **必须** `Promise.all` 并行，禁止串行 `await`
- **只读快照统计**：同一（组）表的多条统计查询要求结果相互一致时（汇总卡片 + 明细榜单、对账）
  用 `readSnapshot()`（`db/index.ts`，repeatable read + read only）；事务内语句串行执行，
  普通分页列表的 count + rows **禁止**套快照事务，保持 `Promise.all` 并行
- **CMS 检索向量**：`cmsContents` 的写入必须经 `contentSearchVector()` /
  `contentSearchVectorOnUpdate()`（`cms-search.service.ts`）派生 `searchVector`，
  **禁止**手工拼装 `to_tsvector` 表达式或漏更新可检索字段
- **RQB 优先**：关联数据查询优先 `db.query.tableName.findMany/findFirst({ with: { ... } })`，
  仅跨表 WHERE 过滤或聚合计数才手写 JOIN

### WHERE 条件构造

统一使用 `lib/where-helpers.ts`，**禁止**手写等价样板：

| 场景 | 用 | 禁止 |
| --- | --- | --- |
| 用户输入参与 LIKE / ILIKE（单列或跨列、包含或前缀匹配） | `keywordCondition(keyword, [colA, colB], mode?, match?)` | 手写 `like(col, '%…%')` / `or(like(a, '%…%'), …)` / 裸 `sql\`… ILIKE …\`` |
| 时间范围过滤 | `dateRangeConditions(column, start, end)` | 手写 `parseXxx` + `gte`/`lte` |
| 合并条件数组 / 附加租户与数据权限条件 | `buildWhere(...conditions)` | `conditions.length ? and(...) : undefined` |
| 分页 | `withPagination(qb.$dynamic(), page, pageSize)` | 手写 `.limit().offset()` |

- 条件数组类型必须是 `(SQL | undefined)[]`；构造函数不适用时返回 `undefined`，`buildWhere` 自动过滤，
  **禁止**为迁就 `SQL[]` 加 `!` 非空断言
- `keywordCondition` 内部已 trim、判空（空串 / 纯空格返回 `undefined`）并转义 `%`、`_`、`\`，
  调用点**不要**再包 `if (keyword)`，也**不要**自行拼 `%…%`
- 列参数接受裸列或 SQL 表达式（`sql\`coalesce(${col}, '')\``、`sql\`${col}::text\``），
  `match: 'prefix'` 用于路径 / 编号前缀匹配
- `like` 与 `ilike` 按各表原有语义指定，不得一刀切；`mode` 默认 `like`
- 时间范围一律闭区间（`gte` / `lte`），禁止 `gt` / `lt`——边界时刻记录会被漏掉

### 时间范围端点解析

- **范围端点必须走 `parseDateRangeStart` / `parseDateRangeEnd`**（或直接用 `dateRangeConditions`）：
  纯日期时起点取 `00:00:00`、终点取 `23:59:59.999`。**禁止**用 `parseDateTimeInput` 解析范围端点——
  它把 `2026-08-01` 解析成 `00:00:00`，「筛选到 8 月 1 日」会漏掉整个 8 月 1 日的数据
- `parseDateTimeInput` **只**用于单点时间（`scheduledAt` / `expireAt` / 投放起止等实体字段）
- **范围端点查询参数必须校验格式**：契约查询参数用 `dateRangeBound('说明')`（`@zenith/shared/core`），
  同时接受 `YYYY-MM-DD` 与 `YYYY-MM-DD HH:mm:ss`。**禁止**裸 `z.string().optional()`——
  `?endTime=abc` 会被静默当成「无筛选」返回全量数据

## Route 层（Step 6-7）

- **路由一律由契约定义**：`defineContractRoute(xxxContract.op, { middleware, handler })`（`lib/contract-route.ts`）；
  方法、路径、入参校验、响应 schema、security、tags 与 `commonErrorResponses` 全部由契约推导。
  **禁止**在路由文件调用 `createRoute` / `defineOpenAPIRoute`、**禁止**手写 `request:` / `responses:`、
  **禁止**声明实体 DTO；契约之外的额外响应（如 `conflictResponse`）经 `responses` 选项追加
- **薄路由**：**禁止在路由 handler 中直接调用 `db.*`**；DB 访问与业务逻辑全部在 service
- **响应体构造**：统一 `okBody(data, msg?)` / `errBody(msg, code?)`（`lib/openapi-schemas`），
  **禁止内联** `{ code: 0 as const, message, data }` 字面量；每个 `c.json(...)` 必须显式带状态码
- **中间件在路由侧声明**：`authMiddleware` / `guard({ permission, audit })` / `platformAdminOnly` 等只出现在
  `middleware:`；公开接口在契约上标 `public: true`，设备签名 / 开放网关鉴权的接口标
  `security: 'device-signature' | 'open-gateway'`（文档 security 随之变化，校验仍由中间件完成）；
  **禁止**在路由器上 `use('*', authMiddleware)`
- **进程入口导入顺序**：`src/index.ts` 第二条 import 与 `src/test-setup.ts` 首条 import 固定为
  `import '@hono/zod-openapi'`（`index.import-order.test.ts` 锁定）；新增进程入口同样如此
- **批量路由顺序**：`DELETE /batch` 必须注册在 `DELETE /{id}` **之前**，否则 `/batch` 被匹配为 `id="batch"`；
  静态 `/all` 同理早于 `/{id}`
- **挂载路径取契约**：`routes/{业务域}/index.ts` 的挂载写 `[xxxContract.basePath, xxxRoutes]`，**禁止**路径字面量
- **设置类接口不另开端点**：模块级设置的读写只经 `routes/platform/settings.ts` 循环注册表生成的 `GET/PUT /api/settings/{module-path}`，
  **禁止**在业务域路由再暴露 `/settings` / `/policy` 之类的独立设置端点；写接口的 `guard` 权限取模块 `writePermission`，
  平台作用域在多租户模式下仅平台管理员可写
- **契约编译期检查**：`npm run typecheck:contracts`（随 `lint` 执行）以 `src/**/*.typecheck.ts` 锁定
  handler 入参 / 响应类型约束，改动 `lib/contract-route.ts` 必须保持其绿色
- **外呼 HTTP**：服务端任何对外请求**必须**走 `lib/http-client.ts` 的 `httpRequest` / `httpGet` /
  `httpPost` 等，**禁止**全局 `fetch()`（见 [backend-patterns.md](./backend-patterns.md)）
- **写接口的审计快照**：需要 diff 的 PUT / DELETE 在写操作前 `setAuditBeforeData(c, before)`；
  响应 `data` 为 null 但仍需展示变更后状态（成员 / 角色 / 菜单 / 数据权限分配）时，
  写操作后补 `setAuditAfterData(c, after)`

---

## 菜单与权限配置（Step 9-10）

- **显示与操作解耦**：`directory` / `menu` 节点是纯显示资源，**禁止**携带 `permission`；
  全部权限码（含查询）挂在 `button` 节点上。每个页面菜单的第一个按钮固定为「查询」
  （`sort: 0`，权限码 `xxx:list`）；无列表语义的页面级设置页用 `xxx:view` / `xxx:update`
  （通用设置页 `/system/settings` 为 `system:setting:view` / `system:setting:update`，模块 `readPermission` / `writePermission` 与之对齐）
- **菜单 ID 分段**：每个一级目录独占 1000 段（系统管理 = 1000、系统设置 = 2000…）；
  页面落 10 的倍数槽位，按钮从父菜单 ID 顺延 +1..+n。**分配前必读 `SEED_MENUS` 源文件确认段内分布**，
  **严禁**依据任何文档记录的「当前最大 ID」分配
- **菜单种子只新增不更新**：seed.ts 对 `menus` 按 id `onConflictDoNothing`，`SEED_MENUS` 只决定新菜单的初始定义；
  已存在的行（含管理后台的改名 / 图标 / 排序 / 禁用 / 隐藏 / 换父级）不会被 seed 回写。
  **修改既有内置菜单的 path / component / 权限码等结构字段时，必须同时提供数据迁移**
  （`npx drizzle-kit generate --custom` 建独立迁移写 UPDATE），否则已初始化的环境不会跟随代码变化；新增菜单只需维护 `SEED_MENUS`。
  角色 / 套餐引用菜单 ID 用 `collectMenuSubtreeIds()` 等结构化推导，**禁止**硬编码魔法数字
- **手工菜单 ID 从 100000 起**（seed.ts `MENU_CUSTOM_ID_START`），`SEED_MENUS` 的 id **禁止**进入该区间

## MSW Mock 层（Step 11）

- **handler 由契约绑定**：一律 `mock(xxxContract.op, ({ params, query, body, ok, paginate }) => ...)`
  （`mocks/utils/contract.ts`）；路径、方法与入参解析来自契约，`ok(data)` 的载荷按契约响应类型检查。
  **禁止** `http.get('/api/...')` 路径字面量、**禁止**自行 `new URL(request.url).searchParams` / `request.json()` 解析入参
- **失败响应统一**：`mocks/utils/handlers.ts` 的 `fail` / `badRequest` / `unauthorized` / `forbidden` / `notFound` /
  `conflict` / `locked`；**禁止**内联 `HttpResponse.json({ code, message, data })`，**也禁止**在 handler 文件内自建同名局部 helper
- **分页统一**：用上下文的 `paginate(list)`（按契约解析后的 `page` / `pageSize` 切片）；页码来自 query 之外时用
  `pageResult(list, page, pageSize)`。**禁止**手写 `(page - 1) * pageSize`
- **自增 ID**：用 `nextIdFrom(list)`；**禁止**手写 `Math.max(...list.map((x) => x.id)) + 1`（空列表得 `-Infinity`）
- **HTTP 状态码**：失败响应显式带 `{ status: N }`，与真实后端一致
- **`data` 字段的有无是可观察差异**：`ok(x)` 省略 `data` 时响应体不含该字段，需要 `data: null` 就显式传 `null`
- **数据源对齐**：初始数据从 `@zenith/shared/seed` 的 `SEED_XXXS` 派生，**禁止**在 mock 中重复写静态数组；
  运行时设置的 Demo 存储在 `mocks/data/settings.ts`（默认值来自模块 schema，解析 / diff / 投影复用 `@zenith/shared/settings`），
  依赖某设置的其它 handler 读 `getMockSettings(module)` 或其镜像对象，**禁止**再写一份设置字面量
- **路径契约测试**：`packages/web/src/lib/api-conformance.test.ts` 对照服务端路由快照校验所有仍以字面量书写的
  请求 URL 与 handler 路径；服务端尚无对应端点的调用必须登记在 `api-conformance.allowlist.ts` 并写明原因

---

## 全局约束

### 时间格式

- **统一格式**：API 响应、入参、前端显示、MSW Mock 一律 `YYYY-MM-DD HH:mm:ss`
- **前端**：单点时间用 `formatDateTime()` / `formatDateTimeForApi()`；标准 `startTime` / `endTime`
  范围用 `formatDateTimeRangeForApi()`，非标准字段名（`startAt` / `endAt`）用
  `formatDateTimeRangeValuesForApi()` 后显式赋值（均来自 `@/utils/date`）。
  **禁止**在页面中手写 `[0]` / `[1]` 两端转换。仅接收 `YYYY-MM-DD` 的纯日期端点用 `formatDateForApi()`
- **后端格式化**：`lib/datetime.ts` 的 `formatDateTime()` / `formatNullableDateTime()`
- **后端解析**：范围端点 → `parseDateRangeStart()` / `parseDateRangeEnd()`（或 `dateRangeConditions()`）；
  单点时间 → `parseDateTimeInput()`。**不要混用**
- **Mock**：`mockDateTime()`（`mocks/utils/date.ts`）
- **禁止**：`toISOString()` / 原生 `toLocaleString()` / `toLocaleDateString()`

### 图标库

- 统一 `lucide-react`，禁止 `@douyinfe/semi-icons`

### 通用工具函数（`@zenith/shared/core`）

前后端与 Mock 共用，**禁止**在页面 / service 内重写等价实现：

| 场景 | 用 |
| --- | --- |
| 动态文本插入 HTML（邮件、打印页、SSR 片段） | `escapeHtml(text)` |
| 任意字符串拼入 `new RegExp()` | `escapeRegExp(text)` |
| 数值限制在区间内 | `clamp(value, min, max)` |
| 字节数展示（B / KB / MB / GB / TB） | `formatBytes(bytes)` |
| 平铺列表（`id` / `parentId`，或自定义键）→ 树 | `buildTree(list, { compare?, keepEmptyChildren?, id?, parentId? })`；父节点缺失的节点挂到根 |
| 树 → 另一种节点形态（如 Semi `TreeNodeData`） | `mapTree(nodes, (node) => ({ ... }))`，children 自动递归 |

- 前端毫秒耗时展示用 `@/utils/format` 的 `formatDurationMs(ms)`；空值统一渲染 `EMPTY_PLACEHOLDER`
- 服务端手机号脱敏用 `lib/masking.ts` 的 `maskPhone()`；等待用 `node:timers/promises` 的 `setTimeout`

### 分页格式

- 列表接口返回 `{ list, total, page, pageSize }`：契约用 `paginated(xxxSchema)` 声明，查询参数 `paginationQuery.extend({...})`
- SQL-builder 分页用 `withPagination(query.$dynamic(), page, pageSize)`；RQB 分页用 `offset: pageOffset(page, pageSize)`；
  MSW Mock 用契约上下文的 `paginate(list)` / `pageResult(list, page, pageSize)`
- 禁止手写 `(page - 1) * pageSize`

### 重型依赖懒加载（Server）

server 启动时加载全部路由 / 服务模块图，任何模块顶层静态 import 的依赖都会计入**每次**冷启动。

- **禁止**在 server 模块顶层静态 import 重型 SDK（首次 import 数百 ms 以上、且仅特定功能使用），
  已知清单：`exceljs`、`pdfkit`、`sharp`、`cheerio`、`dockerode`、`mssql`、`mysql2`、
  `@opentelemetry/sdk-node`、`@alicloud/*`、`tencentcloud-sdk-*`、云存储 SDK
  （`ali-oss` / `@aws-sdk/*` / `cos-nodejs-sdk-v5` / `qiniu` / `@baiducloud/sdk` / `@azure/storage-blob` / `esdk-obs-nodejs`）
- **必须**改为首次使用时经 `createRequire` 惰性加载；类型引用一律 `import type`。
  写法见 [backend-patterns.md](./backend-patterns.md)
- **禁止**在 ESM 模块中使用裸 `require()`；必须 `createRequire(import.meta.url)`
- 新引入第三方依赖先评估加载成本（`node -e "console.time('t');require('pkg');console.timeEnd('t')"`）；
  启动即需要的依赖（`hono`、`drizzle-orm`、`pino`、`pg-boss`、`ioredis`、`zod`）可静态 import

### 异步任务

- 大数据量、长耗时、可重试或需进度 / 取消的操作必须接任务中心（`lib/task-center/`）。
  用户已选中且可在正常 HTTP 请求窗口内快速完成的有界表格批量操作可以使用同步 `/batch`；
  **禁止**自建任务表、后台轮询线程或 `setInterval` 驱动的作业。见 [async-tasks.md](./async-tasks.md)

### 通知发送

- **事件通知唯一入口是 `notify()` / `notifyWithin()`**（`services/messaging/notification-outbox.service`）；
  业务域**禁止**直接 import `sendMail` / `sendSmsByProvider` / `sendWebhookNotification` /
  `notifyUserWithCard`（ESLint 已封禁，豁免清单见 `packages/server/eslint.config.js`，
  仅限事务性发信与配置驱动的编排节点）。见 [notifications.md](./notifications.md)
- **事件先注册后使用**：新事件必须先加进 `shared/messaging/notification-events.ts`
  （key 用 `{域}.{对象}.{动作}` 点分小写，变量用 `eventVars<>()` 声明）；未注册的 key 编译不过
- **定时任务 / 可重放场景必传 `dedupeKey`**；站内信可跳转的场景必传 `link`
- **`mandatory: true` 仅限账号安全与告警必达**；`availableChannels` 不得列出无投递支撑的渠道
- **Webhook 收件人只能是 `external`**（它是地址不是人）；配置开关翻译为 `channelPolicy`，
  渠道参数（短信模板 / 邮件主题）放 `channelOptions`，禁止业务侧自行分发渠道

### 进程级错误兜底

- **fire-and-forget 必须自带 catch**：`void promise.catch((err) => logger.error(...))`；
  **禁止**裸悬空 Promise——unhandledRejection 会触发进程级 fatal 兜底并 exit(1)
- **禁止在 uncaughtException / unhandledRejection 后继续运行**：进程级兜底
  （`lib/fatal-handlers.ts`，index.ts 第一条 import 自装；第二条固定为 `@hono/zod-openapi`，见 Route 层）只负责崩溃可观测
  （stderr + 崩溃哨兵 + 尽力 flush 日志/遥测）后 exit(1)；崩溃告警由下次启动补投
  （`services/platform/crash-report.service`），恢复语义靠 outbox 补投与启动 reconcile，
  **不得**在业务代码中自行注册这两个 process 事件
