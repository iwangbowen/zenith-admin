# 网页授权与 JS-SDK

面向 H5 网页开发的两类能力：**网页授权 OAuth2**（获取用户 openid / 用户信息）与 **JS-SDK 配置签名**（`wx.config` 调用微信 JS 接口）。

---

## 网页授权 OAuth2

用于 H5 页面获取用户身份。需先在微信公众平台「接口权限 - 网页授权」配置授权回调域名。

### 生成授权链接

`POST /api/mp/oauth/url` 按账号生成授权跳转 URL：

| 参数 | 说明 |
| --- | --- |
| `accountId` | 公众号 |
| `redirectUri` | 用户授权后微信跳转的页面（须在已配置的授权域名下） |
| `scope` | `snsapi_base`（静默授权，仅取 openid）/ `snsapi_userinfo`（弹窗授权，取用户信息） |
| `state` | 可选，原样回传，可用于防 CSRF / 携带业务参数 |

### 公开回调端点

系统提供开箱即用的**公开回调端点**（无需登录），可直接作为 `redirect_uri`：

`GET /api/public/mp/oauth/{accountId}` —— 用授权 `code` 换取 `access_token` + openid（`snsapi_userinfo` 时进一步拉取用户信息），返回 openid / unionid / 用户资料 JSON。

> OAuth 的 `sns/oauth2/*` 接口使用 appId + secret 直接换取，与全局 `access_token` 独立。

---

## JS-SDK 配置签名

用于网页调用微信 JS-SDK（`wx.config`）。需先在公众平台配置「JS 接口安全域名」。

`POST /api/mp/jssdk/config` 输入页面完整 URL（不含 `#` 及其后部分），返回 `wx.config` 所需的签名参数：

| 返回 | 说明 |
| --- | --- |
| `appId` | 公众号 AppID |
| `timestamp` | 时间戳（秒） |
| `nonceStr` | 随机串 |
| `signature` | 对 `jsapi_ticket` + `noncestr` + `timestamp` + `url` 做 sha1 签名 |

签名实现于 `lib/wechat/jssdk.ts`：`jsapi_ticket` 经微信 `ticket/getticket` 获取后缓存于 Redis（key `mp:jsapi_ticket:{id}`，留 300s 余量），按 `jsapi_ticket=...&noncestr=...&timestamp=...&url=...` 拼接后 sha1。

---

## 接口一览

| 方法 | 路由 | 权限 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/mp/oauth/url` | `mp:oauth:build` | 生成网页授权链接 |
| `GET` | `/api/public/mp/oauth/{accountId}` | 公开 | 网页授权回调（换 openid / 用户信息） |
| `POST` | `/api/mp/jssdk/config` | `mp:jssdk:config` | 生成 JS-SDK `wx.config` 签名 |

---

## 前端页面

| 页面 | 路径 | 主要能力 |
| --- | --- | --- |
| 网页授权 | `/mp/oauth` | 生成授权链接、复制公开回调端点；JS-SDK 配置签名生成卡片 |

---

## 相关文档

- [OAuth 第三方登录](../backend/oauth.md)
- [外呼 HTTP 客户端](../backend/http-client.md)
