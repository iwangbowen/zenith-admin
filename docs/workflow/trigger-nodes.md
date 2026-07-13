# 触发器与外部审批

触发器节点和外部审批都通过统一作业账本执行外部副作用。触发器属于流程节点；外部审批是审批人节点上的配置，用于把待办派发到第三方审批系统。

## 触发器节点

触发器进入节点后创建等待任务，并入队 `trigger_dispatch` 作业。作业执行成功后根据触发器类型和失败策略决定是否自动推进。

| 类型 | 说明 |
| --- | --- |
| `webhook` | 向外部地址发起 HTTP 请求 |
| `callback` | 向外部地址发起 HTTP 请求，并等待公开回调后继续 |
| `updateData` | 按模板更新当前实例 `formData` |
| `deleteData` | 删除当前实例 `formData` 中指定字段 |

### HTTP 配置

| 配置 | 说明 |
| --- | --- |
| 连接器 | 可选；选择后 URL 作为相对连接器基础地址的路径 |
| 请求地址 / 路径 | 不使用连接器时为完整 URL；使用连接器时可为空或相对路径 |
| 请求方法 | `GET`、`POST`、`PUT` |
| 请求头 | JSON 键值对 |
| 请求体模板 | 支持 <code v-pre>{{form.field}}</code>、<code v-pre>{{callbackUrl}}</code>、<code v-pre>{{callbackId}}</code> 等占位 |
| 超时时间 | 单次请求超时，默认 10 秒 |
| 失败策略 | 继续、重试、阻塞并走异常处理；启用节点级统一失败策略后可扩展为补偿、兜底、通知、终止（见[补偿 / Saga](./compensation.md)） |
| 最大重试 | 作业最大尝试次数，耗尽后进入死信 |

触发器通过连接器调用时，连接器提供鉴权、超时、重试、熔断、限流和调用记录。

### 回调触发器

`callback` 类型会生成回调 ID，流程停在 `waiting`，外部系统处理完成后调用：

```http
POST /api/public/workflow/trigger-callback/{callbackId}
```

请求体：

```json
{
  "comment": "外部处理意见",
  "callerName": "external-system",
  "payload": {}
}
```

回调签名默认使用 `hmacSha256`。开启签名时，外部系统需要携带：

```http
X-Zenith-Signature: t={timestamp},v1={hex_hmac}
```

签名内容为 `${timestamp}.${rawBody}`，时间戳允许 5 分钟偏差。

### 数据触发器

`updateData` 和 `deleteData` 不调用外部 HTTP。它们在事务内读取当前实例表单数据：

- `updateData` 按 `fieldValues` 模板写回字段；
- `deleteData` 删除 `fieldKeys` 中列出的字段；
- 成功后自动推进节点。

## 触发器执行记录

页面入口为 `工作流引擎 → 触发器执行`。该页面读取 `workflow_job_executions` 中 `trigger_dispatch` 作业的执行记录，展示实例、任务、节点、触发器类型、尝试次数、请求、响应、错误和耗时。

## 外部审批

外部审批配置在审批人节点上。启用后，系统创建 `waiting` 审批任务和 `external_dispatch` 作业；外部系统通过公开回调决定通过或驳回。

### 节点配置

| 配置 | 说明 |
| --- | --- |
| 启用外部审批 | 开启后任务由外部系统推进 |
| 连接器 | 可选；选择后回调 URL 退化为连接器相对路径 |
| 派发 URL / 路径 | 外部系统接收审批任务的地址 |
| 签名方式 | `hmacSha256` 或 `none`，默认 HMAC |
| 密钥 | HMAC 签名密钥 |
| 超时时间 | 派发请求超时，默认 10 秒 |
| 失败兜底 | 人工处理、自动通过、自动拒绝 |

### 派发请求

系统向外部地址发送 `POST` 请求：

```http
X-Zenith-Event: external-approval.requested
X-Zenith-Callback-Id: {callbackId}
X-Zenith-Signature: t={timestamp},v1={hex_hmac}
```

请求体包含回调标识、回调路径、实例摘要和任务摘要。

```json
{
  "callbackId": "callback-id",
  "callbackPath": "/api/public/workflow/external-callback/callback-id",
  "instance": {
    "id": 1,
    "title": "流程标题",
    "initiatorId": 1,
    "formData": {}
  },
  "task": {
    "id": 10,
    "nodeKey": "approve_manager",
    "nodeName": "主管审批"
  }
}
```

### 审批回调

外部系统处理完成后调用：

```http
POST /api/public/workflow/external-callback/{callbackId}
```

请求体：

```json
{
  "action": "approve",
  "comment": "审批意见",
  "approverName": "外部审批人"
}
```

`action` 支持 `approve` 和 `reject`。开启 HMAC 时同样需要 `X-Zenith-Signature`。

### 派发失败

| 兜底策略 | 结果 |
| --- | --- |
| `manual` | 保持等待，管理员可在监控中诊断和处理 |
| `autoApprove` | 系统自动通过任务 |
| `autoReject` | 系统自动驳回任务 |

外部审批派发失败会进入作业账本，触发引擎诊断和实例运行时诊断中的问题项。
