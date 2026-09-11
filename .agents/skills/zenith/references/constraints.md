# 核心规范约束（后端与全局）

**所有代码改动的硬约束单一来源**，前端部分在 [constraints-frontend.md](./constraints-frontend.md)。
每条都是一句话可机械核对的「必须 / 禁止」，括号内是漏写的代价或适用 Step。
代码模板与展开说明在各主题文件，本文件只给指针，不放示例。

**按改动涉及的层读取对应章节即可，无需通读：**

| 改动涉及 | 章节 |
| --- | --- |
| 建表、加字段、枚举、审计列 | [Schema 层](#schema-层step-1) |
| 契约、实体 schema、Zod 校验、常量、新增业务域 | [Shared 层](#shared-层step-3-4) |
| 业务逻辑、查询条件、事务、快照统计、大列投影 | [Service 层](#service-层step-5) |
| 路由、中间件、响应构造、审计快照 | [Route 层](#route-层step-6-7) |
| 菜单条目、权限码、种子数据 | [菜单与权限配置](#菜单与权限配置step-9-10) |
| MSW mock handler | [MSW Mock 层](#msw-mock-层step-11) |
| 时间格式与解析、图标、通用工具、数据脱敏、分页、重型依赖、异步任务、Outbox 排空、通知发送、进程级兜底 | [全局约束](#全局约束) |
| 页面、域 hooks、组件、布局 | → [constraints-frontend.md](./constraints-frontend.md) |

---

## Schema 层（Step 1）

- **主键统一 identity**：自增主键一律 `integer().primaryKey().generatedAlwaysAsIdentity()`
  （大表用 `bigint({ mode: 'number' })` 同理），**禁止** `serial` / `bigserial`；
  需要显式插入 id 的场景（仅限 seed）必须链式加 `.overridingSystemValue()`。
  例外是分区时序明细表：`iot_telemetry` 无主键也无 `id`，`drive_activities` 与
  `drive_share_access_logs` 保留无主键的 identity 序号；分区 DDL 由迁移手写。
  **禁止**擅自增加代理主键或改动分区键列，见 [docs/backend/database.md](../../../../docs/backend/database.md)「分区表」
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
- **时间戳列用积木**：`created_at` / `updated_at` 一律展开 `...timestampColumns()`（`db/schema/common.ts`；
  `timestamptz` 传 `{ withTimezone: true }`），**禁止**逐表手写 `timestamp().defaultNow()…$onUpdate(...)` 两行；
  只有 `created_at` 的追加型表单独声明
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
  `@zenith/shared/{业务域}`（可用域以 `shared/package.json` 的 `exports` 为准），种子数据用 `@zenith/shared/seed`
- **Zod Schema 位置**：创建 / 更新 schema 定义在 `shared/src/{业务域}/validation.ts`，前后端共用，
  **禁止**在 server / web 中重复定义
- **纯业务逻辑放 shared**：任何同时被服务端与前端 / Mock 需要的纯函数或常量（过滤谓词、树构建与层级约束、统计口径、
  科目 / 分桶等元数据、消息分支树等算法）放在 `shared/src/{业务域}/` 的独立文件并从域入口导出，两端只导入；
  **禁止**在 server 与 web 各写一份「对齐」的实现
- **枚举 SSOT 在 constants**：`XXX_TYPES` 常量数组 + 派生 union type + `XXX_LABELS` / `XXX_OPTIONS`
  一并写在 `shared/src/{业务域}/constants.ts`，`validation.ts` 通过 `z.enum(XXX_TYPES)` 引用。
  **禁止**把会被其他域 `z.enum()` 引用的常量数组放在 `validation.ts`——validation 互引形成 ESM 值环，
  `z.enum()` 在初始化期取到 `undefined` 直接崩溃。通用的启用 / 禁用状态字段一律用 `@zenith/shared/core` 的
  `entityStatusSchema`（可继续链式 `.default('enabled')` / `.optional()`），**禁止**在各域手写 `z.enum(['enabled', 'disabled'])`
- **API 契约是唯一真相**：实体形状与全部操作定义在 `shared/src/{业务域}/contracts/xxxs.ts`——
  `xxxSchema = z.object({...}).meta({ id: 'Xxx' })` + `type Xxx = z.infer<typeof xxxSchema>` +
  `xxxContract = defineContract('/api/xxxs', { list: op.get(...), ... })`（`@zenith/shared/core`）。
  **禁止**手写 `interface Xxx`、**禁止**在 server 定义实体 DTO、**禁止**在 web / mock 书写 `/api/...` 路径字面量。
  service 的列表查询入参类型同样由契约派生（在契约文件导出 `type XxxListQueryInput = z.infer<typeof xxxListQuery>`），
  **禁止**在 service 里手写与契约查询 schema 同形的 `interface XxxQuery`
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
  `shared/src/settings/modules/{module}.ts` 的字段（`defineSettingsModule`），**禁止**新建 KV 配置表、逐项种子、
  环境变量兜底或在字典里存开关；字段声明、作用域与可见性的判定规则见 [settings.md](./settings.md)

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
- **分页列表编排**：标准形态（count + rows + `{ list, total, page, pageSize }`）一律用 `lib/list-query.ts` 的
  `buildListResult({ page, pageSize, count, rows, map })`，它保证 count 与 rows `Promise.all` 并行并套包络；
  条件、排序、投影仍在 `count` / `rows` 闭包里显式书写。只有聚合 count、需要额外包络字段等特殊形态才手写 `Promise.all`，
  且同样禁止串行 `await`
- **存在性断言**：「取首行，不存在则抛 HTTPException」用 `lib/db-assert.ts` 的 `requireRow(row, message, status?)` /
  `requireFirstRow(queryPromise, message)`；查询本身（投影、租户 / 数据范围条件）留在调用方，**禁止**为此再抽 `ensureById(table, id)` 之类隐藏条件的通用查询
- **租户归属匹配**：与一条已知归属（订单 / 应用 / 事件所属租户）做行到行匹配用 `lib/tenant.ts` 的
  `exactTenantCondition(col, tenantId)`（`null → IS NULL`）、`optionalExactTenantCondition`（`undefined` 不过滤）、
  `inheritedTenantCondition`（平台级可被租户继承：`IS NULL OR =`）；**禁止**手写 `tenantId == null ? isNull(col) : eq(col, tenantId)` 三目。
  它们与 `tenantCondition(table, user)`（请求用户可见性，平台管理员可看全部）语义不同，不得互换。
  其它可空外键（`parentId` / `appId` / `definitionId` / `createdBy`…）与已知值的等值匹配用 `lib/where-helpers.ts` 的 `nullableEq(col, value)`，同样**禁止**手写三目
- **任务终态判定**：异步任务「是否已结束」一律用 `@zenith/shared/tasks` 的 `isAsyncTaskTerminal(status)` /
  `ASYNC_TASK_TERMINAL_STATUSES` / `ASYNC_TASK_ACTIVE_STATUSES`；列表筛选里的 `active` / `terminal` / 具体状态 → WHERE 条件用
  `lib/task-center` 的 `asyncTaskStatusCondition(status)`。**禁止**在 service / 路由 / 导出定义 / 前端 / Mock 里内联 `['success', 'failed', 'cancelled']`
- **业务附件读取**：任何挂在业务记录上的附件（公告 / 工单 / 审批…）一律经 `services/files/business-files.service.ts` 的
  `listBusinessFiles(businessType, businessId)`（按 `sortOrder, id` 排序，带代理下载地址与公开直链），需要更窄形状时 `map` 投影到契约字段；
  **禁止**在业务 service 里再写 `businessFiles leftJoin managedFiles` + `getStorageConfigMap` + `buildPublicFileUrl` 的映射
- **网盘节点 / 空间名批量解析**：列表行引用 `nodeId` / `spaceId` 需要展示名与类型时用 `services/drive/drive-common.ts` 的
  `resolveNodeSpaceLabels(rows)`（返回按行取 `nodeName` / `nodeType` / `spaceName` 的函数），用户名用同文件的 `resolveUserNames`
- **单一默认项写入**：带 `is_default` 的配置类实体（短信 / 推送 / 存储 / 支付渠道 / 公众号 / 报表环境 / 保存视图…）
  一律经 `lib/default-flag.ts` 的 `clearDefaultFlag(executor, table, scopeWhere)` / `ensureSingleDefault(executor, table, id, { scope })`
  在事务内清除范围内其它默认标记，范围条件由调用方给出；**禁止**在 service 里手写 `update(table).set({ isDefault: false })`
- **工作流实例并发保护**：实例上的审批 / 推进 / 管理操作在事务内用 `services/workflow/instances/shared.ts` 的
  `lockInstanceExpecting(tx, id, expectedStatus, message)` 加行级锁并重校验状态；**禁止**手写 `SELECT status … FOR UPDATE` + 409 样板
- **工作流新任务事件**：推进 / 跳转 / 恢复产生的新任务一律经 `services/workflow/instances/shared.ts` 的
  `emitTasksEnteredEvents(instanceId, tasks, meta, executor?)` 补发 `node.entered` → `task.created` → 按状态 `task.assigned` /
  `task.approved` / `task.rejected`（事务内传 `executor` 并 `await`，提交后同步发射不传）；**禁止**在各推进路径手写这组循环；
  `instance.approved` / `instance.rejected` 仍由调用方按终态单独发射
- **并行查询**：分页列表的 count 与 list **必须** `Promise.all` 并行，禁止串行 `await`
- **只读快照统计**：同一（组）表的多条统计查询要求结果相互一致时（汇总卡片 + 明细榜单、对账）
  用 `readSnapshot()`（`db/index.ts`，repeatable read + read only）；事务内语句串行执行，
  普通分页列表的 count + rows **禁止**套快照事务，保持 `Promise.all` 并行
- **CMS 检索向量**：`cmsContents` 的写入必须经 `contentSearchVector()` /
  `contentSearchVectorOnUpdate()`（`cms-search.service.ts`）派生 `searchVector`，
  **禁止**手工拼装 `to_tsvector` 表达式或漏更新可检索字段
- **大列投影**：带 TOAST 大列（富文本 `text`、tsvector、可能很大的 jsonb）的表，任何返回多行的读路径
  **禁止** `db.select().from(table)` / `findMany()` 不带 `columns` 取全行；用表旁定义的投影列集
  （如 `cms-content-columns.ts` 的 `cmsContentListColumns` / `cmsContentLinkColumns`）并把函数签名收窄到对应行类型，
  只有详情 / 写入路径取全行。列表需要「由大列派生的小字段」（导语、页数、标志位）时在写入侧物化：
  能用 SQL 表达式描述的用 **PG 生成列**（`generatedAlwaysAs`，覆盖所有写入路径，含种子 / 导入 / 分发），
  否则在写入 service 派生；**禁止**读取时从大列临时计算。`cmsContents` 的 `excerpt` 即导语生成列，
  列表 / 搜索 / RSS 的导语只能经 `listSummaryOf()`（手填摘要 → `excerpt`），**禁止**再从 `body` 回退
- **RQB 优先**：关联数据查询优先 `db.query.tableName.findMany/findFirst({ with: { ... } })`，
  仅跨表 WHERE 过滤或聚合计数才手写 JOIN；`with` 到带大列的表时必须带 `columns` 排除大列

### WHERE 条件构造

统一使用 `lib/where-helpers.ts`，**禁止**手写等价样板：

| 场景 | 用 | 禁止 |
| --- | --- | --- |
| 用户输入参与 LIKE / ILIKE（单列或跨列、包含或前缀匹配） | `keywordCondition(keyword, [colA, colB], mode?, match?)` | 手写 `like(col, '%…%')` / `or(like(a, '%…%'), …)` / 裸 `sql\`… ILIKE …\`` |
| 时间范围过滤 | `dateRangeConditions(column, start, end)` | 手写 `parseXxx` + `gte`/`lte` |
| 合并条件数组 / 附加租户与数据权限条件 | `buildWhere(...conditions)` | `conditions.length ? and(...) : undefined` |
| 可空列与已知值的等值匹配（`parentId` / `appId` / `createdBy`…） | `nullableEq(col, value)`（`null → IS NULL`）；租户列用 `lib/tenant.ts` 的 `exactTenantCondition` | `x === null ? isNull(col) : eq(col, x)` 三目 |

- 条件数组类型必须是 `(SQL | undefined)[]`；构造函数不适用时返回 `undefined`，`buildWhere` 自动过滤，
  **禁止**为迁就 `SQL[]` 加 `!` 非空断言
- `keywordCondition` 内部已 trim、判空（空串 / 纯空格返回 `undefined`）并转义 `%`、`_`、`\`，
  调用点**不要**再包 `if (keyword)`，也**不要**自行拼 `%…%`
- 列参数接受裸列或 SQL 表达式（`sql\`coalesce(${col}, '')\``、`sql\`${col}::text\``），
  `match: 'prefix'` 用于路径 / 编号前缀匹配
- `like` 与 `ilike` 按各表原有语义指定，不得一刀切；`mode` 默认 `like`
- 时间范围一律闭区间（`gte` / `lte`），禁止 `gt` / `lt`——边界时刻记录会被漏掉；
  端点解析与查询参数校验见[全局约束 → 时间格式](#时间格式)

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
- **静态路径先于动态路径**：`mock(op)` 把 `{id}` 转成 `:id`，MSW 按数组顺序首个命中即返回——`all`（`/all`）、
  `removeBatch`（`/batch`）等静态路径的 handler 必须排在 `detail` / `remove`（`/{id}`）**之前**
- **自增 ID**：用 `nextIdFrom(list)`；**禁止**手写 `Math.max(...list.map((x) => x.id)) + 1`（空列表得 `-Infinity`）
- **机械 CRUD 用工具**：关键词多字段过滤用 `filterByKeyword`（`mocks/utils/filter.ts`），按 id 取 / 改 / 删 / 批删用
  `requireItem` / `updateItem` / `removeItem` / `removeByIds`（`mocks/utils/crud.ts`，找不到抛 `MockHttpError`，`mock()` 映射为 404 响应；
  主键可为 number 或 string），表单或 JSON 请求体用 `readFormOrJsonBody`，`Idempotency-Key` 回放用 `resolveIdempotent`；
  **禁止**在 handler 里手写 `find → notFound → Object.assign` / `findIndex → notFound → splice` / 多字段 `includes` 链。
  仍以裸 `http.*` 注册的少数 handler（OAuth2 授权、CMS 公共广告、会员头像）没有 `MockHttpError` 映射，只能手写 `notFound`
- **HTTP 状态码**：失败响应显式带 `{ status: N }`，与真实后端一致
- **`data` 字段的有无是可观察差异**：`ok(x)` 省略 `data` 时响应体不含该字段，需要 `data: null` 就显式传 `null`
- **数据源对齐**：初始数据从 `@zenith/shared/seed` 的 `SEED_XXXS` 派生，**禁止**在 mock 中重复写静态数组；
  运行时设置的 Demo 存储在 `mocks/data/settings.ts`（默认值来自模块 schema，解析 / diff / 投影复用 `@zenith/shared/settings`），
  依赖某设置的其它 handler 读 `getMockSettings(module)` 或其镜像对象，**禁止**再写一份设置字面量
- **业务规则只导入不重写**：服务端已有的纯业务逻辑（过滤谓词、树构建、层级约束与文案、统计汇总、常量元数据、分支 / 路径算法）
  必须位于 `@zenith/shared/{业务域}`，Mock handler 与前端页面从那里导入；**禁止**在 mock 里「照着服务端再写一遍」——
  两份实现只靠约定同步，漂移无法被任何测试发现
- **路径契约测试**：`packages/web/src/lib/api-conformance.test.ts` 对照服务端路由快照校验所有仍以字面量书写的
  请求 URL 与 handler 路径；服务端尚无对应端点的调用必须登记在 `api-conformance.allowlist.ts` 并写明原因

---

## 全局约束

### 进程角色

- **后台声明保持角色无关**：`registerTaskHandler`、`registerSystemQueueWorker`、`registerSystemRecurringJob` 等任务 / Cron / 系统队列注册**禁止**包在 `if (config.roles.worker)` 中；执行门禁只能位于 `lib/pg-boss-scheduler.ts` / `lib/task-center/runner.ts`。
- **`forceLocal` 只给节点亲和队列**：`registerSystemQueueWorker({ forceLocal: true })` 仅用于必须在提交节点本机执行的 node-affine 队列，普通业务队列**禁止**使用。
- **WebSocket 推送统一出口**：业务模块所有 WS 推送必须走 `lib/ws-manager.ts` 公共函数；IoT 设备推送走 `services/iot/iot-gateway.service.ts` 的 `push*`；**禁止**持有 `WSContext` 集合或直接 `ws.send()`，否则消息不会跨进程扇出。
- **本机文件系统任务声明亲和性**：任何触碰服务请求所在节点本地文件系统的任务 handler 必须声明 `affinity: 'node'`。
- **启动职责分层**：绑定角色的启动步骤放在 `bootstrap/run-api.ts` / `bootstrap/run-worker.ts`；角色无关的任务、Cron 与队列声明放在 `bootstrap/workers.ts`。
- **新增环境变量同步样例**：新增 env 必须写入 `packages/server/.env.example`；涉及部署拓扑时同步 `docker-compose.yml` / `.env.docker`。

### 时间格式

- **统一格式**：API 响应、入参、前端显示、MSW Mock 一律 `YYYY-MM-DD HH:mm:ss`
- **前端**：单点时间用 `formatDateTime()` / `formatDateTimeForApi()`；标准 `startTime` / `endTime`
  范围用 `formatDateTimeRangeForApi()`，非标准字段名（`startAt` / `endAt`）用
  `formatDateTimeRangeValuesForApi()` 后显式赋值（均来自 `@/utils/date`）。
  **禁止**在页面中手写 `[0]` / `[1]` 两端转换。仅接收 `YYYY-MM-DD` 的纯日期端点用 `formatDateForApi()`
- **后端格式化**：`lib/datetime.ts` 的 `formatDateTime()` / `formatNullableDateTime()`
- **后端解析**：范围端点**必须**走 `parseDateRangeStart()` / `parseDateRangeEnd()`（或直接用 `dateRangeConditions()`），
  纯日期时起点取 `00:00:00`、终点取 `23:59:59.999`；`parseDateTimeInput()` **只**用于单点时间
  （`scheduledAt` / `expireAt` 等实体字段）——它把 `2026-08-01` 解析成 `00:00:00`，用作范围终点会漏掉整天数据
- **范围端点查询参数必须校验格式**：契约查询参数用 `dateRangeBound('说明')`（`@zenith/shared/core`），
  同时接受 `YYYY-MM-DD` 与 `YYYY-MM-DD HH:mm:ss`；**禁止**裸 `z.string().optional()`——
  `?endTime=abc` 会被静默当成「无筛选」返回全量数据
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
| 百分比（保留 N 位小数，分母为 0 返回 null） | `percentOf(part, total, digits = 1)`；空值展示由调用方 `?? 0` |
| 阈值比较（`gt` / `gte` / `lt` / `lte` / `eq` / `neq`） | `compareNumber(value, op, threshold)`；算子集合 `NUMERIC_COMPARE_OPS`（报表预警 / IoT / 监控告警同源） |
| ID 数组清洗（正整数、去重、保持顺序） | `uniquePositiveInts(values)`；单值判定 `isPositiveInt(value)` |
| 凭据打码（API Key / Secret / Token） | `maskSecret(value, { head, tail, filler, short })`；展示占位与「未修改」哨兵用 `SECRET_PLACEHOLDER` |
| 字节数展示（B / KB / MB / GB / TB） | `formatBytes(bytes)` |
| 平铺列表（`id` / `parentId`，或自定义键）→ 树 | `buildTree(list, { compare?, keepEmptyChildren?, id?, parentId? })`；父节点缺失的节点挂到根 |
| 树 → 另一种节点形态（如 Semi `TreeNodeData`） | `mapTree(nodes, (node) => ({ ... }))`，children 自动递归 |
| 树 → 先序平铺列表（下拉源查找 / 名称映射） | `flattenTree(nodes)`；节点原样返回不拷贝 |
| 按点分路径读取 JSON 嵌套值（外部 API 响应的 `itemsPath` 等配置化取数路径、表单嵌套字段 `actions[0]`） | `getByPath(source, path)`；空路径返回原值，中途非对象返回 `undefined`，数组可用下标段（`.0` 或 `[0]`） |
| 非 null、非数组的普通对象判定 | `isPlainObject(value)` |
| 拼接 `${base}/${path}` 前归一 base URL / 根路径 | `trimTrailingSlash(value)`（去掉末尾全部 `/`） |

- 前端毫秒耗时展示用 `@/utils/format` 的 `formatDurationMs(ms)`；秒级时长的「N天N小时N分」用 `formatSecondsHuman(seconds)`
  （<1 分钟显示秒，`formatSecondsBetween(start, end)` 取两个时间的差），`mm:ss` 计时用 `formatClock(seconds)`；
  空值统一渲染 `EMPTY_PLACEHOLDER`
- 日志 / 文案里的局部脱敏用 `@zenith/shared/core` 的 `maskPhone()` / `maskEmail()`（server 经 `lib/masking.ts` 转发）；
  等待用 `node:timers/promises` 的 `setTimeout`
- 工作流表单的跨字段比较（`gt` / `gte` / `lt` / `lte` / `eq` / `neq`，数值或日期）前后端共用 `@zenith/shared/workflow` 的
  `evalWorkflowCompareRule(op, a, b, isDate)`（日期经 dayjs 按本地时区解析），算子文案用 `WORKFLOW_COMPARE_OP_TEXT`；
  **禁止**在 web 表单渲染器或 server 校验里再写一份比较 switch

### Server 通用库（`packages/server/src/lib`）

| 场景 | 用 | 禁止 |
| --- | --- | --- |
| 文件下载 / 预览响应头 | `content-disposition.ts`：`attachmentDisposition(filename)`（RFC 5987 `filename*=UTF-8''` + ASCII 回退）、`inlineOrAttachmentDisposition(filename, mimeType)`（仅 `SAFE_INLINE_MIME_TYPES` 允许 inline） | 手拼 `attachment; filename="…"`、各处自维护可内联 MIME 白名单 |
| 无状态 HMAC 签名令牌（事件令牌、渲染凭证、退订链接…） | `signed-token.ts`：`createSignedTokenCodec<T>({ version })`（`<v>.<data>.<sig>`）或 `({ purpose })`（`<data>.<sig>`），`decode` 返回 `null` 后由调用方做载荷校验与错误语义；非 JSON 载荷的签名用 `hmacSha256(input, 'hex' \| 'base64url')` + `constantTimeEqual(a, b)` | 手写 `createHmac` + `timingSafeEqual` + base64url 拆包；新令牌自创线格式 |
| 统计类 service 的「今日 / 近 N 天 / 环比窗口」起点 | `datetime.ts`：`startOfToday()`、`startOfDayAgo(n)`、`startOfRecentDays(days)`（近 N 天含今日）、`resolveStatsWindow(daysRaw, { fallback, min, max })`（夹紧天数 + 本期 / 上期起点 + 日期标签） | 逐 service 手写 `new Date()` + `setHours(0,0,0,0)` + `setDate(...)`、各自的 `startOfToday` / `windowStart` / `sinceDate` |
| 用户 id → 展示名（昵称 \|\| 用户名）批量解析 | `user-nicknames.ts` 的 `resolveUserNames(ids, executor?)`（drive 域经 `drive-common.ts` re-export） | 手写 `select({ id, nickname, username }).from(users).where(inArray(...))` + `Map` |
| 探针的基础设施检查 | `health-checks.ts`：`checkInfraHealth()`（database / redis / invalidationBus）+ `overallHealthStatus(checks)`，角色特有项由调用方追加 | 在 api / worker 探针各写一份 `SELECT 1` / `redis.ping()` 三件套 |
| 通知模板变量归一化 | `notification/template-vars.ts` 的 `normalizeTemplateVars(vars)` | 派发 / 摘要各写一份 `String(value)` 循环 |
| 工作流作业的占位符渲染（`{{form.x}}` / `{{instanceId}}` …） | `workflow-jobs/handlers/shared.ts` 的 `renderWorkflowTemplate(template, formData, extras)`；URL 仍走 `workflow-outbound.renderUrlTemplate` | 反向动作 / 触发器各写一份 `replace(/\{\{form\.…\}\}/)` |
| 微信支付 v3 请求签名 | `payment/signing.ts` 的 `buildWechatPayAuthorization({ mchid, serialNo, privateKey, method, urlPath, body })` / `wechatNonce()`；缺配置的语义（返回 null / 抛 400）留在调用方 | adapter 与证书下载各拼一份 `WECHATPAY2-SHA256-RSA2048 …` |
| 支付域业务单号 | `services/payment/payment-no.ts` 的 `genPaymentNo(prefix)` | 各 service 自写 `${prefix}${Date.now()}${randomInt(...)}` |
| IoT 告警 / 联动规则的引用校验 | `services/iot/iot-rule-refs.ts` 的 `ensureIotRuleReferencesValid(productId, refs, { numericOnly })` | 两个 service 各写一份「设备属产品 + 物模型属性 / 事件已声明」 |
| Wiki 文档追加排序 | `services/wiki/doc-order.ts` 的 `nextWikiDocSort(tx, spaceId, parentId)` | 新建 / 导入各写一份 `coalesce(max(sort), -1) + 1` |

已有令牌的线格式（前缀 / 版本 / 摘要编码）已被黄金测试锁定（`unsubscribe.test.ts`、`cms-ad-render-proof.test.ts`、
`cms-preview.service.test.ts`），改动实现不得改变一个字节。

### 数据脱敏（PII）

- **敏感字段在契约声明**：手机号 / 邮箱 / 证件号 / 银行卡 / 姓名 / 地址等 PII 字段在契约实体 schema 上写
  `sensitive(z.string().nullable(), 'phone')`（`@zenith/shared/core`），所在对象**必须**有 `meta.id`（路由定义期抛错兜底）。
  **禁止**在 service 的 `mapXxx` 里手工调 `maskPhone()` 之类按查看者打码——契约路由出口（`lib/data-mask/boundary.ts`）
  会对所有声明字段按策略统一打码；只有「当前用户查看自己」的自视图端点才在 `op` 上标 `unmasked: true`
- **写接口天然受保护**：请求体在敏感字段上携带脱敏值会被出口边界 400；表单回填与展示的前端配套约束见
  [constraints-frontend.md → 表单与展示组件](./constraints-frontend.md#表单与展示组件)
- **需要支持按需查看明文的实体**在 service 里 `registerRevealSource('Entity', (id) => getXxx(id))`，
  加载器必须复用该实体自己的读取函数（携带租户 / 数据范围校验）
- **导出列**绑定契约字段：`{ key, sensitive: true, maskKey: 'User.phone' }`，**禁止**再写 `maskEntity` / `maskField` 或在导出定义里手工打码
- 策略只保存覆盖记录（`data_mask_policies`），**禁止**为脱敏另建规则表、扫描数据库列名或按角色 code 豁免（豁免只认权限码）

### 分页格式

- 列表接口返回 `{ list, total, page, pageSize }`：契约用 `paginated(xxxSchema)` 声明，查询参数 `paginationQuery.extend({...})`
- SQL-builder 分页用 `withPagination(query.$dynamic(), page, pageSize)`；RQB 分页用 `offset: pageOffset(page, pageSize)`；
  服务层的 count + rows + 包络用 `buildListResult`（见 [Service 层](#service-层step-5)）；
  MSW Mock 用契约上下文的 `paginate(list)` / `pageResult(list, page, pageSize)`
- 禁止手写 `(page - 1) * pageSize`
- `page` / `pageSize` 的取值范围只在契约 `paginationQuery`（`pageSize` 1..200）声明并由路由校验；service **禁止**再做
  `Math.min(pageSize, 100)` / `Math.max(page, 1)` 之类二次夹紧，查询参数类型直接用契约导出的 `XxxQueryInput`

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

### Outbox / 兜底扫描的排空

面向外部 I/O（邮件、短信、Webhook、第三方 API）的 outbox 补投与重试扫描，**禁止**「`SELECT id … LIMIT n` 后 `for … await` 逐条处理」：
单次外呼几百毫秒时一轮跑不完就撞上下一个周期，且没有 ORDER BY 的 LIMIT 在积压时不保证先进先出。

- **认领即取行**：`UPDATE … SET claimed_at = now() WHERE id IN (SELECT id … WHERE <可认领条件> ORDER BY id LIMIT <批> FOR UPDATE SKIP LOCKED) RETURNING *`，
  一条语句完成认领与取行，多实例互不重叠；批大小取并发数的 2 倍左右——它同时是实例崩溃时要等认领超时才重入队的行数上限
- **有界并发 + 循环排空**：一批内 `mapWithConcurrency(rows, N, …)`，mapper 自行 catch 使单行失败不中断本批；
  循环认领直到没有可认领的行或用完时间预算（小于任务周期），不靠单轮扫描条数限制吞吐
- **跨入口的总在飞数用进程级限流器**（`createConcurrencyLimiter`，`lib/concurrency.ts`）：定时补投与请求内立即派发会叠加，
  下游连接数（SMTP 池、数据库池、服务商并发）有硬上限，只限制「一批之内」不够
- **失败重试要有间隔**：失败后保留认领时间（认领超时即重试间隔），**禁止**清空认领时间让紧接着的轮次立刻重打
- **外呼必须带超时**；SMTP 用 `lib/email.ts` 的连接池化 `sendMail`，**禁止**每封邮件 `createTransport`
- 参考实现：`services/messaging/notification-outbox.service.ts`（`claimOutboxBatch` / `dispatchPendingNotifications`）、
  `lib/notification/dispatch.ts`（进程级投递限流器）

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
- **禁止在 uncaughtException / unhandledRejection 后继续运行**：进程级兜底（`lib/fatal-handlers.ts`）只负责崩溃可观测
  （stderr + 崩溃哨兵 + 尽力 flush 日志/遥测）后 exit(1)；崩溃告警由下次启动补投
  （`services/platform/crash-report.service`），恢复语义靠 outbox 补投与启动 reconcile，
  **不得**在业务代码中自行注册这两个 process 事件
- **进程入口导入顺序固定**：`src/index.ts` 第一条 import 为 `./lib/fatal-handlers`（自装上述兜底），第二条为
  `import '@hono/zod-openapi'`（shared schema 须在原型补丁后构造）；`src/test-setup.ts` 首条 import 同为
  `@hono/zod-openapi`（`index.import-order.test.ts` 锁定）；新增进程入口同样如此

### CMS 前台脚本（islands）

- **主题不得内联可执行脚本**：`packages/server/src/cms/themes/**` 是纯服务端组件，禁止字符串脚本常量与
  `<script dangerouslySetInnerHTML>`（仅 `THEME_TOGGLE_SCRIPT` 与 default 主题的会员受众重载 / 清理两段内容恒定的
  引导脚本例外；JSON-LD 是数据块不在此列）。`cms-theme-shared-render.test.ts` 以渲染结果锁定，
  CSP（`lib/html-security-headers.ts`）据此在全站恒定
- **交互写成岛**：浏览器端逻辑放 `packages/server/src/cms/islands/`（独立 `tsconfig.islands.json`，lib DOM，不进服务端 tsc），
  导出 `mount(el)` 并在 `registry.ts` 登记；主题只输出 `<el data-island="name" data-…>` 容器，页面级配置经 `SeoHead`
  的 `<meta name="cms-*">` 传递。岛只读 `data-*` / meta，找不到期望元素时**静默 no-op**（陈旧静态页会引用新脚本）
- **构建 HTML 用 `survey/dom.ts` 的 `h()`**，文本走 `textContent`、属性走 `setAttribute`；**禁止**字符串拼 HTML +
  手写转义写入 `innerHTML`（服务端返回的可信 SVG 除外）
- **接口约定**：会员 token 经 `islands/shared/member.ts` 读取；请求经 `shared/api.ts`（`apiJson` / `apiHeaders` / `isOk`）；
  展示给用户的文案取 `data.message`（信封 `message` 恒为 `'success'`），除非路由显式用 `okBody(null, 文案)`
- **测试**：每个岛配 `// @vitest-environment jsdom` 单测，用 `islands/test-utils.ts` 的 `stubFetch` / `flush` /
  `setMemberToken` / `html` 断言 DOM 行为与请求契约；不要再写 grep 主题源码的字符串断言
- **交付不需改**：`scripts/build-islands.mjs` 打包、`themes/islands-asset.ts` 指纹、`_assets/islands.{hash}.js` 路由已就位，
  新增岛只需上述四步；产物由 `npm run build` 生成、`npm run lint` 含 `tsc -p tsconfig.islands.json`