# 维护模式

维护模式由 `packages/server/src/middleware/maintenance.ts`、`packages/server/src/routes/ops/maintenance.ts` 和 `packages/server/src/services/ops/maintenance.service.ts` 实现。

## 数据表

| 表 | 说明 |
| --- | --- |
| `maintenance_mode` | 单例状态表，记录 `enabled`、提示文案、预计结束时间、开启人 |
| `maintenance_logs` | 每次开启到关闭的维护时段记录 |

`maintenance_mode` 使用固定单例记录，业务按 id=1 读取和更新。

## API

路由挂载在 `/api/maintenance`：

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/status` | 无 | 公开查询维护状态 |
| `GET` | `/` | `system:maintenance:manage` | 管理端查询状态 |
| `PUT` | `/` | `system:maintenance:manage` | 开启或关闭维护模式，记录审计 |
| `GET` | `/logs` | `system:maintenance:manage` | 查询维护记录，支持 `status=ongoing/completed` |

更新请求体：

```json
{
  "enabled": true,
  "message": "系统维护中，请稍后重试",
  "estimatedEndAt": "2026-09-01 02:00:00"
}
```

`estimatedEndAt` 可省略或传 `null`。

## 中间件行为

维护模式中间件在认证入口及认证前 IP 路径限流之后、业务路由之前执行。身份维度限流由后续业务认证器在验证主体后执行。状态读取带 5 秒内存缓存。

免检前缀：

- `/api/health`
- `/api/auth/`
- `/api/maintenance/status`
- `/metrics`
- `/api/ws`

维护开启时，普通请求返回：

```json
{
  "code": 503,
  "message": "系统维护中，请稍后重试",
  "data": null
}
```

HTTP 状态码为 `503`，响应头必须携带 `X-Zenith-Error: maintenance`。

启用维护处理的前端请求客户端仅在状态码与该标识同时满足时派发 `maintenance:enabled` 并进入维护提示。限流服务不可用等其他 503 按各自错误处理，不应进入全站维护；分类约定见[接口限流响应](./rate-limit.md#redis-与-http-响应)。

## 绕过规则

角色码包含 `super_admin` 的管理端 JWT 可绕过维护模式。该绕过逻辑只解析 JWT 角色，不执行完整 Redis 黑名单或会话校验；后续进入受保护业务路由时仍会由认证中间件处理。

## 日志规则

- 开启维护时创建一条 `maintenance_logs` 记录。
- 关闭维护时补齐 `endedAt`、关闭人和持续时间。
- 更新维护文案或预计结束时间会更新单例状态。
