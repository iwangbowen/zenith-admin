# 部署说明

本页说明如何将 Zenith Admin 部署到生产服务器，面向需要独立运行此系统的团队或个人。

## 前置依赖

在目标服务器上准备以下环境：

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | >= 18 | 运行后端服务 |
| PostgreSQL | >= 14 | 持久化业务数据 |
| Redis | >= 6 | 持久化在线会话与黑名单状态 |
| Nginx（可选） | 任意 | 托管前端静态文件 + 反向代理 |

---

## 获取发布产物

在 [GitHub Releases](https://github.com/iwangbowen/zenith-admin/releases) 页面下载最新版本的两个压缩包：

| 文件 | 内容 |
|------|------|
| `zenith-admin-server-vX.Y.Z.zip` | 后端构建产物（`dist/` + `drizzle/` + `package.json`） |
| `zenith-admin-web-vX.Y.Z.zip` | 前端静态文件（直接托管即可） |

---

## 部署后端

### 1. 解压并安装依赖

```bash
unzip zenith-admin-server-vX.Y.Z.zip -d zenith-server
cd zenith-server/server

# 仅安装生产依赖
npm install --production
```

### 2. 配置环境变量

在 `zenith-server/server/` 目录下创建 `.env` 文件：

```dotenv
PORT=3300
JWT_SECRET=your-strong-secret-key

# PostgreSQL
DATABASE_URL=postgresql://user:pass@localhost:5432/zenith_admin

# Redis（URL 格式，支持带密码）
REDIS_URL=redis://127.0.0.1:6379
# REDIS_URL=redis://:your_password@127.0.0.1:6379/0

# 日志（可选）
LOG_LEVEL=info
LOG_DIR=./logs

# 请求防护（可选，默认均不启用）
# 请求体大小上限（字节），0 = 不限制。建议生产环境至少开启一个合理值
# REQUEST_BODY_LIMIT=10485760
# 请求超时（毫秒），0 = 不启用。启用后自动排除 /api/ws、/api/files、/api/db-backups 及 /export 接口
# REQUEST_TIMEOUT_MS=30000

# Prometheus 指标默认暴露在 GET /metrics
# OpenTelemetry tracing（可选）
# OTEL_ENABLED=true
# OTEL_SERVICE_NAME=zenith-admin-server
# OTEL_SERVICE_VERSION=0.5.0
# OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces
# OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer xxx

# CSRF 防护（生产环境强烈建议配置，防止跨站请求伪造）
# 逗号分隔的允许来源，留空则不限制（开发模式）
ALLOWED_ORIGINS=https://your-domain.com

# CORS（生产环境务必收紧，指定前端域名）
# CORS_ORIGIN=https://your-domain.com
```

::: warning 安全提示
生产环境务必使用强随机字符串作为 `JWT_SECRET`，并通过 `ALLOWED_ORIGINS` 限制允许的前端来源（CSRF 防护），不要保留默认的"允许所有来源"配置。
:::

### 3. 初始化数据库

```bash
# 执行数据库迁移
node dist/db/migrate.js

# 填充初始种子数据（创建 admin 账号等）
node dist/db/seed.js
```

### 4. 启动服务

```bash
# 直接启动（开发/测试）
node dist/index.js

# 使用 PM2 管理进程（推荐生产环境）
npm install -g pm2
pm2 start dist/index.js --name zenith-server
pm2 save
pm2 startup
```

后端服务默认监听 `http://localhost:3300`。

---

## 部署前端

前端为纯静态文件，解压后直接用 Nginx 托管即可。

### 1. 解压静态文件

```bash
unzip zenith-admin-web-vX.Y.Z.zip -d zenith-web
# 静态文件位于 zenith-web/web/dist/
```

### 2. Nginx 配置示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    root /path/to/zenith-web/web/dist;
    index index.html;

    # SPA 路由支持
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 反向代理
    location /api/ {
        proxy_pass http://localhost:3300;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Prometheus 指标（建议仅对内网或采集器开放）
    location = /metrics {
        proxy_pass http://localhost:3300;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # WebSocket 支持（路径必须为 /api/ws，与服务端路由一致）
    location /api/ws {
        proxy_pass http://localhost:3300;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

::: tip
将 `your-domain.com` 替换为实际域名，`/path/to/zenith-web/web/dist` 替换为实际路径。
生产环境建议同时配置 HTTPS（可使用 Let's Encrypt）。
:::

### 3. 前端环境配置

在 `packages/web/` 下创建 `.env.production`（或直接修改 `.env`），按实际情况填写：

```ini
# 后端 API 地址（生产环境必填）
VITE_API_BASE_URL=https://api.yourdomain.com
# WebSocket 地址（不填则自动从 VITE_API_BASE_URL 推导）
VITE_WS_BASE_URL=wss://api.yourdomain.com
VITE_APP_TITLE=Zenith Admin
```

若前端与后端同域部署（通过 Nginx 反向代理将 `/api/` 转发到后端），可将 `VITE_API_BASE_URL` 留空，前端将自动使用相对路径请求。

---

## 健康检查

服务启动后，可通过以下接口确认后端运行正常：

```bash
curl http://localhost:3300/api/health
```

返回 `200 OK` 表示服务正常。

## Prometheus 指标抓取

若已完成部署，可通过以下接口确认指标端点可用：

```bash
curl http://localhost:3300/metrics
```

若服务位于 Nginx 后面并通过同域名暴露，请确保已按上文示例代理 `/metrics`，否则 Prometheus 会抓到前端静态站点而不是后端指标。

::: warning
`/metrics` 默认无需鉴权，生产环境建议仅对内网、VPN 或 Prometheus 所在网段开放，避免把内部运行指标暴露到公网。
:::

## OpenTelemetry Tracing

如需将 Trace 导出到 OTLP Collector、Tempo、Jaeger、Honeycomb 等系统，可在后端 `.env` 中加入：

```dotenv
OTEL_ENABLED=true
OTEL_SERVICE_NAME=zenith-admin-server
OTEL_SERVICE_VERSION=0.5.0
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://otel-collector:4318/v1/traces
```

说明：

- 若未设置 `OTEL_ENABLED`，但已配置 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` 或 `OTEL_EXPORTER_OTLP_ENDPOINT`，服务也会自动启用 tracing
- 当前 Trace 基于 `@hono/otel`，覆盖整个 Hono 请求生命周期；若后续需要 PostgreSQL / Redis 更细粒度 spans，可继续叠加 OpenTelemetry Node auto instrumentation

---

## 升级版本

1. 在 [GitHub Releases](https://github.com/iwangbowen/zenith-admin/releases) 下载新版本产物
2. 停止当前后端进程（`pm2 stop zenith-server`）
3. 替换 `dist/` 目录内容
4. 执行数据库迁移（新版本可能包含 schema 变更）

   ```bash
   node dist/db/migrate.js
   ```

5. 重启后端进程（`pm2 restart zenith-server`）
6. 替换前端静态文件目录内容，Nginx 无需重启
