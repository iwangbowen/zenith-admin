# 操作日志与变更记录

Zenith Admin 的操作日志不仅记录了「谁做了什么」，还支持记录**变更前后的实体快照**，在日志详情弹窗中以表格 diff 形式高亮展示差异字段。

---

## 整体架构

```
操作请求
  │
  ├──> guard 中间件（before next()）
  │      查询当前实体 → setAuditBeforeData(c, beforeRow)
  │
  ├──> 路由 handler
  │      执行数据库写操作，返回 { code: 0, data: afterRow }
  │
  └──> guard 中间件（after next()）
         提取响应体中的 data → afterData
         将 beforeData + afterData + 其他字段 写入 operation_logs 表
```

| 层 | 文件 | 职责 |
|----|------|------|
| 数据库 | `operation_logs.before_data` / `operation_logs.after_data` | 存储 JSON 快照字符串（`text` 类型） |
| 中间件 | `packages/server/src/middleware/guard.ts` | 自动提取 `afterData`；暴露 `setAuditBeforeData()` |
| 路由 | PUT / DELETE handler | 操作前查询实体，调用 `setAuditBeforeData(c, entity)` |
| 前端 | `OperationLogsPage.tsx` 中的 `DiffTable` 组件 | 解析 JSON、比对字段、高亮变更行（只读，不需维护） |

---

## 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `before_data` | `text` (JSON) | 操作前的实体快照，DELETE 后该字段有值 |
| `after_data` | `text` (JSON) | 操作后的实体快照，来自响应体 `data`；DELETE 时通常为 `null` |

---

## 前端 Diff 展示效果

当操作日志记录了 `beforeData` 或 `afterData` 时，日志详情弹窗会展示 **DiffTable** 组件：

- 每行代表一个字段，列出字段名、变更前的值、变更后的值
- 有差异的行高亮显示（黄色背景）
- 仅 `beforeData` 有值时（DELETE 操作），展示被删除前的数据快照
- 两者都有值时（PUT 操作），展示完整的字段变更对比

---

## 如何为新路由添加 Diff

### 前提条件

路由必须使用 `guard` 中间件（CRUD 路由已默认使用）。

### 步骤

**1. 导入 `setAuditBeforeData`**

```typescript
import { guard, setAuditBeforeData } from '../middleware/guard';
```

**2. 在写操作前，查询当前实体并注入快照**

在 PUT / DELETE handler 中，通过验证后、执行数据库写操作**之前**执行：

```typescript
// 查询操作前的实体状态
const [before] = await db
  .select()
  .from(yourTable)
  .where(eq(yourTable.id, id))
  .limit(1);

if (before) {
  // 如有敏感字段（如 password），先排除
  const { password: _pw, ...safeBefore } = before as any;
  setAuditBeforeData(c, safeBefore);
}
```

**3. 返回操作后实体（afterData 由中间件自动提取）**

handler 正常返回 `{ code: 0, data: updatedEntity }` 即可，`guard` 中间件会自动从响应体的 `data` 字段提取 `afterData`：

```typescript
const [updated] = await db
  .update(yourTable)
  .set({ ...updateData, updatedAt: new Date() })
  .where(eq(yourTable.id, id))
  .returning();

return c.json({ code: 0, message: 'success', data: updated });
```

### DELETE 操作

DELETE 接口的 `afterData` 通常为 `null`（响应 `data` 为 `null`），这是预期行为。前端 DiffTable 会仅展示删除前的数据快照。

```typescript
// DELETE handler 示例
const [before] = await db.select().from(yourTable).where(eq(yourTable.id, id)).limit(1);
if (before) {
  setAuditBeforeData(c, before);
}

await db.delete(yourTable).where(eq(yourTable.id, id));
return c.json({ code: 0, message: 'success', data: null });
```

---

## 排除敏感字段

在注入 `beforeData` 前，应主动将敏感字段从快照中排除：

```typescript
// 排除 password 和其他敏感字段
const { password: _pw, secretKey: _sk, ...safeRecord } = record as any;
setAuditBeforeData(c, safeRecord);
```

---

## 查询操作日志

操作日志通过 `GET /api/operation-logs` 接口查询，支持按用户名、模块、操作路径、请求方法、IP 地址、时间范围等多维度筛选。

详见 [操作日志 API](/backend/swagger#接口分组)。
