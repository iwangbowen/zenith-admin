# 外部审批

外部审批用于把审批任务转交到外部系统（如钉钉、企业微信、第三方审批中心）。当审批节点开启 `externalApproval.enabled` 时，节点产生的 `task.created` 事件会被 [external-approver.ts 订阅者](../../../packages/server/src/lib/workflow-subscribers/external-approver.ts) 接管，对外发起派发请求，外部系统通过回调推进任务状态。

## 节点配置（`WorkflowNodeConfig.externalApproval`）

| 字段 | 说明 |
| --- | --- |
| `enabled` | 是否开启 |
| `url` | 外部系统接收派发的 URL |
| `secret` | 签名密钥 |
| `signMode` | `'hmacSha256' \| 'none'`，默认 `hmacSha256` |
| `timeoutMs` | 外呼超时，默认 `10_000` |
| `fallbackStrategy` | `'manual' \| 'autoApprove' \| 'autoReject'`（类型已声明，**当前服务端未读取**，派发失败仅记录） |

## 派发请求

POST 到 `node.externalApproval.url`，请求头：

```http
Content-Type: application/json
X-Zenith-Signature: t={timestamp},v1={hex_hmac}
```

`X-Zenith-Signature` 与 [事件订阅签名](./event-subscriptions.md#签名) 算法一致，签名内容为 `${timestamp}.${rawBody}`，算法 `HMAC-SHA256`。

请求体包含任务信息与一个 `callbackUrl`，供外部系统完成审批后回调。

## 回调

回调路径：

```http
POST /api/public/workflow/external-callback/:callbackId
```

`callbackId` 为派发时生成的随机 ID，外部系统须原样回传，并在请求体中提供决策结果与可选意见。回调命中后会推进对应任务的状态（通过/驳回），触发后续节点流转。

## 派发失败

派发失败（网络错误、超时、非 2xx 响应）会记录到任务的 `externalDispatchStatus` 字段（取值 `pending / dispatched / failed / fallback`）。当前实现**不会自动按 `fallbackStrategy` 兜底**，需要后续在订阅者中显式处理。
