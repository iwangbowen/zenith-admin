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

```env
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

# CORS（生产环境务必收紧，指定前端域名）
# CORS_ORIGIN=https://your-domain.com
```

::: warning 安全提示
生产环境务必使用强随机字符串作为 `JWT_SECRET`，并通过 `CORS_ORIGIN` 限制允许的前端来源，不要保留默认的"允许所有来源"配置。
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

    # WebSocket 支持
    location /ws {
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

若需要自定义前端接入的 API 地址，在构建前修改 `packages/web/.env` 中的 `VITE_API_BASE_URL`，或在使用 Nginx 反向代理时，将 `/api/` 代理到后端，前端保持默认配置即可。

---

## 健康检查

服务启动后，可通过以下接口确认后端运行正常：

```bash
curl http://localhost:3300/api/health
```

返回 `200 OK` 表示服务正常。

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
