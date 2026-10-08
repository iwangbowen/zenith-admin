# 数据库与迁移

项目使用 PostgreSQL（**≥ 15**，唯一约束依赖 `NULLS NOT DISTINCT`）+ Drizzle ORM 管理数据库结构与迁移。Server 工作区的 Drizzle 配置在 `packages/server/drizzle.config.ts`，schema 入口是 `packages/server/src/db/schema.ts`，迁移目录是 `packages/server/drizzle/`。

## 默认连接

`.env` 通过 `DATABASE_URL` 配置数据库连接：

```ini
DATABASE_URL=postgres://postgres:postgres@localhost:5432/zenith_admin
```

运行时连接池参数由 `config.database` 控制（`DATABASE_MAX_CONNECTIONS` 默认 20、`DATABASE_IDLE_TIMEOUT_SECONDS` 默认 20、
`DATABASE_CONNECT_TIMEOUT_SECONDS` 默认 10），`db/index.ts` 经 `db/client.ts` 的 `createPgClient()` 创建单例连接池（会话时区固定 UTC，见「时间与时区」）。
这一个池由 HTTP、WebSocket、任务 worker、事件订阅、指标采样与 CMS SSR 同进程共用；pg-boss 与 Mastra 各自另开独立连接池，
容量核算与多实例部署的取值见 [部署指南](../guide/deployment.md)。

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

迁移入口 `packages/server/src/db/migrate.ts` 使用 Drizzle migrator 执行 `./drizzle`。开发启动脚本 `scripts/dev.mjs` 依次执行迁移、seed 与服务，任一步失败都会阻断后续启动。生产 `npm start` 只启动服务，部署时必须先显式执行 `npm run db:migrate`（源码）或 `npm run start:migrate -w @zenith/server`（编译产物）；初始化内置数据时另行执行 seed。Docker Compose 由一次性 `migrate` 服务执行迁移，api / worker 等待其成功完成后启动，seed 仍需显式执行。具体命令见[部署指南](../guide/deployment.md)与[Docker 部署](../guide/docker.md)。

## 重要约定

### 迁移文件来源

结构变更先改 `src/db/schema/`，再由 `drizzle-kit generate` 生成迁移 SQL。不要手工改写已生成迁移来适配代码。仅 Drizzle schema 无法表达的 DDL 可使用 custom migration，例如扩展、条件 DDL。重建基线时允许补齐前置 `pg_trgm`、三张分区父表的 `PARTITION BY`，并将唯一索引排在依赖它的外键之前；列、外键与索引仍由当前 schema 生成，具体步骤见下方「重建基线」。

### 迁移目录

当前 `packages/server/drizzle/` 以 `0000_baseline.sql` 与 `0001_extensions.sql` 为迁移基线，执行顺序由 `drizzle/meta/_journal.json` 管理。此前增量的结构变更已合入当前基线，旧结构转换与历史数据回填不再保留。全新数据库执行 `npm run db:migrate` 会按该顺序建库，再由 `npm run db:seed` 初始化当前菜单与内置数据。

`0001_extensions.sql` 收口维护 Drizzle schema 无法表达的手写 DDL：

- 条件启用 pgvector：`CREATE EXTENSION IF NOT EXISTS vector`（扩展可用才建，否则静默跳过；扩展创建与条件 DDL 均超出 Drizzle 表达范围）。它服务于 Mastra PgVector——知识库向量存放在 `mastra` schema（索引 `kb_{kbId}`），`ai_kb_chunks` 只存分块文本，业务表上没有任何 `vector` 列；无 pgvector 的部署除知识库向量化外照常工作。
- `iot_telemetry` 的 RANGE 日分区初始子分区（见下文「分区表」）。
- `drive_activities` / `drive_share_access_logs` 的 RANGE 月分区初始子分区（见下文「分区表：企业网盘日志」）。
- 跨实例缓存失效广播：通用触发器函数 `notify_cache_invalidate()`，以及 `system_settings`、`data_mask_policies`、`users`、`tenants`、`members`、`user_api_tokens`、`tenant_packages`、`tenant_package_features` 上的触发器；服务端 `lib/invalidation-bus.ts` 监听该频道，见[运行时设置](./settings.md)。`onInvalidate(topic)` 订阅的每张表都必须在此挂触发器（`invalidation-triggers.test.ts` 守卫）。
- CMS 不可变事实：`cms_immutable_revision()`（修订、审批、复审、模型 / 资源 / 组件 / 页面预设 / 集合版本、发布激活）、`cms_release_configuration_immutable()`（发布单输入）、`cms_feedback_history_immutable()` 与 `cms_editorial_history_immutable()`（只追加历史）及其触发器。
- 只读执行角色 `zenith_readonly`（NOLOGIN，仅 SELECT），供用户手写 SQL 在事务内 `SET LOCAL ROLE` 切换；无 CREATEROLE 权限的部署跳过创建并告警，服务端降级为白名单 + READ ONLY，见[数据平台 · 安全边界](../ops/data-platform.md#安全边界)。
- 条件启用 `pg_stat_statements`：扩展可用时创建数据库扩展；PostgreSQL 仍必须在启动配置中预加载 `pg_stat_statements`，否则 SQL 监控保留降级提示。

三张分区父表直接在 `0000_baseline.sql` 中以 `PARTITION BY RANGE` 创建，列、外键与索引只在基线中定义一次。`0001_extensions.sql` 只预建初始子分区，不删除或重建父表；修改这些表后，按当前 schema 生成结构变更，并保留各自的分区键与 UTC 边界。

`pg_trgm` 扩展在 `0000_baseline.sql` 顶部创建；trigram 索引（含 `async_tasks.payload/result` 的「表达式 + gin_trgm_ops」形态）已全部收进 schema DSL，由 `drizzle-kit generate` 随基线生成。

后续新增无法表达的 DDL 时，用 `drizzle-kit generate --custom` 建独立迁移；重建基线时将其内容并回 `0001_extensions.sql`。

### 重建基线

基线重建删除旧迁移链，由当前 schema 重新生成 `0000_baseline`，再收口仍需手写的 DDL。
当前基线**不提供旧结构或历史数据兼容**：既有数据库必须停止全部 api / worker / `all` 进程，删除旧数据库并显式创建空库，再执行迁移与 seed；部署步骤见[部署指南 → 迁移基线重建](../guide/deployment.md#迁移基线重建)。下面的步骤用于生成与验证新迁移链：

1. 结构快照：重建前用现有迁移链建一个空库，执行 `packages/server/scripts/schema-catalog.sql` 保存结构清单。
2. 收集手写 DDL：在旧链中检索 `CREATE FUNCTION|CREATE TRIGGER|CREATE VIEW|DO \$\$|PARTITION|CREATE ROLE|GRANT|CREATE EXTENSION`，保留当前 schema 无法表达且仍需使用的能力；数据回填、旧表转换与菜单兼容修正不保留。
3. 删除 `packages/server/drizzle/` 下全部文件；`npx drizzle-kit generate --name baseline` 生成 `0000_baseline.sql` 与快照。
4. 补齐生成基线中的必要 DDL：在首个依赖 trigram 的索引之前创建 `pg_trgm`；为 `iot_telemetry` 声明 `PARTITION BY RANGE ("reported_at")`，为 `drive_activities` 和 `drive_share_access_logs` 声明 `PARTITION BY RANGE ("created_at")`；将唯一索引排在外键之前，确保引用唯一索引列的外键能成功创建。保留由 schema 生成的列、外键和索引定义，运行 `migration-baseline.test.ts` 检查这些约束。
5. `npx drizzle-kit generate --custom --name extensions` 生成空的 `0001_extensions.sql`，仅写入扩展、初始子分区、触发器、函数与执行角色等手写能力，不重复定义父表、外键或索引，不执行旧结构或历史数据转换。
6. 全新库跑 `npm run db:migrate && npm run db:seed`，再执行一次 `drizzle-kit generate` 确认输出 `No schema changes`。
7. 结构比对：对新库执行同一查询，与第 1 步的清单比对；除本次 schema 有意的改动外不得有差异（缺失的行通常是漏并的触发器 / 函数）。

### 分区表：`iot_telemetry`

`0000_baseline.sql` 直接把 IoT 遥测明细建为 PostgreSQL 原生 **RANGE 日分区表**，`0001_extensions.sql` 预建初始子分区（按 `reported_at`（timestamptz）的 UTC 日边界，分区命名 `iot_telemetry_pYYYYMMDD`）。约定如下：

- 分区边界一律写带 `+00` 的字面量（初始分区与 `iot-partitions.service.ts` 同口径）；`pg_get_expr(relpartbound)` 按会话时区渲染偏移，解析时按带偏移的时刻处理。

- Drizzle schema 与快照仍描述列 / 索引 / 外键（父表定义自动继承到每个分区）；`PARTITION BY` 保留在 `0000_baseline.sql`，初始子分区保留在 `0001_extensions.sql`，重建基线时必须一并保留。
- 表没有代理主键：明细只按 `(device_id, reported_at)` 范围读取，主键索引纯属写放大，且分区键必须进主键的限制让 `id` 失去意义。
- 分区生命周期由 `services/iot/iot-partitions.service.ts` 负责：启动与每小时任务「IoT 遥测分区维护」滚动预建未来 7 天；写入命中「无分区」错误时按批次内日期补建后重试；保留策略 `iot_telemetry` 走 `custom` 模式，按分区上界整表 `DROP`（秒级、零膨胀），写入侧同时丢弃早于保留窗口的回填点。
- `drizzle-kit generate` 不会感知子分区（它只对比 schema 与快照），因此新增 / 删除分区无需迁移；但**不要**在 schema 中给该表加回 `id` 或改分区键列，否则生成的 `ALTER` 会作用于分区父表并破坏分区布局。

### 分区表：企业网盘日志

企业网盘的 `drive_activities` 与 `drive_share_access_logs` 同样使用原生 RANGE 分区，
但按 `created_at`（timestamptz）的 **UTC 月边界**划分，保留 `id` 作为无主键的 identity 展示序号。
分区父表、外键与索引直接在 `0000_baseline.sql` 创建，初始子分区在 `0001_extensions.sql`；生命周期由
`services/drive/drive-partitions.service.ts` 维护，保留策略只删除完整过期月份。
模型与运行规则见[企业网盘](../drive/reference.md)。

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

全库约 520 张表，schema 按业务域拆分在 `packages/server/src/db/schema/`。`src/db/schema.ts` 是 barrel，业务代码导入方式保持：

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
| `data-mask.ts` | 数据脱敏 | `data_mask_policies` |
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

### 时间与时区

**存储**：表示时刻的列一律 `timestamptz`。表文件写 `timestamptz()`，创建 / 更新时间展开 `...timestampColumns()`（`created_at` 默认 `now()`，`updated_at` 默认 `now()` 并由 drizzle `$onUpdate` 在每次 UPDATE 时刷新，业务代码不手动传 `updatedAt`）；只有 `created_at` 的追加型表单独声明 `createdAt: timestamptz().defaultNow().notNull()`。纯日期用 `date({ mode: 'string' })`；按某个 IANA 时区解释的当地钟点（如排期）以 `YYYY-MM-DD HH:mm:ss` 文本与时区一起存放，SQL 中用 `(文本)::timestamp AT TIME ZONE <时区>` 换成时刻。`db/schema-time-columns.test.ts` 保证全部时间列带时区。

**会话时区**：连接主库只用 `db/client.ts` 的 `createPgClient()`，会话 `TimeZone` 固定为 `UTC`（连接启动参数，优先于 `postgresql.conf`、`ALTER DATABASE` 与 `ALTER ROLE`），数据库服务端与宿主机的时区设置不影响应用。用户手写 SQL（数据库控制台、导出、报表 SQL 数据集、数据质量自定义 SQL）、数据库管理的数据浏览 / 编辑 / 导入与 psql 终端在 `APP_TIME_ZONE` 会话下执行，结果与日期函数按业务时区呈现。

**业务时区**：`APP_TIME_ZONE`（IANA 名，默认 `Asia/Shanghai`，启动时校验）是唯一的业务时区，与进程 `TZ`、数据库时区无关。入参用 `parseDateTimeInput()` / `parseDateRangeStart()` / `parseDateRangeEnd()` 解析为 `Date`，出参用 `formatDateTime()` / `formatDate()`，统计窗口用 `startOfToday()` / `startOfDayAgo(n)` / `resolveStatsWindow()`。

**SQL 分桶与日界**（`lib/datetime-sql.ts`，时区字面量内联、不占参数，同一表达式可同时用于 SELECT / GROUP BY / ORDER BY）：

| 场景 | 写法 |
| --- | --- |
| 按自然日分组 | `localDate(col)` → `'YYYY-MM-DD'` |
| 按月 / 整点等其它格式 | `localFormat(col, 'YYYY-MM')`、`localFormat(col, 'YYYY-MM-DD HH24:00')` |
| 小时 / 星期分布 | `extract(hour from ${localTime(col)})` |
| 截断到当地整点 / 零点 / 月初（结果仍是时刻） | `localTrunc('day', col)` |
| 「今日 / n 天前」零点 | `localDayStart(n)` |

**SQL 时间参数**：经列映射传 `Date`（drizzle 条件、`sql.param(date, column)`），或 `date.toISOString()` 加 `::timestamptz`。

**禁止**（`lib/datetime-sql.guard.test.ts` 扫描）：`CURRENT_DATE`；`::timestamp`（当地钟点文本换算除外，且须紧跟 `AT TIME ZONE`）；`AT TIME ZONE 'UTC' AT TIME ZONE …`；把 `formatDateTime()` 文本当 SQL 时间参数；对时间列直接 `date()`、`to_char()`、两参 `date_trunc()`、`extract(hour | isodow …)`——这些写法依赖会话时区，结果按 UTC 而非业务时区切分。

## 数据库备份

数据库备份是「数据库管理」页的「备份」Tab（`/system/db-admin?tab=backups`），接口挂在 `/api/db-admin/backups`
（路由 `packages/server/src/routes/ops/db-admin.ts`，服务 `services/ops/db-admin-backups.service.ts`，
执行器 `lib/db-backup.ts`），记录存放在 `db_backups` 表；定时任务 handler `databaseBackup` 复用同一执行器与表。

### 权限

查看备份列表复用 `system:db-admin:view`；创建 / 删除与活动连接、表维护等运维操作一样要求 `system:db-admin:maintain`。

### 操作说明

- 立即备份：创建 `pg_dump` 完整 SQL 压缩备份或 Drizzle 逻辑 JSON 导出；接口立即返回 `pending` 回执，任务在后台执行，
  列表在有未完成记录时自动轮询直到落为 `success` / `failed`。
- 删除备份：删除备份记录，并把归档文件置为 `orphan`，交由文件 GC 在宽限期后回收对象（宽限期见 `FILE_GC_GRACE_HOURS`）。
- 文件归档：配置默认 `file_storage_configs` 后，备份文件保存到文件存储，并在 `db_backups.file_id` 记录 `managed_files.id`。
  归档文件以 `visibility = 'restricted'` 登记：备份是整库数据，通用 `GET /api/files/{id}/content`（无鉴权公开接口）
  对它一律 404，列表中的「下载」走带 `system:db-admin:view` 校验的 `GET /api/db-admin/backups/{id}/download`。

### 前置条件

使用 `pg_dump` 类型时，服务器环境必须安装 PostgreSQL 客户端工具，并保证版本与数据库服务端兼容
（pg_dump 主版本低于服务端会以「server version mismatch」拒绝导出）。可执行文件默认按 `PATH` 查找，
可用 `PG_DUMP_PATH` 环境变量指定路径（psql 终端同理用 `PSQL_PATH`）。

`pg_dump` 由服务端直接 `spawn`（不经 shell 管道），连接参数从 `DATABASE_URL` 解析后经 `PGPASSWORD` 等
环境变量注入，gzip 压缩由 Node 完成：以 pg_dump 的退出码与 stderr 判定成败，客户端缺失、连接 / 认证失败、
版本不匹配都会把记录置为 `failed` 并把原因写入 `errorMessage`，不会留下空 gzip 文件。
