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

- `users`
- `menus`
- `roles`
- `role_menus`
- `dicts`
- `dict_items`
- `file_storage_configs`
- `managed_files`

这些表构成了后台系统最主要的权限、字典和文件管理能力。
