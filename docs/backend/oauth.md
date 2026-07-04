# OAuth 第三方登录

Zenith Admin 支持作为 OAuth 客户端接入第三方登录，用户可通过 GitHub、钉钉或企业微信账号直接认证。系统会优先复用已绑定账号；若第三方返回的邮箱可匹配现有本地账号，则自动完成绑定；若无法匹配，则提示用户先登录本地账号后在个人中心完成绑定。

---

## 支持的提供方

- GitHub：`github`，适用于开发者工具与内部平台
- 钉钉：`dingtalk`，适用于钉钉企业用户
- 企业微信：`wechat_work`，适用于企业微信组织

---

## 配置方式

在后台「系统设置 → OAuth 配置」页面（菜单路径：`/system/oauth-config`）进行配置。每个提供方需要填写：

- `Client ID`：OAuth 应用的客户端 ID
- `Client Secret`：OAuth 应用的客户端密钥
- `Agent ID`：企业微信应用 AgentId（企业微信使用）
- `Corp ID`：企业微信企业 ID（企业微信使用）
- `是否启用`：关闭后对应提供方不出现在登录页

配置完成后，登录页会自动显示已启用提供方的快捷登录图标。

第三方回调地址由服务端环境变量 `OAUTH_CALLBACK_BASE_URL` 拼接生成，默认值为 `http://localhost:5373`。各提供方实际回调路径分别为：

| 提供方 | 回调地址 |
|--------|----------|
| GitHub | `{OAUTH_CALLBACK_BASE_URL}/oauth/callback/github` |
| 钉钉 | `{OAUTH_CALLBACK_BASE_URL}/oauth/callback/dingtalk` |
| 企业微信 | `{OAUTH_CALLBACK_BASE_URL}/oauth/callback/wechat_work` |

---

## 登录流程

```text
用户点击第三方登录图标
    ↓
前端请求 GET /api/auth/oauth/:provider
    ↓
后端生成 state 并返回提供方授权 URL
    ↓
前端跳转到提供方授权页
    ↓
用户在提供方页面完成授权，回调到前端 /oauth/callback/:provider?code=...
    ↓
前端回调页读取 `provider` + `code`，发送 POST /api/auth/oauth/:provider/callback
    ↓
后端用 code 换取 access_token，再获取用户信息
    ↓
查询 user_oauth_accounts / users.email：
  ├── 已绑定 → 直接登录，签发 JWT
  ├── 未绑定但邮箱匹配现有用户 → 自动绑定并登录
  └── 无法匹配 → 返回 `needBind=true`，提示用户先登录后绑定
    ↓
JWT token 存入 localStorage，跳转至仪表盘
```

### 关键接口

- `GET /api/auth/oauth/{provider}`：获取提供方授权 URL
- `POST /api/auth/oauth/{provider}/callback`：OAuth 回调处理，完成 token 换取与登录/绑定判定
- `GET /api/auth/oauth/accounts`：获取当前用户已绑定的第三方账号列表
- `POST /api/auth/oauth/bind`：为当前登录用户绑定 OAuth 账号
- `DELETE /api/auth/oauth/unbind/{provider}`：解除指定提供方账号绑定

### 前端回调页

`/oauth/callback/:provider` 页面负责：

1. 从路由参数中提取 `provider`，并从 URL query params 中提取 `code`
2. 调用 `POST /api/auth/oauth/{provider}/callback` 完成 token 换取
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
3. `Authorization callback URL` 填写：`https://your-domain.com/oauth/callback/github`（或本地调试时用 `http://localhost:5373/oauth/callback/github`）
4. 创建后获取 Client ID 和 Client Secret

### 钉钉

1. 打开钉钉开发者后台（open.dingtalk.com）
2. 创建移动应用或网页应用
3. 在「权限配置」中开启「个人信息」相关权限
4. 回调地址填写前端回调页，例如 `https://your-domain.com/oauth/callback/dingtalk`
5. 获取 AppKey（Client ID）和 AppSecret（Client Secret）

### 企业微信

1. 打开企业微信后台 → 应用管理 → 创建应用
2. 在「网页授权及 JS-SDK」中配置授权域名与回调地址，例如 `https://your-domain.com/oauth/callback/wechat_work`
3. 获取 CorpID（企业 ID）、AgentId（应用 ID）和 AgentSecret（应用 Secret）

---

## OAuth2 服务端

除第三方登录外，Zenith Admin 也提供 OAuth2 服务端能力，可在「系统设置 → OAuth2 应用」（菜单路径：`/system/oauth2-apps`）管理本系统对外签发令牌的客户端应用。

### 应用管理接口

- `GET /api/oauth2/clients`：获取 OAuth2 应用列表
- `POST /api/oauth2/clients`：创建 OAuth2 应用，`client_secret` 仅返回一次
- `GET /api/oauth2/clients/{id}`：获取应用详情
- `PUT /api/oauth2/clients/{id}`：更新应用
- `DELETE /api/oauth2/clients/{id}`：删除应用
- `POST /api/oauth2/clients/{id}/regenerate-secret`：重置应用密钥
- `GET /api/oauth2/clients/tokens?clientId=...`：获取应用令牌列表
- `DELETE /api/oauth2/clients/tokens/{id}`：撤销令牌

### 标准 OAuth2 端点

- `GET /api/oauth2/authorize/info`：查询应用授权信息，用于前端同意页面
- `POST /api/oauth2/authorize`：用户确认授权，支持授权码模式与 implicit
- `POST /api/oauth2/token`：令牌端点，支持 `authorization_code`、`client_credentials`、`refresh_token`
- `POST /api/oauth2/token/revoke`：撤销令牌（RFC 7009）
- `POST /api/oauth2/token/introspect`：令牌自省（RFC 7662）
- `GET /api/oauth2/userinfo`：UserInfo（OIDC Core）

OAuth2 服务端使用 opaque token，数据库只保存 SHA-256 哈希；授权码有效期 10 分钟，授权码单次使用后标记为已使用。公开客户端可使用 PKCE，机密客户端通过 `client_secret` 校验。

---

## 数据库表

- `oauth_configs`：各提供方的 Client ID / Secret 及启用状态
- `user_oauth_accounts`：用户与第三方账号的绑定关系（openId、nickname、avatar）
- `oauth2_clients`：OAuth2 服务端客户端应用
- `oauth2_authorization_codes`：OAuth2 授权码
- `oauth2_tokens`：OAuth2 access token / refresh token 哈希
- `oauth2_user_grants`：用户对 OAuth2 应用的授权记录
