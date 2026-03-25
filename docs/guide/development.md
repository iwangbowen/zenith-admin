# 本地开发

这一页聚焦开发过程中的常用命令、协作约定和容易踩坑的点。

## 常用命令

### 项目开发

```bash
npm run dev
npm run dev:server
npm run dev:web
```

### 数据库相关

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

### 文档站

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

## 推荐开发顺序

1. 修改共享类型或校验规则时，优先更新 `packages/shared/src/`。
2. 修改数据库 schema 后，先执行 `npm run db:generate`，再执行 `npm run db:migrate`。
3. 页面开发时，优先复用现有请求封装与页面布局规范，避免“一个页面一个风格”。
4. 文档有新增内容时，同步补充到 `docs/`，让站点成为可浏览的项目入口。

## monorepo 协作方式

- `packages/server`：后端服务与数据库操作
- `packages/web`：管理后台前端
- `packages/shared`：共享类型、常量、Zod schema

共享层直接引用 TypeScript 源文件，无需额外编译流程。

## 常见注意事项

### 数据库迁移不要手改 SQL

修改 `packages/server/src/db/schema.ts` 后，应该通过 Drizzle 生成迁移，而不是直接改已有 SQL 文件。

### 时间显示统一格式

前端时间统一使用 `YYYY-MM-DD HH:mm:ss`，并通过 `packages/web/src/utils/date.ts` 中的 `formatDateTime` 处理。

### 图标统一使用 `lucide-react`

前端页面与操作入口统一使用 `lucide-react`，不要引入 `@douyinfe/semi-icons`。

## 发布新版本

当需要发布新版本时，参考 Zenith Skill 中的「发布新版本流程」，或按以下步骤操作：

1. 更新四个 `package.json` 中的版本号（根 + server + web + shared）
2. 在 `docs/changelog/index.md` 顶部追加本版本变更记录
3. 提交并推送到 `master`
4. 打 tag 并推送，触发 Release 工作流：

```bash
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions `release.yml` 将自动完成构建 → 打包 → 创建 GitHub Release。
