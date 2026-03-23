# Zenith Admin

基于 **Hono + React 19 + Drizzle ORM** 的现代化全栈后台管理系统。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端框架 | [Hono](https://hono.dev/) v4 + Node.js |
| 前端框架 | [React](https://react.dev/) 19 + [Vite](https://vitejs.dev/) 6 |
| UI 组件库 | [Semi Design](https://semi.design/) v2（字节跳动） |
| 数据库 ORM | [Drizzle ORM](https://orm.drizzle.team/) + PostgreSQL |
| 前端路由 | [React Router](https://reactrouter.com/) v7 |
| 参数验证 | [Zod](https://zod.dev/)（前后端共享） |
| 认证方案 | JWT Bearer Token（7 天有效期） |
| 文件存储 | 本地存储 / 阿里云 OSS |
| 包管理器 | pnpm（monorepo） |

---

## 项目结构

```
zenith-admin/
├── packages/
│   ├── server/          # Hono 后端服务（端口 3000）
│   │   ├── src/
│   │   │   ├── routes/  # API 路由（auth/users/menus/roles/dicts/files）
│   │   │   ├── db/      # Drizzle schema 与数据库操作
│   │   │   ├── lib/     # 文件存储等工具库
│   │   │   └── middleware/  # JWT 认证中间件
│   │   └── drizzle/     # 数据库迁移文件
│   ├── web/             # React 前端（端口 5173）
│   │   └── src/
│   │       ├── pages/   # 页面组件（登录/仪表盘/用户/系统管理等）
│   │       ├── layouts/ # AdminLayout 主布局
│   │       ├── components/ # 公共组件（IconPicker/NProgress）
│   │       ├── hooks/   # useAuth / useTheme
│   │       └── utils/   # request.ts 请求封装
│   └── shared/          # 前后端共享类型 + Zod schema + 常量
└── package.json         # Monorepo 根配置
```

---

## 快速开始

### 前置条件

- Node.js >= 18
- pnpm >= 9
- PostgreSQL（本地或远程）

### 安装依赖

```bash
pnpm install
```

### 配置环境变量

在 `packages/server/` 下创建 `.env` 文件：

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zenith_admin
JWT_SECRET=your-secret-key
PORT=3000
```

在 `packages/web/` 下创建 `.env` 文件（可选，有默认值）：

```env
VITE_API_BASE_URL=http://localhost:3000
VITE_APP_TITLE=Zenith Admin
```

### 初始化数据库

```bash
# 执行迁移
pnpm db:migrate

# 填充初始数据（创建 admin 账号等）
pnpm db:seed
```

### 启动开发服务器

```bash
# 同时启动前端 + 后端
pnpm dev

# 或分别启动
pnpm dev:server   # 后端：http://localhost:3000
pnpm dev:web      # 前端：http://localhost:5173
```

---

## 功能模块

| 模块 | 说明 |
|------|------|
| 用户管理 | 用户 CRUD、状态管理、角色分配 |
| 菜单管理 | 树形菜单结构，支持目录/菜单/按钮三种类型 |
| 角色管理 | 角色 CRUD、菜单权限分配 |
| 数据字典 | 字典主表 + 字典项管理 |
| 文件管理 | 文件上传、列表查看，支持本地/OSS 双模式 |
| 存储配置 | 配置本地存储或阿里云 OSS，支持切换默认存储 |
| 个人中心 | 修改密码、更新个人资料 |

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
pnpm db:generate   # 根据 schema 变更生成迁移文件
pnpm db:migrate    # 执行迁移
pnpm db:seed       # 重置并填充种子数据
```

> 修改 `packages/server/src/db/schema.ts` 后，**必须** 先 `db:generate` 再 `db:migrate`，不要直接手动修改 SQL。

---

## 构建部署

```bash
# 生产构建（顺序：shared → server → web）
pnpm build
```

构建产物：
- 后端：`packages/server/dist/`
- 前端：`packages/web/dist/`

> 生产环境部署前，请收紧 CORS 配置（当前允许所有来源）。

---

## 开发规范

- **Zod Schema**：定义在 `packages/shared/src/validation.ts`，禁止在 server/web 中重复定义
- **枚举值**：数据库 pg enum、TypeScript union type、Zod enum 三者必须保持同步
- **UI 组件**：优先使用 Semi Design，图标优先 `@douyinfe/semi-icons`，其次 `lucide-react`
- **请求封装**：前端统一使用 `src/utils/request.ts`，已自动处理 token 注入和 401 跳转
