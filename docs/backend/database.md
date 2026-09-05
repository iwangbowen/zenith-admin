# 数据库与迁移

项目使用 PostgreSQL（**≥ 15**，唯一约束依赖 `NULLS NOT DISTINCT`）+ Drizzle ORM 管理数据库结构与迁移。Server 工作区的 Drizzle 配置在 `packages/server/drizzle.config.ts`，schema 入口是 `packages/server/src/db/schema.ts`，迁移目录是 `packages/server/drizzle/`。

## 默认连接

`.env` 通过 `DATABASE_URL` 配置数据库连接：

```ini
DATABASE_URL=postgres://postgres:postgres@localhost:5432/zenith_admin
```

运行时连接池参数由 `config.database` 控制，`db/index.ts` 使用 `postgres` + `drizzle-orm/postgres-js` 创建单例连接。

## 迁移流程

修改 `packages/server/src/db/schema/` 后，在仓库根目录执行：

```bash
npm run db:generate
npm run db:migrate
```

如需初始化演示 / 内置数据：

```bash
npm run db:seed
```

根目录脚本会转发到 `@zenith/server`：

| 根目录脚本 | Server 脚本 |
| --- | --- |
| `npm run db:generate` | `npm run db:generate -w @zenith/server` → `drizzle-kit generate` |
| `npm run db:migrate` | `npm run db:migrate -w @zenith/server` → `tsx src/db/migrate.ts` |
| `npm run db:seed` | `npm run db:seed -w @zenith/server` → `tsx src/db/seed.ts` |

迁移入口 `packages/server/src/db/migrate.ts` 使用 Drizzle migrator 执行 `./drizzle`。开发、生产和容器启动链路都会先执行迁移再启动服务；迁移失败以非零码退出，阻断服务启动。

## 重要约定

### 迁移文件来源

结构变更先改 `src/db/schema/`，再由 `drizzle-kit generate` 生成迁移 SQL。不要手工改写已生成迁移来适配代码。仅 Drizzle schema 无法表达的 DDL 可使用 custom migration，例如扩展、表达式索引、条件 DDL。

### 迁移目录

`packages/server/drizzle/` 包含 `0000_baseline.sql`、`0001_extensions.sql` 和后续增量迁移，执行顺序由 `drizzle/meta/_journal.json` 管理。全新数据库执行 `npm run db:migrate` 会按该顺序建库。

`0001_extensions.sql` 收口维护 Drizzle schema 无法表达的手写 DDL，当前四项：

- 条件启用 pgvector：`CREATE EXTENSION IF NOT EXISTS vector`（扩展可用才建，否则静默跳过；扩展创建与条件 DDL 均超出 Drizzle 表达范围）。它服务于 Mastra PgVector——知识库向量存放在 `mastra` schema（索引 `kb_{kbId}`），`ai_kb_chunks` 只存分块文本，业务表上没有任何 `vector` 列；无 pgvector 的部署除知识库向量化外照常工作。
- `iot_telemetry` 的 RANGE 日分区建表与初始分区（见下文「分区表」）。
- 跨实例缓存失效广播：通用触发器函数 `notify_cache_invalidate()`（以表名为 topic、可选以某列为 key 向 `cache_invalidate` 频道 `pg_notify`）与 `system_settings` 上的触发器；服务端 `lib/invalidation-bus.ts` 监听该频道，见[运行时设置](./settings.md)。新增需跨实例失效的进程内缓存只需再挂一个触发器。
- 只读执行角色 `zenith_readonly`（NOLOGIN，仅 SELECT），供用户手写 SQL 在事务内 `SET LOCAL ROLE` 切换；无 CREATEROLE 权限的部署跳过创建并告警，服务端降级为白名单 + READ ONLY，见[数据平台 · 安全边界](../ops/data-platform.md#安全边界)。

`pg_trgm` 扩展在 `0000_baseline.sql` 顶部创建；trigram 索引（含 `async_tasks.payload/result` 的「表达式 + gin_trgm_ops」形态）已全部收进 schema DSL，由 `drizzle-kit generate` 随基线生成。

后续新增无法表达的 DDL 时，用 `drizzle-kit generate --custom` 建独立迁移；重建基线时将其内容并回 `0001_extensions.sql`。

### 分区表：`iot_telemetry`

`0001_extensions.sql` 把 IoT 遥测明细建为 PostgreSQL 原生 **RANGE 日分区表**（按 `reported_at`，UTC 日边界，分区命名 `iot_telemetry_pYYYYMMDD`）。这是全库唯一的分区表，约定如下：

- Drizzle schema 仍以普通表描述列 / 索引 / 外键（父表定义自动继承到每个分区），`PARTITION BY` 与初始分区只存在于 `0001_extensions.sql`；重建基线时必须一并保留。
- 表没有代理主键：明细只按 `(device_id, reported_at)` 范围读取，主键索引纯属写放大，且分区键必须进主键的限制让 `id` 失去意义。
- 分区生命周期由 `services/iot/iot-partitions.service.ts` 负责：启动与每小时任务「IoT 遥测分区维护」滚动预建未来 7 天；写入命中「无分区」错误时按批次内日期补建后重试；保留策略 `iot_telemetry` 走 `custom` 模式，按分区上界整表 `DROP`（秒级、零膨胀），写入侧同时丢弃早于保留窗口的回填点。
- `drizzle-kit generate` 不会感知子分区（它只对比 schema 与快照），因此新增 / 删除分区无需迁移；但**不要**在 schema 中给该表加回 `id` 或改分区键列，否则生成的 `ALTER` 会作用于分区父表并破坏分区布局。

### 枚举同步

枚举必须保持三端一致：

- PostgreSQL `pgEnum`；
- `@zenith/shared/{domain}` 中的 TS union / 常量数组；
- Zod enum。

可被其他域复用的枚举常量放在 `shared/src/{domain}/constants.ts`，不要放在 `validation.ts` 中制造 ESM 值循环。

### LIKE 查询

用户输入参与 `like()` / `ilike()` 时一律使用 `keywordCondition()`（`lib/where-helpers`），
它负责 trim、判空与 `%`、`_`、`\` 转义；列参数接受裸列或 SQL 表达式，`match: 'prefix'` 生成前缀匹配。

```ts
import { keywordCondition } from '../lib/where-helpers';

keywordCondition(keyword, [users.username, users.nickname], 'ilike');
keywordCondition(pathPrefix, [managedFiles.objectKey], 'like', 'prefix');
```

## Schema 组织（按业务域拆分）

全库约 375 张表，schema 按业务域拆分在 `packages/server/src/db/schema/`。`src/db/schema.ts` 是 barrel，业务代码导入方式保持：

```ts
import { users, roles } from '../db/schema';
```

表间关联统一声明在 `schema/relations.ts`；数据库类型别名在 `src/db/types.ts`。

| Schema 文件 | 业务域 | 代表性表 |
| --- | --- | --- |
| `core.ts` | 租户 / 组织 / 权限 | `tenants`、`tenant_packages`、`departments`、`positions`、`users`、`menus`、`roles`、`user_roles`、`user_groups` |
| `licensing.ts` | 授权许可 | `system_installations`、`licenses`、`license_events` |
| `auth.ts` | 认证与账号安全 | `user_oauth_accounts`、`oauth_configs`、`user_api_tokens`、`password_reset_tokens`、`user_mfa_factors`、`user_trusted_devices`、`login_risk_events`、`rate_limit_rules` |
| `identity-providers.ts` | 企业 SSO | `tenant_identity_providers`、`user_identity_accounts`、`identity_provider_sync_logs` |
| `directory-sync.ts` | 通讯录同步 | `directory_sync_sources`、`directory_sync_runs`、`directory_sync_run_items`、`directory_sync_conflicts`、`directory_sync_user_links`、`directory_sync_dept_links` |
| `system.ts` | 运行时设置与调度 | `system_settings`（按模块的 jsonb 覆盖文档，见[运行时设置](./settings.md)）、`system_runtime_state`、`cron_jobs`、`cron_job_logs`、`system_scheduler_*`、`retention_policies`、`regions`、`maintenance_mode`、`user_feedbacks` |
| `dicts.ts` | 数据字典 | `dicts`、`dict_items` |
| `files.ts` | 文件存储 | `file_storage_configs`、`managed_files`、`upload_sessions`、`upload_chunks`、`business_files` |
| `logs.ts` | 审计日志 | `login_logs`、`operation_logs`、`ip_access_logs` |
| `announcements.ts` | 通知公告 | `announcements`、`announcement_reads`、`announcement_recipients` |
| `messaging.ts` | 邮件 / 短信 / 站内信 | `email_configs`、`email_templates`、`email_send_logs`、`sms_*`、`in_app_*`、通知策略与偏好表 |
| `channels.ts` | 消息渠道 | 频道、订阅、消息、菜单、自动回复、客服会话等表 |
| `tasks.ts` | 任务中心 / 导出中心 | `async_tasks`、`async_task_items`、`async_task_type_configs`、`export_jobs`、`export_job_downloads` |
| `db-admin.ts` | 数据库运维 | `db_backups`、`db_admin_query_history`、`db_query_favorites` |
| `monitor.ts` | 监控告警 | `system_metric_samples`、`monitor_alert_rules`、`monitor_alert_events`、`ssl_certificates` |
| `terminal.ts` | 终端 / SSH | `terminal_sessions`、`terminal_recordings`、`ssh_profiles` |
| `data-mask.ts` | 数据脱敏 | `data_mask_configs` |
| `tags.ts` | 通用标签 | `tags` |
| `workflow.ts` | 工作流 | 流程分类、表单、定义、版本、实例、任务、作业、事件订阅、调度、健康快照等表 |
| `payment.ts` | 支付中心 | 应用、订单、退款、回调、事件、对账、分账、结算、风控、合约等表 |
| `member.ts` | 会员体系 | `members`、`member_levels`、`member_tags`、积分 / 钱包账户与流水、优惠券、签到、充值、登录日志 |
| `chat.ts` | 聊天 | 会话、成员、消息、反应、收藏、Webhook、快捷回复、定时消息、坐席等表 |
| `ai.ts` | AI | 提供方配置、会话、消息、提示词、知识库、评测、Arena、分享等表 |
| `analytics.ts` | 埋点分析 / 前端错误 | 事件、身份映射、会话、聚合、Tracking Plan、实验、错误组、错误事件、Source Map、告警历史 |
| `report.ts` / `report-platform.ts` | 报表中心 | 文件夹、数据源、数据集、仪表盘、订阅、投递、打印、质量规则、资产、填报等表 |
| `cms.ts` | CMS | 站点、模型、栏目、内容、素材、发布、采集、评论、页面搭建、表单、订阅、互动等表 |
| `mp.ts` | 微信公众号 | 账号、粉丝、标签、菜单、素材、群发、模板消息、客服、网页授权等表 |
| `open-platform.ts` | 开放平台 | OAuth2 客户端、授权、Token、API Scope、限流套餐、调用日志、统计、Webhook 等表 |
| `rules.ts` | 规则引擎 | 决策表、版本、测试用例、执行记录、资产版本、决策流、名单库 |
| `biz.ts` | 业务示例 | `biz_leaves`、`biz_pay_demos` |
| `app-releases.ts` | 应用发布 | `client_apps`、`app_releases`、`app_artifacts`、`app_release_events` |
| `wiki.ts` | 知识中心 | 空间、成员、文档、版本、模板、标签、评论、导入导出、治理表 |
| `common.ts` | 公共枚举 | 无表，提供 `statusEnum` 等跨域共享枚举 |
| `relations.ts` | 关联关系 | 无表，统一声明全部 `xxxRelations` |

新增表时在对应域文件声明 `pgTable`，关联写进 `relations.ts`，新建域文件时同步 `src/db/schema.ts` re-export。

### 通用审计字段（`created_by` / `updated_by`）

业务主表通过 `auditColumns()` 展开 `created_by` / `updated_by`。赋值由 `db/index.ts` 的 Proxy 统一注入：

- `runAsUser(userId, fn)` 覆盖优先；
- 其次读取请求上下文中的 `currentUserOrNull()`；
- 没有可用身份时写入 `null`；
- 拦截 `db.insert(table).values(...)`、`db.update(table).set(...)`、`db.insert(...).onConflictDoUpdate({ set })`，事务内 `tx` 同样生效。

Service、route、seed、cron 不手动赋值 `createdBy` / `updatedBy`。需要指定操作人时使用：

```ts
import { runAsUser } from '../lib/audit-context';

await runAsUser(adminId, async () => {
  await db.insert(xxxs).values(data);
});
```

典型不加审计列的表：纯关联表、追加型日志、临时凭证、IM 消息、天然已有操作者语义的运行时表。

## 数据库备份

系统内置数据库备份功能，路由在 `packages/server/src/routes/ops/db-backups.ts`，服务在 `services/ops/db-backups.service.ts` 与 `lib/db-backup.ts`。

### 菜单入口

系统设置 → 数据库备份（路由 `/system/db-backups`，权限 `system:db-backup:list`）。

### 操作说明

- 立即备份：创建 `pg_dump` 完整 SQL 压缩备份或 Drizzle 逻辑 JSON 导出。
- 删除备份：删除指定备份记录。
- 文件归档：配置默认 `file_storage_configs` 后，备份文件保存到文件存储，并在 `db_backups.file_id` 记录 `managed_files.id`。

### 前置条件

使用 `pg_dump` 类型时，服务器环境必须安装 PostgreSQL 客户端工具，并保证版本与数据库服务端兼容。
