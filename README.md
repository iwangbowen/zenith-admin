# Zenith Admin

基于 **Hono v4 + React 19 + Semi Design v2 + Drizzle ORM** 的全栈后台管理系统，覆盖认证授权、组织架构、系统配置、通知公告、日志审计、在线会话、定时任务、文件管理与运行监控等后台场景。

项目采用 **npm monorepo** 结构：后端使用 Hono + PostgreSQL 提供 API 服务，前端使用 React 19 + Vite + **Semi Design v2** 构建后台界面，`shared` 包统一维护前后端共享类型、常量与 Zod 校验 schema。

---

## 文档站、演示站与项目首页

- 文档站：<https://iwangbowen.github.io/zenith-admin/>
- 演示站：<https://iwangbowen.github.io/zenith-admin/demo/>（账号 `admin` / 密码 `123456`，无需后端）

---

## 技术栈

| 层级 | 技术 |
| ---- | ---- |
| 后端框架 | [Hono](https://hono.dev/) v4 + Node.js |
| 前端框架 | [React](https://react.dev/) 19 + [Vite](https://vitejs.dev/) 6 |
| UI 组件库 | [Semi Design](https://semi.design/) v2 |
| 图标体系 | [lucide-react](https://lucide.dev/) |
| 数据库 ORM | [Drizzle ORM](https://orm.drizzle.team/) + PostgreSQL |
| 会话持久化 | [Redis](https://redis.io/)（ioredis） |
| 前端路由 | [React Router](https://reactrouter.com/) v7 |
| 参数验证 | [Zod](https://zod.dev/)（前后端共享） |
| 认证方案 | JWT Bearer Token（7 天有效期） |
| 会话机制 | Access Token + Refresh Token 自动续期 |
| 实时通信 | WebSocket |
| 文件存储 | 本地存储 / 阿里云 OSS |
| 包管理器 | npm（monorepo） |

---

## 项目结构

```text
zenith-admin/
├── packages/
│   ├── server/          # Hono 后端服务
│   │   ├── src/
│   │   │   ├── routes/  # API 路由（认证、用户、部门、岗位、角色、菜单、字典、日志、监控、会话、定时任务等）
│   │   │   ├── db/      # Drizzle schema、迁移与种子数据
│   │   │   ├── lib/     # 验证码、文件存储、日志、权限、WebSocket、定时任务调度等能力封装
│   │   │   └── middleware/  # 日志、认证与权限中间件
│   │   └── drizzle/     # 数据库迁移文件
│   ├── web/             # React 前端
│   │   └── src/
│   │       ├── pages/   # 页面组件（登录、仪表盘、个人中心、组织与系统管理、日志、监控等）
│   │       ├── layouts/ # AdminLayout 主布局与导航容器
│   │       ├── components/ # 公共组件（图标选择器、进度条、Cron 表达式构建器等）
│   │       ├── hooks/   # 认证、主题、偏好设置、标签页、WebSocket 等 hooks
│   │       └── utils/   # 请求封装、日期格式化、图标映射等工具
│   └── shared/          # 前后端共享类型、常量与 Zod schema
└── package.json         # Monorepo 根配置
```

---

## 快速开始

### 前置条件

- Node.js >= 18
- PostgreSQL（本地或远程）
- Redis（本地或远程，用于会话持久化）

### 安装依赖

```bash
npm install
```

### 配置环境变量

在 `packages/server/` 下创建 `.env` 文件：

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zenith_admin
JWT_SECRET=your-secret-key
PORT=3300
# Redis 连接（URL 格式，支持带密码）
REDIS_URL=redis://127.0.0.1:6379
```

在 `packages/web/` 下创建 `.env` 文件（可选，有默认值）：

```env
VITE_API_BASE_URL=http://localhost:3300
VITE_APP_TITLE=Zenith Admin
```

### 初始化数据库

```bash
# 执行迁移
npm run db:migrate

# 填充初始数据（创建 admin 账号等）
npm run db:seed
```

### 启动开发服务器

```bash
# 同时启动前端 + 后端
npm run dev

# 或分别启动
npm run dev:server   # 后端：http://localhost:3300
npm run dev:web      # 前端：http://localhost:5373
```

### 启动文档站（VitePress）

```bash
# 本地开发
npm run docs:dev

# 生产构建
npm run docs:build

# 本地预览构建结果
npm run docs:preview
```

默认本地地址：`http://localhost:4177`

---

## 功能模块

### 认证与账户

- 用户登录、注册、个人中心、资料维护、密码修改
- JWT Bearer Token 鉴权，配合 Refresh Token 自动续期
- 登录支持验证码校验，降低暴力尝试风险

### 权限与导航

- 用户管理：用户 CRUD、启停用、角色分配
- 角色管理：角色 CRUD、菜单权限配置
- 菜单管理：支持目录 / 菜单 / 按钮三级能力模型
- 动态菜单路由：前端根据当前用户菜单自动注册可访问页面

### 组织与基础资料

- 部门管理：组织层级维护
- 岗位管理：岗位信息维护与关联使用
- 数据字典：字典类型与字典项统一管理
- 系统配置：可维护系统运行相关配置项

### 通知、审计与安全

- 通知公告：发布记录、已读状态管理，并支持实时通知推送
- 登录日志：记录登录行为，便于安全审计
- 操作日志：记录关键业务操作轨迹
- 在线会话：查看当前在线会话，并支持强制下线

### 文件与存储

- 文件管理：上传、列表查询、下载等基础能力
- 存储配置：支持本地文件系统与阿里云 OSS
- 默认存储切换：通过配置切换当前默认文件存储策略

### 任务与运行维护

- 定时任务管理：维护 Cron 任务并由服务端调度执行
- 系统监控：查看运行状态相关信息
- WebSocket：支持实时通知与会话下线消息推送
- 健康检查：提供 `/api/health` 接口用于服务探活

---

## API 规范

所有接口挂载在 `/api` 前缀下，遵循统一响应格式：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

列表接口返回分页结构：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "list": [],
    "total": 100,
    "page": 1,
    "pageSize": 10
  }
}
```

认证接口需携带 `Authorization: Bearer <token>` 请求头。

---

## 数据库管理

```bash
npm run db:generate   # 根据 schema 变更生成迁移文件
npm run db:migrate    # 执行迁移
npm run db:seed       # 重置并填充种子数据
```

> 修改 `packages/server/src/db/schema.ts` 后，**必须** 先 `db:generate` 再 `db:migrate`，不要直接手动修改 SQL。

---

## 构建部署

```bash
# 生产构建（顺序：shared → server → web）
npm run build
```

构建产物：

- 后端：`packages/server/dist/`
- 前端：`packages/web/dist/`

> 生产环境部署前，请收紧 CORS 配置（当前允许所有来源）。

---

## License

本项目采用 [MIT License](./LICENSE)。
