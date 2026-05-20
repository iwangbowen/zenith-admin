# 数据库与迁移

项目使用 **PostgreSQL + Drizzle ORM** 管理数据库结构与迁移。

## 默认连接

默认连接字符串如下，可通过 `.env` 覆盖：

```ini
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zenith_admin
```

## 相关目录

- `packages/server/src/db/schema.ts`：数据库 schema 定义
- `packages/server/src/db/types.ts`：统一数据库类型别名（`Db` / `DbTransaction` / `DbExecutor`）
- `packages/server/src/db/migrate.ts`：迁移执行入口
- `packages/server/src/db/seed.ts`：种子数据入口
- `packages/server/drizzle/`：生成的迁移文件

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

### 组织架构

| 表名 | 说明 |
| --- | --- |
| `departments` | 部门（树形结构，含 `tenant_id`） |
| `positions` | 岗位（含 `tenant_id`） |
| `user_positions` | 用户与岗位多对多 |

### 基础配置

| 表名 | 说明 |
| --- | --- |
| `dicts` | 字典类型 |
| `dict_items` | 字典项 |
| `system_configs` | 系统配置项（key-value 格式，含 configType 枚举） |

### 文件存储

| 表名 | 说明 |
| --- | --- |
| `file_storage_configs` | 存储配置（local / OSS / S3 / COS） |
| `managed_files` | 已上传文件记录（`url` 字段由服务端动态拼接，不存入数据库） |

### 通用审计字段（`created_by` / `updated_by`）

所有业务主表均含 `created_by` / `updated_by` 两列（指向 `users.id`，`ON DELETE SET NULL`），由 schema 中的 [`auditColumns()`](../../packages/server/src/db/schema.ts) 展开。赋值由 [`db/index.ts`](../../packages/server/src/db/index.ts) 的 Proxy 统一拦截：

- **读取顺序**：`overrideStore`（`runAsUser()` 包裹）→ 请求上下文中的当前用户（`auth` 中间件设置）→ `null`。
- **拦截点**：`db.insert(t).values(d)` / `db.update(t).set(d)` / `db.insert(t).values(d).onConflictDoUpdate({set})` 及其在 `db.transaction()` 中的子事务版本。
- **严禁**：service / route / seed / cron 任意位置手动赋值 `createdBy` / `updatedBy`。
- **例外**（**不**加审计列）：
  - 多对多关联表：`user_roles`、`user_positions`、`role_menus`、`notice_reads`、`notice_recipients`、`chat_conversation_members`、`chat_message_reactions`
  - 追加型日志：`login_logs`、`operation_logs`、`cron_job_logs`、`email_send_logs`、`sms_send_logs`、`in_app_messages`
  - 用户自身/临时凭证：`user_oauth_accounts`、`password_reset_tokens`、`chat_messages`
  - 工作流运行时：`workflow_tasks`
- **种子数据**：`db/seed.ts` 主函数被 `runAsUser(adminId, ...)` 包裹，所有种子记录的创建人 / 修改人默认为 admin。

### 通知与审计

| 表名 | 说明 |
| --- | --- |
| `notices` | 通知公告（富文本 `text` 字段） |
| `notice_reads` | 通知已读记录 |
| `login_logs` | 登录日志 |
| `operation_logs` | 操作日志（含 `before_data` / `after_data` JSON 快照）|

### 任务调度

| 表名 | 说明 |
| --- | --- |
| `cron_jobs` | 定时任务配置（名称、Handler、Cron 表达式、启用状态） |
| `cron_job_logs` | 任务执行日志（开始时间、结束时间、状态、输出） |

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

## 数据库备份

从 v0.1.4 起，系统内置数据库备份功能，基于 `pg_dump` 命令生成 PostgreSQL 完整备份文件。

### 菜单入口

**系统设置 → 数据库备份**（路由：`/system/db-backups`，权限：`system:db-backup:list`）

### 操作说明

- **立即备份**：手动触发 `pg_dump`，生成 `.sql` 备份文件并保存到服务器本地
- **删除备份**：删除服务器上的指定备份文件

### 前置条件

服务器环境必须安装 `pg_dump` 工具（PostgreSQL 客户端工具包），且版本需与数据库服务端版本兼容：

```bash
# Ubuntu / Debian
apt-get install postgresql-client

# 验证安装
pg_dump --version
```

### 备份文件存储位置

备份文件默认保存在后端服务的 `./backups/` 目录下。路径可通过后端环境变量 `BACKUP_DIR` 自定义：

```ini
# packages/server/.env
BACKUP_DIR=./backups
```

### 相关接口

- `GET /api/db-backups`：获取备份列表
- `POST /api/db-backups`：触发立即备份
- `DELETE /api/db-backups/{id}`：删除指定备份记录

### 定期自动备份建议

当前内置功能仅支持手动触发。如需定期自动备份，可通过**定时任务模块**实现：

1. 在 `cron-scheduler.ts` 中注册一个备份 Handler
2. 在「定时任务」页面创建任务，绑定该 Handler，设置适合的 Cron 表达式（如每天凌晨 2 点）

> **生产建议**：建议将备份文件定期同步到对象存储（如阿里云 OSS、AWS S3），避免仅依赖本地磁盘存储。
