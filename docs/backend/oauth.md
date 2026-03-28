# OAuth 第三方登录

Zenith Admin 从 v0.1.4 起支持 OAuth 第三方登录，用户可通过 GitHub、钉钉或企业微信账号直接认证，系统会自动创建或绑定对应的本地账号。

---

## 支持的提供方

| 提供方 | 类型标识 | 说明 |
|--------|----------|------|
| GitHub | `github` | 适用于开发者工具与内部平台 |
| 钉钉 | `dingtalk` | 适用于钉钉企业用户 |
| 企业微信 | `wechat_work` | 适用于企业微信组织 |

---

## 配置方式

在后台「系统设置 → OAuth 配置」页面（菜单路径：`/system/oauth-config`）进行配置。每个提供方需要填写：

| 字段 | 说明 |
|------|------|
| Client ID | OAuth 应用的客户端 ID |
| Client Secret | OAuth 应用的客户端密钥 |
| 是否启用 | 关闭后对应提供方不出现在登录页 |

配置完成后，登录页会自动显示已启用提供方的快捷登录图标。

---

## 登录流程

```
用户点击第三方登录图标
    ↓
前端跳转到 GET /api/auth/oauth/init/:provider?redirect_uri=...
    ↓
后端生成 state 并返回提供方授权 URL
    ↓
用户在提供方页面完成授权，回调到前端 /oauth/callback
    ↓
前端将 code + state 发送到 GET /api/oauth/callback/:provider?code=...&state=...
    ↓
后端用 code 换取 access_token，再获取用户信息
    ↓
查询 user_oauth_accounts 表：
  ├── 已绑定 → 直接登录，签发 JWT
  └── 未绑定 → 创建新用户 + 绑定账号 → 签发 JWT
    ↓
JWT token 存入 localStorage，跳转至仪表盘
```

### 关键接口

| 接口 | 说明 |
|------|------|
| `GET /api/auth/oauth/init/:provider` | 获取提供方授权 URL（传入 `redirect_uri`）|
| `GET /api/oauth/callback/:provider` | OAuth 回调处理，完成 token 换取与账号关联 |
| `GET /api/oauth/accounts` | 获取当前用户已绑定的第三方账号列表 |
| `DELETE /api/oauth/accounts/:id` | 解除某个第三方账号绑定 |

### 前端回调页

`/oauth/callback` 页面（`packages/web/src/pages/oauth/`）负责：

1. 从 URL query params 中提取 `code` 和 `state`
2. 调用回调接口完成 token 换取
3. 将返回的 `accessToken` / `refreshToken` 存入 `localStorage`
4. 跳转至 `/`（仪表盘）

---

## 个人中心：关联账号

用户登录后可在「个人中心 → 关联账号」Tab 中查看已绑定的第三方账号，并可手动解除绑定。

- 解绑后，对应 OAuth 账号将不能再用于登录（除非重新绑定）
- 如系统只有 OAuth 登录，解绑前建议先设置本地密码

---

## 如何申请 OAuth 应用

### GitHub

1. 打开 GitHub → Settings → Developer settings → OAuth Apps
2. 点击「New OAuth App」
3. `Authorization callback URL` 填写：`https://your-domain.com/oauth/callback`（或本地调试时用 `http://localhost:5373/oauth/callback`）
4. 创建后获取 Client ID 和 Client Secret

### 钉钉

1. 打开钉钉开发者后台（open.dingtalk.com）
2. 创建移动应用或网页应用
3. 在「权限配置」中开启「个人信息」相关权限
4. 回调域名填写前端域名
5. 获取 AppKey（Client ID）和 AppSecret（Client Secret）

### 企业微信

1. 打开企业微信后台 → 应用管理 → 创建应用
2. 在「网页授权及 JS-SDK」中配置授权域名
3. 获取 CorpID（企业 ID）和 AgentSecret（应用 Secret）

---

## 数据库表

| 表名 | 说明 |
|------|------|
| `oauth_provider_configs` | 各提供方的 Client ID / Secret 及启用状态 |
| `user_oauth_accounts` | 用户与第三方账号的绑定关系（openId、nickname、avatar）|
