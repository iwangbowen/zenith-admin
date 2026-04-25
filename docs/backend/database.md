# 数据库与迁移

项目使用 **PostgreSQL + Drizzle ORM** 管理数据库结构与迁移。

## 默认连接

默认连接字符串如下，可通过 `.env` 覆盖：

```ini
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zenith_admin
```

## 相关目录

- `packages/server/src/db/schema.ts`：数据库 schema 定义
- `packages/server/src/db/types.ts`：统一数据库类型别名（`Db` / `DbTransaction` / `DbExecutor`）
- `packages/server/src/db/migrate.ts`：迁移执行入口
- `packages/server/src/db/seed.ts`：种子数据入口
- `packages/server/drizzle/`：生成的迁移文件

## 迁移流程

当你修改数据库 schema 后：

```bash
npm run db:generate
npm run db:migrate
```

如果需要初始化演示数据：

```bash
npm run db:seed
```

## 重要约定

### 不要直接手改迁移 SQL

正确方式是修改 `schema.ts`，然后生成新的迁移文件。

### 枚举需要三处保持一致

以下三者必须同步：

- PostgreSQL enum
- TypeScript union type
- Zod enum

## 主要表

### 多租户（可选）

| 表名 | 说明 |
| --- | --- |
| `tenants` | 租户定义（名称、唯一编码、有效期、最大用户数） |

### 权限与用户体系

| 表名 | 说明 |
| --- | --- |
| `users` | 用户信息（含 `tenant_id`、`passwordUpdatedAt`） |
| `roles` | 角色定义 |
| `menus` | 菜单与按钮权限 |
| `user_roles` | 用户与角色多对多 |
| `role_menus` | 角色与菜单多对多 |

### 组织架构

| 表名 | 说明 |
| --- | --- |
| `departments` | 部门（树形结构，含 `tenant_id`） |
| `positions` | 岗位（含 `tenant_id`） |
| `user_positions` | 用户与岗位多对多 |

### 基础配置

| 表名 | 说明 |
| --- | --- |
| `dicts` | 字典类型 |
| `dict_items` | 字典项 |
| `system_configs` | 系统配置项（key-value 格式，含 configType 枚举） |

### 文件存储

| 表名 | 说明 |
| --- | --- |
| `file_storage_configs` | 存储配置（local / OSS / S3 / COS） |
| `managed_files` | 已上传文件记录（`url` 字段由服务端动态拼接，不存入数据库） |

### 通知与审计

| 表名 | 说明 |
| --- | --- |
| `notices` | 通知公告（富文本 `text` 字段） |
| `notice_reads` | 通知已读记录 |
| `login_logs` | 登录日志 |
| `operation_logs` | 操作日志（含 `before_data` / `after_data` JSON 快照）|

### 任务调度

| 表名 | 说明 |
| --- | --- |
| `cron_jobs` | 定时任务配置（名称、Handler、Cron 表达式、启用状态） |
| `cron_job_logs` | 任务执行日志（开始时间、结束时间、状态、输出） |

### 行政区划

| 表名 | 说明 |
| --- | --- |
| `regions` | 行政区划数据（三级：省 / 市 / 区县，`parent_code` 树形结构） |

### 安全与认证

| 表名 | 说明 |
| --- | --- |
| `email_configs` | SMTP 邮件配置（主机、端口、加密方式、授权密码） |
| `oauth_configs` | OAuth 提供方配置（Client ID / Secret，按 provider 区分） |
| `user_oauth_accounts` | 用户第三方账号绑定（openId、nickname、avatar） |
| `user_api_tokens` | 用户个人 API Token（用于第三方接口调用） |
| `password_reset_tokens` | 密码重置 Token（含过期时间，支持找回密码流程） |
| `db_backups` | 数据库备份记录（文件名、大小、状态、备份类型） |

## 数据库操作规范

### 计数查询

使用 `db.$count(table, where)` 代替 `db.select({ total: count() }).from(table).where(where)`：

```ts
// ✅ 推荐
const total = await db.$count(users, and(eq(users.status, 'active'), tc));

// ❌ 避免（冗余 select）
const [{ total }] = await db.select({ total: count() }).from(users).where(where);
```

如果 count 查询需要 `JOIN`（如聚合分组），则仍需使用 `db.select({ cnt: count() }).from(table).leftJoin(...).groupBy(...)`。

### updatedAt 自动更新

所有表的 `updatedAt` 字段在 schema 中声明了 `.$onUpdate(() => new Date())`，**无需在 update 操作中手动传入**：

```ts
// ✅ 推荐
await db.update(users).set({ name: 'Alice' }).where(eq(users.id, id));

// ❌ 避免（手动传 updatedAt 是多余的）
await db.update(users).set({ name: 'Alice', updatedAt: new Date() }).where(eq(users.id, id));
```

### 事务处理

凡是**多步写操作**需要保证原子性时，必须使用 `db.transaction()`。

### 统一数据库类型（`src/db/types.ts`）

当 helper 需要同时接受 `db` 与事务里的 `tx` 执行器时，统一从 `packages/server/src/db/types.ts` 导入类型，避免手工从 `db.transaction()` 签名反推：

```ts
import type { Db, DbExecutor, DbTransaction } from '../db/types';

let executor: Db;
let tx: DbTransaction;

async function saveItems(executor: DbExecutor, parentId: number, items: Item[]) {
  // ...
}
```

**不要**再写这类手工推导：

```ts
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
```

#### 何时需要事务

| 场景 | 示例 | 是否需要事务 |
| ---- | ---- | ------------ |
| **replace 模式**（先 delete 再 insert） | 保存角色菜单、保存通知接收人 | ✅ 必须 |
| **多表联写**（写入主表 + 关联表） | 创建用户同时设置角色和岗位 | ✅ 必须 |
| **单表单次写入** | 普通 create / update / delete | ❌ 不需要 |

#### 模式一：辅助函数接受 executor 参数（推荐用于可复用的写操作）

```ts
import type { DbExecutor } from '../db/types';

// 辅助函数接受 executor，可在事务内和事务外都调用
async function saveItems(executor: DbExecutor, parentId: number, items: Item[]) {
  await executor.delete(relTable).where(eq(relTable.parentId, parentId));
  if (items.length > 0) {
    await executor.insert(relTable).values(items.map(i => ({ parentId, ...i })));
  }
}

// 使用时：传入 tx 确保与主表写入在同一事务
const row = await db.transaction(async (tx) => {
  const [created] = await tx.insert(mainTable).values(data).returning();
  await saveItems(tx, created.id, data.items);
  return created;
});
```

#### 模式二：直接内联事务（适用于一次性多步操作）

```ts
await db.transaction(async (tx) => {
  await tx.delete(roleMenus).where(eq(roleMenus.roleId, id));
  if (menuIds.length > 0) {
    await tx.insert(roleMenus).values(menuIds.map(menuId => ({ roleId: id, menuId })));
  }
});
```

> **注意**：WebSocket 推送、发邮件等副作用操作**不要放在事务内**，应在事务成功后执行。

### 分页列表的 count + list 并行查询

所有分页列表接口中，`total` 统计和 `list` 数据查询是两个**完全独立**的数据库操作，必须用 `Promise.all` 并行执行，**不允许串行**：

```ts
// ✅ 正确：并行执行
const [total, rows] = await Promise.all([
  db.$count(xxxs, where),
  db
    .select()
    .from(xxxs)
    .where(where)
    .limit(pageSize)
    .offset(pageOffset(page, pageSize))
    .orderBy(xxxs.id),
]);

// ❌ 禁止：串行（会白白等待 count 完成后才开始 list 查询）
const total = await db.$count(xxxs, where);
const rows = await db.select().from(xxxs).where(where)...;
```

同理，仪表盘等需要**同时取多个独立统计值**时，也应统一放入 `Promise.all`：

```ts
const [totalUsers, activeUsers, todayLogins] = await Promise.all([
  db.$count(users),
  db.$count(users, eq(users.status, 'active')),
  db.$count(loginLogs, gte(loginLogs.createdAt, todayStart)),
]);
```

### SQL 调试日志（Drizzle Logger）

`packages/server/src/db/index.ts` 已集成自定义 `DrizzleLogger`，通过 winston 输出 SQL。启用方式：

```dotenv
LOG_LEVEL=debug
```

开启后，每条 SQL 及其参数会以 `debug` 级别写入控制台和日志文件，方便开发调试。生产环境将 `LOG_LEVEL` 保持默认 `info` 即可，不会有任何额外开销。

### 分页偏移量 pageOffset

分页偏移量统一使用 `pageOffset(page, pageSize)` 工具函数（来自 `src/lib/pagination.ts`），**禁止手写 `(page - 1) * pageSize`**：

```ts
import { pageOffset } from '../lib/pagination';

// ✅ 推荐
db.select().from(xxxs).offset(pageOffset(page, pageSize));

// ❌ 禁止
db.select().from(xxxs).offset((page - 1) * pageSize);
```

### 关联查询优先使用 RQB

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

若返回结果需要再做“关联二次聚合”，同样优先用 RQB 一次取全，而不是先查主表、再额外查联结表并手工拼装 `Map`：

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

### 条件算子一律用 drizzle-orm 原生函数

比较 / 判空 / 范围筛选必须使用 `eq` / `ne` / `gt` / `gte` / `lt` / `lte` / `isNull` / `isNotNull` / `inArray` / `notInArray` / `and` / `or` / `like` / `ilike` 等原生函数，**禁止在 WHERE 中写裸 `sql\`\`` 模板表达比较关系**：

```ts
// ✅ 推荐
where(and(eq(tenants.code, data.code), ne(tenants.id, id)))
where(and(eq(users.username, 'admin'), isNull(users.tenantId)))

// ❌ 禁止
where(and(eq(tenants.code, data.code), sql`${tenants.id} != ${id}`))
where(sql`${users.username} = 'admin' AND ${users.tenantId} IS NULL`)
```

> 只有 Drizzle 未抽象的表达式（`date(col AT TIME ZONE 'UTC')`、`setval()`、`pg_stat_*` 系统表、`excluded.xxx` upsert 引用）才允许保留裸 `sql` 模板。

### 批量 upsert + `sql\`excluded.&lt;column&gt;\``

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

### 带 NULL 列的复合唯一约束幂等陷阱

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
