# 部署说明

本页说明源码方式部署 Zenith Admin。若希望一键启动 PostgreSQL、Redis、API 与 Nginx，优先使用 [Docker 部署](./docker.md)。

## 环境要求

| 依赖 | 版本 / 说明 |
| --- | --- |
| Node.js | 24.x |
| npm | 使用仓库 `package-lock.json` |
| PostgreSQL | 生产主数据库 |
| Redis | 会话、限流、幂等、黑名单等运行时状态 |
| Nginx | 托管前端静态文件并反向代理 API / WebSocket |
| Git | 拉取源码与切换 tag |

::: warning 源码方式运行后端
`@zenith/shared` 是工作区包，后端源码部署时依赖仓库完整 checkout。GitHub Release 中的 server zip 是归档产物，不作为独立 npm 包分发。
:::

## 后端部署

### 1. 获取代码并安装依赖

```bash
git clone https://github.com/iwangbowen/zenith-admin.git
cd zenith-admin
git checkout vX.Y.Z
npm ci
```

### 2. 配置 `packages/server/.env`

```bash
cp packages/server/.env.example packages/server/.env
npm run secret:generate   # 输出 JWT_SECRET / FIELD_ENCRYPTION_KEY 两行，粘贴进 .env
```

生产最小配置：

```dotenv
PORT=3300
ZENITH_ROLES=all
JWT_SECRET=<npm run secret:generate 输出>
FIELD_ENCRYPTION_KEY=<npm run secret:generate 输出>
DATABASE_URL=postgresql://zenith:strong-password@db.example.com:5432/zenith_admin
REDIS_URL=redis://redis.example.com:6379
LOG_LEVEL=info
LOG_DIR=./logs
ALLOWED_ORIGINS=https://admin.example.com
```

::: warning 密钥没有默认值
`JWT_SECRET`（≥ 32 字符随机，按服务实例独立）与 `FIELD_ENCRYPTION_KEY`（64 位 hex，按数据库共享）在任何非 `NODE_ENV=development` 的环境下都必填；缺失、仍为模板占位值或随机性不足时服务拒绝启动。
`FIELD_ENCRYPTION_KEY` 用于加密 MFA 密钥、SSH 凭据、支付 / AI 渠道密钥等入库字段：连接同一个数据库的所有实例必须使用同一把；更换它会使已入库的密文不可读，需要重新录入。
:::

按需启用的常见变量：

| 变量 | 用途 |
| --- | --- |
| `DATABASE_MAX_CONNECTIONS` | 单个进程的业务连接池上限，默认 `20`。连接预算按角色累计：业务池 + pg-boss 池（worker 约 10，api send-only 约 2）+ 1 条 LISTEN 连接；api 还包含 Mastra 10 + 5。所有 api / worker 进程总和必须低于 PostgreSQL `max_connections`，超出时前置 pgBouncer（会话池模式，事务池无法透传 LISTEN/NOTIFY）或调低该值 |
| `ZENITH_ROLES` | 进程角色，逗号分隔：`api` / `worker` / `all`（等于两者）。非 `NODE_ENV=development` 环境必填；单机全量部署显式设为 `all` |
| `WORKER_HEALTH_PORT` | 纯 worker 探针端口，默认 `3301`，提供 `/health`、`/ready`、`/metrics` |
| `SHUTDOWN_GRACE_MS` | 优雅停机硬截止；默认 api/all `15000`，纯 worker `120000`。容器 `stop_grace_period` / K8s `terminationGracePeriodSeconds` 必须大于该值 |
| `STORAGE_SHARED` | 默认 `false`。纯 worker 使用本地磁盘相关存储或 CMS 静态化时，设为 `true` 表示 `storage/` 由 api 与 worker 共享 |
| `REQUEST_BODY_LIMIT` | 请求体大小上限，`0` 或未设置表示不启用全局限制（此时只有各上传端点按 `file.size` 自行拦截），生产环境务必设置（`.env.example` 示例为 64 MB，67108864）；至少要容纳一个分片（`files.chunkSizeMb`，最大 32 MB）加 multipart 开销，建议 ≥ 40 MB（41943040）；反向代理的 `client_max_body_size` 同理 |
| `REQUEST_TIMEOUT_MS` | 请求超时，自动排除 `/api/ws`、`/api/files`、`/api/db-admin` 与 `/export` 接口 |
| `UPLOAD_TEMP_DIR` | 分片上传本地暂存根目录，默认 `storage/tmp/uploads`；多实例部署见下文「多实例与本地存储」 |
| `TRUSTED_PROXY_CIDRS` | 仅信任指定代理的 `X-Forwarded-For` / `X-Real-IP` |
| `REPORT_OUTBOUND_PRIVATE_ALLOWLIST` | 报表外部数据源访问私网的 allowlist |
| `AI_OUTBOUND_PRIVATE_ALLOWLIST` | AI 服务商请求访问本地 / 私网模型的 allowlist，默认含 `127.0.0.1,localhost` |
| `MASTRA_STUDIO_ALLOW_ANONYMOUS` | 开发环境放开 `/api/mastra` 鉴权；生产环境强制忽略 |
| `WEBRTC_STUN_URLS` / `WEBRTC_TURN_*` | Chat 音视频通话 ICE 服务器配置 |
| `PAYMENT_NOTIFY_BASE_URL` | 支付渠道回调基址 |
| `CMS_STATIC_ROOT` | CMS 静态化输出目录 |
| `OPEN_WEBHOOK_ALLOWED_HOSTS` | 开放平台 Webhook 私网回调 allowlist |
| `WORKFLOW_OUTBOUND_ALLOWED_HOSTS` | 工作流出站（数据源 / 连接器 / 订阅 / 触发器 / 补偿 / 节点监听）私网目标 allowlist；默认一律拒绝内网 |

跨域部署时同时设置 `CORS_ORIGIN=https://admin.example.com`。同域反向代理 `/api` 时通常不需要 CORS。

### 3. 进程角色（api / worker）

后端进程通过 `ZENITH_ROLES` 选择运行角色：

| 角色 | 职责 | 端口与探针 |
| --- | --- | --- |
| `api` | HTTP / WebSocket 入口、IoT 设备接入、CMS SSR、终端 PTY、OpenAPI、限流规则、Mastra 代理；pg-boss 只声明队列与入队，不执行 `work()` | 监听 `PORT`（默认 3300），健康检查走 `/api/health` |
| `worker` | 执行任务中心、业务 `cron_jobs`、系统周期任务与系统队列 worker（导出、网盘渲染、工作流作业等） | 纯 worker 不监听业务端口；在 `WORKER_HEALTH_PORT`（默认 3301）暴露 `/health`、`/ready`、`/metrics`，业务路径返回 404 |
| `all` | 单进程同时承担 api 与 worker | 仅允许开发默认；生产单机部署也必须显式设置 `ZENITH_ROLES=all` |

`ZENITH_ROLES` 未设置时仅 `NODE_ENV=development` 允许默认 `all`；生产或未设置 `NODE_ENV` 时会拒绝启动。

任务 handler、系统队列和调度元数据在所有角色中都会声明，便于 api 校验任务类型、入队、管理开关和展示调度概览；只有 worker 负责通用执行、cron 监控、孤儿清理与队列对账。节点亲和任务（如终端文件压缩 / 解压）会投递到提交进程专属队列，是 api 进程执行 worker 的唯一例外。

纯 worker 启动前会检查存储拓扑：启用 `local`、`kodo`、`sftp` 等本地暂存型文件存储，或存在非 dynamic 的 CMS 静态站点时，必须使用共享卷 / 共享目录并设置 `STORAGE_SHARED=true`；否则 worker 拒绝启动。跨主机部署可改用对象存储，或共享 `storage/`（含 `localRootPath`、`UPLOAD_TEMP_DIR`、`CMS_STATIC_ROOT`）。

### 4. 初始化数据库

```bash
npm run db:migrate
npm run db:seed
```

`db:seed` 写入默认管理员 `admin` / `123456`、菜单、字典和各域种子数据，可重复执行；升级版本后重跑只会补入新增的菜单与配置，不会覆盖已在管理后台调整过的内置数据。

### 5. 启动后端

生产部署请在 `.env` 或进程环境中显式设置 `NODE_ENV=production` 与 `ZENITH_ROLES`（Docker Compose 已内置）。未设置 `NODE_ENV` 时服务按严格模式运行（密钥必填、验证码不回传），但部分第三方库仍可能以开发模式加载。

源码方式可直接用 TypeScript 运行。单机全量部署示例：

```bash
cd packages/server
ZENITH_ROLES=all npx tsx src/index.ts
```

拆分部署建议分别启动 api 与 worker：

```bash
cd packages/server
ZENITH_ROLES=api npx tsx src/index.ts
ZENITH_ROLES=worker WORKER_HEALTH_PORT=3301 npx tsx src/index.ts
```

运行编译产物时，迁移需要作为显式步骤执行；`npm start` 只启动 `node dist/index.js`：

```bash
npm run build -w @zenith/shared && npm run build -w @zenith/server
node docker/patch-shared-exports.mjs   # 把 @zenith/shared 的 exports 指向 dist（部署机执行）
npm run start:migrate -w @zenith/server
ZENITH_ROLES=api npm start -w @zenith/server
ZENITH_ROLES=worker WORKER_HEALTH_PORT=3301 npm start -w @zenith/server
```

::: warning
`patch-shared-exports.mjs` 会就地修改 `packages/shared/package.json`。开发机执行后 tsx / Vite 将改为消费 dist，请用 `git checkout packages/shared/package.json` 还原；仅建议在部署机或 CI 产物目录中执行。
:::

使用 PM2 管理进程时在仓库根目录执行两个应用，迁移先单独运行 `npm run db:migrate`（或 dist 产物用 `npm run start:migrate -w @zenith/server`）：

```bash
npm install -g pm2
NODE_ENV=production ZENITH_ROLES=api pm2 start node_modules/tsx/dist/cli.mjs --name zenith-api --cwd packages/server -- src/index.ts
NODE_ENV=production ZENITH_ROLES=worker WORKER_HEALTH_PORT=3301 pm2 start node_modules/tsx/dist/cli.mjs --name zenith-worker --cwd packages/server -- src/index.ts
pm2 save
pm2 startup
```

api 默认监听 `http://localhost:3300`；纯 worker 不占用业务端口，健康探针默认在 `http://localhost:3301/health`。

### 6. 多实例与本地存储

后端进程本身无状态，会话、限流等运行时状态在 Redis / PostgreSQL 中，可以横向扩多个实例。但有两类数据落在进程所在机器的磁盘上，
多实例部署时必须放到各实例共享的卷（NFS / 云盘多点挂载等），否则请求被负载均衡到不同节点后彼此看不到对方写的文件：

| 目录 | 内容 | 何时涉及 |
| --- | --- | --- |
| `storage/local`（或存储配置的 `localRootPath`） | `local` 存储的文件本体 | 默认文件服务是 `local` |
| `storage/tmp/uploads`（`UPLOAD_TEMP_DIR`） | 分片上传的本地暂存分片 | 默认文件服务是 `local` / `kodo` / `sftp`——它们没有可控的云端 multipart，分片先落本地再合并上传 |
| `storage/cms-static`（`CMS_STATIC_ROOT`） | CMS 静态化产物 | 启用了 CMS 静态化 |

默认文件服务为 `oss` / `s3` / `cos` / `obs` / `azure` / `bos` 时，分片直传云端 multipart、进度记在数据库，不依赖本地磁盘，
无需共享卷。api / worker 拆分且 worker 需要访问本地暂存或 CMS 静态产物时，必须共享 `storage/` 并在 worker 设置 `STORAGE_SHARED=true`。Docker Compose 已用 `server_storage` 共享卷挂载到 api 与 worker，容器重建不会丢失进行中的分片。

多 api / worker 进程依赖 Redis 保持运行时正确性：会话、限流、权限缓存与跨进程 WebSocket / IoT 推送都经 Redis 协作；WS 扇出使用 Redis pub/sub，Redis 故障时实时推送按 at-most-once 语义丢弃，客户端重连后回源补齐。

## 前端部署

前端是 Vite 静态产物。推荐同域部署：Nginx 托管静态文件，并把 `/api`、`/api/ws` 代理到后端。

### 1. 构建或获取静态文件

```bash
npm run build
# 静态产物位于 packages/web/dist/
```

GitHub Release 的 `zenith-admin-web-vX.Y.Z.zip` 也包含 `web/dist/`，适合同域部署。发布包**不含**预压缩副本（`.gz` / `.br`），
需要 `gzip_static` 时在部署机上生成一次：`node web/precompress.mjs web/dist`（脚本随包提供，仅依赖 Node 内建模块，约 30 秒）；
未生成时 nginx 按 `gzip on` 动态压缩，功能不受影响。

### 2. Nginx 配置要点

仓库 `docker/nginx.conf` 是 Docker 镜像使用的生产配置，可作为手动部署模板。关键行为：

- `/api` 代理到后端，并开启 WebSocket upgrade。
- `/studio/` 托管 Mastra Studio 静态 SPA，数据面走 `/api/mastra`。
- `/studio/refresh-events` 返回 204。
- `/` fallback 到 `/index.html` 支持 React Router；HTML 入口 `Cache-Control: no-cache, must-revalidate`。
- JS/CSS/字体/图片等静态资源使用一年 immutable 缓存。
- `gzip_static on` 直接下发预生成的 `.gz`（源码构建 `npm run build` 自动产出；发布 zip 需先执行 `node web/precompress.mjs web/dist`）。
  构建也产出 `.br`，需含 brotli 模块的 nginx 才能启用 `brotli_static`。
- 生产环境必须在 TLS 终结层启用 HTTP/2：多入口 SPA 首屏并发请求依赖 h2 多路复用，HTTP/1.1 会按域名 6 连接排队。

最小同域配置示例：

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name admin.example.com;
    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    root /path/to/packages/web/dist;
    index index.html;

    gzip on;
    gzip_static on;
    gzip_comp_level 6;
    gzip_types text/css application/javascript application/json image/svg+xml font/woff2 application/wasm;

    location /api {
        proxy_pass http://localhost:3300;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        client_max_body_size 100m;
    }

    location /studio/ { try_files $uri $uri/ /studio/index.html; }
    location = /studio { return 301 /studio/; }
    location = /studio/refresh-events { return 204; }

    location ~* \.(js|css|woff2?|ttf|png|jpe?g|gif|svg|webp|ico)$ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    location ~* \.html$ { add_header Cache-Control "no-cache, must-revalidate"; }

    location / {
        add_header Cache-Control "no-cache, must-revalidate";
        try_files $uri $uri/ /index.html;
    }
}
```

### 3. 前端 API 地址策略

同域部署使用默认相对路径：浏览器访问 `https://admin.example.com`，前端请求 `/api/*`，Nginx 代理到后端。

跨域部署需创建 `packages/web/.env.production` 后重新构建：

```ini
VITE_API_BASE_URL=https://api.example.com
VITE_WS_BASE_URL=wss://api.example.com
VITE_APP_TITLE=Zenith Admin
```

```bash
npm run build -w @zenith/web
```

后端同时配置 `CORS_ORIGIN` 与 `ALLOWED_ORIGINS`。

## Mastra Studio

`npm run build:studio` 将根依赖中的 Mastra Studio 静态资源复制到 `packages/web/dist/studio/`，并写入生产配置：`MASTRA_AUTO_DETECT_URL=true`、`MASTRA_API_PREFIX=/api/mastra`、`MASTRA_STUDIO_BASE_PATH=/studio`，同时关闭遥测、云 CTA、模板与实验 UI。

Docker 构建会自动执行该步骤。手动部署时需先 `npm run build`，再执行 `npm run build:studio`。

生产访问 `/studio/` 时，服务端要求登录并具备 `ai:studio:access` 权限。Studio 的 Settings → Custom headers 中配置当前登录用户的 `Authorization` 请求头。

## 健康检查与观测

| 能力 | 地址 / 配置 |
| --- | --- |
| api 健康检查 | `GET /api/health`，响应包含 `roles`，并在 `checks` 中报告 `wsFanout` 与 `workers`（无可用 worker 心跳时为 `degraded`） |
| worker 探针 | 纯 worker 暴露 `GET /health`、`GET /ready`（pg-boss 启动前 503）、`GET /metrics`，端口 `WORKER_HEALTH_PORT`（默认 3301） |
| Swagger UI | `GET /api/docs`（api 角色） |
| OpenAPI JSON | `GET /api/openapi.json`（api 角色） |
| Prometheus | api 为 `GET /metrics`；worker 为 `GET /metrics`。指标默认标签包含 `process_role`，WS 扇出提供 published / failed / delivered / dropped 计数 |
| 日志 | 日志行包含 `role` 字段；`all` 角色写 `logs/app.*.log`，拆分时分别写 `logs/app-api.*.log` 与 `logs/app-worker.*.log` |
| OpenTelemetry | `OTEL_ENABLED=true` 或配置 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `OTEL_EXPORTER_OTLP_ENDPOINT`。启用后自动插桩入站 HTTP（每请求 span）与出站 fetch（undici），资源属性包含 `zenith.process.role`，日志行追加 `trace_id` / `span_id` 便于 APM 关联；停机时自动 flush 未导出的 span |

`/metrics` 默认无鉴权，生产环境应只向内网、VPN 或采集器开放。

## GitHub Actions

| 工作流 | 触发 | 行为 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | `master` push、pull request | Node 24、`npm ci`、`npm run lint`、`npm run test`、`npm run build` |
| `.github/workflows/pages.yml` | 文档 / Web / shared / lockfile 变更、手动触发 | 构建 VitePress 文档与 Demo 站，把 Demo 合并到 `/demo/` 后发布 GitHub Pages |
| `.github/workflows/release.yml` | `v*.*.*` tag、手动指定 tag | 构建全部包，打包 server / web zip，从 changelog 提取 Release Notes，创建 GitHub Release |

## 升级版本

1. 可选：在发布前执行 `npm run verify:split` 验证本地 api / worker 拆分链路。
2. 停止 worker，并等待其在 `SHUTDOWN_GRACE_MS` 内完成排空。
3. 切换到目标 tag 并安装依赖：`git fetch --tags && git checkout vX.Y.Z && npm ci`。
4. 显式执行迁移：源码部署用 `npm run db:migrate`，dist 产物用 `npm run start:migrate -w @zenith/server`。
5. 启动 worker。
6. 滚动重启 api；api 重启不再中断后台作业。
7. 重新构建或替换 `packages/web/dist/`，Nginx 无需重启。
8. Electron 客户端可通过「系统设置 → 应用版本」发布热更新包或安装包，详见 [Electron 桌面客户端](./electron.md)。
