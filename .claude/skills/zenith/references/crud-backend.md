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
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
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

## Step 5：Hono Router（`packages/server/src/routes/xxx.ts`）

```ts
import { Hono } from 'hono';
import { and, eq, like, or, sql, gte, lte } from 'drizzle-orm';
import { db } from '../db/index';
import { xxxs } from '../db/schema';
import { createXxxSchema, updateXxxSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';

const xxxRouter = new Hono();

// 所有路由要求登录
xxxRouter.use('*', authMiddleware);

// ─── 私有辅助函数 ────────────────────────────────────────────────────────

/** DB Row → 公开 Xxx 对象（剔除敏感字段 + 补充关联数据） */
async function toPublicXxx(row: any): Promise<Xxx> {
  // 如有关联查询，在此批量获取
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── 路由定义 ─────────────────────────────────────────────────────────────

/**
 * GET / — 分页列表，支持关键词搜索 + 状态筛选 + 时间范围
 */
xxxRouter.get('/', guard({ permission: 'system:xxx:list' }), async (c) => {
  const page      = Number(c.req.query('page'))     || 1;
  const pageSize  = Number(c.req.query('pageSize')) || 10;
  const keyword   = c.req.query('keyword') || '';
  const status    = c.req.query('status');
  const startTime = c.req.query('startTime');
  const endTime   = c.req.query('endTime');

  const conditions: any[] = [];
  if (keyword) {
    conditions.push(
      or(
        like(xxxs.name, `%${keyword}%`),
        // 如有其他可搜索字段，继续添加 like(xxxs.xxx, `%${keyword}%`)
      )
    );
  }
  if (status === 'active' || status === 'disabled') {
    conditions.push(eq(xxxs.status, status));
  }
  if (startTime) conditions.push(gte(xxxs.createdAt, new Date(startTime)));
  if (endTime)   conditions.push(lte(xxxs.createdAt, new Date(endTime)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // 先 count 再 select（两次查询，避免 count + SELECT 混在一起）
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(xxxs)
    .where(where);

  const rows = await db
    .select()
    .from(xxxs)
    // 如需 JOIN：.leftJoin(parents, eq(xxxs.parentId, parents.id))
    .where(where)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .orderBy(xxxs.id);

  const list = await Promise.all(rows.map(toPublicXxx));

  return c.json({
    code: 0, message: 'ok',
    data: { list, total: Number(count), page, pageSize },
  });
});

/**
 * POST / — 创建
 */
xxxRouter.post('/', guard({
  permission: 'system:xxx:create',
  audit: { description: '创建XXX', module: 'XXX管理' },
}), async (c) => {
  const body = await c.req.json();
  const result = createXxxSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const { ...data } = result.data;

  try {
    const [row] = await db.insert(xxxs).values(data).returning();
    return c.json({ code: 0, message: '创建成功', data: await toPublicXxx(row) });
  } catch (err: any) {
    if (err.code === '23505') {  // PostgreSQL 唯一约束违反
      return c.json({ code: 400, message: '该名称已存在', data: null }, 400);
    }
    throw err;
  }
});

/**
 * PUT /:id — 更新
 */
xxxRouter.put('/:id', guard({
  permission: 'system:xxx:update',
  audit: { description: '更新XXX', module: 'XXX管理' },
}), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateXxxSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const [row] = await db
    .update(xxxs)
    .set({ ...result.data, updatedAt: new Date() })
    .where(eq(xxxs.id, id))
    .returning();

  if (!row) {
    return c.json({ code: 404, message: 'XXX不存在', data: null }, 404);
  }

  return c.json({ code: 0, message: '更新成功', data: await toPublicXxx(row) });
});

/**
 * DELETE /:id — 删除
 */
xxxRouter.delete('/:id', guard({
  permission: 'system:xxx:delete',
  audit: { description: '删除XXX', module: 'XXX管理' },
}), async (c) => {
  const id = Number(c.req.param('id'));

  const [deleted] = await db
    .delete(xxxs)
    .where(eq(xxxs.id, id))
    .returning();

  if (!deleted) {
    return c.json({ code: 404, message: 'XXX不存在', data: null }, 404);
  }

  return c.json({ code: 0, message: '删除成功', data: null });
});

export default xxxRouter;
```

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

```ts
/** 先删后插，更新 xxx 的 yyy 关联 */
async function setXxxYyys(xxxId: number, yyyIds: number[]): Promise<void> {
  await db.delete(xxxYyys).where(eq(xxxYyys.xxxId, xxxId));
  if (yyyIds.length > 0) {
    await db.insert(xxxYyys).values(yyyIds.map((yyyId) => ({ xxxId, yyyId })));
  }
}
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
|----|------|------|
| DB | `operation_logs.before_data` / `after_data` | 存储 JSON 快照字符串（`text` 类型） |
| 中间件 | `packages/server/src/middleware/guard.ts` | 自动从响应体提取 `afterData`；提供 `setAuditBeforeData()` 供路由注入 `beforeData` |
| 路由 | 需要 diff 的 PUT/DELETE 路由 | 在处理前查询实体，调用 `setAuditBeforeData(c, entityRow)` |
| 前端 | `OperationLogsPage.tsx → DiffTable` | 解析 JSON、比对字段、高亮变更行（无需额外修改） |

### 为新路由添加 diff

1. 导入 `setAuditBeforeData`：
```ts
import { guard, setAuditBeforeData } from '../middleware/guard';
```

2. 在 PUT / DELETE handler 中，验证通过后、执行写操作**前**，查询并注入操作前快照：
```ts
// 操作前快照（如有敏感字段需先排除，如 password）
const [before] = await db.select().from(xxxs).where(eq(xxxs.id, id)).limit(1);
if (before) {
  const { sensitiveField: _sf, ...safeBefore } = before as any;
  setAuditBeforeData(c, safeBefore);
}
```

3. `guard` 中间件自动：
   - 在 `next()` 后从 `{ code: 0, data: ... }` 响应体提取 `afterData`
   - 将 `beforeData` + `afterData` 一并写入 `operation_logs`

> **注意**：DELETE 操作的 `afterData` 通常为 null（响应 `data` 为 null），是预期行为，前端 diff 会仅展示变更前列。
