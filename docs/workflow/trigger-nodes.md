# 触发器与外部审批

触发器节点和外部审批都通过统一作业账本执行外部副作用。触发器属于流程节点；外部审批是审批人节点上的配置，用于把待办派发到第三方审批系统。

## 触发器节点

触发器进入节点后登记任务和 `trigger_dispatch` 作业。是否等待作业完成取决于触发器类型和 `onFailure` 配置：

| 模式 | 条件 | 任务与路径 |
| --- | --- | --- |
| 等待完成 | `callback`、`updateData`、`deleteData`，或 `onFailure=block` | 任务为 `waiting`，Token 停留；数据变更 / 阻塞 HTTP 成功后推进，回调触发器等待公开回调 |
| 异步继续 | 普通 `webhook`，且未配置 `onFailure=block` | 任务为 `approved`，Token 越过节点，外呼由作业独立完成 |

异步继续的触发事实即使在实例已完成后仍可执行，任务状态不能代表外呼已经成功。等待型触发器执行时还会校验实例是否在运行中。节点失败策略负责错误处置，门控判定仍由上述触发器配置决定。

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

触发器通过连接器调用时复用鉴权、超时、熔断、限流和调用记录；作业内 HTTP 不叠加连接器传输层重试，尝试次数和退避由作业账本控制。

### 回调触发器

`callback` 类型生成回调 ID，节点任务停在 `waiting`，实例保持 `running`。外呼模板可使用回调 ID 和完整回调 URL；URL 由 `PUBLIC_BASE_URL` 拼装，部署时须配置接收方可访问的地址。外部系统处理完成后调用：

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

页面入口为 `工作流引擎 → 运维与集成 → 触发器执行`。该页面读取 `workflow_job_executions` 中 `trigger_dispatch` 作业的执行记录，展示实例、任务、节点、触发器类型、尝试次数、请求、响应、错误和耗时。一次尝试失败与作业最终失败分别判断，作业恢复见[作业执行与恢复](./jobs.md)。

## 外部审批

外部审批配置在审批人节点上。启用后，系统创建 `waiting` 审批任务和 `external_dispatch` 作业；外部系统通过公开回调决定通过或驳回。

### 节点配置

| 配置 | 说明 |
| --- | --- |
| 启用外部审批 | 开启后任务由外部系统推进 |
| 连接器 | 可选；派发 URL 可使用连接器相对路径，接收本系统结果的公开回调路径独立提供 |
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

外部审批派发失败由作业账本保存与重试；已确认的最终失败先尝试节点失败策略 / 异常路径，未被接管时再执行表中派发兜底。问题出现在引擎诊断和实例运行时诊断中。`manual` 保持等待，不将派发失败自动改成人工同意或拒绝。

外部请求已经开始发送而结果不明时，作业进入“外部操作结果待确认”死信，停止自动重试及自动兜底推进。管理员应先核实外部处理结果，再决定重试或人工处理；取消作业不能撤销已经送达的请求。
