# CRUD 后端实现参考（以「用户管理」为范例）

本文档提供后端各层的代码模板，对照 `packages/server/src/routes/users.ts` 和 `packages/server/src/db/schema.ts` 的实际实现。

---

## Step 1：数据库 Schema（`packages/server/src/db/schema.ts`）

### 基础表模板

```ts
// ─── 枚举（如有新枚举，三端必须同步：pgEnum / TS union / Zod enum）───
export const xxxStatusEnum = pgEnum('xxx_status', ['active', 'disabled']);
// 如果复用已有 statusEnum，则无需新建

// ─── 主表 ───────────────────────────────────────────────────────────────
export const xxxs = pgTable('xxxs', {
  id:          serial('id').primaryKey(),
  name:        varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  // 枚举字段（使用已有 status 枚举时）：
  status:      statusEnum('status').notNull().default('active'),
  // 外键（FK 字段 + onDelete 策略）：
  parentId:    integer('parent_id').references(() => xxxs.id, { onDelete: 'set null' }),
  // 时间戳：
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

// ─── 类型导出 ────────────────────────────────────────────────────────────
export type XxxRow = typeof xxxs.$inferSelect;
export type NewXxx = typeof xxxs.$inferInsert;
```

### 多对多关联表模板

```ts
// 如需多对多（如 User ↔ Role）：
export const xxxYyys = pgTable('xxx_yyys', {
  xxxId: integer('xxx_id').notNull().references(() => xxxs.id, { onDelete: 'cascade' }),
  yyyId: integer('yyy_id').notNull().references(() => yyys.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.xxxId, t.yyyId] })]);
```

> **要点**：
>
> - 主表总是导出 `XxxRow` 和 `NewXxx` 两个 infer 类型
> - 枚举值在 `pgEnum`、TypeScript union type、Zod enum 三处必须完全一致
> - `onDelete: 'cascade'` 用于关联表，`'set null'` 用于可选外键列

---

## Step 3：共享 Zod Schema（`packages/shared/src/validation.ts`）

```ts
// ─── 创建 Schema ─────────────────────────────────────────────────────────
export const createXxxSchema = z.object({
  name:        z.string().min(1, '名称不能为空').max(64),
  description: z.string().max(256).optional(),
  status:      z.enum(['active', 'disabled']).default('active'),
  // 外键引用（可选）：
  parentId:    z.number().int().positive().nullable().optional(),
  // 多对多（如 role IDs）：
  yyyIds:      z.array(z.number().int()).default([]),
});

// ─── 更新 Schema（partial，不含不可改字段）───────────────────────────────
export const updateXxxSchema = createXxxSchema.partial();

// ─── 类型导出 ────────────────────────────────────────────────────────────
export type CreateXxxInput = z.infer<typeof createXxxSchema>;
export type UpdateXxxInput = z.infer<typeof updateXxxSchema>;
```

> **要点**：
>
> - `updateXxxSchema = createXxxSchema.partial()` 是标准模式
> - 若有不可更改字段（如 `username`），用 `.omit({ username: true })`
> - 特殊操作（如重置密码）单独建 schema

---

## Step 4：共享 TypeScript Interface（`packages/shared/src/types.ts`）

```ts
export interface Xxx {
  id: number;
  name: string;
  description?: string;
  status: 'active' | 'disabled';
  // 关联冗余字段（JOIN 后附加，供前端直接展示）：
  parentId?: number | null;
  parentName?: string | null;
  // 关联实体嵌套（多对多时）：
  yyys?: Yyy[];
  yyyIds?: number[];
  // 时间字段序列化为字符串（ISO 格式）：
  createdAt: string;
  updatedAt: string;
}
```

---

## Step 5：OpenAPIHono Router（`packages/server/src/routes/xxx.ts`）

> **必读：实体 DTO 必须集中在 `packages/server/src/lib/dtos/` 子目录中（按业务域拆分：`iam` / `auth` / `dict` / `files` / `logs` / `notices` / `system` / `workflow` / `dashboard` / `region` / `messages`）。** 新增实体时先在对应子文件中添加：
>
> ```typescript
> export const XxxDTO = z
>   .object({
>     id: z.number().int(),
>     name: z.string(),
>     description: z.string().nullable().optional(),
>     status: z.enum(['active', 'disabled']),
>     createdAt: z.string(),
>     updatedAt: z.string(),
>   })
>   .openapi('Xxx');
> ```
>
> 然后在路由中导入：`import { XxxDTO } from '../lib/openapi-dtos';`。**严禁在路由文件内本地声明带 `.openapi('EntityName')` 的实体 DTO**，以免 Swagger Components 重复/冲突。

```ts
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { and, eq, like, gte, lte } from 'drizzle-orm';
import { db } from '../db/index';
import { pageOffset } from '../lib/pagination';
import { xxxs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  ErrorResponse, jsonContent,
  PaginationQuery, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, BatchIdsBody,
} from '../lib/openapi-schemas';
// 实体 DTO 必须从中心仓库导入（严禁路由内本地声明 .openapi('EntityName')）
import { XxxDTO } from '../lib/openapi-dtos';
// 可直接从 @zenith/shared 导入（shared 已升级至 Zod v4）
// import { createXxxSchema, updateXxxSchema } from '@zenith/shared';

// 不使用 <AuthEnv> 泛型，不添加全局 use('*', authMiddleware)
const xxxRouter = new OpenAPIHono({ defaultHook: validationHook });

// 若 @zenith/shared 中的 schema 不满足需求（如需 coerce），可在本地声明
const createXxxSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(256).optional(),
  status: z.enum(['active', 'disabled']).default('active'),
});
const updateXxxSchema = createXxxSchema.partial();

// ─── GET / — 分页列表 ────────────────────────────────────────────────────
const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['XXX管理'], summary: 'XXX列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:xxx:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['active', 'disabled']).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: {
      ...commonErrorResponses,
      ...okPaginated(XxxDTO, 'ok'),
    },
  }),
  handler: async (c) => {
    const { page = 1, pageSize = 10, keyword, status, startTime, endTime } = c.req.valid('query');
    const conditions = [];
    if (keyword) conditions.push(like(xxxs.name, `%${keyword}%`));
    if (status)    conditions.push(eq(xxxs.status, status));
    if (startTime) conditions.push(gte(xxxs.createdAt, new Date(startTime)));
    if (endTime)   conditions.push(lte(xxxs.createdAt, new Date(endTime)));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [total, rows] = await Promise.all([
      db.$count(xxxs, where),
      db.select().from(xxxs).where(where)
        .limit(pageSize).offset(pageOffset(page, pageSize)).orderBy(xxxs.id),
    ]);
    return c.json({ code: 0 as const, message: 'ok', data: { list: rows, total, page, pageSize } }, 200);
  },
});

// ─── POST / — 创建 ────────────────────────────────────────────────────────
const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['XXX管理'], summary: '创建 XXX',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:xxx:create', audit: { description: '创建 XXX', module: 'XXX管理' } })] as const,
    request: { body: { content: jsonContent(createXxxSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(XxxDTO, '创建成功'),
    },
  }),
  handler: async (c) => {
    const data = c.req.valid('json');
    try {
      const [row] = await db.insert(xxxs).values(data).returning();
      return c.json({ code: 0 as const, message: '创建成功', data: row }, 200);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        return c.json({ code: 400, message: '该名称已存在', data: null }, 400);
      }
      throw err;
    }
  },
});

// ─── PUT /{id} — 更新 ────────────────────────────────────────────────────
const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['XXX管理'], summary: '更新 XXX',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:xxx:update', audit: { description: '更新 XXX', module: 'XXX管理' } })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(updateXxxSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(XxxDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const [before] = await db.select().from(xxxs).where(eq(xxxs.id, id)).limit(1);
    if (before) setAuditBeforeData(c, before);
    const [row] = await db.update(xxxs).set({ ...data }).where(eq(xxxs.id, id)).returning();
    if (!row) return c.json({ code: 404, message: 'XXX不存在', data: null }, 404);
    return c.json({ code: 0 as const, message: '更新成功', data: row }, 200);
  },
});

// ─── DELETE /{id} — 删除 ──────────────────────────────────────────────────
const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['XXX管理'], summary: '删除 XXX',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:xxx:delete', audit: { description: '删除 XXX', module: 'XXX管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const [before] = await db.select().from(xxxs).where(eq(xxxs.id, id)).limit(1);
    if (before) setAuditBeforeData(c, before);
    const [deleted] = await db.delete(xxxs).where(eq(xxxs.id, id)).returning();
    if (!deleted) return c.json({ code: 404, message: 'XXX不存在', data: null }, 404);
    return c.json({ code: 0 as const, message: '删除成功', data: null }, 200);
  },
});

// 统一注册所有路由（必须在 export 之前）
xxxRouter.openapiRoutes([listRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default xxxRouter;
```

---

## 关联查询：优先使用 RQB（`db.query.*`）

当路由需要读取关联数据时（如「创建者昵称」「所属部门名称」），优先使用 Drizzle RQB 而非手写 JOIN：

```ts
// ✅ 推荐：RQB 自动处理 LEFT JOIN
const row = await db.query.xxxs.findFirst({
  where: eq(xxxs.id, id),
  with: {
    createdByUser: { columns: { nickname: true } },  // 只取 nickname
  },
});
// 使用：row?.createdByUser?.nickname

// ✅ 推荐：分页列表 + 关联
const rows = await db.query.xxxs.findMany({
  where,
  with: { parent: { columns: { name: true } } },
  orderBy: desc(xxxs.id),
  limit: pageSize,
  offset: pageOffset(page, pageSize),
});

// ❌ 避免：手写 LEFT JOIN（仅在跨表 WHERE 过滤或聚合计数时才需要）
db.select({ xxx: xxxs, parentName: parents.name })
  .from(xxxs)
  .leftJoin(parents, eq(xxxs.parentId, parents.id))
  .where(where);
```

> **注意**：新增表后须在 `schema.ts` 末尾补充 `xxxRelations`，否则 `db.query.xxx` 无法识别关联字段。

---

## Step 6：注册路由（`packages/server/src/index.ts`）

在现有路由注册区域添加：

```ts
import xxxRoutes from './routes/xxx';

// 在其他 app.route() 的同级位置添加：
app.route('/api/xxxs', xxxRoutes);
```

---

## Guard 中间件说明

```ts
// 权限检查（超管自动跳过）
guard({ permission: 'system:xxx:list' })

// 权限检查 + 自动写入 operation_logs
guard({
  permission: 'system:xxx:create',
  audit: {
    description: '创建XXX',   // 操作描述，显示在操作日志中
    module: 'XXX管理',         // 所属模块
    // recordBody: false,      // 上传文件等场景不记录请求体
  },
})
```

---

## 多对多关联帮助函数模板

> **必须使用事务**：先 delete 再 insert 的 replace 模式，若 insert 失败会丢失数据，必须保证原子性。
> 辅助函数接受 executor 参数，可在事务内外统一调用。

```ts
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 先删后插，原子性更新 xxx 的 yyy 关联（调用方需传入 tx 或 db） */
async function setXxxYyys(executor: DbTransaction | typeof db, xxxId: number, yyyIds: number[]): Promise<void> {
  await executor.delete(xxxYyys).where(eq(xxxYyys.xxxId, xxxId));
  if (yyyIds.length > 0) {
    await executor.insert(xxxYyys).values(yyyIds.map((yyyId) => ({ xxxId, yyyId })));
  }
}

// 在创建接口中：将主表写入与关联写入放在同一事务
const row = await db.transaction(async (tx) => {
  const [created] = await tx.insert(xxxs).values(data).returning();
  await setXxxYyys(tx, created.id, data.yyyIds ?? []);
  return created;
});

// 在独立的「分配关联」接口中（无需改主表）：同样用事务确保 delete+insert 原子
await db.transaction(async (tx) => {
  await setXxxYyys(tx, id, data.yyyIds);
});
```

## 外键引用校验帮助函数模板

```ts
/** 校验 yyyId 是否存在，返回错误消息字符串或 null */
async function ensureYyyExists(yyyId: number | null | undefined): Promise<string | null> {
  if (!yyyId) return null;
  const [row] = await db.select({ id: yyys.id }).from(yyys).where(eq(yyys.id, yyyId));
  return row ? null : `指定的 YYY（id=${yyyId}）不存在`;
}
```

---

## 操作日志数据变更 Diff（为路由添加修改前/后快照）

Zenith Admin 的操作日志支持记录**操作前/后的实体快照**，在日志详情弹窗中以表格 diff 形式展示变更字段（高亮差异行）。

### 架构说明

| 层 | 文件 | 职责 |
| --- | --- | --- |
| DB | `operation_logs.before_data` / `after_data` | 存储 JSON 快照字符串（`text` 类型） |
| 中间件 | `packages/server/src/middleware/guard.ts` | 自动从响应体提取 `afterData`；提供 `setAuditBeforeData()` 供路由注入 `beforeData` |
| 路由 | 需要 diff 的 PUT/DELETE 路由 | 在处理前查询实体，调用 `setAuditBeforeData(c, entityRow)` |
| 前端 | `OperationLogsPage.tsx → DiffTable` | 解析 JSON、比对字段、高亮变更行（无需额外修改） |

### 为新路由添加 diff

1. 导入 `setAuditBeforeData`：

```ts
import { guard, setAuditBeforeData } from '../middleware/guard';
```

1. 在 PUT / DELETE handler 中，验证通过后、执行写操作**前**，查询并注入操作前快照：

```ts
// 操作前快照（如有敏感字段需先排除，如 password）
const [before] = await db.select().from(xxxs).where(eq(xxxs.id, id)).limit(1);
if (before) {
  const { sensitiveField: _sf, ...safeBefore } = before as any;
  setAuditBeforeData(c, safeBefore);
}
```

1. `guard` 中间件自动：
   - 在 `next()` 后从 `{ code: 0, data: ... }` 响应体提取 `afterData`
   - 将 `beforeData` + `afterData` 一并写入 `operation_logs`

> **注意**：DELETE 操作的 `afterData` 通常为 null（响应 `data` 为 null），是预期行为，前端 diff 会仅展示变更前列。

## 更新 OpenAPI Spec

无需手动维护。`@hono/zod-openapi` 会从每个 `createRoute(...)` 自动汇总到 `/api/openapi.json`。

新路由通过 `app.route()` 注册后，刷新 [`http://localhost:3300/api/docs`](http://localhost:3300/api/docs) 即可看到新接口。

> **要点**：每个路由的 `createRoute()` 里的 `tags` 字段就是 Swagger UI 中的分组标签，无需在任何地方另外注册。

---

## 数据权限过滤（dataScope）

> 仅业务数据模块需要；配置数据（角色/菜单/字典）无需过滤。

### 前提：业务表必须有 `department_id` 字段

```ts
// packages/server/src/db/schema.ts
export const xxxs = pgTable('xxxs', {
  // ...其他字段
  departmentId: integer('department_id').references(() => departments.id),
});
```

> **设计原则**：`department_id` 在创建时从创建人部门写入，之后不跟随人员调岗变动。过滤逻辑是 `WHERE data.department_id IN (我的部门及子部门)`，而非反查创建人当前部门。

### 列表接口中追加 scopeCondition

```ts
import { getDataScopeCondition } from '../lib/data-scope';

// ⚠️ 需要 AuthEnv 泛型以正确推断 c.get('user') 类型
const xxxRouter = new OpenAPIHono<AuthEnv>({ defaultHook: validationHook });

// 在 GET / 列表 handler 中：
const currentUserId = c.get('user').userId;
const scopeCondition = await getDataScopeCondition({
  currentUserId,
  deptColumn: xxxs.departmentId,  // 目标表的 department_id 列
  ownerColumn: xxxs.id,            // 用于 self 过滤的主键列
});
if (scopeCondition) conditions.push(scopeCondition);
```

### 创建接口中自动填入部门

```ts
// POST / 创建 handler 中：
const [creator] = await db.select({ departmentId: users.departmentId })
  .from(users).where(eq(users.id, currentUserId)).limit(1);

await db.insert(xxxs).values({
  ...validatedData,
  departmentId: creator?.departmentId ?? null,
});
```

### dataScope 取值说明

| 值 | 含义 | 可见范围 |
| --- | --- | --- |
| `all` | 全部数据 | 所有记录（不过滤） |
| `dept` | 本部门 | 与当前用户同 `department_id` 的记录 |
| `self` | 仅本人 | 由 `ownerColumn = currentUserId` 标识的记录 |

---

## 批量操作后端路由（DELETE /batch）

> **路由顺序关键**：`DELETE /batch` 必须注册在 `DELETE /{id}` **之前**，否则 `/batch` 会被匹配为 `id = "batch"`。

```ts
// ✅ 正确顺序：/batch 在 /{id} 之前
const batchDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/batch',
    tags: ['XXX管理'], summary: '批量删除 XXX',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:xxx:delete', audit: { description: '批量删除 XXX', module: 'XXX管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('批量删除成功'),
    },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    if (!ids || ids.length === 0) {
      return c.json({ code: 400, message: '请选择要删除的记录', data: null }, 400);
    }
    await db.delete(xxxs).where(inArray(xxxs.id, ids));
    return c.json({ code: 0 as const, message: `已删除 ${ids.length} 条记录`, data: null }, 200);
  },
});

// /${id} 路由必须排在 /batch 之后：
xxxRouter.openapiRoutes([..., batchDeleteRoute, deleteRoute_] as const);
```

---

## 多租户隔离（tenantScope）

> 仅当 `MULTI_TENANT_MODE=true` 时生效；关闭时两个工具函数均返回 `null`/`undefined`，与单实例行为兼容。

### Step 1：Schema 中添加 `tenant_id`

```ts
export const xxxs = pgTable('xxxs', {
  // ...其他字段
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
});
```

### 路由中使用

```ts
import { tenantCondition, getCreateTenantId } from '../lib/tenant';

// 列表接口
const tCond = tenantCondition(xxxs, c.get('user'));
if (tCond) conditions.push(tCond);

// 创建接口
await db.insert(xxxs).values({
  ...validatedData,
  tenantId: getCreateTenantId(c.get('user')),
});
```

### 关键约束

- `tenantCondition` 在多租户关闭时返回 `undefined`，**无需**在路由中额外判断是否开启多租户
- 平台超管在「平台视角」时同样返回 `undefined`，可查看全量数据
- `getCreateTenantId` 在多租户关闭时返回 `null`，不影响写入
