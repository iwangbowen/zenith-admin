# 事件订阅（HTTP Webhook）

事件订阅用于把工作流事件以 HTTP POST 形式投递到外部系统，由 [webhook.ts 订阅者](../../../packages/server/src/lib/workflow-subscribers/webhook.ts) 监听总线后按数据库配置分发。

## 订阅表字段（`workflow_event_subscriptions`）

| 字段 | 说明 |
| --- | --- |
| `name` | 订阅名称 |
| `url` | 投递目标 URL |
| `definitionId` | `null` = 订阅所有流程；非空 = 仅订阅指定流程定义 |
| `events` | 订阅的事件类型数组（JSON）；可选所有 12 种事件 |
| `signMode` | `hmacSha256 \| none` |
| `secret` | HMAC 密钥 |
| `headers` | 附加请求头 JSON |
| `enabled` | 是否启用 |
| `tenantId` | 租户隔离 |

> 当前订阅表 **不支持按 `nodeKey` 过滤**，需在接收方按 payload 内 `nodeKey` 自行筛选。

## 投递记录（`workflow_event_deliveries`）

每次投递写入一条记录，包含：状态（`pending / success / failed / retrying`）、响应码、响应体、尝试次数、下次重试时间。重试与超时由投递层控制，不在订阅表上配置。

## 签名

`signMode === 'hmacSha256'` 时，请求头会带：

```http
X-Zenith-Signature: t={timestamp},v1={hex_hmac}
```

签名内容为 `${timestamp}.${rawBody}`，密钥为订阅记录的 `secret`，算法 `HMAC-SHA256`。接收方应：

1. 校验 `timestamp` 与当前时间偏差（建议 ≤ 5 分钟）；
2. 用相同密钥重算 HMAC 并比对 `v1`。

## 管理 UI

前端位于「工作流 → 事件订阅」与「工作流 → 触发器执行」两个菜单。
