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
// 列名由 drizzle 的 casing: 'snake_case' 自动派生（key 驼峰 → 蛇形），不写显式列名；
// 仅当派生结果与目标列名不一致时（如 wechatApiV3Key → wechat_api_v3_key 的边界情形）才显式指定。
export const xxxs = pgTable('xxxs', {
  id:          integer().primaryKey().generatedAlwaysAsIdentity(),
  name:        varchar({ length: 64 }).notNull(),
  description: text(),
  status:      statusEnum().notNull().default('enabled'),
  // 可选外键用 set null，关联表用 cascade
  parentId:    integer().references(() => xxxs.id, { onDelete: 'set null' }),
  // 审计列：created_by / updated_by → users.id，由 db Proxy 自动写入
  ...auditColumns(),
  createdAt:   timestamp().defaultNow().notNull(),
  updatedAt:   timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});

// 主表总是导出这两个 infer 类型
export type XxxRow = typeof xxxs.$inferSelect;
export type NewXxx = typeof xxxs.$inferInsert;
```

唯一约束命名：驼峰多词列（`orderNo` 等）必须显式蛇形命名——列级 `.unique('xxxs_order_no_unique')`、
表级 `unique('xxxs_tenant_code_unique').on(t.tenantId, t.code)`；单词列（`code` / `name`）裸 `.unique()` 即可。

Step 0 确认需要租户隔离时，才按 [backend-patterns.md → 多租户隔离](./backend-patterns.md#多租户隔离tenantscope)
添加 `tenantId`；基础模板不默认调用租户工具。

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

`.default()` 只属于创建语义。禁止直接调用 `.partial()`（ESLint 封禁）：Zod 的 `.partial()` 保留 `.default()`，
字段省略时会填入默认值并被服务层 `.set({ ...data })` 写库。全量替换 / upsert 端点（如整体保存的配置表单、
按 key 覆盖的授权记录）可以带默认值，但必须在 `app.contract.test.ts` 的整体替换例外清单登记理由。

特殊操作（如重置密码）单独建 schema。

## Step 4：共享契约（`shared/src/{业务域}/contracts/xxxs.ts`）

实体形状与全部操作在这里定义一次：server 路由、web hooks、MSW mock 与 OpenAPI 文档全部由它派生。
路径用 OpenAPI 风格 `{id}`；`response` 描述 `data` 载荷（`{ code, message, data }` 信封由传输层统一处理），
省略即 `z.null()`。

```ts
import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
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

// ─── 列表查询参数：分页 + 筛选；范围端点必须用 dateRangeBound ────────────
export const xxxListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  status: z.enum(XXX_STATUSES).optional(),
  startTime: dateRangeBound('创建时间起'),
  endTime: dateRangeBound('创建时间止'),
});

// ─── 契约：键名即操作名（list / detail / create / update / remove 为标准 CRUD 约定）──
export const xxxContract = defineContract('/api/xxxs', {
  list:   op.get('/', { query: xxxListQuery, response: paginated(xxxSchema), summary: 'XXX 列表' }),
  // all:  op.get('/all', { response: z.array(xxxOptionSchema), summary: '全部启用 XXX（供下拉框）' }),
  detail: op.get('/{id}', { params: idParam, response: xxxSchema, summary: 'XXX 详情' }),
  create: op.post('/', { body: createXxxSchema, response: xxxSchema, summary: '创建 XXX' }),
  update: op.put('/{id}', { params: idParam, body: updateXxxSchema, response: xxxSchema, summary: '更新 XXX' }),
  // removeBatch: op.delete('/batch', { body: batchIdsBody, summary: '批量删除 XXX' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除 XXX' }),
}, { tags: ['XXX管理'] });
```

- `contracts/index.ts` 里 `export * from './xxxs'`；域 `index.ts` 已 `export * from './contracts'`
- 非 JSON 响应：`kind: 'excel' | 'csv' | 'file' | 'sse'`（此时 `response` 忽略）；上传：`body: multipart(z.object({ file: fileField() }))`
- 公开接口：`public: true`；设备签名 / 开放网关鉴权的接口：`security: 'device-signature' | 'open-gateway'`
  （默认 Bearer 登录令牌；凭证校验仍由 `middleware` 完成）；额外文档说明：`description`
- 自定义路径参数：`params: z.object({ code: z.string().meta({ description: '编码', example: 'demo' }) })`
- 业务请求头（如幂等键）：`headers: z.object({ 'x-idempotency-key': z.string().min(8).max(128) })`，键为小写头名；
  服务端 `c.req.valid('header')`，客户端在输入的 `headers` 段提供；认证头不在契约声明

---

## Step 5：Service 层（`services/{业务域}/xxx.service.ts`）

```ts
import { HTTPException } from 'hono/http-exception';
import { eq, asc } from 'drizzle-orm';
import { db } from '../../db';
import { xxxs, type XxxRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';

// ─── 数据映射（DB 行 → 公开字段），纯函数、无副作用 ──────────────────────
export function mapXxx(row: XxxRow) {
  return {
    id:          row.id,
    name:        row.name,
    description: row.description ?? null,
    status:      row.status,
    createdBy:   row.createdBy ?? null,
    updatedBy:   row.updatedBy ?? null,
    createdAt:   formatDateTime(row.createdAt),
    updatedAt:   formatDateTime(row.updatedAt),
  };
}

export interface ListXxxsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: XxxStatus;
  startTime?: string;
  endTime?: string;
}

interface XxxWhereInput extends ListXxxsQuery {
  id?: number;
}

// 所有读取入口共用；Step 0 启用 dataScope / tenantScope 时也把访问条件集中加在这里
async function buildXxxWhere(q: XxxWhereInput) {
  return buildWhere(
    q.id !== undefined ? eq(xxxs.id, q.id) : undefined,
    // 内部已 trim、判空并转义，调用点不要再包 if (q.keyword)
    keywordCondition(q.keyword, [xxxs.name, xxxs.description]),
    q.status ? eq(xxxs.status, q.status) : undefined,
    // 终点自动取当天 23:59:59.999，不会漏掉当天数据
    ...dateRangeConditions(xxxs.createdAt, q.startTime, q.endTime),
  );
}

export async function listXxxs(q: ListXxxsQuery) {
  const { page = 1, pageSize = 10 } = q;
  const where = await buildXxxWhere(q);

  // count 与 list 相互独立，必须并行
  const [total, rows] = await Promise.all([
    db.$count(xxxs, where),
    withPagination(
      db.select().from(xxxs).where(where).orderBy(asc(xxxs.id)).$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return { list: rows.map(mapXxx), total, page, pageSize };
}

export async function getXxx(id: number) {
  return mapXxx(await ensureXxxExists(id));
}

// ─── 前置校验：直接抛 HTTPException，由全局 onError 转标准 JSON ───────────
export async function ensureXxxExists(id: number) {
  const [row] = await db.select().from(xxxs).where(await buildXxxWhere({ id })).limit(1);
  if (!row) throw new HTTPException(404, { message: 'XXX 不存在' });
  return row;
}
```

更新与删除也使用 `await buildXxxWhere({ id })`；route 的前置校验不替代 service 行级隔离。

命名约定：数据映射函数 `mapXxx` 前缀，前置校验函数 `ensureXxx` 前缀。

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

先 delete 再 insert 的 replace 模式若 insert 失败会丢数据，必须保证原子性；
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

路由文件只提供 `middleware` 与 `handler`；方法、路径、入参校验、响应 schema、security、tags 与
`commonErrorResponses` 全部由 `defineContractRoute` 从契约推导。`c.req.valid('param' | 'query' | 'json')`
与 `c.json(okBody(...), 200)` 都按契约类型检查。

```ts
import { OpenAPIHono } from '@hono/zod-openapi';
import { xxxContract } from '@zenith/shared/{业务域}';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody, errBody, conflictResponse } from '../../lib/openapi-schemas';
import { listXxxs, getXxx, createXxx, updateXxx, deleteXxx, ensureXxxExists } from '../../services/{业务域}/xxx.service';

// 不使用 <AuthEnv> 泛型，不添加全局 use('*', authMiddleware)
const xxxRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:xxx:list' })] as const;

const listRoute = defineContractRoute(xxxContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listXxxs(c.req.valid('query'))), 200),
});

const detailRoute = defineContractRoute(xxxContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getXxx(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(xxxContract.create, {
  middleware: [authMiddleware, guard({ permission: 'system:xxx:create', audit: { description: '创建 XXX', module: 'XXX管理' } })],
  handler: async (c) => c.json(okBody(await createXxx(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(xxxContract.update, {
  middleware: [authMiddleware, guard({ permission: 'system:xxx:update', audit: { description: '更新 XXX', module: 'XXX管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureXxxExists(id));   // 不存在时抛 HTTPException(404)；操作日志 diff 的变更前快照
    return c.json(okBody(await updateXxx(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(xxxContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'system:xxx:delete', audit: { description: '删除 XXX', module: 'XXX管理' } })],
  // 契约之外的额外响应（如删除冲突）经 responses 追加
  responses: conflictResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureXxxExists(id));
    await deleteXxx(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// 路由注册与 export 见下方「最终注册顺序」
```

### 下拉源（契约启用 `all` 时）

先在 service 添加：

```ts
export async function listAllXxxs() {
  // 必须复用列表的访问边界；否则 /all 会绕过 dataScope / tenantScope
  const where = await buildXxxWhere({ status: 'enabled' });
  return db.select({ id: xxxs.id, name: xxxs.name, status: xxxs.status }).from(xxxs).where(where).orderBy(asc(xxxs.id));
}
```

再添加路由：

```ts
const allRoute = defineContractRoute(xxxContract.all, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listAllXxxs()), 200),
});
```

若 Step 0 未确认需要下拉源，契约中不声明 `all`；启用 Demo 模式时 Mock 用同一契约操作实现。

### 批量删除（契约启用 `removeBatch` 时）

仅用于用户已选中、可在正常 HTTP 请求窗口内快速完成的有界操作。
大数据量、长耗时或需要进度 / 重试 / 取消的批处理改用[任务中心](./async-tasks.md)。
`DELETE /batch` 必须注册在 `DELETE /{id}` **之前**，否则 `/batch` 被匹配为 `id = "batch"`。

先在 service 添加同样受行级权限约束的批量删除（并从 `drizzle-orm` 导入 `inArray`）：

```ts
export async function deleteXxxs(ids: number[]) {
  const where = buildWhere(
    inArray(xxxs.id, ids),
    await buildXxxWhere({}),   // 复用 dataScope / tenantScope
  );
  const deleted = await db.delete(xxxs).where(where).returning({ id: xxxs.id });
  return deleted.length;
}
```

路由：

```ts
const batchDeleteRoute = defineContractRoute(xxxContract.removeBatch, {
  middleware: [authMiddleware, guard({ permission: 'system:xxx:delete', audit: { description: '批量删除 XXX', module: 'XXX管理' } })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    if (!ids.length) return c.json(errBody('请选择要删除的记录'), 400);
    const deleted = await deleteXxxs(ids);
    return c.json(okBody(null, `已删除 ${deleted} 条记录`), 200);
  },
});
```

### 最终注册顺序

路由文件只调用**一次** `openapiRoutes()`，放在 `export default` 之前；按实际启用项取消注释：

```ts
xxxRouter.openapiRoutes([
  listRoute,
  // allRoute,             // 启用 all 时；静态 /all 早于动态 /{id}
  // batchDeleteRoute,     // 启用 removeBatch 时；静态 /batch 早于动态 /{id}
  detailRoute,
  createRouteDef,
  updateRouteDef,
  deleteRouteDef,
] as const);

export default xxxRouter;
```

---

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
