# CRUD 后端实现参考（Step 1-7）

后端主链路的代码模板，以「xxx管理」为范例。参考实现：
`packages/shared/src/identity/contracts/tenants.ts`（契约）、`packages/server/src/routes/identity/tenants.ts`（路由）、
`packages/server/src/db/schema/core.ts`（schema）。

约束条目见 [constraints.md](./constraints.md)，本文件不重复；条件性能力
（数据权限、多租户、审计 diff、附件、外呼 HTTP、懒加载、导出）见 [backend-patterns.md](./backend-patterns.md)。

---

## Step 1：数据库 Schema（`db/schema/{业务域}.ts`）

Schema 按业务域拆分（`core.ts` / `payment.ts` / `member.ts`…），由 `db/schema.ts` barrel 统一 re-export，
业务代码统一 `from '../../db/schema'` 导入。新表放入对应业务域文件（没有合适的就新建域文件并在 barrel 登记）；
`xxxRelations` 统一维护在 `db/schema/relations.ts`。

```ts
// ─── 枚举（新枚举需三端同步：pgEnum / TS union / Zod enum）───────────────
export const xxxStatusEnum = pgEnum('xxx_status', ['enabled', 'disabled']);
// 复用已有 statusEnum 时无需新建

// ─── 主表 ───────────────────────────────────────────────────────────────
// 列名由 casing: 'snake_case' 自动派生，不写显式列名（constraints.md → Schema 层）
// 通用列一律用 common.ts 的积木：idColumn / statusColumn / sortColumn / remarkColumn（租户归属用 core.ts 的 tenantIdColumn）
export const xxxs = pgTable('xxxs', {
  id:          idColumn(),
  name:        varchar({ length: 64 }).notNull(),
  description: text(),
  status:      statusColumn(),          // 启用 / 禁用，默认 enabled；statusColumn('disabled') 改默认
  sort:        sortColumn(),            // 排序值，默认 0
  remark:      remarkColumn(),          // varchar(256)；remarkColumn(500) 改长度，长文本用 text()
  // 可选外键用 set null，关联表用 cascade
  parentId:    integer().references(() => xxxs.id, { onDelete: 'set null' }),
  // 审计列：created_by / updated_by → users.id，由 db Proxy 自动写入
  ...auditColumns(),
  // 时间戳列：created_at 默认 now()，updated_at 自动刷新（timestamptz）；其它时刻列写 timestamptz()
  ...timestampColumns(),
});

// 主表总是导出这两个 infer 类型
export type XxxRow = typeof xxxs.$inferSelect;
export type NewXxx = typeof xxxs.$inferInsert;
```

Step 0 确认需要租户隔离时，才按 [backend-patterns.md → 多租户隔离](./backend-patterns.md#多租户隔离tenantscope)
添加 `tenantId: tenantIdColumn()`（随租户级联删除；平台级资源被删后需保留行时 `tenantIdColumn('set null')`）；基础模板不默认调用租户工具。

多对多联结表：

```ts
export const xxxYyys = pgTable('xxx_yyys', {
  xxxId: integer().notNull().references(() => xxxs.id, { onDelete: 'cascade' }),
  yyyId: integer().notNull().references(() => yyys.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.xxxId, t.yyyId] })]);
```

关联声明写在 `db/schema/relations.ts`，否则 `db.query.xxxs` 无法识别 `with:` 中的关联字段。

## Step 2：迁移

```bash
npm run db:generate && npm run db:migrate
```

## Step 3：共享 Zod Schema（`shared/src/{业务域}/validation.ts`）

```ts
import { partialForUpdate } from '../core/validation';

export const createXxxSchema = z.object({
  name:        z.string().min(1, '名称不能为空').max(64),
  description: z.string().max(256).optional(),
  // 会被其他域 z.enum() 引用的常量数组必须放 constants.ts，此处只做引用
  status:      z.enum(XXX_STATUSES).default('enabled'),
  parentId:    z.number().int().positive().nullable().optional(),
  yyyIds:      z.array(z.number().int()).default([]),   // 多对多
});

// 部分更新一律由 partialForUpdate 派生：剥离全部 .default() 后再 partial，字段省略即「保持不变」
// 有不可更改字段时 partialForUpdate(createXxxSchema.omit({ username: true }))
export const updateXxxSchema = partialForUpdate(createXxxSchema);

export type CreateXxxInput = z.infer<typeof createXxxSchema>;
export type UpdateXxxInput = z.infer<typeof updateXxxSchema>;
```

`.default()` 只属于创建语义；部分更新为何必须经 `partialForUpdate` 派生、全量替换 / upsert 端点的例外登记见
[constraints.md → Shared 层](./constraints.md#shared-层step-3-4)。特殊操作（如重置密码）单独建 schema。

## Step 4：共享契约（`shared/src/{业务域}/contracts/xxxs.ts`）

实体形状与全部操作在这里定义一次：server 路由、web hooks、MSW mock 与 OpenAPI 文档全部由它派生。
路径用 OpenAPI 风格 `{id}`；`response` 描述 `data` 载荷（`{ code, message, data }` 信封由传输层统一处理），
省略即 `z.null()`。

```ts
import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, dateRangeQuery, entityStatusQuery, idParam, keywordQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { XXX_STATUSES } from '../constants';
import { createXxxSchema, updateXxxSchema } from '../validation';

// ─── 实体：OpenAPI 元数据用 zod 原生 .meta()，id 即组件名 ──────────────────
export const xxxSchema = z.object({
  id: z.int(),
  name: z.string(),
  description: z.string().nullable().optional(),
  status: z.enum(XXX_STATUSES),
  // 关联冗余字段（JOIN 后附加，供前端直接展示）
  parentId: z.int().nullable().optional(),
  parentName: z.string().nullable().optional(),
  // 多对多关联
  yyyIds: z.array(z.int()).optional(),
  ...auditFieldsSchema,            // createdBy / updatedBy
  createdAt: z.string(),           // YYYY-MM-DD HH:mm:ss
  updatedAt: z.string(),
}).meta({ id: 'Xxx' });

export type Xxx = z.infer<typeof xxxSchema>;

// 下拉源精简项（启用 all 时）
export const xxxOptionSchema = xxxSchema.pick({ id: true, name: true, status: true }).meta({ id: 'XxxOption' });
export type XxxOption = z.infer<typeof xxxOptionSchema>;

// ─── 列表查询参数：分页 + 筛选。关键字用 keywordQuery（写人可读的匹配字段，派生 OpenAPI 描述与前端占位），
//     启用 / 禁用状态用 entityStatusQuery，其它枚举用 queryEnum（空串 = 全部；第二参数 { dict } 或 { options } 声明标签来源），
//     标准 startTime / endTime 范围用 ...dateRangeQuery('作用的时间字段')（非标准键名才逐个 dateRangeBound(desc, 'start' | 'end')）。
//     这些积木都写入 x-filter 语义（core/filter-meta.ts），前端 useListPage 的 filters() 据此派生筛选控件；
//     不导出 z.infer 类型——server 用 QueryOutputOf、web 用 QueryOf 从契约操作派生 ──
export const xxxListQuery = paginationQuery.extend({
  keyword: keywordQuery('名称 / 描述'),
  status: entityStatusQuery,
  type: queryEnum(XXX_TYPES, { description: '类型；空 = 全部', options: XXX_TYPE_OPTIONS }),
  ...dateRangeQuery('创建时间'),
});

// ─── 契约：键名即操作名（list / detail / create / update / remove 为标准 CRUD 约定）──
//     每个登录令牌操作都声明 access（权限码 / 'authenticated' / platformOnly），写操作声明 audit；
//     服务端路由据此自动装配门禁，前端按钮 / Mock / 文档 / 权限矩阵同源读取
export const xxxContract = defineContract('/api/xxxs', {
  list:   op.get('/', { access: { permission: 'system:xxx:list' }, query: xxxListQuery, response: paginated(xxxSchema), summary: 'XXX 列表' }),
  // all:  op.get('/all', { access: { permission: 'system:xxx:list' }, response: z.array(xxxOptionSchema), summary: '全部启用 XXX（供下拉框）' }),
  detail: op.get('/{id}', { access: { permission: 'system:xxx:list' }, params: idParam, response: xxxSchema, summary: 'XXX 详情' }),
  create: op.post('/', { access: { permission: 'system:xxx:create' }, audit: '创建XXX', body: createXxxSchema, response: xxxSchema, summary: '创建 XXX' }),
  update: op.put('/{id}', { access: { permission: 'system:xxx:update' }, audit: '更新XXX', params: idParam, body: updateXxxSchema, response: xxxSchema, summary: '更新 XXX' }),
  // removeBatch: op.delete('/batch', { access: { permission: 'system:xxx:delete' }, audit: '批量删除XXX', body: batchIdsBody, summary: '批量删除 XXX' }),
  remove: op.delete('/{id}', { access: { permission: 'system:xxx:delete' }, audit: '删除XXX', params: idParam, summary: '删除 XXX' }),
}, { tags: ['XXX管理'], auditModule: 'XXX管理' });
```

- `contracts/index.ts` 里 `export * from './xxxs'`；域 `index.ts` 已 `export * from './contracts'`
- 权限码先在 `shared/src/{业务域}/permissions.ts` 登记（见 [seed-config.md](./seed-config.md)），`access.permission` 只接受注册表里的码
- `access` 形态：`{ permission }`（数组 = 任一即可；`platformOnly: true` 始终平台超管 / `'multi-tenant'` 仅多租户模式）、
  `{ platformOnly: true }`（不看权限码）、`'authenticated'`（登录即可，归属 / 租户校验在 service）
- `audit`：字符串即 description；请求体含密码 / 密钥或响应含一次性凭证时用对象 `{ description, recordBody: false, recordResponseBody: false }`
- License 门控：契约组 `defaults.feature` 或 op 级 `feature`（`LicenseFeatureKey`）
- 非 JSON 响应：`kind: 'excel' | 'csv' | 'file' | 'sse'`（此时 `response` 忽略）；上传：`body: multipart(z.object({ file: fileField() }))`
- 公开接口：`public: true`；设备签名 / 开放网关鉴权的接口：`security: 'device-signature' | 'open-gateway'`；
  会员前台整组：`defineContract(..., { security: 'member-bearer' })`（这些操作不写 `access`，鉴权 / 验签由路由 `middleware` 完成）；额外文档说明：`description`
- 自定义路径参数：`params: z.object({ code: z.string().meta({ description: '编码', example: 'demo' }) })`
- 查询串积木：布尔 `queryBool(desc?, { labels? })`、枚举筛选 `queryEnum(XXX_VALUES, { dict | options })`、字典开放枚举 `dictQuery('字典编码')`、
  启用 / 禁用状态 `entityStatusQuery`（都把空串视为未传，handler 无需再 `|| undefined`）、关键字 `keywordQuery(fields?, { max? })`、
  关联 ID `idQuery()` / 必填切分维度 `requiredIdQuery()`；列表查询的每个筛选字段都要有 `x-filter` 语义。
  `entityStatusSchema` 只用于请求体 / 实体字段。积木的 `x-filter` 语义只描述参数是什么（匹配字段、标签来源、布尔文案），不放控件名
- 业务请求头（如幂等键）：`headers: z.object({ 'x-idempotency-key': z.string().min(8).max(128) })`，键为小写头名；
  服务端 `c.req.valid('header')`，客户端在输入的 `headers` 段提供；认证头不在契约声明

---

## Step 5：Service 层（`services/{业务域}/xxx.service.ts`）

标准资源默认用 **`defineCrudService`** 工厂：以契约为类型来源（列表入参 = `QueryOutputOf<contract.list>`，
创建 / 更新入参 = 契约 body 解析输出，返回实体 = 契约 `detail` 响应），把「取行断言 / 列表编排 / 插入 / 更新 / 删除 / 批量删除」
按同一套规则生成；资源只声明差异——筛选条件、行 → 实体映射、写入换算与业务钩子。

```ts
import { asc, eq } from 'drizzle-orm';
import { xxxContract, xxxSchema } from '@zenith/shared/{业务域}';
import { xxxs, type XxxRow } from '../../db/schema';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';
import { dateRangeConditions, keywordCondition } from '../../lib/where-helpers';

// ─── 行 → 契约实体：按 xxxSchema 的键投影（Date 自动格式化、undefined → null、多余列不泄漏），只写差异字段 ──
export const mapXxx = entityMapper(xxxSchema, (row: XxxRow) => ({
  secret: row.secretEncrypted ? '******' : null,   // 解密 / 脱敏 / 换算字段写在这里；纯投影的资源直接 entityMapper(xxxSchema)
}));

export const xxxService = defineCrudService(xxxContract, {
  table: xxxs,
  map: mapXxx,
  notFound: 'XXX 不存在',
  unique: 'XXX 名称已存在',                 // 唯一约束冲突 → 400；同表多个约束传 { message, byConstraint }
  tenant: true,                              // Step 0 确认租户隔离时：读写一律套 tenantScope，插入补 tenantId
  // scope: () => getDataScopeCondition(...), // 数据权限等更细的可见范围；与 tenant 叠加，对 detail / update / remove / list 全部生效
  list: (q) => ({
    where: [
      keywordCondition(q.keyword, [xxxs.name, xxxs.description]),   // 内部已 trim / 判空 / 转义
      q.status ? eq(xxxs.status, q.status) : undefined,             // 契约已收窄为枚举 | undefined
      ...dateRangeConditions(xxxs.createdAt, q.startTime, q.endTime),
    ],
    orderBy: [asc(xxxs.sort), asc(xxxs.id)],
  }),
  create: {
    before: async (input) => { await ensureYyyExists(input.yyyId); },   // 前置校验 / 引用存在性
    toRow: (input) => ({ ...input, secretEncrypted: encryptSecret(input.secret) }),
  },
  update: {
    toRow: (input, existing) => ({ ...input, secretEncrypted: mergeSecret(input.secret, existing.secretEncrypted) }),
    after: async (entity) => { invalidateXxxCache(entity.id); },       // 副作用：缓存失效 / 事件发布
  },
  remove: {
    before: async (row) => { if (row.isBuiltin) throw new HTTPException(400, { message: '内置 XXX 不可删除' }); },
  },
});

// 旧命名的别名：其它模块（导出中心 / 通知 / 其它域 Service）按函数名调用
export const { list: listXxxs, get: getXxx, ensure: ensureXxxExists, create: createXxx, update: updateXxx, remove: deleteXxx, removeMany: deleteXxxs } = xxxService;
```

- **适用判据**：钩子每个操作 ≤ 2 个、无跨表事务、无自定义响应形状。不满足的资源写显式 Service（下文 RQB / 事务小节），
  **不许**把事务塞进钩子；部分满足时工厂只接标准操作，自定义操作（启停 / 排序 / 导出…）另写函数。
- **可见范围只声明一次**：`tenant` / `scope` 对 detail / update / remove / removeMany / list 全部生效，
  结构上杜绝「列表套了租户、详情没套」的漏洞；工厂返回的 `scope()` / `whereId(id)` 供同模块自定义查询复用。
- 契约入参类型不手写：`QueryOutputOf<typeof xxxContract.list>` 是解析后输出（page / pageSize 必填、枚举已收窄）。
- 显式 Service 里的列表：单表全行用 `listRows({ page, pageSize, table, where, orderBy, map })`，
  带 join / 投影 / 聚合的用 `buildListResult({ count, rows, map })`，可见范围为空的短路用 `emptyListResult(page, pageSize)`；
  行映射同样用 `pickEntity(xxxSchema, row, overrides)` / `entityMapper`，不再逐字段 `row.x ?? null`。

命名约定：数据映射 `mapXxx`，前置校验 `ensureXxxExists`，列表 `listXxxs`，删除 `deleteXxx` / `deleteXxxs`。

### 关联查询优先用 RQB

```ts
// ✅ 详情：RQB 自动处理 LEFT JOIN，columns 限定取值范围
const row = await db.query.xxxs.findFirst({
  where: await buildXxxWhere({ id }),
  with: { createdByUser: { columns: { nickname: true } } },
});

// ✅ 分页列表 + 多层关联：一次拉全，不要先查主表再手工拼装 getXxxMap()
const rows = await db.query.users.findMany({
  where,
  with: {
    department:    { columns: { name: true } },
    userRoles:     { columns: {}, with: { role: true } },
    userPositions: { columns: {}, with: { position: true } },
  },
  orderBy: users.id,
  limit: pageSize,
  offset: pageOffset(page, pageSize),
});

// ❌ 手写 LEFT JOIN 仅在跨表 WHERE 过滤或聚合计数时才需要
```

### 事务与多对多写入

replace 模式（先删后插）的原子性要求见 [constraints.md → Service 层](./constraints.md#service-层step-5)；
辅助函数接受 `executor` 参数，事务内外统一调用。

```ts
import type { DbExecutor } from '../../db/types';

/** 先删后插，原子性更新 xxx 的 yyy 关联 */
async function setXxxYyys(executor: DbExecutor, xxxId: number, yyyIds: number[]): Promise<void> {
  await executor.delete(xxxYyys).where(eq(xxxYyys.xxxId, xxxId));
  if (yyyIds.length > 0) {
    await executor.insert(xxxYyys).values(yyyIds.map((yyyId) => ({ xxxId, yyyId })));
  }
}

// 创建：主表写入与关联写入同一事务
const row = await db.transaction(async (tx) => {
  const [created] = await tx.insert(xxxs).values(data).returning();
  await setXxxYyys(tx, created.id, data.yyyIds ?? []);
  return created;
});

// 更新：updateXxxSchema 经 partialForUpdate 派生，yyyIds 省略即 undefined，表示不改动关联
const updated = await db.transaction(async (tx) => {
  const { yyyIds, ...columns } = data;
  const [row] = await tx.update(xxxs).set(columns).where(eq(xxxs.id, id)).returning();
  if (yyyIds !== undefined) await setXxxYyys(tx, id, yyyIds);
  return row;
});

// 独立的「分配关联」接口（不改主表）：集合字段必填，同样用事务保证 delete+insert 原子
await db.transaction(async (tx) => {
  await setXxxYyys(tx, id, data.yyyIds);
});
```

外键存在性校验：

```ts
async function ensureYyyExists(yyyId: number | null | undefined): Promise<void> {
  if (!yyyId) return;
  const [row] = await db.select({ id: yyys.id }).from(yyys).where(eq(yyys.id, yyyId));
  if (!row) throw new HTTPException(400, { message: `指定的 YYY（id=${yyyId}）不存在` });
}
```

---

## Step 6：路由（`routes/{业务域}/xxx.ts`）

权限与审计已在契约 `access` / `audit` 上声明，`defineContractRoute` 自动装配门禁；标准操作由 **`mountCrud`** 按契约派生：
更新 / 删除前统一以契约实体做审计快照，`DELETE /batch` 自动先于 `/{id}` 注册。
非标准操作继续 `defineContractRoute`，与派生路由一起交给 `mountCrud`（静态路径自动排在同方法的参数路径之前）。

```ts
import { OpenAPIHono } from '@hono/zod-openapi';
import { xxxContract } from '@zenith/shared/{业务域}';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listAllXxxs, xxxService } from '../../services/{业务域}/xxx.service';
import { mountCrud } from '../_crud';

// 不使用 <AuthEnv> 泛型，不添加全局 use('*', authMiddleware)
const xxxRouter = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(xxxRouter, xxxContract, xxxService, {
  // 权限 / 审计文案来自契约；这里只放派生路由的差异项
  // messages: { create: '已新增' },       // 成功提示覆盖；缺省 创建成功 / 更新成功 / 删除成功 / 批量删除成功
  // responses: { remove: conflictResponse }, // 契约之外的额外响应
  // exclude: ['update'],                  // 需要自定义 handler 的标准操作：排除后在 extra 里显式书写
}, [
  // 契约启用 all 时：下拉源复用列表的访问边界（Service 里 listAllXxxs 用 xxxService.scope()）
  defineContractRoute(xxxContract.all, {
    handler: async (c) => c.json(okBody(await listAllXxxs()), 200),
  }),
  // 认证前的限流 / IP 校验放 preAuth；认证后追加的幂等 / 限流放 middleware；路由文件里不出现 authMiddleware / guard
  // defineContractRoute(xxxContract.export, { preAuth: [sensitiveRateLimit], handler: … }),
]);

export default xxxRouter;
```

- 服务侧既可传 `defineCrudService` 的产物，也可传显式函数包 `{ list, get, create, update, remove, removeMany, snapshot }`
  （显式 Service 的资源）；返回类型**逐操作**对照契约响应检查——列表行可以是精简 schema、`detail` 返回扩展实体
  （`paginated(xxxSchema)` + `xxxDetailSchema`）、`create` 返回专用结果都能直接派生；缺函数在模块加载期报错而不是运行时 500。
- 服务函数需要请求上下文（当前用户 / 闭包参数）时在 bag 里绑定：`{ list: () => listMine(currentUser().userId), remove: (id) => removeOne(id, domain) }`；
  无 query 的「我的 xxx」列表同样可派生。整组路由需要额外中间件（平台侧限定等）用 `middleware: [platformHostOnly]`。
- 写操作不需要成功提示（对话式创建等）传 `messages: { create: null }`。
- 契约上有标准操作却仍显式书写的，须在 `exclude` 里给出，并在 `routes/_crud-explicit.ts` 登记「文件 → 契约 → 操作 → 理由」；
  `crud-coverage.test.ts` 守住两条：未登记的显式块直接失败，已派生的块必须从登记表删除（表只准缩小）。
- 权限码必须先在 `packages/shared/src/{业务域}/permissions.ts` 注册（种子按钮由此生成；`permission-audit` / `contract-access` 测试对账契约 `access` ↔ 注册表 ↔ 种子）。

## Step 7：注册路由（`routes/{业务域}/index.ts`）

各业务域 barrel 声明挂载清单，挂载路径取契约的 `basePath`；`routes/index.ts` 只声明域顺序。

```ts
import { xxxContract } from '@zenith/shared/{业务域}';
import { defineRouteDomain } from '../_kit';
import xxxRoutes from './xxx';                 // ← 新增 import

export default defineRouteDomain({
  name: '{业务域}',
  mounts: () => [
    // …既有挂载保持原样
    [xxxContract.basePath, xxxRoutes],         // ← 新增挂载
  ],
});
```

- **数组顺序即挂载顺序**：同一路径被多次挂载时顺序是语义的一部分，不要改动既有条目的相对位置
- WS 路由需要 `upgradeWebSocket` 时，把 `mounts` 写成 `(ctx) => [...]`，用 `ctx.upgradeWebSocket`
- 需要在**全部** API 路由之后兜底的挂载（如按 Host 匹配的 `/`）必须放进 `fallback` 而不是 `mounts` 末尾
- 新增业务域：建 `routes/{业务域}/index.ts`，再加进 `routes/index.ts` 的 `ROUTE_DOMAINS`

OpenAPI spec 无需手工维护，由各契约操作自动汇总到 `/api/openapi.json`（组件名取实体 schema 的 `.meta({ id })`）。
挂载后执行 `npm run dev:server`，刷新 <http://localhost:3300/api/docs> 确认新接口出现。
