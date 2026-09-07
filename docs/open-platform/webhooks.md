# Webhook

开放平台 Webhook 将应用调用失败、配额事件、Scope 拒绝等事件投递到开发者配置的 HTTP 回调地址。

---

## 订阅模型

订阅存储在 `app_webhook_subscriptions`。

| 字段 | 说明 |
| --- | --- |
| `clientId` | 所属应用 AppKey |
| `url` | HTTP/HTTPS 回调地址 |
| `signMode` | `hmacSha256` 或 `none` |
| `events` | 订阅事件；空数组表示订阅全部 |
| `headers` | 自定义请求头 |
| `status` | `enabled` / `disabled` |
| `consecutiveFailures` | 连续终态失败次数 |
| `autoDisabledAt` | 自动停用时间 |

创建或重置订阅密钥时，明文 `secret` 只返回一次。

## 可订阅事件

| 事件 | 说明 |
| --- | --- |
| `app.test` | 测试事件 |
| `app.call.failed` | 调用失败 |
| `app.quota.warning` | 配额预警 |
| `app.quota.exceeded` | 配额超限 |
| `app.scope.denied` | Scope 未授权 |

CMS 站点域事件通过同一开放事件总线进入 Webhook 投递链路，事件形如 `cms.content.published`、`cms.content.updated`、`cms.content.offline`、`cms.content.recycled`、`cms.content.deleted`。

企业网盘文件变更事件同样经该链路投递：`drive.node.created` / `drive.node.version_created` / `drive.node.updated` / `drive.node.deleted` /
`drive.node.restored` / `drive.node.purged` / `drive.share.created` / `drive.share.revoked` / `drive.collect.received`。
这些事件由文件动态派生并延迟约 2 秒投递（事务确认提交后才 emit），payload 只含节点 / 空间 / 外链元数据，不含文件内容与下载地址；
预览、下载等高频动作不对外投递。网盘事件必须显式订阅、必须使用 `hmacSha256` 签名，且只投递给在「合规治理 → 开放应用授权」中被授予该空间的应用。

## 投递请求

投递请求使用 JSON 请求体，并附带以下系统头：

| Header | 说明 |
| --- | --- |
| `X-Zenith-Event` | 事件类型 |
| `X-Zenith-Event-Id` | 事件 ID |
| `X-Zenith-Delivery-Id` | 投递记录 ID |
| `X-Zenith-Attempt` | 当前尝试次数 |
| `X-Zenith-Signature` | `hmacSha256` 模式下的签名 |

签名格式：

```text
X-Zenith-Signature: t=<timestamp>,v1=<hex_hmac_sha256>
```

签名计算：

```text
v1 = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
```

## 重试与自动停用

- 投递超时时间为 10 秒。
- 响应体最多记录 4096 字节。
- 重试间隔按分钟为 `[1, 5, 30, 180, 720]`。
- HTTP 4xx（除 408、429）视为永久失败，不再阶梯重试。
- SSRF 拦截、URL 协议非法、DNS 无法解析、证书不可信等配置类错误视为永久失败。
- 非测试事件达到 `OPEN_WEBHOOK_AUTO_DISABLE_FAILURES` 次连续终态失败后自动停用订阅，默认阈值为 5。
- 最终失败会向应用 owner 发送 `open-platform.webhook.delivery_failed` 通知。

## SSRF 防护

创建、更新与实际投递都会校验出站地址。开发环境可通过 `OPEN_WEBHOOK_ALLOWED_HOSTS` 放行本地或指定主机。

## Webhook API

挂载前缀：`/api/app-webhooks`。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/app-webhooks` | `open:webhook:view` | 获取订阅列表 |
| `GET` | `/api/app-webhooks/events` | 登录 | 获取可订阅事件类型 |
| `POST` | `/api/app-webhooks` | `open:webhook:manage` | 创建订阅并返回一次性 `secret` |
| `GET` | `/api/app-webhooks/{id}` | `open:webhook:view` | 获取订阅详情 |
| `PUT` | `/api/app-webhooks/{id}` | `open:webhook:manage` | 更新订阅 |
| `POST` | `/api/app-webhooks/{id}/regenerate-secret` | `open:webhook:manage` | 重置签名密钥 |
| `POST` | `/api/app-webhooks/{id}/test` | `open:webhook:manage` | 发送测试投递 |
| `DELETE` | `/api/app-webhooks/{id}` | `open:webhook:manage` | 删除订阅 |
| `GET` | `/api/app-webhooks/deliveries` | `open:webhook:view` | 获取投递日志列表 |
| `GET` | `/api/app-webhooks/deliveries/{id}` | `open:webhook:view` | 获取投递详情 |
| `POST` | `/api/app-webhooks/deliveries/{id}/retry` | `open:webhook:manage` | 重试单条最终失败投递 |
| `POST` | `/api/app-webhooks/deliveries/batch-retry` | `open:webhook:manage` | 批量重试最终失败投递，单次最多 100 条 |

