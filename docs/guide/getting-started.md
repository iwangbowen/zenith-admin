# 快速开始

Zenith Admin 是一个基于 **Hono + React 19 + Drizzle ORM** 的 npm monorepo 项目。

如果你想在本地把项目和文档站都跑起来，建议按下面的顺序执行。

## 环境要求

- Node.js >= 18
- npm
- PostgreSQL
- Redis（用于会话持久化，默认连接本地 `127.0.0.1:6379`）

## 安装依赖

在仓库根目录执行：

```bash
npm install
```

## 配置环境变量

### 后端 `packages/server/.env`

```ini
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zenith_admin
JWT_SECRET=your-secret-key
PORT=3300
# Redis 连接（默认连接本地无密码 Redis）
REDIS_URL=redis://127.0.0.1:6379
# 带密码示例: REDIS_URL=redis://:your_password@127.0.0.1:6379/0
# REDIS_KEY_PREFIX=zenith:   # 所有 key 的命名空间前缀（默认 zenith:）
```

### 前端 `packages/web/.env.development`

开发环境下，API 请求通过 Vite Dev Server 代理转发到后端，无需直接填写后端地址：

```ini
VITE_API_BASE_URL=
VITE_WS_BASE_URL=
VITE_API_PROXY_TARGET=http://localhost:3300
VITE_APP_TITLE=Zenith Admin
```

> `VITE_API_PROXY_TARGET` 仅在开发模式的 Vite Dev Server 中生效，不会暴露到客户端 bundle。生产部署时通过 `VITE_API_BASE_URL` 指定后端地址，详见 [部署文档](./deployment.md)。

## 初始化数据库

```bash
npm run db:migrate
npm run db:seed
```

## 启动业务项目

```bash
# 同时启动后端与前端
npm run dev

# 或分别启动
npm run dev:server
npm run dev:web
```

## 启动文档站

```bash
npm run docs:dev
```

默认地址：`http://localhost:4177`

## 下一步建议

- 想先了解目录分层：继续阅读 [项目结构](/guide/project-structure)
- 想快速判断能否满足场景：查看 [功能模块](/product/features)
- 想看接口与数据规范：查看 [后端文档](/backend/api-conventions)
