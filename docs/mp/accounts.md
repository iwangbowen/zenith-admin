# 公众号账号管理

公众号账号是整个模块的核心实体，支持**配置多个公众号并在各页面自由切换**。账号信息保存在 `mp_accounts` 表，前端通过 `useMpAccounts()` hook 维护「当前公众号」选择（localStorage 持久化，跨页面共享）。

---

## 数据模型

| 字段 | 说明 |
| --- | --- |
| `name` / `account` | 公众号名称 / 原始 ID（`gh_` 开头） |
| `app_id` / `app_secret` | 开发者凭证；列表接口对 `app_secret` 脱敏为 `******`，详情返回空串，更新时留空表示保持原值 |
| `token` | 服务器配置 Token，用于回调签名校验 |
| `encoding_aes_key` | 消息加解密密钥（安全 / 兼容模式必填） |
| `encrypt_mode` | `plaintext` 明文 / `compatible` 兼容 / `safe` 安全 |
| `type` | `subscribe` 订阅号 / `service` 服务号 / `test` 测试号 |
| `qr_code_url` | 公众号二维码图片地址 |
| `is_default` | 是否默认公众号；设为默认时取消同租户其它默认 |
| `auto_create_member` | 关注即自动注册并绑定会员（详见 [粉丝与会员](./fans.md)） |
| `content_check_enabled` | 是否对群发 / 客服消息启用内容安全校验（详见 [内容安全](./statistics.md#内容安全校验)） |
| `status` | `enabled` / `disabled`；`disabled` 时回调直接返回 200 不处理 |

---

## 多公众号管理

- 每个业务页面顶部均有 `MpAccountSwitcher` 公众号切换器，切换后页面按 `currentId` 重新拉取数据。
- 前端通过 `currentIdRef` 在异步请求返回后判断账号是否已切换，丢弃过期响应，避免「账号 A 的数据渲染到账号 B」。
- 账号是各 `mp_*` 表的外键根，删除账号会级联清理其标签、粉丝、消息、菜单、客服会话等数据。

---

## 加密模式与回调配置

账号的 `token` / `encoding_aes_key` / `encrypt_mode` 决定回调的验签与消息加解密方式：明文模式仅校验 `signature`；兼容 / 安全模式校验 `msg_signature` 并对 `Encrypt` 字段做 AES 解密。

将回调地址 `{API_BASE}/api/public/mp/callback/{accountId}` 填入微信公众平台「服务器配置」即可，Token / EncodingAESKey / 加密模式须与账号配置一致。验签细节、处理管线与重试语义详见 [消息回调接入](./callback.md)。

---

## 连接测试

`POST /api/mp/accounts/{id}/test` 使用账号 `app_id` / `app_secret` 向微信换取 `access_token`，验证凭证是否有效：成功返回 `{ success: true }` 并缓存 token，凭证错误时返回微信错误信息。前端在账号列表「测试连接」按钮触发。

---

## 接口一览

| 方法 | 路由 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/mp/accounts` | `mp:account:list` | 公众号列表（分页 / 关键词 / 类型） |
| `GET` | `/api/mp/accounts/{id}` | `mp:account:list` | 公众号详情（编辑用，`app_secret` 返回空串） |
| `POST` | `/api/mp/accounts` | `mp:account:create` | 新增公众号 |
| `PUT` | `/api/mp/accounts/{id}` | `mp:account:update` | 编辑公众号 |
| `POST` | `/api/mp/accounts/{id}/default` | `mp:account:default` | 设为默认 |
| `POST` | `/api/mp/accounts/{id}/test` | `mp:account:token` | 连接测试 |
| `DELETE` | `/api/mp/accounts/{id}` | `mp:account:delete` | 删除公众号 |

---

## 前端页面

| 页面 | 路径 | 主要能力 |
| --- | --- | --- |
| 公众号账号 | `/mp/accounts` | 列表 / 新增 / 编辑 / 删除 / 设为默认 / 连接测试；表单含加密模式、关注建会员、内容安全校验开关 |

---

## 菜单与权限

| 菜单 | 权限码 |
| --- | --- |
| 公众号账号（页面） | `mp:account:list` |
| 新增公众号 | `mp:account:create` |
| 编辑公众号 | `mp:account:update` |
| 删除公众号 | `mp:account:delete` |
| 设为默认 | `mp:account:default` |
| 测试连接 | `mp:account:token` |
| 内容安全检测 | `mp:security:check` |
