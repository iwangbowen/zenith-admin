# Docker 部署

Docker Compose 会启动 PostgreSQL、Redis、一次性迁移、API、worker 与 Nginx，适合生产试运行与中小规模部署。配置文件位于仓库根目录：`Dockerfile`、`docker-compose.yml`、`docker-compose.dev.yml`、`.env.docker`。

## 前置依赖

- Docker 24+
- Docker Compose v2

## 快速开始

```bash
git clone https://github.com/iwangbowen/zenith-admin.git
cd zenith-admin

cp .env.docker .env
# 一次生成四个必填项并填入 .env（JWT_SECRET / FIELD_ENCRYPTION_KEY / POSTGRES_PASSWORD / REDIS_PASSWORD 均无默认值，留空无法启动）
npm run secret:generate -- --docker

docker compose up -d

# 首次部署或需要补齐内置数据时执行，可重复运行
docker compose exec api node dist/db/seed.js

docker compose ps
```

::: tip 宿主机端口与暴露面
Compose 默认只对外映射 `80`（Web）；API 端口 `3300` 默认绑定宿主机回环 `127.0.0.1`（浏览器与 WebSocket 经 Nginx 同源代理 `/api`），PostgreSQL / Redis **不映射宿主机端口**——Docker 端口映射会绕过 ufw / firewalld，直接映射等于把数据库和会话存储暴露到公网。
端口冲突时在 `.env` 中调整 `WEB_PORT` / `API_PORT`；确需直接对外暴露 API 时设置 `API_BIND=0.0.0.0`。本机排障需要 `psql` / `redis-cli` 直连时叠加排障文件：`docker compose -f docker-compose.yml -f docker-compose.debug.yml up -d`（绑定 `127.0.0.1`，端口由 `POSTGRES_PORT` / `REDIS_PORT` 控制）。
:::

访问地址：

| 服务 | 默认地址 |
| --- | --- |
| 前端 / Nginx | `http://localhost` |
| API | `http://localhost/api`（直连 `http://127.0.0.1:3300` 仅本机） |
| Mastra Studio | `http://localhost/studio/` |

默认管理员：`admin` / `123456`。

::: tip
迁移由一次性 `migrate` 服务执行，`api` / `worker` 会等待其成功完成后启动；需要手动补迁移时执行 `docker compose run --rm migrate`。种子数据需手动执行一次，可重复执行。
:::

## 服务拓扑

```text
postgres ─┐
redis    ─┤──→ migrate（一次性迁移）
          ├──→ api × N (ZENITH_ROLES=api, Node.js :3300) ──→ web (Nginx :80)
          └──→ worker × M (ZENITH_ROLES=worker, probe :3301)

api / worker → Redis pub/sub → api  （WebSocket / IoT 推送扇出）
api ⇄ server_storage ⇄ worker       （本地文件、上传暂存、CMS 静态产物）
```

| 服务 | 镜像 / 阶段 | 说明 |
| --- | --- | --- |
| `postgres` | `postgres:16-alpine` | 数据库，库名 `zenith_admin` |
| `redis` | `redis:7-alpine` | 会话、限流、幂等、黑名单与 WS 扇出状态；始终 `requirepass` + AOF |
| `migrate` | Dockerfile `server` stage | 一次性执行 `node dist/db/migrate.js`，`restart: "no"` |
| `api` | Dockerfile `server` stage | Hono 后端，`ZENITH_ROLES=api`，端口 3300，健康检查 `/api/health`；以非 root 用户 `node` 运行 |
| `worker` | Dockerfile `server` stage | 后台任务进程，`ZENITH_ROLES=worker`，健康检查 `http://localhost:3301/health`，默认不发布端口 |
| `web` | Dockerfile `web` stage | Nginx 静态站点，代理 `/api` 与 `/api/ws` |

## Dockerfile 构建流程

| 阶段 | 基础镜像 | 行为 |
| --- | --- | --- |
| `builder` | `node:24-alpine` | 安装全量依赖，构建 shared、analytics-sdk、server、web，执行 `docker/build-studio.mjs`，最后用 `docker/patch-shared-exports.mjs` 把 `@zenith/shared` 的 exports 指向编译产物 |
| `server` | `node:24-alpine` | 安装生产依赖，复制 server dist、Drizzle 迁移与 shared dist，写入 entrypoint；entrypoint 只按参数执行命令或启动 `node dist/index.js`，不再自动迁移；`storage` / `logs` 归属 `node` 后切换 `USER node` |
| `web` | `nginx:1.30-alpine` | 复制 `packages/web/dist` 与 `docker/nginx.conf` |

`node-pty` 在 Linux 下需要编译，构建阶段安装 `python3 make g++`；server 阶段保留 `libstdc++` 并移除编译工具链。

::: details 为什么产物可以用纯 Node 运行？
源码中的相对导入不带扩展名（依赖 tsx / Vite 解析），而 Node.js 原生 ESM 要求显式 `.js` 扩展名。
shared 与 server 的 `build` 脚本在 `tsc` 之后运行 `tsc-alias --resolve-full-paths`，把 dist 中的相对导入改写为完整路径；
`docker/patch-shared-exports.mjs` 再把 `@zenith/shared` 的 `exports` 从 `./src/*.ts` 机械改写为 `./dist/*.js`。
两步之后 `node dist/db/migrate.js`、`node dist/index.js` 与 `node dist/db/seed.js` 均可脱离 tsx 直接运行。
:::

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `JWT_SECRET` | 无（必填） | JWT 签名密钥，≥ 32 字符随机值，按服务实例独立；`npm run secret:generate` 生成 |
| `FIELD_ENCRYPTION_KEY` | 无（必填） | 字段级 AES-256-GCM 密钥（64 位 hex），按数据库共享——连同一个库的实例必须一致，轮换会使已入库密文不可读 |
| `POSTGRES_PASSWORD` | 无（必填） | PostgreSQL 口令；`npm run secret:generate -- --docker` 生成 |
| `REDIS_PASSWORD` | 无（必填） | Redis 口令，始终启用 `requirepass`；会拼进 `REDIS_URL`，只能用 URL 安全字符（生成器输出即满足） |
| `REDIS_URL` | `redis://:${REDIS_PASSWORD}@redis:6379/0` | API 使用的 Redis URL，可整体覆盖为外部 Redis |
| `WEB_PORT` | `80` | Nginx 对外端口 |
| `API_PORT` | `3300` | API 宿主机端口 |
| `API_BIND` | `127.0.0.1` | API 端口绑定地址；`0.0.0.0` 才对外暴露 |
| `POSTGRES_PORT` / `REDIS_PORT` | `5432` / `6379` | 仅在叠加 `docker-compose.debug.yml` 时生效，绑定 `127.0.0.1` |
| `ALLOWED_ORIGINS` | 空 | CSRF 允许来源 |
| `CORS_ORIGIN` | `*` | CORS 允许来源 |
| `LOG_LEVEL` | `info` | 后端日志级别 |
| `OAUTH_GITHUB_CLIENT_ID` / `OAUTH_GITHUB_CLIENT_SECRET` | 空 | GitHub OAuth 登录凭据 |
| `OAUTH_CALLBACK_BASE_URL` | `http://localhost` | OAuth 回调基础地址 |
| `TAG` | `latest` | 本地构建镜像标签 |
| `WORKER_SHUTDOWN_GRACE_MS` | `120000` | worker 优雅停机硬截止，Compose `stop_grace_period` 默认为 130s，应始终大于该值 |

`JWT_SECRET` / `FIELD_ENCRYPTION_KEY` / `POSTGRES_PASSWORD` / `REDIS_PASSWORD` 任一留空时 `docker compose up` 直接失败（前两者为占位值时 API 启动也会失败）。生产环境请按实际域名设置 `ALLOWED_ORIGINS`。Compose 已固定 api / worker 的 `ZENITH_ROLES`，通常无需在 `.env` 中覆盖。使用外部 Redis 时整体覆盖 `REDIS_URL`（含口令）即可。

API 容器以非 root 用户 `node` 运行；如需在容器内访问宿主机 Docker socket（运维模块的容器管理），请在自定义 override 中挂载 socket 并通过 `group_add` 加入 socket 所属组，不要改回 root。

## Nginx 行为

`docker/nginx.conf` 的当前行为：

- `/api` 代理到 `api:3300`，包含 WebSocket upgrade，覆盖 `/api/ws`。
- `/studio/` 托管 Mastra Studio 静态资源，数据面走同源 `/api/mastra`。
- `/studio/refresh-events` 返回 204，减少静态部署下的 EventSource 重试日志。
- `/index` / `/index.html` 跳转到 `/`。
- `/` fallback 到 `/index.html` 支持 SPA 路由。
- 所有 HTML 入口（`/`、`member.html`、`approval.html`）下发 `Cache-Control: no-cache, must-revalidate`，浏览器每次校验后拿到最新的 hash 资源清单，发版不会留在旧壳层。
- JS/CSS/字体/图片等静态资源使用一年 immutable 缓存。
- `gzip_static on`：直接下发构建期预生成的 `.gz` 文件（`packages/web/scripts/precompress.mjs`，gzip level 9）；未预压缩的响应按 `gzip_comp_level 6` 动态压缩。构建同时产出 `.br`，官方 `nginx:1.30-alpine` 不含 brotli 模块，如自建含 `ngx_brotli` 的镜像可打开配置里注释的 `brotli_static on`。
- 容器内 `listen 80` 只提供 HTTP/1.1。多入口 SPA 的资源请求并发度依赖 HTTP/2，生产环境应在 TLS 终结层（外层反向代理或本镜像挂证书后 `listen 443 ssl; http2 on;`）启用 HTTP/2，否则首屏请求会受 6 连接/域名限制排队。
- 安全响应头：所有响应下发 `X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`，并以 `X-Frame-Options: SAMEORIGIN` + `Content-Security-Policy: frame-ancestors 'self'` 禁止跨站嵌入；仅 `/public/report/`（公开仪表盘嵌入）不下发帧保护头，嵌入来源由应用按仪表盘 `embed.allowedOrigins` 校验。SPA 的内容安全策略（`script-src` 不含 `'unsafe-inline'` 等）由 Vite 构建期注入入口 HTML 的 `<meta http-equiv="Content-Security-Policy">` 承担（见 `packages/web/vite.config.ts`），nginx 无需重复配置。

## 常用操作

```bash
# 查看日志
docker compose logs -f
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f web

# 停止服务（保留数据卷）
docker compose down

# 停止并删除数据卷
docker compose down -v

# 扩容 / 缩容
docker compose up -d --scale api=2 --scale worker=3

# 手动执行迁移
docker compose run --rm migrate

# 单容器 all-in-one 覆盖文件（worker 副本数为 0）
docker compose -f docker-compose.yml -f docker-compose.single.yml up -d

# 进入容器
docker compose exec api sh

# 连接数据库
docker compose exec postgres psql -U postgres -d zenith_admin
```

## 升级版本

```bash
git pull
docker compose build --no-cache
docker compose up -d
```

`migrate` 服务会先运行一次迁移，`api` 与 `worker` 通过 `depends_on: condition: service_completed_successfully` 等待迁移完成后再启动。前端静态资源由 `web` 镜像提供，重建镜像后随容器替换生效。需要单独补迁移时运行 `docker compose run --rm migrate`。

## 本地开发基础设施

```bash
docker compose -f docker-compose.dev.yml up -d
npm run dev
```

`docker-compose.dev.yml` 只启动 `postgres:16-alpine` 与 `redis:7-alpine`，端口固定映射为 `5432` / `6379`，用于配合本地 Node / Vite 开发。

## 数据持久化

| 卷名 | 内容 |
| --- | --- |
| `postgres_data` | PostgreSQL 数据 |
| `redis_data` | Redis AOF 数据 |
| `server_storage` | `storage/` 整体，由 api 与 worker 共享：本地上传文件、分片上传暂存目录、CMS 静态化产物。旧 `api_storage` 卷名已不再使用 |
| `api_logs` | api 角色日志 |
| `worker_logs` | worker 角色日志 |

```bash
# 备份 PostgreSQL
docker compose exec postgres pg_dump -U postgres zenith_admin > backup.sql

# 恢复 PostgreSQL
docker compose exec -T postgres psql -U postgres zenith_admin < backup.sql
```
