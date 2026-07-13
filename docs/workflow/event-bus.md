# 事件总线与事件订阅

工作流事件总线负责把实例、节点和任务变化分发给站内通知、WebSocket、聊天卡片、自动化、业务桥接、节点监听器和 HTTP Webhook 订阅。事件通过 `event_dispatch` 作业可靠分发，并为每个匹配的 Webhook 订阅生成独立 `webhook_delivery` 作业。

## 事件类型

| 事件 | 触发时机 |
| --- | --- |
| `instance.created` | 实例创建并进入运行 |
| `instance.approved` | 实例通过 |
| `instance.rejected` | 实例驳回终止 |
| `instance.withdrawn` | 发起人撤回 |
| `node.entered` | 进入节点 |
| `node.left` | 离开节点 |
| `task.created` | 任务创建 |
| `task.assigned` | 任务指派给处理人 |
| `task.approved` | 任务通过 |
| `task.rejected` | 任务驳回 |
| `task.skipped` | 任务跳过 |
| `task.transferred` | 任务转办 |
| `task.addSigned` | 加签任务创建 |
| `task.reduceSigned` | 加签任务被减签跳过 |
| `task.urged` | 任务被催办 |

所有事件都包含 `eventId`、`type`、`occurredAt`、`instanceId`、`definitionId`、`tenantId` 和可选 `actor`。实例事件带完整实例，节点事件带节点信息，任务事件带任务与意见。

## 内置订阅者

| 订阅者 | 说明 |
| --- | --- |
| WebSocket | 给在线用户推送待办和状态变化 |
| 通知 | 生成站内消息 |
| 聊天 | 发送聊天/机器人卡片 |
| 节点监听器 | 执行节点上配置的 Webhook |
| 自动化 | 执行流程级自动化规则 |
| 业务桥接 | 将 `bizType` 对应流程结果回写业务模块 |
| Webhook 订阅 | 按后台配置向外部系统投递事件 |

进程内订阅者按 best-effort 执行，单个订阅者失败不会阻断其它订阅者。外部 Webhook 投递由作业账本记录、重试和死信。

## 事件订阅

页面入口为 `工作流引擎 → 事件订阅`。

| 配置 | 说明 |
| --- | --- |
| 名称 / 描述 | 订阅基础信息 |
| 流程定义 | 为空表示订阅所有流程；指定后只订阅该定义 |
| 事件类型 | 可多选事件总线支持的事件 |
| URL | 投递目标；使用连接器时可为相对路径 |
| 连接器 | 可选；提供基础地址、鉴权、限流、熔断和调用审计 |
| 签名方式 | `hmacSha256` 或 `none` |
| Secret | HMAC 密钥，AES-256-GCM 加密落库，详情页脱敏显示，可按需查看明文 |
| 请求头 | 附加 Header |
| 启用状态 | 控制是否参与匹配 |

## 投递请求

Webhook 投递使用 `POST`，请求体为完整工作流事件。

```http
X-Zenith-Event: task.approved
X-Zenith-Event-Id: {eventId}
X-Zenith-Delivery-Job: {jobId}
X-Zenith-Attempt: {attempt}
X-Zenith-Signature: t={timestamp},v1={hex_hmac}
```

签名内容为 `${timestamp}.${rawBody}`，算法为 HMAC-SHA256。接收方应校验时间戳偏差并使用相同 Secret 重算 `v1`。

## 投递记录与重放

事件订阅页面提供投递记录抽屉。记录来自 `workflow_job_executions` 中的 `webhook_delivery` 作业尝试，包含请求 URL、响应码、响应体、错误、耗时和下次重试时间；订阅列表同时展示投递次数、最近 HTTP 状态、耗时与错误信息。

投递状态含义：

| 状态 | 说明 |
| --- | --- |
| `pending` | 等待投递或正在投递 |
| `success` | 投递成功 |
| `retrying` | 投递失败但仍有重试预算 |
| `failed` | 重试耗尽或进入死信 |

| 操作 | 说明 |
| --- | --- |
| 重试单条 | 将对应作业重新置为 `pending` |
| 批量重试 | 按选中记录重试 |
| 按筛选重放 | 按订阅、事件类型、状态和时间范围补发，包含已成功投递 |

重放有数量上限，适合外部系统恢复后补发一段时间内的事件。

## API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/workflows/event-subscriptions` | 订阅列表 |
| `GET` | `/api/workflows/event-subscriptions/{id}` | 订阅详情 |
| `GET` | `/api/workflows/event-subscriptions/{id}/secret` | 查看 Secret 明文（敏感操作） |
| `POST` | `/api/workflows/event-subscriptions` | 创建订阅 |
| `PUT` | `/api/workflows/event-subscriptions/{id}` | 更新订阅 |
| `DELETE` | `/api/workflows/event-subscriptions/{id}` | 删除订阅 |
| `PATCH` | `/api/workflows/event-subscriptions/{id}/toggle` | 启用 / 禁用 |
| `GET` | `/api/workflows/event-subscriptions/deliveries/list` | 投递记录 |
| `POST` | `/api/workflows/event-subscriptions/deliveries/{id}/retry` | 重试投递 |
| `POST` | `/api/workflows/event-subscriptions/deliveries/batch-retry` | 批量重试投递 |
| `POST` | `/api/workflows/event-subscriptions/deliveries/replay` | 按筛选重放 |
