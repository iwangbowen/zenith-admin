# 消息回调接入

公众号消息回调是整个模块的**事件入口**：消息落库、扫码计数与送积分、关注自动建会员、多客服会话接入、模板消息送达回执、自动回复，全部由回调驱动。回调为**公开端点**（无需登录，由微信服务器调用），实现于 `routes/mp/mp-callback.ts`。

---

## 回调端点

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| `GET` | `/api/public/mp/callback/{accountId}` | 服务器配置校验（验签通过后原样返回 `echostr`） |
| `POST` | `/api/public/mp/callback/{accountId}` | 接收消息 / 事件（明文或 AES 解密）并处理 |

将 `{API_BASE}/api/public/mp/callback/{accountId}` 填入微信公众平台「设置与开发 - 服务器配置」的 URL，Token / EncodingAESKey / 加密模式须与[公众号账号](./accounts.md)中的配置一致。

- **无登录上下文**：按 `accountId` 直接查询账号（不做租户过滤），落库时携带账号 `tenantId`。
- 账号 `status = disabled` 时直接返回 200 不处理。
- 请求体上限 **64KB**，超限直接拒绝，避免对未验签内容做大文本解析。

---

## 验签与加解密

账号的 `encrypt_mode` 决定验签与解密方式（实现于 `lib/wechat/crypto.ts` / `signature.ts`）：

| 模式 | 验签 | 消息体 |
| --- | --- | --- |
| `plaintext` 明文 | 校验 `signature`（token + timestamp + nonce 排序后 sha1） | 明文 XML |
| `compatible` 兼容 / `safe` 安全 | 校验 `msg_signature`（额外纳入 `Encrypt` 字段） | 用 `encoding_aes_key` 对 `Encrypt` 字段 AES 解密 |

- 请求带 `encrypt_type=aes` 或账号非明文模式时走加密分支。
- 签名比较使用常量时间比较（`timingSafeCompare`），防时序攻击。

---

## 处理管线

POST 回调验签、解析成功后按以下顺序处理：

1. **入站落库 + 去重**：依赖 `(account_id, msg_id)` 部分唯一索引原子去重；事件消息无 `MsgId` 时按 `openid + event + eventKey + createTime` 合成 sha1 作为去重键（微信重试时字段一致，事件同样可去重）。
2. **带参二维码**：`SCAN`（已关注扫码）或 `subscribe` + `qrscene_` 前缀（扫码关注）事件 → 扫码计数 + [扫码送积分](./marketing.md#带参二维码)。
3. **关注自动建会员**：账号开启 `auto_create_member` 时，首次 `subscribe` 事件自动建会员并绑定（详见[粉丝与会员](./fans.md#会员体系打通)）。
4. **多客服会话接入**：非事件类实质消息触发[会话状态机](./customer-service.md)（建 / 续会话并按策略分配）。
5. **模板消息送达回执**：`TEMPLATESENDJOBFINISH` 事件按 `msgid` 回写[发送日志](./marketing.md#送达回执)最终状态。
6. **自动回复**：关注事件 / 文本消息匹配[自动回复](./messages.md#自动回复)，以被动回复 XML 返回；安全模式下回复 XML 会 AES 加密后返回。出站回复仅在消息首次到达时落库（重试时仍返回被动回复，但不写重复记录）。

> 第 2–5 步均为**最佳努力**：单步失败仅记日志，不影响响应与其余步骤。

---

## 响应与重试语义

微信对非 200 响应或 5 秒内未响应会重试（最多 3 次），处理结果按可否重试区分：

| 情形 | 响应 | 效果 |
| --- | --- | --- |
| 账号不存在 | `404` | — |
| 验签 / 解密失败、请求体超限 | `403` | 拒绝处理 |
| 报文解析失败 | `200` 空串 | **不重试**（坏消息，重试无意义） |
| 入站落库失败（如 DB 抖动） | `500` | **触发微信重试**，避免消息永久丢失 |
| 正常处理 | `200`（被动回复 XML 或空串） | — |
| 重复推送（微信重试） | `200` | 去重不落库，被动回复仍正常返回 |

---

## 相关文档

- [公众号账号](./accounts.md)（Token / EncodingAESKey / 加密模式配置）
- [消息与自动回复](./messages.md)
- [多客服会话治理](./customer-service.md)
- [群发、模板消息与二维码](./marketing.md)
