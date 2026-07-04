# 数据库与迁移

项目使用 **PostgreSQL + Drizzle ORM** 管理数据库结构与迁移。

## 默认连接

默认连接字符串如下，可通过 `.env` 覆盖：

```ini
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zenith_admin
```

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

### 迁移基线化（Baseline）

历史迁移链（`0000..0200`，共 201 条）已在基线化时压缩为单条基线迁移 `0000_baseline.sql`（含全部表结构与表/列注释），此后的新迁移在其之上正常追加。

- **全新环境**：`npm run db:migrate` 直接执行基线，一步建库。
- **存量环境（已跑完旧链 0200）**：`src/db/migrate.ts` 中的 `adoptBaseline()` 会在启动迁移前自动「收养」——将 `drizzle.__drizzle_migrations` 中的 201 条旧记录原子替换为 1 条基线记录（不重放任何 SQL），并把 3 个历史遗留的唯一索引原地转换为同名唯一约束（`UNIQUE USING INDEX`，零重建）。该过程幂等。
- **过旧环境（未升到旧链头）**：migrate 会直接报错拒绝启动，需先升级到 v0.79.x 跑完全部旧迁移，再升级到基线版本（**检查点规则**）。
- 已知无害差异：部分枚举值的物理排序（`enumsortorder`）在存量库与新库间不同（旧链 `ADD VALUE` 追加所致，PostgreSQL 不支持重排）。业务代码不依赖枚举物理排序，无需处理。

再次基线化（如未来迁移又积累过多）时按同样流程操作：确认 `db:generate` 无漂移 → 审计数据迁移是否已被 seed 覆盖 → 删除 `drizzle/` 重新 `generate` → 更新 `migrate.ts` 中的 `LEGACY_HEAD_WHEN` / `LEGACY_HEAD_TAG` 为旧链头的 journal `when` 与 tag → 用两个空库（旧链 vs 基线）做结构化 schema diff 验证。

### 枚举需要三处保持一致

以下三者必须同步：

- PostgreSQL enum
- TypeScript union type
- Zod enum

### LIKE 查询必须使用 escapeLike

所有使用 `like()` / `ilike()` 的模糊查询，**必须**通过 `escapeLike()` 对用户输入进行转义，防止 `%`、`_`、`\` 等通配符被恶意利用：

```ts
import { escapeLike } from '../lib/where-helpers';

// ✅ 正确
like(users.username, `%${escapeLike(keyword)}%`)

// ❌ 错误 - 未转义，可能匹配任意记录
like(users.username, `%${keyword}%`)
```

`escapeLike` 定义在 `packages/server/src/lib/where-helpers.ts`，同时处理 `%`、`_`、`\` 三种元字符。

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
| `role_dept_scopes` | 角色自定义数据范围部门 |
| `user_menus` | 用户额外菜单权限 |
| `user_dept_scopes` | 用户自定义数据范围部门 |

### 组织架构

| 表名 | 说明 |
| --- | --- |
| `departments` | 部门（树形结构，含 `tenant_id`） |
| `positions` | 岗位（含 `tenant_id`） |
| `user_positions` | 用户与岗位多对多 |
| `user_groups` | 用户组 |
| `user_group_members` | 用户组成员 |

### 基础配置

| 表名 | 说明 |
| --- | --- |
| `dicts` | 字典类型 |
| `dict_items` | 字典项 |
| `system_configs` | 系统配置项（key-value 格式，含 configType 枚举） |

### 文件存储

| 表名 | 说明 |
| --- | --- |
| `file_storage_configs` | 存储配置（local / OSS / S3 / COS / OBS / 七牛 Kodo / 百度 BOS / Azure Blob / SFTP） |
| `managed_files` | 已上传文件记录，主键 `id` 为 UUIDv7（应用层生成）；`url` 字段由服务端动态拼接，不存入数据库 |
| `business_files` | 业务附件与 `managed_files` 的关联，`file_id` 为 UUID 外键 |

### 通用审计字段（`created_by` / `updated_by`）

带审计字段的业务表均通过 schema 中的 [`auditColumns()`](../../packages/server/src/db/schema/core.ts) 展开 `created_by` / `updated_by` 两列（指向 `users.id`，`ON DELETE SET NULL`）。赋值由 [`db/index.ts`](../../packages/server/src/db/index.ts) 的 Proxy 统一拦截：

- **读取顺序**：`overrideStore`（`runAsUser()` 包裹）→ 请求上下文中的当前用户（`auth` 中间件设置）→ `null`。
- **拦截点**：`db.insert(t).values(d)` / `db.update(t).set(d)` / `db.insert(t).values(d).onConflictDoUpdate({set})` 及其在 `db.transaction()` 中的子事务版本。
- **严禁**：service / route / seed / cron 任意位置手动赋值 `createdBy` / `updatedBy`。
- **不加审计列的典型表**：
  - 多对多关联表：`user_roles`、`user_positions`、`role_menus`、`announcement_reads`、`announcement_recipients`、`chat_conversation_members`、`chat_message_reactions`
  - 追加型日志：`login_logs`、`operation_logs`、`cron_job_logs`、`email_send_logs`、`sms_send_logs`、`in_app_messages`
  - 用户自身/临时凭证：`user_oauth_accounts`、`password_reset_tokens`、`chat_messages`
  - 工作流运行时：`workflow_tasks`
- **种子数据**：`db/seed.ts` 主函数被 `runAsUser(adminId, ...)` 包裹，所有种子记录的创建人 / 修改人默认为 admin。

### 通知与审计

| 表名 | 说明 |
| --- | --- |
| `announcements` | 通知公告（富文本 `text` 字段） |
| `announcement_reads` | 公告已读记录 |
| `announcement_recipients` | 公告接收人 |
| `login_logs` | 登录日志 |
| `operation_logs` | 操作日志（含 `before_data` / `after_data` JSON 快照）|
| `ip_access_logs` | IP 访问控制命中日志 |
| `user_events` | 用户行为事件 |
| `analytics_sessions` | 埋点会话 |
| `analytics_daily_rollup` | 埋点日聚合 |
| `analytics_event_meta` | 埋点事件元信息 |
| `analytics_settings` | 埋点配置 |
| `error_groups` | 前端错误聚合 |
| `error_events` | 前端错误事件 |
| `error_alert_rules` | 前端错误告警规则 |
| `source_maps` | 前端 Source Map 记录 |

### 任务调度

| 表名 | 说明 |
| --- | --- |
| `cron_jobs` | 定时任务配置（名称、Handler、Cron 表达式、启用状态） |
| `cron_job_logs` | 任务执行日志（开始时间、结束时间、状态、输出） |

### 工作流

| 表名 | 说明 |
| --- | --- |
| `workflow_categories` | 流程分类 |
| `workflow_forms` | 流程表单 |
| `workflow_definitions` | 流程定义 |
| `workflow_definition_versions` | 流程定义版本 |
| `workflow_instances` | 流程实例 |
| `workflow_tasks` | 流程任务 |
| `workflow_task_urges` | 催办记录 |
| `workflow_comments` | 流程评论 |
| `workflow_event_subscriptions` | 工作流事件订阅 |
| `workflow_event_deliveries` | 工作流事件投递记录 |
| `workflow_trigger_executions` | 工作流触发执行记录 |
| `workflow_automations` | 工作流自动化规则 |
| `workflow_schedules` | 工作流定时计划 |
| `workflow_saved_views` | 工作流保存视图 |
| `workflow_quick_phrases` | 审批快捷语 |
| `workflow_delegations` | 委托审批 |
| `workflow_templates` | 工作流模板 |
| `workflow_task_consults` | 流程协办 / 咨询 |

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
| `db_admin_query_history` | 数据库管理查询历史 |
| `db_query_favorites` | 数据库管理收藏 SQL |
| `rate_limit_rules` | 接口限流规则 |
| `oauth2_clients` | OAuth2 客户端 |
| `oauth2_authorization_codes` | OAuth2 授权码 |
| `oauth2_tokens` | OAuth2 Token |
| `oauth2_user_grants` | OAuth2 用户授权记录 |

### 通知、聊天与支付

| 表名 | 说明 |
| --- | --- |
| `email_templates` | 邮件模板 |
| `email_send_logs` | 邮件发送日志 |
| `sms_configs` | 短信通道配置 |
| `sms_templates` | 短信模板 |
| `sms_send_logs` | 短信发送日志 |
| `in_app_templates` | 站内信模板 |
| `in_app_messages` | 站内信消息 |
| `chat_conversations` | 聊天会话 |
| `chat_conversation_members` | 聊天会话成员 |
| `chat_messages` | 聊天消息 |
| `chat_message_reactions` | 消息表情反应 |
| `chat_webhooks` | 聊天 Webhook |
| `payment_channel_configs` | 支付渠道配置 |
| `payment_orders` | 支付订单 |
| `payment_refunds` | 支付退款 |
| `payment_notify_logs` | 支付通知日志 |
| `payment_events` | 支付事件 |

### AI、终端与监控

| 表名 | 说明 |
| --- | --- |
| `ai_provider_configs` | AI 服务提供方配置 |
| `ai_conversations` | AI 对话 |
| `ai_messages` | AI 消息 |
| `user_ai_configs` | 用户 AI 偏好配置 |
| `ai_prompt_templates` | AI 提示词模板 |
| `terminal_recordings` | 终端录屏 |
| `ssh_profiles` | SSH / SFTP 连接配置 |
| `system_metric_samples` | 系统指标采样 |
| `monitor_alert_rules` | 监控告警规则 |
| `monitor_alert_events` | 监控告警事件 |
| `maintenance_mode` | 维护模式配置 |

### 会员体系

| 表名 | 说明 |
| --- | --- |
| `member_levels` | 会员等级 |
| `members` | 前台会员 |
| `member_point_accounts` | 会员积分账户（含 `version` 乐观锁） |
| `member_point_transactions` | 会员积分流水 |
| `member_wallets` | 会员钱包账户（含 `version` 乐观锁） |
| `member_wallet_transactions` | 会员钱包流水 |
| `coupons` | 优惠券 |
| `member_coupons` | 会员优惠券 |
| `member_login_logs` | 会员登录日志 |
| `checkin_rules` | 签到规则 |
| `member_checkins` | 会员签到记录 |

## 数据库备份

系统内置数据库备份功能，支持 `pg_dump` 完整 SQL 压缩备份与 Drizzle 逻辑 JSON 导出两种类型。

### 菜单入口

**系统设置 → 数据库备份**（路由：`/system/db-backups`，权限：`system:db-backup:list`）

### 操作说明

- **立即备份**：手动触发 `pg_dump` 或 Drizzle 逻辑导出，创建异步备份任务
- **删除备份**：删除指定备份记录

### 前置条件

使用 `pg_dump` 类型时，服务器环境必须安装 `pg_dump` 工具（PostgreSQL 客户端工具包），且版本需与数据库服务端版本兼容：

```bash
# Ubuntu / Debian
apt-get install postgresql-client

# 验证安装
pg_dump --version
```

### 备份文件存储位置

备份任务会先在后端服务工作目录的 `storage/backups/` 下生成文件：

- `pg_dump`：`pgdump-YYYYMMDD_HHmmss.sql.gz`
- `drizzle_export`：`drizzle-export-YYYYMMDD_HHmmss.json`

若已配置默认 `file_storage_configs`，备份完成后会上传到默认文件存储，并在 `db_backups.file_id` 记录对应的 `managed_files.id`（UUIDv7）。

### 相关接口

- `GET /api/db-backups`：获取备份列表，支持 `status` 与 `type` 查询参数
- `POST /api/db-backups`：触发立即备份，body 为 `{ type: 'pg_dump' | 'drizzle_export', name?: string }`
- `DELETE /api/db-backups/{id}`：删除指定备份记录

### 定期自动备份建议

定期自动备份可通过**定时任务模块**实现：

1. 在「定时任务」页面创建任务，Handler 填写 `databaseBackup`
2. 参数填写 `pg_dump` 或 `drizzle_export`
3. 设置适合的 Cron 表达式（如每天凌晨 2 点）

> **生产建议**：建议将备份文件定期同步到对象存储（如阿里云 OSS、AWS S3），避免仅依赖本地磁盘存储。
