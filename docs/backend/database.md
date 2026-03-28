# 数据库与迁移

项目使用 **PostgreSQL + Drizzle ORM** 管理数据库结构与迁移。

## 默认连接

默认连接字符串如下，可通过 `.env` 覆盖：

```ini
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zenith_admin
```

## 相关目录

- `packages/server/src/db/schema.ts`：数据库 schema 定义
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

## 主要表

### 多租户（可选）

| 表名 | 说明 |
|------|------|
| `tenants` | 租户定义（名称、唯一编码、有效期、最大用户数）|

### 权限与用户体系

| 表名 | 说明 |
|------|------|
| `users` | 用户信息（含 `tenant_id`、`locked_until`、`passwordUpdatedAt`）|
| `roles` | 角色定义 |
| `menus` | 菜单与按钮权限 |
| `user_roles` | 用户与角色多对多 |
| `role_menus` | 角色与菜单多对多 |

### 组织架构

| 表名 | 说明 |
|------|------|
| `departments` | 部门（树形结构，含 `tenant_id`）|
| `positions` | 岗位（含 `tenant_id`）|
| `user_positions` | 用户与岗位多对多 |

### 基础配置

| 表名 | 说明 |
|------|------|
| `dicts` | 字典类型 |
| `dict_items` | 字典项 |
| `system_configs` | 系统配置项（key-value 格式，含 configType 枚举）|

### 文件存储

| 表名 | 说明 |
|------|------|
| `file_storage_configs` | 存储配置（local / OSS）|
| `managed_files` | 已上传文件记录（`url` 字段由服务端动态拼接，不存入数据库）|

### 通知与审计

| 表名 | 说明 |
|------|------|
| `notices` | 通知公告（富文本 `text` 字段）|
| `notice_reads` | 通知已读记录 |
| `login_logs` | 登录日志 |
| `operation_logs` | 操作日志（含 `before_data` / `after_data` JSON 快照）|

### 任务调度

| 表名 | 说明 |
|------|------|
| `cron_jobs` | 定时任务配置（名称、Handler、Cron 表达式、启用状态）|
| `cron_job_logs` | 任务执行日志（开始时间、结束时间、状态、输出）|

### 行政区划

| 表名 | 说明 |
|------|------|
| `regions` | 行政区划数据（五级：省/市/区/街道/乡镇，`parent_code` 树形结构）|

### 安全与认证

| 表名 | 说明 |
|------|------|
| `email_configs` | SMTP 邮件配置（主机、端口、加密方式、授权密码）|
| `oauth_configs` | OAuth 提供方配置（Client ID / Secret，按 provider 区分）|
| `user_oauth_accounts` | 用户第三方账号绑定（openId、nickname、avatar）|
| `user_api_tokens` | 用户个人 API Token（用于第三方接口调用）|
| `password_reset_tokens` | 密码重置 Token（含过期时间，支持找回密码流程）|
| `db_backups` | 数据库备份记录（文件名、大小、状态、备份类型）|
