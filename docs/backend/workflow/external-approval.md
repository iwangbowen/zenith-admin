# 外部审批

外部审批用于把审批任务转交到外部系统（如钉钉、企业微信、第三方审批中心）。当审批节点开启 `externalApproval.enabled` 时，节点产生的 `task.created` 事件会被 `external-approver` 订阅者接管，对外发起派发请求，外部系统通过回调推进任务状态。

## 节点配置（`WorkflowNodeConfig.externalApproval`）

| 字段 | 说明 |
| --- | --- |
| `enabled` | 是否开启 |
| `url` | 外部系统接收派发的 URL |
| `secret` | 签名密钥 |
| `signMode` | `'hmacSha256' \| 'none'`，默认 `hmacSha256` |
| `timeoutMs` | 外呼超时，默认 `10_000` |
| `fallbackStrategy` | `'manual' \| 'autoApprove' \| 'autoReject'`：派发失败时的兜底动作，详见下文 |

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

派发失败（网络错误、超时、非 2xx 响应）会记录到任务的 `externalDispatchStatus` 字段，并按节点 `externalApproval.fallbackStrategy` 兜底：

| 取值 | 行为 |
| --- | --- |
| `manual`（默认） | 不做处理，任务保持待人工审批 |
| `autoApprove` | 自动通过该任务，写入「[系统] 外部审批服务调用失败，按节点 fallbackStrategy 自动处理」备注 |
| `autoReject` | 自动驳回该任务，备注同上 |

`externalDispatchStatus` 取值：

- `pending`：派发中
- `dispatched`：外部系统已接收，等待回调
- `failed`：派发失败且为 `manual` 策略
- `fallback`：派发失败且已按非 `manual` 策略自动处理
