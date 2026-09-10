# 快速开始

Zenith Admin 是基于 **Hono v4 + React 19 + Drizzle ORM** 的 npm monorepo 项目，当前版本为 `1.90.0`。本页用于把本地开发环境跑通；生产部署请看 [部署说明](./deployment.md) 与 [Docker 部署](./docker.md)。

## 环境要求

- Node.js 24.x（根 `package.json` 限定 `>=24 <25`，CI 与 Docker 也使用 Node 24）
- npm
- PostgreSQL
- Redis（会话、限流、幂等、黑名单等运行时状态）

::: tip 用 Docker 启动本地基础设施
本机没有 PostgreSQL / Redis 时，在仓库根目录执行：

```bash
docker compose -f docker-compose.dev.yml up -d
```

该 compose 只启动 PostgreSQL `5432` 与 Redis `6379`，不构建 API / Web 镜像。
:::

## 安装依赖

```bash
npm install
```

CI、Docker 和发布流程使用 `npm ci`；本地首次开发或更新依赖时使用 `npm install` 更方便。

## 配置环境变量

### 后端 `packages/server/.env`

从模板复制：

```bash
cp packages/server/.env.example packages/server/.env
```

本地最小配置：

```ini
PORT=3300
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zenith_admin
REDIS_URL=redis://127.0.0.1:6379
```

`JWT_SECRET` 与 `FIELD_ENCRYPTION_KEY` 本地开发可以留空：`npm run dev` 会以 `NODE_ENV=development` 启动并使用内置开发密钥，因此团队成员连接同一个开发库时不需要互相交换密钥。只有在需要自定义时才运行 `npm run secret:generate` 填入（`FIELD_ENCRYPTION_KEY` 按数据库共享，自定义后同库的同事必须使用同一把）。直接用 `tsx src/index.ts` 等方式启动而不设置 `NODE_ENV=development` 时按生产规则校验，两把密钥与 `ZENITH_ROLES` 均必填。

`packages/server/.env.example` 还列出开放平台、请求限制、CSRF、可信代理、出站私网 allowlist、Mastra Studio、WebRTC、HTTP 流量日志、支付、CMS 与 Webhook 等可选变量。

### 前端 `packages/web/.env.development`

开发模式默认通过 Vite 代理访问后端：

```ini
VITE_API_BASE_URL=
VITE_WS_BASE_URL=
VITE_API_PROXY_TARGET=http://localhost:3300
VITE_PORT=5373
VITE_APP_TITLE=Zenith Admin
VITE_BASE_URL=
```

`VITE_API_PROXY_TARGET` 只作用于 Vite Dev Server，不会写入浏览器 bundle。生产跨域部署时才需要设置 `VITE_API_BASE_URL` / `VITE_WS_BASE_URL`。

## 初始化数据库

```bash
npm run db:migrate
npm run db:seed
```

种子脚本写入默认管理员 `admin` / `123456`、菜单、字典、演示数据等，可重复执行：只补充缺失的记录，不回写已存在的行，因此在管理后台对菜单等内置数据的修改在重启后仍然保留。`npm run dev:server` 会先执行迁移与种子，再启动 watch 服务，因此也可以直接进入开发启动。

## 启动业务项目

```bash
# 同时启动后端与前端（后端为单个 all 角色开发进程）
npm run dev

# 验证 api / worker 拆分运行
npm run dev:split

# 或分别启动
npm run dev:server
npm run dev:web
```

| 入口 | 地址 |
| --- | --- |
| 后台管理 | `http://localhost:5373/` |
| 会员前台 | `http://localhost:5373/member.html` |
| 移动审批 | `http://localhost:5373/approval.html` |
| 后端 API | `http://localhost:3300` |
| Swagger UI | `http://localhost:3300/api/docs` |
| OpenAPI JSON | `http://localhost:3300/api/openapi.json` |

## 启动文档站

```bash
npm run docs:dev
```

默认地址：`http://localhost:4177`。构建产物预览使用 `npm run docs:preview`，端口为 `4178`。

## 下一步建议

- 了解目录分层：阅读 [项目结构](/guide/project-structure)
- 查看所有功能：阅读 [功能模块](/product/features)
- 开发新模块：阅读 [AI 辅助开发](/ai/) 与仓库内 `.agents/skills/zenith/`
