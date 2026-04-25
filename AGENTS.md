# Zenith Admin — AI 协作指南

Zenith Admin 是一个基于 **Hono + React + Drizzle ORM** 的全栈后台管理系统，采用 npm monorepo 结构。

---

## 项目结构

```text
packages/
├── server/   Hono HTTP 服务，Drizzle ORM，PostgreSQL，JWT 认证
├── web/      React 19 + Vite + Semi Design 前端
└── shared/   前后端共享的 TypeScript 类型 + Zod 验证 schema
```

---

## 常用命令

```bash
npm run dev            # 同时启动 server + web 开发服务器
npm run dev:server     # 仅启动后端（端口 3300）
npm run dev:web        # 仅启动前端（端口 5373）
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
- **认证**：JWT Bearer Token，7 天有效期；`src/middleware/auth.ts` 中 `authMiddleware` 注入 `c.set('user', payload)`；签发/校验统一走 `src/lib/jwt.ts` 的 `signToken` / `verifyToken`（基于 `hono/jwt`）
- **请求上下文**：全局挂载 `hono/context-storage`，辅助函数可用 `src/lib/context.ts` 的 `currentUser()` / `getCtx()` 零参取值，无需再层层透传 `c` 或 `user`
- **路由定义模式**：所有路由文件统一使用 `defineOpenAPIRoute` + `router.openapiRoutes()` 模式（参考 `src/routes/api-tokens.ts`）。不使用 `<AuthEnv>` 泛型，不添加全局 `router.use('*', authMiddleware)`；每个受保护路由在 `createRoute` 的 `middleware: [authMiddleware, guard(...)] as const` 中显式声明。收集所有路由常量后调用 `router.openapiRoutes([route1, route2, ...] as const)` 统一注册
- **Service 层**：业务逻辑、数据映射、前置校验从路由中提取到 `src/services/xxx.service.ts`（已覆盖所有路由）。命名约定：`mapXxx`（数据映射，纯函数）、`ensureXxx`（前置校验，抛 `AppError`）。**禁止**在 service 中调用 `c.json()`、直接访问 Hono `Context`、使用 `console.*`；需要当前登录用户时统一通过 `src/lib/context.ts` 的 `currentUser()` 获取（依赖全局 `contextStorage()`）。路由 handler 只负责取参数、调 service、返回 HTTP 响应。DB 唯一约束异常（PG 错误码 `23505`）统一在 service 中通过 `src/lib/db-errors.ts` 的 `rethrowPgUniqueViolation(err, msg)` 映射为 `AppError`。`AppError` 定义在 `src/lib/errors.ts`，由 `src/index.ts` 的全局 `onError` 统一转为标准 JSON 错误响应。
- **验证**：所有入参通过 `@hono/zod-openapi` 的 `createRoute` 声明 Zod schema 后自动校验，路由内用 `c.req.valid()` 取已验证数据；`defaultHook: validationHook` 自动将校验失败转为 `{ code: 400, message: '...', data: null }`
- **响应辅助函数**：`src/lib/openapi-schemas.ts` 提供三个路由 `responses:` 块快捷函数（必须使用展开语法）：`...ok(DTO, desc)`（单对象 200 响应）、`...okPaginated(DTO, desc)`（分页 200 响应）、`...okMsg(desc)`（仅消息的 200 响应）；**禁止**直接写 `200: { content: jsonContent(apiResponse(DTO)) }`。同文件还提供两个响应 **body** 构造函数：`okBody(data, msg?)` 构造成功响应体（`{ code: 0 as const, message, data }`），`errBody(msg, code?)` 构造错误响应体（`{ code, message, data: null }`）；路由 handler 中**必须**使用 `c.json(okBody(data), 200)` / `c.json(errBody(msg, 404), 404)` 模式，**禁止**内联写 `{ code: 0 as const, message, data }` 字面量对象。另外提供 `IdParam`（数值 id path 参数）、`PaginationQuery`（分页 query）、`BatchIdsBody`（批量操作 body）等公共 schema
- **DTO 中心化**：所有响应实体 DTO 按业务域拆分至 `src/lib/dtos/`（`iam.ts` / `auth.ts` / `dict.ts` / `files.ts` / `logs.ts` / `notices.ts` / `system.ts` / `workflow.ts` / `dashboard.ts` / `region.ts` / `messages.ts`），通过 `src/lib/openapi-dtos.ts`（re-export barrel）对外统一暴露。各路由文件通过 `import { XxxDTO } from '../lib/openapi-dtos'` 导入，**新增实体请直接在对应子文件中维护**。**禁止在路由文件内本地声明带 `.openapi('EntityName')` 的实体 DTO**，避免 Swagger Components 重复/冲突
- **统一响应**：`{ code: 0, message: 'success', data: T }`，失败时 `code` 为非零值；使用 `okBody(data, msg?)` / `errBody(msg, code?)` 构造响应体，禁止内联写字面量对象
- **数据库**：Drizzle ORM + PostgreSQL，schema 定义在 `src/db/schema.ts`，迁移文件在 `drizzle/`，统一数据库类型别名位于 `src/db/types.ts`；计数查询统一用 `db.$count(table, where)`；分页列表的 `total` 与 `list` 必须用 `Promise.all` **并行执行**；分页偏移量统一使用 `pageOffset(page, pageSize)` 工具函数（来自 `src/lib/pagination.ts`），禁止手写 `(page - 1) * pageSize`；关联数据查询优先使用 Drizzle RQB（`db.query.tableName.findMany/findFirst({ with: { relation: true } })`），尤其是通过联结表读取角色/岗位/菜单权限等场景，避免先查主表再手工二次聚合；`schema.ts` 已声明所有 `xxxRelations`，`db` 实例已传入 `schema`，可直接使用；若 helper 需要同时接受 `db` 与 `tx`，统一从 `src/db/types.ts` 导入 `DbExecutor` / `DbTransaction`，禁止使用 `Parameters<Parameters<typeof db.transaction>[0]>[0]` 之类的手工推导
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

支持四种存储模式，通过 `file_storage_configs` 表中的 `is_default` 字段切换：

- **local**：本地文件系统
- **oss**：阿里云 OSS（依赖 `ali-oss`）
- **s3**：S3 兼容对象存储（AWS S3 / MinIO / Cloudflare R2 等）
- **cos**：腾讯云 COS

相关逻辑在 `packages/server/src/lib/file-storage.ts`。

---

## 数据库说明

默认连接：`postgresql://postgres:postgres@localhost:5432/zenith_admin`（可通过 `.env` 覆盖）

主要表：`users`, `menus`, `roles`, `role_menus`, `dicts`, `dict_items`, `file_storage_configs`, `managed_files`

---

## Redis 说明

会话数据（在线会话、强制下线黑名单）通过 **Redis** 持久化，服务重启后不丢失。

默认连接：`redis://127.0.0.1:6379`（无密码）

通过 `.env` 文件配置（两种方式二选一）：

```env
# 方式一：URL 格式（支持带密码）
REDIS_URL=redis://127.0.0.1:6379
# REDIS_URL=redis://:your_password@127.0.0.1:6379/0

# 方式二：逐项配置
# REDIS_HOST=127.0.0.1
# REDIS_PORT=6379
# REDIS_PASSWORD=
# REDIS_DB=0
```

Redis key 规范：

所有 key 带统一命名空间前缀（默认 `zenith:`，可通过 `REDIS_KEY_PREFIX` 环境变量覆盖）：

- `zenith:session:{tokenId}` — SessionInfo JSON，TTL 8h（每次请求自动续期）
- `zenith:blacklist:{tokenId}` — 强制下线标记，TTL 2h（与 accessToken 有效期一致）

---

## 请求防护（Body Limit & Timeout & CSRF & 限流）

服务端提供多层可选请求防护，通过环境变量控制：

```env
# 请求体大小上限（字节），0 = 不限制（使用运行时默认）
REQUEST_BODY_LIMIT=0
# 请求超时（毫秒），0 = 不启用
REQUEST_TIMEOUT_MS=0
# CSRF 允许来源白名单，逗号分隔，留空 = 开发模式不限制
ALLOWED_ORIGINS=
```

- `bodyLimit` 作用于全局所有请求，超出返回 `{ code: 413, message: '请求体超出大小限制' }`。
- `timeout` 仅作用于 `/api/*`，使用 `hono/combine` 的 `except()` 自动排除长耗时路径：`/api/ws`、`/api/files`、`/api/db-backups` 及所有以 `/export` 结尾的导出接口。超时返回 `{ code: 408, message: '请求处理超时（Xms）' }`。
- `hono/csrf` 校验请求的 `Origin` 头。`ALLOWED_ORIGINS` 为空时（开发模式）不限制；无 `Origin` 头的请求（curl/Postman/服务端）直接放行；Origin 不在白名单中返回 403。
- **接口级限流**（`hono-rate-limiter` + Redis）对高危认证接口限制请求频率，超限返回 `{ code: 429, message: '...' }`，计数器存储于 Redis，key 格式：`{prefix}rl:{ip}`。限流配置见 `packages/server/src/middleware/rate-limit.ts`。
- 实现位置：`packages/server/src/index.ts`（全局），`packages/server/src/middleware/rate-limit.ts`（限流）。

---

## 时间格式规范

前端所有时间显示**统一使用 `YYYY-MM-DD HH:mm:ss` 格式**（如 `2026-03-23 14:30:00`）。

- 所有时间处理**必须**使用第三方库 `dayjs` 统一接管。
- 使用 `packages/web/src/utils/date.ts` 中的 `formatDateTime(date)` 工具函数，该函数已内嵌了 `dayjs` 逻辑。
- 禁止在组件中直接调用 `toLocaleString()`、`toLocaleDateString()`、`toLocaleTimeString()` 等原生方法。
- `formatDateTime` 接受 `Date | string | number | null | undefined` 类型参数，对所有页面统一生效。

---

## 页面布局规范

### 列表页整体布局与表格

所有 CRUD 列表页面（参考 `UsersPage.tsx`）采用无卡片（Cardless）设计方案：

- 搜索区域统一使用 `SearchToolbar` 组件（`components/SearchToolbar.tsx`）。
- 数据表格必须使用带边框属性：`<Table bordered {...props} />`。
- 整体背景由 `AdminLayout` 统一负责，列表页不要自行包裹 `<Card>`。

顶部搜索栏和操作按钮必须遵循统一布局：

```tsx
import { SearchToolbar } from '../../components/SearchToolbar';

<SearchToolbar>
  {/* 搜索输入框 + 下拉筛选 + 查询/重置按钮 + 操作按钮，全部直接作为 children */}
  <Input prefix={<Search size={14} />} placeholder="..." showClear />
  <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  <Button type="secondary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
</SearchToolbar>
```

要点：

- `children` 自动用 `<Space wrap>` 包裹，按需换行
- 按钮文案统一为「查询」「重置」「新增」
- 可选 props：`className`（附加 CSS 类名）

### 表格操作列按钮

操作列按钮使用**纯文字无图标**的 borderless 按钮：

```tsx
<Space>
  <Button theme="borderless" size="small" onClick={() => handleEdit(record)}>编辑</Button>
  <Popconfirm title="确定要删除吗？" onConfirm={() => handleDelete(record.id)}>
    <Button theme="borderless" type="danger" size="small">删除</Button>
  </Popconfirm>
</Space>
```

要点：

- `theme="borderless"` + `size="small"`
- 删除按钮额外加 `type="danger"`
- **不使用图标**，仅纯文字

---

## 常见陷阱

- 修改数据库 schema 后，必须运行 `npm run db:generate` 再 `npm run db:migrate`，不能直接修改 SQL
- `@zenith/shared` 中新增类型/schema 后，无需重新构建，server 和 web 会直接引用源文件
- Semi Design 组件查询请使用 `.claude/skills/semi-ui-skills/SKILL.md` 中的 MCP 工具流程
- CORS 当前允许所有来源（开发配置），生产部署前需收紧

### 列表规范

- 所有的表格页面的“操作”列必须设置右侧固定（`fixed: 'right'`）。---

## Demo 演示模式（MSW Mock）

当 `VITE_DEMO_MODE=true` 时，前端通过 [MSW（Mock Service Worker）](https://mswjs.io/) 拦截所有 API 请求，无需后端服务即可完整运行。

### 关键文件

```text
packages/web/src/mocks/
├── data/          # 与 packages/server/src/db/seed.ts 对齐的静态数据
│   ├── users.ts   departments.ts   positions.ts
│   ├── roles.ts   menus.ts         dicts.ts
│   ├── system.ts  notices.ts       logs.ts
│   └── index.ts
├── handlers/      # 每个业务模块对应一个 handler 文件
│   ├── auth.ts    users.ts     roles.ts       menus.ts
│   ├── departments.ts          positions.ts   dicts.ts
│   ├── system-configs.ts       notices.ts     files.ts
│   ├── cron-jobs.ts            monitor.ts
│   ├── login-logs.ts           operation-logs.ts  sessions.ts
│   └── index.ts   # 汇总所有 handlers
├── browser.ts     # setupWorker
└── index.ts       # enableMocking()，条件判断入口
```

### 维护规范

- **新增业务模块时**：必须同步在 `data/` 中添加初始数据，并在 `handlers/` 中添加对应的 MSW handler，然后在 `handlers/index.ts` 中注册。
- **修改 API 接口格式时**：对应的 handler 文件也必须同步更新。
- 构建 Demo 站点：`npm run build:demo`（使用 `packages/web/.env.demo` 中的变量）。
- GitHub Pages 部署由 `.github/workflows/pages.yml` 自动完成（推送到 master 分支触发，文档站与 Demo 统一部署）。
