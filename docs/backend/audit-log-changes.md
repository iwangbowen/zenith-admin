# 操作日志与变更记录

操作日志由 `guard()` 中间件与 `operation-logs.service.ts` 写入，主要记录管理端有权限保护的业务操作、请求摘要、响应摘要和变更快照。

## 数据表

表名：`operation_logs`。

关键字段：

- `user_id`、`username`、`tenant_id`
- `module`、`description`
- `method`、`path`、`request_id`
- `request_body`
- `before_data`、`after_data`
- `response_code`、`response_body`
- `duration_ms`
- `ip`、`location`、`user_agent`、`os`、`browser`
- `created_at`

`before_data`、`after_data`、`request_body` 建有 `pg_trgm` GIN 索引，用于内容模糊检索。

## 写入方式

写操作在契约操作上声明 `audit`（字符串即 description，或 `{ description, module?, recordBody?, recordResponseBody? }`，
`module` 缺省取契约组 `auditModule`）；`defineContractRoute` 据此装配 `guard({ audit })`，`guard()` 在响应结束后使用异步任务写入日志，
写入失败不影响业务响应。路由文件不承载审计选项。

审计选项：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `recordBody` | `true` | 记录请求体 |
| `recordResponseBody` | `true` | 记录响应体 |
| `module` | - | 模块名 |
| `description` | - | 操作描述 |

请求体优先使用校验后的 JSON body；校验失败时尝试读取原始 JSON。非 JSON 请求体不作为结构化请求体记录。

## 变更快照

业务代码可在 handler 中设置快照：

```ts
setAuditBeforeData(c, before)
setAuditAfterData(c, after)
```

如果标准响应为 `code === 0` 且 `data != null`，未手动设置 `afterData` 时可自动捕获响应 `data` 作为操作后快照。

## 裁剪策略

裁剪逻辑位于 `packages/server/src/lib/audit-clamp.ts`：

- 请求体预算：4 KB；
- 响应体、操作前快照、操作后快照预算：16 KB；
- JSON 使用结构化裁剪，按字符串长度、数组项数、对象键数和深度逐级收紧；
- 超出预算时落为摘要对象，保证仍是合法 JSON；
- 非 JSON 文本响应使用 UTF-8 安全截断，避免截断多字节字符。

## 查询接口

路由挂载在 `/api/operation-logs`：

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/` | `system:log:operation` | 分页查询 |
| `GET` | `/stats` | `system:log:operation` | 统计 |
| `DELETE` | `/clean` | `system:log:operation` | 按天数清理并记录审计 |

分页查询支持：

- `userId`：按操作人精确筛选（`username` 是模糊关键字，用于「找某个人的记录」会串号）
- `username`
- `module`
- `description`
- `method`
- `path`
- `ip`
- `status=success/fail`
- `content`：匹配请求体、操作前快照、操作后快照
- `startTime`、`endTime`
- `minDurationMs`、`maxDurationMs`

## 登录日志关系

登录与退出日志写入 `login_logs`，不写入 `operation_logs`。管理端普通登录、刷新失败、退出等认证事件应在登录日志中查询；业务操作审计在操作日志中查询。

两个管理侧分页接口（`GET /api/login-logs`、`GET /api/operation-logs`）都接受 `userId` 精确筛选，供「某个人的记录」场景使用；用户管理行操作「登录与操作记录」即以此按人读取，无需为每个用户新增端点。（运营审计列表的模糊 `username` 与前者并存。）

## 使用建议

- 修改或删除接口应在执行前读取 before 快照。
- 创建接口可依赖响应数据作为 after 快照，但包含一次性密码、密钥等敏感值时应关闭响应体记录或手动脱敏。
- 批量操作应记录 ID 列表、匹配条件和影响数量，避免写入完整大对象。
