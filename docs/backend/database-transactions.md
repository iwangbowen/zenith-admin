# 数据库事务

Zenith Admin 使用 Drizzle ORM 的 `db.transaction()` 管理 PostgreSQL 事务。本页约定事务使用场景、可复用写函数、任务 outbox、副作用边界和错误处理。

## 基本用法

`db.transaction()` 接受异步回调。回调正常返回时 COMMIT，抛出异常时 ROLLBACK。回调内所有数据库操作使用同一个 `tx`。

```ts
const result = await db.transaction(async (tx) => {
  const [created] = await tx.insert(mainTable).values(data).returning();
  await tx.insert(relTable).values({ parentId: created.id, ...extra });
  return created;
});
```

`db/index.ts` 会包装事务对象，因此审计字段自动注入在 `tx.insert()` / `tx.update()` 中同样生效。

## 何时需要事务

| 场景 | 示例 | 是否需要事务 |
| --- | --- | --- |
| replace 模式 | 保存角色菜单、保存公告接收人：先删旧关系再插新关系 | 必须 |
| 多表联写 | 创建用户同时设置角色、岗位、用户组 | 必须 |
| 互斥写入 | 切换默认存储配置：先清默认标记，再设置新默认 | 必须 |
| 状态机推进 | 支付、工作流、任务等需要校验状态后写入多处结果 | 必须 |
| 账本 / 余额 | 积分、钱包、账户余额与流水同时写入 | 必须 |
| 写业务记录 + 任务 outbox | 写业务表并提交任务中心任务 | 必须 |
| 单表单次写入 | 普通 create / update / delete | 不需要 |

## 常见模式

### 模式一：多表联写（创建主记录 + 关联关系）

```ts
const created = await db.transaction(async (tx) => {
  const [u] = await tx.insert(users).values({
    ...rest,
    password: hashedPassword,
    departmentId: departmentId ?? null,
  }).returning();

  await setUserRoles(tx, u.id, roleIds);
  await setUserPositions(tx, u.id, positionIds);
  return u;
});
```

### 模式二：replace 模式（先删后插）

```ts
await db.transaction(async (tx) => {
  await tx.delete(roleMenus).where(eq(roleMenus.roleId, id));
  if (menuIds.length > 0) {
    await tx.insert(roleMenus).values(menuIds.map((menuId) => ({ roleId: id, menuId })));
  }
});
```

### 模式三：辅助函数接受 `DbExecutor`

可复用写函数使用 `DbExecutor`，调用方可传 `db` 或事务内的 `tx`。

```ts
import type { DbExecutor } from '../../db/types';

async function setUserRoles(executor: DbExecutor, userId: number, roleIds: number[]) {
  await executor.delete(userRoles).where(eq(userRoles.userId, userId));
  if (roleIds.length > 0) {
    await executor.insert(userRoles).values(roleIds.map((roleId) => ({ userId, roleId })));
  }
}

await db.transaction(async (tx) => {
  const [u] = await tx.insert(users).values(data).returning();
  await setUserRoles(tx, u.id, roleIds);
  return u;
});
```

### 模式四：互斥写入

```ts
await db.transaction(async (tx) => {
  await clearDefaultFlag(tx);
  const [row] = await tx
    .update(fileStorageConfigs)
    .set({ isDefault: true })
    .where(eq(fileStorageConfigs.id, id))
    .returning();
  return row;
});
```

### 模式五：级联递归操作

```ts
await db.transaction(async (tx) => {
  const all = await tx.select({ id: menus.id, parentId: menus.parentId }).from(menus);
  const toDelete = new Set<number>();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    toDelete.add(cur);
    all.filter((m) => m.parentId === cur).forEach((m) => queue.push(m.id));
  }
  await tx.delete(menus).where(inArray(menus.id, [...toDelete]));
});
```

### 模式六：事务性任务 outbox

任务中心任务需要与业务写操作同事务落库时，使用 `persistAsyncTask(tx, input)`，事务提交后再入队。独立提交使用 `submitAsyncTask(input)`，由入口管理事务与投递。

```ts
const task = await db.transaction(async (tx) => {
  await tx.insert(orders).values(orderData);
  return persistAsyncTask(tx, { taskType: 'order-sync', payload });
});

await enqueueAsyncTask(task.id);
```

事务内禁止直接入队；入队失败由任务中心 pending 兜底扫描补投。

## 副作用的处理原则

WebSocket 推送、邮件 / 短信 / Webhook、文件存储、缓存清除、pg-boss 入队等副作用放在事务提交之后执行。需要事务一致性的异步副作用使用 outbox 表或任务中心 pending 记录承接。

```ts
const row = await db.transaction(async (tx) => {
  const [inserted] = await tx.insert(announcements).values(data).returning();
  await saveRecipients(tx, inserted.id, recipientList);
  return inserted;
});

await broadcastAnnouncement(row);
```

通知类副作用通过通知中心 `notify()` / `notifyWithin()` 收口；需要与业务写入原子化时使用该服务提供的事务内接口，而不是在业务事务里直接调用通道发送函数。

## 事务内的错误处理

事务回调内抛出 `HTTPException` 或普通 `Error`，Drizzle 自动 ROLLBACK。唯一约束冲突使用 `rethrowPgUniqueViolation()` 统一映射：

```ts
import { rethrowPgUniqueViolation } from '../../lib/db-errors';

try {
  const created = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values(data).returning();
    await setUserRoles(tx, u.id, roleIds);
    return u;
  });
} catch (err: unknown) {
  rethrowPgUniqueViolation(err, '用户名或邮箱已存在', {
    users_username_unique: '用户名已存在',
    users_email_unique: '邮箱已存在',
  });
}
```

`rethrowPgUniqueViolation` 会沿 `cause` 链读取 PG 错误码 `23505` 和约束名；非唯一约束错误原样抛出。

## 乐观锁与重试

积分、钱包等资金一致性场景使用 `version` 字段做乐观锁。`member_point_accounts` 与 `member_wallets` 带 `version` 列，更新时校验主键与版本号，成功后 `version + 1`。

```ts
import { withOptimisticRetry, OptimisticLockError } from '../../lib/optimistic';

return withOptimisticRetry(() =>
  db.transaction(async (tx) => {
    const [updated] = await tx
      .update(memberWallets)
      .set({ balance: nextBalance, version: wallet.version + 1 })
      .where(and(eq(memberWallets.id, wallet.id), eq(memberWallets.version, wallet.version)))
      .returning();

    if (!updated) throw new OptimisticLockError();
    return updated;
  }),
);
```

`withOptimisticRetry(fn, retries = 3)` 重试整个操作；重试耗尽后抛 `HTTPException(409, { message: '操作过于频繁，请稍后重试' })`。

## 注意事项

- 事务内写操作保持线性 `await`，不要用 `Promise.all()` 并发执行多条写语句。
- 事务内可以并行读取互不依赖的数据，但后续写入仍保持顺序。
- 不要把 `tx` 传到脱离当前调用链的异步分支、定时器或后台任务。
- `updatedAt` 普通 update 由 schema 的 `$onUpdate` 维护；`onConflictDoUpdate({ set })` 中需要显式写更新时间。
- 写入需要审计字段时不要手动赋 `createdBy` / `updatedBy`；非请求场景用 `runAsUser()`。

## 统一数据库类型（`src/db/types.ts`）

```ts
import type { Db, DbExecutor, DbTransaction } from '../../db/types';

// Db            — 顶层 db 实例
// DbTransaction — db.transaction() 回调中的 tx 对象
// DbExecutor    — Db | DbTransaction
```

不要手工从 `db.transaction()` 签名推导事务类型。
