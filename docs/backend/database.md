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

### 权限与用户体系

| 表名 | 说明 |
|------|------|
| `users` | 用户信息 |
| `roles` | 角色定义 |
| `menus` | 菜单与按钮权限 |
| `user_roles` | 用户与角色多对多 |
| `role_menus` | 角色与菜单多对多 |

### 组织架构

| 表名 | 说明 |
|------|------|
| `departments` | 部门（树形结构）|
| `positions` | 岗位 |
| `user_positions` | 用户与岗位多对多 |

### 基础配置

| 表名 | 说明 |
|------|------|
| `dicts` | 字典类型 |
| `dict_items` | 字典项 |
| `system_configs` | 系统配置项 |

### 文件存储

| 表名 | 说明 |
|------|------|
| `file_storage_configs` | 存储配置（local / OSS）|
| `managed_files` | 已上传文件记录（`url` 字段为服务端动态拼接，不存入数据库）|

### 通知与审计

| 表名 | 说明 |
|------|------|
| `notices` | 通知公告 |
| `notice_reads` | 通知已读记录 |
| `login_logs` | 登录日志 |
| `operation_logs` | 操作日志 |

### 任务调度

| 表名 | 说明 |
|------|------|
| `cron_jobs` | 定时任务配置与执行记录 |
