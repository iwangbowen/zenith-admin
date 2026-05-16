# 数据库操作规范

本页汇总 Zenith Admin 后端所有数据库查询与写入的编码规范，包括计数、分页、关联查询、条件算子、批量写入等最佳实践。

## 计数查询

使用 `db.$count(table, where)` 代替 `db.select({ total: count() }).from(table).where(where)`：

```ts
// ✅ 推荐
const total = await db.$count(users, and(eq(users.status, 'enabled'), tc));

// ❌ 避免（冗余 select）
const [{ total }] = await db.select({ total: count() }).from(users).where(where);
```

如果 count 查询需要 `JOIN`（如聚合分组），则仍需使用 `db.select({ cnt: count() }).from(table).leftJoin(...).groupBy(...)`。

## `updatedAt` 自动更新

所有表的 `updatedAt` 字段在 schema 中声明了 `.$onUpdate(() => new Date())`，**无需在 update 操作中手动传入**：

```ts
// ✅ 推荐
await db.update(users).set({ name: 'Alice' }).where(eq(users.id, id));

// ❌ 避免（手动传 updatedAt 是多余的）
await db.update(users).set({ name: 'Alice', updatedAt: new Date() }).where(eq(users.id, id));
```

## 分页列表的 count + list 并行查询

所有分页列表接口中，`total` 统计和 `list` 数据查询是两个**完全独立**的数据库操作，必须用 `Promise.all` 并行执行，**不允许串行**：

```ts
// ✅ 正确：并行执行，SQL-builder 分页使用 withPagination
const [total, rows] = await Promise.all([
  db.$count(xxxs, where),
  withPagination(
    db.select().from(xxxs).where(where).orderBy(xxxs.id).$dynamic(),
    page, pageSize,
  ),
]);

// ❌ 禁止：串行（会白白等待 count 完成后才开始 list 查询）
const total = await db.$count(xxxs, where);
const rows = await db.select().from(xxxs).where(where)...;
```

同理，仪表盘等需要**同时取多个独立统计值**时，也应统一放入 `Promise.all`：

```ts
const [totalUsers, activeUsers, todayLogins] = await Promise.all([
  db.$count(users),
  db.$count(users, eq(users.status, 'enabled')),
  db.$count(loginLogs, gte(loginLogs.createdAt, todayStart)),
]);
```

## SQL 调试日志（Drizzle Logger）

`packages/server/src/db/index.ts` 已集成自定义 `DrizzleLogger`，通过 winston 输出 SQL。启用方式：

```dotenv
LOG_LEVEL=debug
```

开启后，每条 SQL 及其参数会以 `debug` 级别写入控制台和日志文件，方便开发调试。生产环境将 `LOG_LEVEL` 保持默认 `info` 即可，不会有任何额外开销。

## 分页：`withPagination`（SQL-builder）与 `pageOffset`（RQB）

根据查询风格选择对应的分页工具：

| 查询风格 | 分页方式 | 来源 |
| -------- | -------- | ---- |
| SQL-builder（`db.select().from()`） | `withPagination(query.$dynamic(), page, pageSize)` | `lib/where-helpers` |
| RQB（`db.query.xxx.findMany`） | `offset: pageOffset(page, pageSize)` | `lib/pagination` |

```ts
import { withPagination } from '../lib/where-helpers';
import { pageOffset } from '../lib/pagination';

// ✅ SQL-builder：使用 withPagination + .$dynamic()
withPagination(
  db.select().from(xxxs).where(where).orderBy(xxxs.id).$dynamic(),
  page, pageSize,
);

// ✅ RQB：使用 pageOffset
db.query.xxxs.findMany({ where, orderBy: xxxs.id, limit: pageSize, offset: pageOffset(page, pageSize) });

// ❌ 禁止：手写 (page - 1) * pageSize
db.select().from(xxxs).offset((page - 1) * pageSize);
```

## 关联查询优先使用 RQB

`db` 实例已传入 `schema`，`schema.ts` 已为所有表声明 `xxxRelations`，可直接使用 `db.query.*`。

**有关联数据时，优先用 RQB 替代手动 JOIN**：

```ts
// ✅ 推荐： RQB 自动处理关联
const row = await db.query.workflowDefinitions.findFirst({
  where: eq(workflowDefinitions.id, id),
  with: {
    createdByUser: { columns: { nickname: true } },
  },
});
// row.createdByUser?.nickname

// ❌ 避免：手动 JOIN
const [row] = await db
  .select({ def: workflowDefinitions, createdByName: users.nickname })
  .from(workflowDefinitions)
  .leftJoin(users, eq(workflowDefinitions.createdBy, users.id))
  .where(eq(workflowDefinitions.id, id));
```

若返回结果需要再做"关联二次聚合"，同样优先用 RQB 一次取全，而不是先查主表、再额外查联结表并手工拼装 `Map`：

```ts
// ✅ 推荐：一次拉取用户 + 部门 + 角色 + 岗位
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

// ❌ 避免：先查 users，再写 getUserRolesMap()/getUserPositionsMap() 二次聚合
```

**已声明的关联关系（可直接使用）**：

| 表 | 可用 `with` 字段 |
| --- | --- |
| `users` | `department`, `userRoles`, `userPositions`, `oauthAccounts`, `apiTokens` |
| `roles` | `userRoles`, `roleMenus` |
| `userRoles` | `user`, `role` |
| `userPositions` | `user`, `position` |
| `dicts` | `items` |
| `workflowDefinitions` | `createdByUser`, `instances` |
| `workflowInstances` | `definition`, `initiator`, `tasks` |
| `workflowTasks` | `instance`, `assignee` |
| `dbBackups` | `file`, `createdByUser` |
| `cronJobs` | `logs` |
| `notices` | `reads`, `recipients` |

> **保留手动 JOIN 的场景**：聚合计数需要跨表过滤（如 `countDistinct` + 反向遍历联结表）；keyword 搜索同时过滤主表和关联表字段（WHERE 依赖 JOIN 列）。

## 条件算子一律用 drizzle-orm 原生函数

比较 / 判空 / 范围筛选必须使用 `eq` / `ne` / `gt` / `gte` / `lt` / `lte` / `isNull` / `isNotNull` / `inArray` / `notInArray` / `and` / `or` / `like` / `ilike` 等原生函数，**禁止在 WHERE 中写裸 `sql`` 模板表达比较关系**：

```ts
// ✅ 推荐
where(and(eq(tenants.code, data.code), ne(tenants.id, id)))
where(and(eq(users.username, 'admin'), isNull(users.tenantId)))

// ❌ 禁止
where(and(eq(tenants.code, data.code), sql`${tenants.id} != ${id}`))
where(sql`${users.username} = 'admin' AND ${users.tenantId} IS NULL`)
```

> 只有 Drizzle 未抽象的表达式（`date(col AT TIME ZONE 'UTC')`、`setval()`、`pg_stat_*` 系统表、`excluded.xxx` upsert 引用）才允许保留裸 `sql` 模板。

## 批量 upsert + `sql\`excluded.&lt;column&gt;\``

**不要在循环里逐条执行 upsert**。Drizzle 支持 `.values([...])` 数组语法，配合 `onConflictDoUpdate` 的 `set` 中使用 `sql\`excluded.&lt;snake_case_column_name&gt;\`` 完成单语句批量 upsert：

```ts
// ✅ 批量 upsert（单次 round-trip）
await db.insert(menus).values(menuRows).onConflictDoUpdate({
  target: menus.id,
  set: {
    parentId:   sql`excluded.parent_id`,
    title:      sql`excluded.title`,
    // ...其余列
    updatedAt:  new Date(),
  },
});

// ❌ 禁止：N 次 round-trip
for (const row of menuRows) {
  await db.insert(menus).values(row).onConflictDoUpdate({ target: menus.id, set: { ... } });
}
```

**要点**：

- `sql\`excluded.xxx\`` 中的列名必须是**数据库真实列名**（snake_case），不是 JS 属性名。写错会直接 `column excluded.&lt;x&gt; does not exist`。
- 如果列数多且懒得手写，可简单复制定义里的 `integer('parent_id')` / `varchar('config_value')` 等 DB 名即可。
- `updatedAt` 在 upsert 的 set 里仍需显式写 `new Date()`（因为 `$onUpdate` 只对 `.update()` 生效，对 `onConflictDoUpdate` 不自动触发）。

## 带 NULL 列的复合唯一约束幂等陷阱

PostgreSQL 唯一约束中 `NULL != NULL`，因此当复合唯一键里某列可为 NULL 时（常见于多租户场景 `(tenant_id, xxx)`，平台级记录 `tenant_id = NULL`），**`onConflictDoNothing` 无法触发冲突**，重复执行 seed/初始化会产出重复记录。此时须先查再插：

```ts
// ❌ 错误：tenant_id=NULL 时冲突永不发生，会插出多条 admin
await db.insert(users).values({ username: 'admin', ... }).onConflictDoNothing();

// ✅ 正确：先查再插
const existing = await db.select({ id: users.id })
  .from(users)
  .where(and(eq(users.username, 'admin'), isNull(users.tenantId)))
  .limit(1);
if (existing.length === 0) {
  await db.insert(users).values({ username: 'admin', ... });
}
```

参考实现见 `packages/server/src/db/seed.ts` 中 admin 账号与 `system_configs` 的处理。
