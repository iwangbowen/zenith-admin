# CRUD 后端实现参考（以「用户管理」为范例）

本文档提供后端各层的代码模板，对照 `packages/server/src/routes/users.ts` 和 `packages/server/src/db/schema.ts` 的实际实现。

---

## Step 1：数据库 Schema（`packages/server/src/db/schema.ts`）

### 基础表模板

```ts
// ─── 枚举（如有新枚举，三端必须同步：pgEnum / TS union / Zod enum）───
export const xxxStatusEnum = pgEnum('xxx_status', ['enabled', 'disabled']);
// 如果复用已有 statusEnum，则无需新建

// ─── 主表 ───────────────────────────────────────────────────────────────
export const xxxs = pgTable('xxxs', {
  id:          serial('id').primaryKey(),
  name:        varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  // 枚举字段（使用已有 status 枚举时）：
  status:      statusEnum('status').notNull().default('enabled'),
  // 外键（FK 字段 + onDelete 策略）：
  parentId:    integer('parent_id').references(() => xxxs.id, { onDelete: 'set null' }),
  // 通用审计列（created_by / updated_by → users.id, ON DELETE SET NULL）：
  ...auditColumns(),
  // 时间戳：
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

// ─── 类型导出 ────────────────────────────────────────────────────────────
export type XxxRow = typeof xxxs.$inferSelect;
export type NewXxx = typeof xxxs.$inferInsert;
```

> **审计列必加**：所有业务主表必须展开 `...auditColumns()`，由 `packages/server/src/db/index.ts` 的 Proxy 在 `insert().values()` / `update().set()` / `insert().onConflictDoUpdate({set})` 时根据 `audit-context`（来自 `auth` 中间件或 `runAsUser()`）自动写入 `created_by` / `updated_by`，**禁止**业务代码手动赋值。例外（**不要**加审计列）：纯关联表（如 `xxx_yyys`）、追加型日志（`*_logs`）、临时凭证（`*_tokens`）、IM 消息等"作者天然就是当前用户"的实体。

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
  status:      z.enum(['enabled', 'disabled']).default('enabled'),
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
  status: 'enabled' | 'disabled';
  // 关联冗余字段（JOIN 后附加，供前端直接展示）：
  parentId?: number | null;
  parentName?: string | null;
  // 关联实体嵌套（多对多时）：
  yyys?: Yyy[];
  yyyIds?: number[];
  // 审计字段（由后端 Proxy 自动写入，可选透出给前端）：
  createdBy?: number | null;
  updatedBy?: number | null;
  // 时间字段序列化为字符串（YYYY-MM-DD HH:mm:ss）：
  createdAt: string;
  updatedAt: string;
}
```

---

## Step 5：Service 层（`packages/server/src/services/xxx.service.ts`）

业务逻辑（数据映射、参数校验、关联写操作）从路由中提取到独立的 service 文件，路由 handler 只负责参数取值、调用 service、返回 HTTP 响应。

### service 文件模板

```ts
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { xxxs } from '../db/schema';
import { eq } from 'drizzle-orm';
import { formatDateTime } from '../lib/datetime';
import type { XxxRow } from '../db/schema';

// ─── 数据映射函数（DB 行 → 公开 DTO 字段） ──────────────────────────────
export function mapXxx(row: XxxRow) {
  return {
    id:          row.id,
    name:        row.name,
    description: row.description ?? null,
    status:      row.status,
    // 审计字段：由 db Proxy 自动写入，按需透出（如需在前端显示创建人/修改人）
    createdBy:   row.createdBy ?? null,
    updatedBy:   row.updatedBy ?? null,
    createdAt:   formatDateTime(row.createdAt),
    updatedAt:   formatDateTime(row.updatedAt),
  };
}

// ─── 获取单个实体（用于详情页/编辑弹窗实时获取） ──────────────────────────
export async function getXxx(id: number) {
  const [row] = await db.select().from(xxxs).where(eq(xxxs.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: 'XXX 不存在' });
  return mapXxx(row);
}

// ─── 前置校验（抛 HTTPException，由全局 onError 转为标准 JSON 错误响应） ────
export async function ensureXxxExists(id: number) {
  const [row] = await db.select().from(xxxs).where(eq(xxxs.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: 'XXX 不存在' });
  return row;
}
```

> **约束：**
>
> - `mapXxx` 等数据映射函数以 `map` 前缀命名，纯函数，无副作用
> - `ensureXxx` 等校验函数直接 `throw new HTTPException(statusCode, { message })` 无需返回错误码
> - 禁止在 service 中调用 `c.json()`、直接引用 `c`、调用 `console.*`
> - 复杂业务逻辑（RQB 查询、事务、多表操作）放在 service，路由只调用 service 函数
> - DB 唯一约束异常（PG 错误码 `23505`）在 service 的写入 `try-catch` 中通过 `rethrowPgUniqueViolation(err, msg)` 映射为 `HTTPException(400)`

---

## Step 6：OpenAPIHono Router（`packages/server/src/routes/xxx.ts`）

> **必读：实体 DTO 必须集中在 `packages/server/src/lib/dtos/` 子目录中（按业务域拆分：`roles` / `positions` / `users` / `menus` / `departments` / `tenants` / `api-tokens` / `auth` / `dict` / `files` / `logs` / `announcements` / `system-configs` / `cron-jobs` / `email-config` / `cache` / `db-backups` / `monitor` / `sessions` / `workflow` / `dashboard` / `region` / `messages`）。** 新增实体时先在对应子文件中添加：
>
> ```typescript
> import { auditFields } from './_audit';
>
> export const XxxDTO = z
>   .object({
>     id: z.number().int(),
>     name: z.string(),
>     description: z.string().nullable().optional(),
>     status: z.enum(['enabled', 'disabled']),
>     ...auditFields, // createdBy / updatedBy（由 db Proxy 自动写入，DTO 中为可选）
>     createdAt: z.string(),
>     updatedAt: z.string(),
>   })
>   .openapi('Xxx');
> ```
>
> 然后在路由中导入：`import { XxxDTO } from '../lib/openapi-dtos';`。**严禁在路由文件内本地声明带 `.openapi('EntityName')` 的实体 DTO**，以免 Swagger Components 重复/冲突。

**薄路由约定**：**禁止在路由 handler 中直接调用 `db.*`**。所有 DB 访问与业务逻辑必须放在 `services/xxx.service.ts`；路由只负责：取参数 → 调 service → 返回 `c.json(okBody(...))`或透传错误（由全局 `onError` 将 `HTTPException` 转为标准 JSON）。DB 唯一约束 `23505` 也统一在 service 中通过 `rethrowPgUniqueViolation(err, msg)` 映射。

```ts
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  ErrorResponse, jsonContent,
  PaginationQuery, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, BatchIdsBody,
  okBody, errBody,
} from '../lib/openapi-schemas';
// 实体 DTO 必须从中心仓库导入（严禁路由内本地声明 .openapi('EntityName')）
import { XxxDTO } from '../lib/openapi-dtos';
// 业务逻辑统一从 service 导入
import { listXxx, getXxx, createXxx, updateXxx, deleteXxx, ensureXxxExists } from '../services/xxx.service';
// 可直接从 @zenith/shared 导入（使用 Zod v4）
// import { createXxxSchema, updateXxxSchema } from '@zenith/shared';

// 不使用 <AuthEnv> 泛型，不添加全局 use('*', authMiddleware)
const xxxRouter = new OpenAPIHono({ defaultHook: validationHook });

// 若 @zenith/shared 中的 schema 不满足需求（如需 coerce），可在本地声明
const createXxxSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(256).optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});
const updateXxxSchema = createXxxSchema.partial();

// ─── GET /{id} — 详情 ────────────────────────────────────────────────────
const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['XXX管理'], summary: '获取 XXX 详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:xxx:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(XxxDTO, 'XXX 详情'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const row = await getXxx(id);
    return c.json(okBody(row), 200);
  },
});

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
        status: z.enum(['enabled', 'disabled']).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: {
      ...commonErrorResponses,
      ...okPaginated(XxxDTO, 'ok'),
    },
  }),
  handler: async (c) => c.json(okBody(await listXxx(c.req.valid('query'))), 200),
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
    const row = await createXxx(data);
    return c.json(okBody(row, '创建成功'), 200);
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
    const before = await ensureXxxExists(id);  // 不存在时抛 HTTPException(404)
    setAuditBeforeData(c, before);
    const row = await updateXxx(id, data);
    return c.json(okBody(row, '更新成功'), 200);
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
    const before = await ensureXxxExists(id);
    setAuditBeforeData(c, before);
    await deleteXxx(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// 统一注册所有路由（必须在 export 之前）
xxxRouter.openapiRoutes([listRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_] as const);

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

// ✅ 推荐：分页列表 + 关联（RQB 使用 pageOffset）
const rows = await db.query.xxxs.findMany({
  where,
  with: { parent: { columns: { name: true } } },
  orderBy: desc(xxxs.id),
  limit: pageSize,
  offset: pageOffset(page, pageSize),
});

// ✅ 推荐：SQL-builder 分页使用 withPagination + .$dynamic()
const rows = await withPagination(
  db.select().from(xxxs).where(where).orderBy(desc(xxxs.id)).$dynamic(),
  page, pageSize,
);

// ❌ 避免：手写 LEFT JOIN（仅在跨表 WHERE 过滤或聚合计数时才需要）
db.select({ xxx: xxxs, parentName: parents.name })
  .from(xxxs)
  .leftJoin(parents, eq(xxxs.parentId, parents.id))
  .where(where);
```

> **注意**：新增表后须在 `schema.ts` 末尾补充 `xxxRelations`，否则 `db.query.xxx` 无法识别关联字段。

若路由返回的数据需要经过“关联二次展开”（如用户列表要顺带带出部门名、角色列表、岗位列表），也优先让 RQB 一次拉取完整关系，而不是先查主表再写 `getXxxMap()` 一类 helper 手工拼装：

```ts
const rows = await db.query.users.findMany({
  where,
  with: {
    department: { columns: { name: true } },
    userRoles: { columns: {}, with: { role: true } },
    userPositions: { columns: {}, with: { position: true } },
  },
  orderBy: users.id,
  limit: pageSize,
  offset: pageOffset(page, pageSize),
});
```

---

## Step 7：注册路由（`packages/server/src/index.ts`）

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
import type { DbExecutor } from '../db/types';

/** 先删后插，原子性更新 xxx 的 yyy 关联（调用方需传入 tx 或 db） */
async function setXxxYyys(executor: DbExecutor, xxxId: number, yyyIds: number[]): Promise<void> {
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

const xxxRouter = new OpenAPIHono({ defaultHook: validationHook });

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
      return c.json(errBody('请选择要删除的记录'), 400);
    }
    await db.delete(xxxs).where(inArray(xxxs.id, ids));
    return c.json(okBody(null, `已删除 ${ids.length} 条记录`), 200);
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

## 外呼 HTTP 调用（统一走 `http-client`）

服务端**所有**对外 HTTP 请求必须通过 `packages/server/src/lib/http-client.ts`，**禁止**直接使用全局 `fetch()`。

### 基本用法

```ts
import { httpGet, httpPost, HttpClientError } from '../lib/http-client';

// GET
const resp = await httpGet('https://api.example.com/users', {
  headers: { Authorization: `Bearer ${token}` },
});
if (!resp.ok) {
  throw new HttpClientError('上游返回非 2xx', { status: resp.status, url: resp.url });
}
const data = await resp.json<{ id: number; name: string }>();

// POST JSON（对象自动 JSON.stringify，自动补 Content-Type）
const resp = await httpPost('https://api.example.com/users', { name: 'Alice' });
```

### 何时设置可选参数

| 参数 | 默认 | 何时设置 |
| --- | --- | --- |
| `timeout` | `0`（无超时） | 调用不可控的第三方接口建议设 `5000`–`10000` |
| `retries` | `0` | 上游偶发 5xx / 网络抖动场景设 `1`–`3` |
| `retryDelay` | `300`（ms 基准） | 指数退避起点，通常无需改 |
| `proxy` | 无 | **仅由代码显式传入**（如 `'http://127.0.0.1:7890'`），**不读环境变量** |
| `baseURL` | 无 | url 为相对路径时拼接前缀 |
| `signal` | 无 | 与外部 `AbortController` 协作 |

### 错误处理

失败统一抛 `HttpClientError`：

- `status === 0` → 网络错误 / 熔断 / 超时
- `status > 0` → 上游 HTTP 非 2xx（由业务代码主动 throw）
- 包含 `url` / `headers` / `bodySnippet` / `cause` 字段，便于排查

```ts
try {
  await httpGet(url);
} catch (err) {
  if (err instanceof HttpClientError && err.status === 0) {
    throw new HTTPException(502, { message: '上游服务不可用' });
  }
  throw err;
}
```

### 自动具备的能力（无需调用方关心）

- 按 host 维度熔断：连续 5 次失败开启 30s 冷却
- 敏感 Header 在日志中脱敏（`authorization` / `cookie` / `*token*` / `*secret*` / `*password*`）
- 完整 winston 结构化日志（request / response / retry / error）

> 详细 API 与设计说明：[docs/backend/http-client.md](../../../docs/backend/http-client.md)

---

## 附件功能（业务模块文件关联）

如果某个业务模块需要支持上传附件（如公告、通知、工单等），使用系统统一的 `business_files` 表进行多态关联。

### 架构概览

| 层级 | 文件 | 职责 |
| --- | --- | --- |
| DB 表 | `business_files` | 通用业务文件关联表（多态） |
| DB 表 | `managed_files` | 文件元数据表（已存在） |
| 枚举 | `business_type` (pgEnum) | 业务类型枚举（如 `announcement`） |
| Service | `business-files.service.ts` | 通用附件 CRUD 服务 |
| Route | `business-files.ts` | 通用附件接口（GET / DELETE） |
| 前端组件 | `FileAttachment` | 统一的附件上传/预览/下载组件 |

### Step 1：添加业务类型枚举

**1.1 在 `packages/server/src/db/schema.ts` 中添加 pgEnum 值**

```ts
// 找到现有的 businessTypeEnum，添加新的业务类型
export const businessTypeEnum = pgEnum('business_type', [
  'announcement',  // 已有的
  'notice',        // 新增：通知模块
  'ticket',        // 新增：工单模块
  // ... 其他业务类型
]);
```

**1.2 生成并执行迁移**

```bash
npm run db:generate
npm run db:migrate
```

> **注意**：PostgreSQL 的 pgEnum 添加新值需要 ALTER TYPE 命令，Drizzle 会自动生成。

**1.3 在 `packages/shared/src/constants.ts` 中添加常量**

```ts
export const BUSINESS_TYPES = ['announcement', 'notice', 'ticket'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
```

### Step 2：Shared 层类型和验证 Schema

**2.1 在 `packages/shared/src/types.ts` 中添加附件接口**

```ts
export interface NoticeAttachment {
  id: number;
  fileId: number;
  businessType: 'notice';
  businessId: number;
  file: {
    id: number;
    originalName: string;
    size: number;
    mimeType: string | null;
    extension: string | null;
    url: string;
  };
  sortOrder: number;
  createdAt: string;
}
```

**2.2 在 `packages/shared/src/validation.ts` 中添加 fileIds 字段**

```ts
export const createNoticeSchema = z.object({
  // ... 其他字段
  fileIds: z.array(z.number().int()).optional().default([]), // 附件文件 ID 列表
});

export const updateNoticeSchema = createNoticeSchema.partial();
```

### Step 3：Service 层集成附件

**3.1 在业务 Service 中导入附件服务**

```ts
import {
  saveBusinessFiles,
  removeBusinessFile,
  listBusinessFiles,
} from '../services/business-files.service';
```

**3.2 在创建/更新事务中保存附件关联**

```ts
// 创建接口
export async function createNotice(data: CreateNoticeInput) {
  return db.transaction(async (tx) => {
    // 1. 创建主记录
    const [created] = await tx.insert(notices).values({
      title: data.title,
      content: data.content,
      // ... 其他字段
    }).returning();

    // 2. 保存附件关联（如果传了 fileIds）
    if (data.fileIds?.length > 0) {
      await saveBusinessFiles(tx, 'notice', created.id, data.fileIds);
    }

    return mapNotice(created);
  });
}

// 更新接口
export async function updateNotice(id: number, data: UpdateNoticeInput) {
  return db.transaction(async (tx) => {
    // 1. 更新主记录
    await tx.update(notices).set({
      title: data.title,
      content: data.content,
    }).where(eq(notices.id, id));

    // 2. 如果传了 fileIds，替换附件关联（先删后插）
    if (data.fileIds !== undefined) {
      await saveBusinessFiles(tx, 'notice', id, data.fileIds);
    }

    return getNotice(id);
  });
}
```

**3.3 添加获取附件的函数**

```ts
export async function getNoticeAttachments(noticeId: number) {
  return listBusinessFiles('notice', noticeId);
}
```

### Step 4：Route 层添加附件接口

**4.1 在业务路由中添加附件 GET 接口**

```ts
// GET /api/notices/{id}/attachments
const getAttachmentsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/attachments',
    tags: ['通知管理'],
    summary: '获取通知附件列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:notice:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(NoticeAttachmentDTO, '附件列表'),
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const attachments = await getNoticeAttachments(id);
    return c.json(okBody(attachments), 200);
  },
});
```

**4.2 在路由注册中包含附件接口**

```ts
noticeRouter.openapiRoutes([
  listRoute,
  getOneRoute,
  createRoute_,
  updateRoute_,
  deleteRoute_,
  getAttachmentsRoute,  // 新增
] as const);
```

### Step 5：DTO 定义

**5.1 在 `packages/server/src/lib/dtos/notices.ts` 中添加附件 DTO**

```ts
import { auditFields } from './_audit';

export const NoticeAttachmentDTO = z
  .object({
    id: z.number().int(),
    fileId: z.number().int(),
    businessType: z.literal('notice'),
    businessId: z.number().int(),
    file: z.object({
      id: z.number().int(),
      originalName: z.string(),
      size: z.number().int(),
      mimeType: z.string().nullable(),
      extension: z.string().nullable(),
      url: z.string(),
    }),
    sortOrder: z.number().int(),
    createdAt: z.string(),
  })
  .openapi('NoticeAttachment');
```

**5.2 在 `packages/server/src/lib/openapi-dtos.ts` 中导出**

```ts
export { NoticeAttachmentDTO } from './dtos/notices';
```

### Step 6：前端集成

**6.1 使用 FileAttachment 组件**

```tsx
import FileAttachment from '@/components/FileAttachment';
import type { AttachmentItem } from '@/components/FileAttachment';

// 编辑模式
<FileAttachment
  mode="edit"
  value={formData.attachments}
  onChange={(items) => setFormData(prev => ({ ...prev, attachments: items }))}
  title="附件"
  limit={10}
  maxSizeMB={50}
  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
/>

// 查看模式
<FileAttachment
  mode="view"
  value={attachments}
  title="附件"
/>
```

**6.2 表单提交时处理附件**

```tsx
// 提交表单时，提取 fileIds
const payload = {
  title: formData.title,
  content: formData.content,
  fileIds: formData.attachments.map(a => a.fileId), // 附件 ID 列表
};

// 调用 API
await request.post(`/api/notices/${id}`, payload);
```

**6.3 附件数据获取方式（两种方案）**

**方案一：独立附件接口（推荐，当前公告模块采用）**

- 详情接口不返回附件，前端单独调用 `GET /api/{module}/{id}/attachments`
- 优点：详情接口响应快，附件懒加载
- 缺点：需要两次 API 调用

```tsx
// 详情弹窗中单独获取附件
const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);

useEffect(() => {
  if (visible && detail) {
    request.get(`/api/notices/${detail.id}/attachments`)
      .then((res) => {
        if (res.code === 0 && res.data) {
          setAttachments(res.data);
        }
      });
  }
}, [visible, detail?.id]);
```

**方案二：详情接口包含附件**

- 在 `getDetail` service 函数中，使用 RQB 的 `with` 选项关联查询附件
- 优点：一次 API 调用，前端代码简单
- 缺点：详情接口响应稍慢（需要 JOIN）

```ts
// Service 层
export async function getNoticeDetail(id: number) {
  const row = await db.query.notices.findFirst({
    where: eq(notices.id, id),
    with: {
      attachments: {
        with: {
          file: true,  // 关联查询 managed_files
        },
      },
    },
  });
  if (!row) throw new HTTPException(404, { message: '通知不存在' });
  return {
    ...mapNotice(row),
    attachments: row.attachments.map(mapAttachment),
  };
}
```

> **建议**：如果附件数量少（< 10 个）且用户查看详情时通常需要看到附件，使用方案二；否则使用方案一。

### 前端文件访问注意事项

- **所有文件 URL 都是受保护的**（`/api/files/{id}/content` 需要 Authorization 头）
- **禁止使用 `window.open(url)`** 打开受保护的文件 URL
- **使用 `fetchProtectedFile(url)`** 获取 Blob，然后创建 object URL 进行预览或下载
- `FileAttachment` 组件内部已经处理了认证逻辑，直接使用即可

### 参考实现

- 公告模块：`packages/server/src/routes/announcements.ts`
- 附件服务：`packages/server/src/services/business-files.service.ts`
- 前端组件：`packages/web/src/components/FileAttachment/index.tsx`
- 文件工具：`packages/web/src/utils/file-utils.tsx`
