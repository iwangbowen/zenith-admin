# 操作日志与变更记录

Zenith Admin 的操作日志不仅记录了「谁做了什么」，还支持记录**变更前后的实体快照**，在日志详情弹窗中以表格 diff 形式高亮展示差异字段。

---

## 整体架构

```
操作请求
  │
  ├──> guard 中间件（权限校验）
  │
  ├──> 路由 handler / service（写操作前）
  │      查询当前实体 → setAuditBeforeData(c, beforeRow) / setAuditBefore(beforeRow)
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
| 中间件 | `packages/server/src/middleware/guard.ts` | 权限校验、审计写入、自动提取 `afterData` 与响应体；暴露 `setAuditBeforeData()` |
| 路由 / Service | PUT / DELETE handler 或 service | 操作前查询实体，调用 `setAuditBeforeData(c, entity)` 或 `setAuditBefore(entity)` |
| 前端 | `OperationLogsPage.tsx` 中的 `DiffTable` 组件 | 解析 JSON、比对字段、高亮变更行（只读，不需维护） |

---

## 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `before_data` | `text` (JSON) | 操作前的实体快照，DELETE 后该字段有值 |
| `after_data` | `text` (JSON) | 操作后的实体快照，来自响应体 `data`；DELETE 时通常为 `null` |
| `request_body` | `varchar(4096)` | JSON 请求体，经 `sanitizeBody()` 脱敏后截断保存；`recordBody: false` 时不记录 |
| `response_body` | `text` | 完整响应体文本，最长 16KB，非 JSON 响应也可记录 |
| `duration_ms` | `integer` | 路由处理耗时 |

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

Service 层也可使用零参版本：

```typescript
import { setAuditBefore } from '../lib/context';
```

**2. 在写操作前，查询当前实体并注入快照**

在 PUT / DELETE handler 中，通过验证后、调用 service 写方法**之前**执行：

```typescript
// 推荐：service 的 ensureXxxExists 同时返回实体交给路由做快照
import { ensureYourRecordExists } from '../services/your.service';

const before = await ensureYourRecordExists(id);  // 不存在时抛 HTTPException(404)
// 如有敏感字段（如 password），先排除
const { password: _pw, ...safeBefore } = before as Record<string, unknown>;
setAuditBeforeData(c, safeBefore);
```

若快照在 service 层生成，可调用 `setAuditBefore(safeBefore)`，无需透传 Hono `Context`。

**3. 返回操作后实体（afterData 由中间件自动提取）**

handler 正常返回 `okBody(updatedEntity)` 即可，`guard` 中间件会自动从响应体的 `data` 字段提取 `afterData`：

```typescript
import { updateYourRecord } from '../services/your.service';

const updated = await updateYourRecord(id, updateData);
return c.json(okBody(updated, 'success'), 200);
```

### DELETE 操作

DELETE 接口的 `afterData` 通常为 `null`（响应 `data` 为 `null`），这是预期行为。前端 DiffTable 会仅展示删除前的数据快照。

```typescript
// DELETE handler 示例
import { ensureYourRecordExists, deleteYourRecord } from '../services/your.service';

const before = await ensureYourRecordExists(id);
setAuditBeforeData(c, before);

await deleteYourRecord(id);
return c.json(okBody(null, 'success'), 200);
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

操作日志通过 `GET /api/operation-logs` 接口查询，支持按用户名、模块、描述、操作路径、请求方法、IP 地址、状态、时间范围、耗时范围等多维度筛选。

相关接口：

| 接口 | 说明 |
|------|------|
| `GET /api/operation-logs` | 分页查询操作日志 |
| `GET /api/operation-logs/stats` | 统计总量、成功/失败、模块、用户、方法、小时分布与耗时 |
| `DELETE /api/operation-logs/clean?months=0` | 清理操作日志，`months=0` 表示清空全部 |

操作日志导出统一通过导出中心创建任务，筛选条件沿用操作日志列表当前提交查询参数。

---

## 登录日志采集字段

登录日志写入 `login_logs` 表，记录登录成功 / 失败及客户端信息：

| 字段 | 说明 |
|------|------|
| `username` / `user_id` | 登录账号与匹配到的用户 ID |
| `status` / `message` | `success` / `fail` 与结果说明 |
| `ip` / `location` | 客户端 IP 与 IP 归属地 |
| `browser` / `os` / `user_agent` | 由 User-Agent 解析出的浏览器、操作系统与原始 UA |
| `tenant_id` | 多租户模式下的租户 ID |
| `screen_width` / `screen_height` / `device_pixel_ratio` | 前端登录时上报的屏幕信息 |
| `gpu` / `cpu_cores` / `memory_gb` | 前端登录时上报的 GPU、CPU 核数与内存信息 |

登录日志通过 `GET /api/login-logs` 查询，支持按用户名、状态、时间范围筛选；`GET /api/login-logs/stats` 提供每日趋势、用户、IP、失败 IP、浏览器、操作系统与小时分布统计。

详见 [操作日志 API](/backend/swagger#接口分组)。
