# 平台基础能力

`platform` 是系统配置、基础数据、安全治理与运行态能力的路由领域。本页以 `packages\server\src\routes\platform\index.ts` 的挂载清单为边界，汇总能力、管理入口及已有专题，不重复维护各专题的详细规则。

## 模块边界

| 概念 | 当前归属 |
| --- | --- |
| `platform` 路由领域 | 配置、字典、地区、标签、反馈、脱敏、审计、IP 访问日志、限流、缓存、监控、链路、健康检查与管理端 WebSocket |
| 规则中心与 License | 共享契约分别位于 `shared\src\rules`、`shared\src\licensing`，路由由 `platform` 挂载，不是独立路由领域 |
| `files` 路由领域 | 文件、存储配置、业务附件独立挂载；虽然共享契约位于 `shared\src\platform`，专题归属[文件与存储](../storage/index.md) |
| `drive` 路由领域 | [企业网盘](../drive/index.md)独立管理空间与文件协作权限，复用文件存储底座 |
| 系统运维专题 | 按用户能力组织，覆盖 `ops` 与 `platform` 的部分接口；详见[系统运维](../ops/index.md)，不能用菜单或文档目录推导路由领域数量 |

## 能力与 API 前缀

| 能力 | API 前缀 | 当前实现 |
| --- | --- | --- |
| 系统配置 | `/api/system-configs` | 配置 CRUD、按键批量读取、公开配置读取与密码策略；配置键和读取工具见[系统内置配置](../backend/system-configs.md) |
| 数据字典 | `/api/dicts` | 字典与字典项维护，按字典编码读取选项，支撑业务表单与展示 |
| 地区 | `/api/regions` | 地区树、平铺列表、详情与增删改 |
| 标签 | `/api/tags` | 标签维护、分组查询与批量删除 |
| 意见反馈 | `/api/feedbacks` | 登录用户提交反馈，管理端查询、处理与删除 |
| 数据脱敏 | `/api/data-mask-configs` | 脱敏规则、敏感字段扫描与批量创建；详见[安全体系](../backend/security.md#数据脱敏) |
| 操作审计 | `/api/operation-logs` | 操作记录、筛选与变更前后快照；详见[操作日志与变更记录](../backend/audit-log-changes.md) |
| IP 访问与限流 | `/api/ip-access-logs`、`/api/rate-limit` | IP 拦截日志、限流规则、统计与拦截处置；IP 黑白名单配置及中间件行为见[安全体系](../backend/security.md) |
| 缓存 | `/api/cache` | Redis 概览、key 浏览与清理等管理操作；详见[数据库、缓存与保留策略](../ops/data-platform.md) |
| 监控与告警 | `/api/monitor`、`/api/monitor-alerts` | 实时监控、历史趋势、告警规则与事件处理；详见[监控与告警](../ops/observability.md) |
| 请求链路 | `/api/trace` | 链路查询；观测入口见[系统运维](../ops/index.md) |
| 规则中心 | `/api/rules/decision-tables`、`/api/rules/decision-flows`、`/api/rules/executions`、`/api/rules/lists`、`/api/rules/scorecards` | 决策资产、求值与执行记录；详见[规则中心](../rules/index.md) |
| License 授权 | `/api/licensing` | 授权状态、激活、停用与事件记录 |
| 实时通道 | `/api/ws` | 管理端连接、通知与 Chat / WebRTC 信令；详见[WebSocket 事件](../backend/websocket-events.md) |
| 健康检查 | `/api/health` | 检查 PostgreSQL 与 Redis，返回 `status`、版本、运行时长与分项状态 |

API 的方法、参数和响应以共享契约及运行中的 `/api/docs`、`/api/openapi.json` 为准；`/api/ws` 是独立的 WebSocket 升级端点。

## 管理入口

菜单按用户任务组织，分布在「系统管理」「系统设置」等目录，并不与后端领域一一对应：

| 页面 | 前端路径 |
| --- | --- |
| 字典管理 | `/system/dicts` |
| 地区管理 | `/system/regions` |
| 系统配置 | `/system/configs` |
| 标签管理 | `/system/tags` |
| 意见反馈 | `/system/feedbacks` |
| 数据脱敏 | `/system/data-mask` |
| 缓存管理 | `/system/cache` |
| License 授权 | `/system/license` |

菜单与按钮权限的来源是 `packages\shared\src\seed\menus\system.ts` 和 `settings.ts`；运行态与规则页面分别从[系统运维](../ops/index.md)和[规则中心](../rules/index.md)继续查阅。

## 访问与运行边界

- 管理操作按各路由的管理员认证与 `guard` 权限执行，不能把整个领域视为公开 API。反馈提交只要求管理员登录态，查询、处理和删除另有 `system:feedback:*` 权限。
- 公开配置读取、密码策略和健康检查不要求登录；配置公开范围见[系统内置配置](../backend/system-configs.md)。健康检查在依赖异常时仍返回 HTTP 200，调用方应读取 `data.status`（`ok` / `degraded`）和 `data.checks`。
- `/api/ws` 只接受管理端 access token，不能复用会员凭证；身份与消息约束见[WebSocket 事件](../backend/websocket-events.md)。
- 规则中心挂载声明 `feature: 'rules'`。License 管理面不加 feature 门禁，以便受限模式下恢复授权；仍要求平台管理员身份及 `system:license:view` / `system:license:manage` 权限。

## 实现位置

| 层 | 位置 |
| --- | --- |
| API 装配与路由 | `packages\server\src\routes\platform\` |
| 业务服务 | `packages\server\src\services\platform\` |
| 共享契约 | `packages\shared\src\platform\contracts\`、`packages\shared\src\rules\contracts\`、`packages\shared\src\licensing\contracts\` |
| 前端数据访问 | `packages\web\src\hooks\queries\` 下的 `system-configs.ts`、`dicts.ts`、`regions.ts`、`tags.ts`、`user-feedbacks.ts`、`data-mask.ts`、`cache.ts`、`licensing.ts` 等 |

路由领域完整清单及统计口径见[功能模块](../product/features.md#路由领域口径)。调整挂载边界时，应同步更新本页和归属专题，而不是按共享层目录增加重复文档。
