# AGENTS.md

`AGENTS.md` 是 Zenith Admin 的"项目说明书"，位于仓库根目录。主流 AI 工具（GitHub Copilot、Claude Code、Cursor 等）在进入项目时会自动读取此文件，从而了解项目架构、约定和常见陷阱。

---

## 包含内容

### 技术栈与架构约定

- 后端 Hono 路由规范（统一响应格式、认证中间件、Zod 校验）
- 前端 Semi Design 使用规则（图标来源、时间格式、组件用法）
- 共享层说明（`@zenith/shared` 直接引用 `.ts` 源文件，无需编译）

### 常用命令

```bash
npm run dev            # 同时启动 server + web 开发服务器
npm run db:generate    # 生成 Drizzle 迁移文件
npm run db:migrate     # 执行数据库迁移
npm run db:seed        # 填充初始种子数据
```

### 页面布局规范

- 列表页搜索区使用 `<div className="search-area">` 包裹
- 搜索栏用 `flex + justifyContent: space-between`（搜索条件 + 查询/重置按钮在左，新增按钮在右）
- 操作列按钮：`theme="borderless"` 纯文字，无图标，必须 `fixed: 'right'`
- 表格统一使用 `<Table bordered>`

### Demo 演示模式（MSW Mock）

新增业务模块时，必须同步在 `data/` 和 `handlers/` 中添加对应的 MSW mock。

### 常见陷阱

- 修改数据库 schema 后，必须运行 `npm run db:generate` 再 `npm run db:migrate`
- 枚举值在 pgEnum、TypeScript union、Zod enum 三处必须保持一致
- 操作列必须设置 `fixed: 'right'`

---

## 已内置的项目上下文

AI 在生成代码时会自动遵守以下约定：

| 约定 | 规则 |
| --- | --- |
| API 响应格式 | `{ code, message, data }` |
| 时间显示 | 使用 `formatDateTime()` 工具函数 |
| 图标来源 | `lucide-react`，禁止使用 `@douyinfe/semi-icons` |
| 分页响应 | `{ list, total, page, pageSize }` |
| Token 存储 | `localStorage`，Access Token key 为 `zenith_token`，Refresh Token key 为 `zenith_refresh_token` |

---

## 如何维护

当你修改了项目的架构约定（如新增组件规范、修改 API 格式、添加新中间件），应同步更新 `AGENTS.md`，确保 AI 工具获取最新信息。

```bash
# 典型需要更新 AGENTS.md 的场景：
# - 新增了全局中间件
# - 修改了统一响应格式
# - 约定了新的命名规范
# - 新增了必须遵守的布局规则
```
