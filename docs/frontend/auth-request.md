# 认证与请求

这一页说明后台、会员端与移动审批端如何维护登录态，以及请求层如何与后端接口协作。

## 登录态管理

后台认证状态集中在 `packages/web/src/providers/AuthProvider.tsx`，由 `main.tsx` 挂载在 `QueryClientProvider` 之内、`App` 之外。页面通过 `useAuth()`（`hooks/useAuth.ts`）读取账号状态，通过 `usePermission()` 读取同一 Provider 注入的权限码。

- **会话数据也是服务端状态**：当前用户与权限来自 `hooks/queries/auth.ts` 的 `authSessionQueryOptions()`，query key 为 `['auth', 'me']`，请求 `GET /api/auth/me`，`staleTime` 为 5 分钟，`refetchOnWindowFocus: true`
- `useAuth()` 暴露：`user`、`permissions`、`status`、`loading`、`refreshing`、`error`、`parkedAccounts`、`canAddAccount`、`login`、`verifyMfaLogin`、`register`、`logout`、`refresh`、`updateUser`、`switchAccount`、`removeAccount`、`logoutAllAccounts`
- **状态机**：`anonymous`（本地无 access token）→ `checking`（有 access token，正在确认会话）→ `authenticated`；会话查询失败但不是 401 时进入 `unavailable`，凭证保留，`App.tsx` 渲染 `FullPageRetry`

后台登录态使用 `@zenith/shared/core` 中的本地存储 key：

| 常量 | Key | 说明 |
| --- | --- | --- |
| `TOKEN_KEY` | `zenith_token` | 当前活跃账号的 Access Token |
| `REFRESH_TOKEN_KEY` | `zenith_refresh_token` | 当前活跃账号的 Refresh Token |
| `ACCOUNTS_STORE_KEY` | `zenith_accounts` | 停靠账号列表，只保存资料快照与 refreshToken |
| `ACCOUNT_SWITCH_BROADCAST_KEY` | `zenith_account_switch` | 跨标签页账号切换广播 |
| `PREFERENCES_KEY` | `zenith_preferences` | 当前账号的偏好缓存 |
| `TABS_STORAGE_KEY` | `zenith_tabs` | 当前账号的多标签页缓存 |

`AuthProvider` 还维护 `zenith_device_id`（随机 UUID），登录时随 `deviceInfo` 上报，用于可信设备识别。

## 多账号切换

后台右上角头像菜单内置 GitHub 风格账号切换器（`layouts/admin/AccountSwitcher.tsx`）。当前活跃账号占 1 席，最多同时保持 `MAX_STORED_ACCOUNTS = 5` 个账号登录；停靠区最多保存 4 个非活跃账号。

### 停靠账号模型

`packages/web/src/lib/account-store.ts` 是停靠账号仓库的唯一读写方。`StoredAccount` 字段为：

```ts
interface StoredAccount {
  userId: number;
  username: string;
  nickname: string;
  avatar?: string;
  tenantName?: string | null;
  refreshToken: string;
  lastUsedAt: number;
}
```

停靠账号不保存 access token。切换账号时使用目标账号的 `refreshToken` 调用 `POST /api/auth/refresh` 换发新的 access token；目标会话过期时移除该停靠账号，并引导到 `/login?add_account=1&username=...` 重新登录。

### 添加与切换流程

- 点击「添加其他账号」跳转 `/login?add_account=1`；该模式保留当前登录态，登录、MFA 验证或注册成功后把原账号停靠，写入新账号凭证并整页重载
- 切换停靠账号时先快照当前账号的用户资料与 refreshToken，再把目标账号从停靠区取出，写入目标 refreshToken 与换发得到的 access token
- 切换、添加成功后调用 `broadcastSwitchAndReload()`：写入 `zenith_account_switch` 广播其他标签页，本标签页跳到应用首页并重载；其他标签页监听到广播后整页重载，避免旧内存态发新账号请求
- `ACCOUNTS_STORE_KEY` 变化时同步账号切换器列表；`TOKEN_KEY` 变化时同步登录/退出状态
- 退出当前账号时若存在停靠账号，自动切到最近使用的账号；退出停靠账号或退出全部账号时使用 `POST /api/auth/logout-by-refresh` 按 refreshToken 注销服务端会话

账号切换会清理账号级本地状态：偏好缓存、标签页缓存与锁屏凭证；查询缓存也会清空身份相关内容，仅保留 `auth-public` 公开配置查询。

## 请求封装

通用 HTTP 客户端在 `packages/web/src/utils/http-client.ts`（`HttpClient` 类），三端各自实例化，token 与登录入口隔离：

| 实例 | 文件 | token key | 401 刷新接口 | 凭证失效后 |
| --- | --- | --- | --- | --- |
| `request`（后台 admin） | `utils/request.ts` | `zenith_token` / `zenith_refresh_token` | `POST /api/auth/refresh` | 派发 `auth:invalidated`，由 `AuthProvider` 切回匿名态 |
| `memberRequest`（会员前台） | `member/utils/member-request.ts` | `zenith_member_token` / `zenith_member_refresh_token` | `POST /api/member/auth/refresh` | 跳转 `/member.html#/login` |
| `approvalRequest`（移动审批轻页） | `approval/lib/approval-request.ts` | `zenith_token` / `zenith_refresh_token` | `POST /api/auth/refresh` | 跳转 `/approval.html#/login`；退出只清 access token |

`HttpClient` 统一实现：

- 自动附加 `Authorization`；非 `FormData` 请求自动设置 `Content-Type: application/json`
- Access Token 过期时用 Refresh Token 换取新 access token 并重试原请求；并发请求共享同一个刷新 Promise
- 刷新失败或重试仍 401 时清除配置的本地凭证，写入 `zenith_auth_invalidated_reason`，再执行宿主回调或整页跳转
- `silent` 由调用方接管错误提示；`skipAuth` 让 401 直接返回响应体，不触发刷新与退出
- 429 读取 `Retry-After` 并返回 `retryAfterSeconds`
- 后台、会员与移动审批仅将带 `X-Zenith-Error: maintenance` 的 503 派发为 `maintenance:enabled`，失效公开状态并显示维护提示；30 秒轮询兜底，恢复后校准缓存，失败保留凭证。管理恢复和普通业务通行分别由服务端能力决定，见[维护模式](../backend/maintenance-mode.md)。
- `fetchRaw(url, init)`：带鉴权的原生 fetch，401 时刷新并重试一次，返回原生 `Response`（非 401 的失败状态码原样返回，认证失效 / 网络错误返回 `null`），供流式与二进制读取
- `authHeaders()`：当前登录态的 `Authorization` 头，供 Semi `Upload`、wangEditor 等自行发请求的第三方组件使用

后台 `request` 额外提供：

| 方法 | 用途 |
| --- | --- |
| `postForm(url, formData, { onProgress })` | 带上传进度的表单提交；传 `onProgress` 时走 XMLHttpRequest |
| `getBlob(url, init?)` | 二进制读取（可传 `method` / `body` 走 POST 导出），非 2xx 按统一错误提示处理 |
| `download(url, filename)` | 下载二进制响应并保存为文件 |

流式响应经 `utils/streaming.ts` 读取：`streamText(url, onChunk, signal)` 逐块回调纯文本流（tail -f、ping）；
`readSseStream(response, onEvents)` 按空行切帧解析 `event:` / `data:`，每个网络分块解析出的帧一次回调。
页面不得裸用 `fetch` 手拼 `Authorization`，也不得自写 `getReader()` 循环与 SSE 帧解析。

::: tip request 只是传输层
页面数据读取不要直接写 `request.get` + 本地 `loading` 状态。可缓存读与影响其他视图的写统一收口到 `hooks/queries/` 域 hooks，queryFn / mutationFn 内部再使用 `request.*(...).then(unwrap)`。完整规范见[数据获取与服务端状态](/frontend/data-fetching)。
:::

## 与后端的协作方式

### 401 刷新流程

请求返回 401 且未设置 `skipAuth` 时，请求封装读取 refresh token 并调用对应刷新接口：

```json
{ "refreshToken": "<refresh-token>" }
```

刷新成功后更新 access token，并用响应中轮换后的 `refreshToken` 覆盖本地保存的 refresh token（旧值已被服务端吊销），然后重试原请求；停靠账号切回时同样以换发结果中的新 refresh token 入库。

### 响应读取

统一响应格式：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

`lib/query.ts` 的 `unwrap(res)` 在 `code !== 0` 时抛 `ApiError`，供 TanStack Query 的 queryFn / mutationFn 使用。

### 共享类型

接口类型、实体定义和校验 schema 尽量复用 `@zenith/shared`（按域子路径导入），避免前后端各写一套。

## 开发环境代理配置

开发环境下，Vite Dev Server 将 `/api/*` 请求转发到后端，客户端保持使用相对路径。

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `VITE_API_PROXY_TARGET` | Dev Server 代理目标，只在 `vite.config.ts` 读取，不进入客户端包 | `http://localhost:3300` |
| `VITE_API_BASE_URL` | 客户端 API 基础 URL。开发留空，生产可填完整后端地址 | 空 |
| `VITE_WS_BASE_URL` | WebSocket 基础 URL。开发留空，由 `useWebSocket.ts` 从当前 Origin 推导 | 空 |

```ts
server: {
  proxy: {
    '/api': {
      target: apiTarget,
      changeOrigin: true,
      ws: true,
    },
  },
}
```

## 会员端独立请求实例

会员前台使用 `member.html` 入口、`member/App-member.tsx`、`MemberAuthProvider`、`memberQueryClient` 与 `memberRequest`。会员路由基于 `HashRouter`，公开页在 `/`、`/features`、`/levels`、`/promotions`、`/about`，会员中心页由 `RequireMember` 保护。会员 token 与后台管理员 token 隔离，退出登录时清空会员 Query 缓存。

## 开发建议

- 新增接口前先确认 `@zenith/shared` 是否已有类型、常量或校验 schema
- 后台、会员端、移动审批端不要混用请求实例或 token key
- 登录态、权限码、菜单树都按服务端状态处理，账号切换和退出必须清理身份相关缓存
- 页面数据获取遵循[数据获取与服务端状态](/frontend/data-fetching)中的域 hooks 模式
