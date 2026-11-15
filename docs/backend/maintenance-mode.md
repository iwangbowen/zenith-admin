# 维护模式

维护模式是平台级业务入口门禁，页面为 `/system/maintenance`。API 契约在 `shared/src/ops/contracts/maintenance.ts`，Service 负责生命周期、版本控制和通知。

## 状态与时间

`maintenance_mode` 按唯一业务键 `global` 保存提示草稿与递增版本，不依赖固定数字 ID。`maintenance_logs` 保存维护时段，状态为 `scheduled`（待开始）、`ongoing`（维护中）、`completed`（已结束）、`cancelled`（已取消）；数据库保证全局最多一个未结束时段。

- 保存提示草稿不会开启维护；开启、更新说明、结束、计划及取消都是显式动作，均填写原因。
- 写入携带读取时的 `version`，事务内共用 PostgreSQL advisory lock；旧版本返回 409，页面保留草稿并要求重载。
- 更新说明或恢复时间保留实际开始时间、开启人和时段 ID；变更过程写入 `changes`。
- `estimatedEndAt` 仅用于预计时间展示；`autoEndAt` 是独立的自动恢复指令，可清空关闭。超过预计时间仍保持维护。
- API 时间使用业务时区 `YYYY-MM-DD HH:mm:ss`，校验日期溢出和时间顺序。

## 权限与认证

| 能力 | 权限 |
| --- | --- |
| 查看状态与访问诊断 | `system:maintenance:view` 或 `system:maintenance:manage` |
| 保存、开启、更新、结束及计划 | `system:maintenance:manage` |
| 记录与详情 | `system:maintenance:log` 或 `system:maintenance:manage` |
| 维护期间访问普通业务 | `system:maintenance:bypass`（高风险权限） |

管理能力不授予普通业务通行。维护中具有查看、管理或日志权限的账号可以进入恢复控制台；普通账号显示维护页。通行判定执行完整管理员令牌校验、主体活性及会话撤销检查，并读取当前启用角色和权限。模拟身份不可管理或业务通行。多租户部署仅启用的平台超级管理员可管理全局维护，租户身份即使分配菜单也不可操作。平台超级管理员具有恢复和通行能力，仍受账号状态及会话校验约束。

公开摘要只返回维护文案、时间、版本及生效状态，不返回开启人、通知接收人、操作原因或变更记录。

## API

基址 `/api/maintenance`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/status` | 公开摘要，`Cache-Control: no-store` |
| GET | `/access` | 当前认证主体的维护能力 |
| GET | `/` | 管理详情、当前时段和版本 |
| PUT | `/` | 完整提交 `version, enabled, message, estimatedEndAt, autoEndAt, reason` |
| GET | `/recipients` | 启用的平台通知接收人 |
| POST | `/plans` | 一次性计划，附加开始时间、自动恢复时间、接收人、提醒分钟数 |
| POST | `/start` | 提前开始，传 `version, reason` |
| POST | `/cancel` | 取消待开始计划，传 `version, reason` |
| POST | `/diagnose` | 当前身份、方法、路径及版本的门禁诊断，与实际请求共用判定 |
| GET | `/logs` | 分页记录，支持状态、关键词及记录创建时间筛选 |
| GET | `/logs/{id}` | 时段详情和变更过程 |

待开始计划通过提前开始或取消处理；重排时取消后新建。诊断只说明维护门禁是否放行，实际业务仍执行路由权限、租户隔离、IP 控制、限流等策略。

## 拦截边界

门禁在认证前 IP 路径限流之后、业务路由之前执行。例外位于 `maintenance-access-policy.ts`，按 HTTP 方法与完整路径模板匹配。健康探测、公开状态、认证必需配置、登录及恢复认证链、经过验签与幂等校验的支付回调继续运行；`/api/auth/*` 和 `/api/ws*` 不是整体豁免范围。

维护拒绝返回 HTTP 503、`X-Zenith-Error: maintenance`、`Retry-After` 和 `Cache-Control: no-store`。状态读取失败返回 503 与 `maintenance-unavailable`，不能将未知状态视为正常开放或计划维护。状态使用非 SWR 的 5 秒进程缓存，数据库失效总线通知其他节点，监听重建时清空缓存。

控制通道 `GET /api/ws` 保留认证、心跳与维护广播；聊天输入、通话信令等业务帧重新校验通行能力。终端新连接和既有连接输入也受门禁控制。

维护不提供数据库只读保证：已有 HTTP 请求、Worker、Subscriber、关键回调及已开始作业可能继续写入。CMS 非 API 页面、短链和静态资源由部署层控制；全站停写需要配合部署与基础设施措施。

## 计划、通知与恢复

系统调度 `maintenance-lifecycle` 由 Worker 每分钟扫描，支持手动执行。提醒、到点开启、显式自动恢复都在全局锁内重读当前时段，不按旧任务载荷操作其他时段。重启后已过预计或自动结束时间的待开始计划直接取消。进行中维护只有显式自动恢复时间到达才会自动结束。Worker 不可用时计划不会准点推进，应检查系统调度执行状态。

创建人和选定的平台接收人通过 `ops.maintenance.changed` 与 `ops.maintenance.reminder` 接收通知。通知与状态同事务落 Outbox，以时段、版本或提醒动作去重，投递遵循渠道策略和个人偏好。

后台、公开分享页、会员前台和移动审批复用维护提示。HTTP 标识触发公开状态失效，30 秒轮询兜底；恢复后重新校准业务缓存，检查失败保留凭证。管理员从提示页进入登录和恢复管理。

浏览器不可用时，在服务器部署目录执行：

```bash
npm run maintenance:recover -- --actor-id <平台管理员ID> --reason "维护完成，恢复服务" --confirm-disable
```

开发环境使用 `maintenance:recover:dev`。命令验证启用的平台账号及当前管理权限，复用版本与事务锁，将恢复原因和操作者写入时段；不提供公开 HTTP 绕过入口。数据库不可用时先恢复数据库。

## 记录保留与验收

保留策略按结束时间清理已完成或已取消的时段，默认 365 天；始终保护待开始和维护中的记录。页面支持筛选、时段详情及变更过程，只读账号没有写入按钮。

验证覆盖：并发开启、旧版本 409、更新不重置开始时间、无效令牌、管理与通行分离、多租户与模拟身份、关键回调、实时业务帧、计划取消/重试/过期窗口、提醒幂等、自动恢复及本地恢复；真实浏览器回归开启、提示、登录恢复、记录详情和窄屏布局。
