# 认证与请求

这一页说明前端如何维护登录态，以及请求层如何与后端接口协作。

## 登录态管理

- 通过 `useAuth` hook 管理认证状态
- Token 存储在 `localStorage`，key 来自 `@zenith/shared/src/constants.ts`：

| 常量 | Key | 说明 |
|------|-----|------|
| `TOKEN_KEY` | `zenith_token` | Access Token |
| `REFRESH_TOKEN_KEY` | `zenith_refresh_token` | Refresh Token，用于自动续期 |
| `PREFERENCES_KEY` | `zenith_preferences` | 用户偏好设置（主题、布局等）|

## 请求封装

前端 HTTP 请求统一封装在：

`packages/web/src/utils/request.ts`

主要职责：

- 自动附加 Bearer Token
- 统一处理接口响应
- Access Token 过期时，自动用 Refresh Token 换取新 token 并重试
- 在 401（无法续期）场景下跳转登录页

## 与后端的协作方式

### 请求头

需要认证的请求应自动带上：

```http
Authorization: Bearer <token>
```

### 响应读取

优先按统一响应格式读取：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

### 共享类型

接口类型、实体定义和校验 schema 尽量复用 `@zenith/shared`，避免前后端各写一套。

## 开发环境代理配置

开发环境下，前端 Vite Dev Server 通过内置代理将 `/api/*` 请求转发到后端，避免跨域问题，同时让前端无需感知后端地址。

**相关文件：**

- `packages/web/.env.development` — 开发环境变量
- `packages/web/vite.config.ts` — 代理规则定义

**关键环境变量：**

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `VITE_API_PROXY_TARGET` | 代理目标（后端地址），仅在 Vite Dev Server 中生效，**不会**暴露到客户端 | `http://localhost:3300` |
| `VITE_API_BASE_URL` | 客户端 API 基础 URL。**开发时留空**，请求走相对路径 `/api/...` 由代理转发；**生产部署时**填写后端完整地址，如 `https://api.yourdomain.com` | 空（开发）|
| `VITE_WS_BASE_URL` | WebSocket 基础 URL。**开发时留空**，由 `useWebSocket.ts` 自动从当前 Origin 推导并经代理转发；**生产时**填写如 `wss://api.yourdomain.com` | 空（开发）|

**代理规则（`vite.config.ts`）：**

```ts
server: {
  proxy: {
    '/api': {
      target: apiTarget, // 来自 VITE_API_PROXY_TARGET
      changeOrigin: true,
      ws: true, // 同时代理 WebSocket（/api/ws）
    },
  },
},
```

**各环境配置示例：**

::: code-group

```env [.env.development（开发）]
VITE_API_BASE_URL=
VITE_WS_BASE_URL=
VITE_API_PROXY_TARGET=http://localhost:3300
```

```env [生产部署（自行创建 .env.production）]
VITE_API_BASE_URL=https://api.yourdomain.com
VITE_WS_BASE_URL=wss://api.yourdomain.com
# 生产构建无 Dev Server，无需 VITE_API_PROXY_TARGET
```

:::

> **注意**：`VITE_API_PROXY_TARGET` 不带 `VITE_` 前缀以外的特殊声明，Vite 不会将它注入到客户端 bundle 中（因为 `loadEnv` 在 `vite.config.ts` 中以非 `import.meta.env` 方式读取），后端地址不会泄露到生产包。

## 开发建议

- 新增接口前，先确认是否已有共享类型或校验 schema
- 对需要登录的页面，优先复用现有登录态与跳转机制
- 请求错误处理尽量集中在封装层，不把每个页面都写成“各自为战”
