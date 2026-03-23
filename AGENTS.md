# Zenith Admin — AI 协作指南

Zenith Admin 是一个基于 **Hono + React + Drizzle ORM** 的全栈后台管理系统，采用 npm monorepo 结构。

---

## 项目结构

```
packages/
├── server/   Hono HTTP 服务，Drizzle ORM，PostgreSQL，JWT 认证
├── web/      React 19 + Vite + Semi Design 前端
└── shared/   前后端共享的 TypeScript 类型 + Zod 验证 schema
```

---

## 常用命令

```bash
npm run dev            # 同时启动 server + web 开发服务器
npm run dev:server     # 仅启动后端（端口 3000）
npm run dev:web        # 仅启动前端（端口 5173）
npm run build          # 顺序构建：shared → server → web
npm run db:generate    # 生成 Drizzle 迁移文件
npm run db:migrate     # 执行数据库迁移
npm run db:seed        # 填充初始种子数据
```

---

## 架构约定

### 后端（`packages/server`）

- **框架**：Hono v4，通过 `@hono/node-server` 运行在 Node.js
- **路由**：所有路由挂载在 `/api` 前缀，文件位于 `src/routes/`
- **认证**：JWT Bearer Token，7 天有效期；`src/middleware/auth.ts` 中 `authMiddleware` 注入 `c.set('user', payload)`
- **验证**：所有入参必须通过 `schema.safeParse()` 校验；失败返回 `{ code: 400, message: '...' }`
- **统一响应**：`{ code: 0, message: 'success', data: T }`，失败时 `code` 为非零值
- **数据库**：Drizzle ORM + PostgreSQL，schema 定义在 `src/db/schema.ts`，迁移文件在 `drizzle/`
- **枚举同步**：数据库 pg enum、TypeScript union type、Zod enum **三者必须保持一致**

### 前端（`packages/web`）

- **UI 库**：Semi Design v2（`@douyinfe/semi-ui`）— 使用 Semi Design 组件时先查阅 `.claude/skills/semi-ui-skills/`
- **图标**：统一使用 `lucide-react`，禁止引入 `@douyinfe/semi-icons`
- **路由**：`react-router-dom` v7，页面组件位于 `src/pages/`
- **认证状态**：`useAuth` hook，token 存储在 `localStorage`，key 为 `zenith_token`（来自 `@zenith/shared` constants）
- **HTTP 请求**：封装在 `src/utils/request.ts`，自动附加 Bearer token 和处理 401 跳转
- **环境变量**：`VITE_API_BASE_URL`（API 地址）、`VITE_APP_TITLE`（应用名）

### 共享层（`packages/shared`）

- 直接引用 `.ts` 源文件，**无需编译步骤**
- `types.ts`：所有实体类型（`User`, `Menu`, `Role`, `Dict` 等）及 `ApiResponse<T>`, `PaginatedResponse<T>`
- `validation.ts`：Zod schema，前后端共用，**禁止在 server/web 中重复定义**
- `constants.ts`：枚举常量（角色、状态、存储提供方等）

### 分页规范

所有列表接口返回 `PaginatedResponse<T>`：`{ list, total, page, pageSize }`

---

## 文件存储

支持两种存储模式，通过 `file_storage_configs` 表中的 `is_default` 字段切换：

- **local**：本地文件系统
- **oss**：阿里云 OSS（依赖 `ali-oss`）

相关逻辑在 `packages/server/src/lib/file-storage.ts`。

---

## 数据库说明

默认连接：`postgresql://postgres:postgres@localhost:5432/zenith_admin`（可通过 `.env` 覆盖）

主要表：`users`, `menus`, `roles`, `role_menus`, `dicts`, `dict_items`, `file_storage_configs`, `managed_files`

---

## 时间格式规范

前端所有时间显示**统一使用 `YYYY-MM-DD HH:mm:ss` 格式**（如 `2026-03-23 14:30:00`）。

- 所有时间处理**必须**使用第三方库 `dayjs` 统一接管。
- 使用 `packages/web/src/utils/date.ts` 中的 `formatDateTime(date)` 工具函数，该函数已内嵌了 `dayjs` 逻辑。
- 禁止在组件中直接调用 `toLocaleString()`、`toLocaleDateString()`、`toLocaleTimeString()` 等原生方法。
- `formatDateTime` 接受 `Date | string | number | null | undefined` 类型参数，对所有页面统一生效。

---

## 常见陷阱

- 修改数据库 schema 后，必须运行 `npm run db:generate` 再 `npm run db:migrate`，不能直接修改 SQL
- `@zenith/shared` 中新增类型/schema 后，无需重新构建，server 和 web 会直接引用源文件
- Semi Design 组件查询请使用 `.claude/skills/semi-ui-skills/SKILL.md` 中的 MCP 工具流程
- CORS 当前允许所有来源（开发配置），生产部署前需收紧

### 列表规范

- 所有的表格页面的“操作”列必须设置右侧固定（`fixed: 'right'`）。
