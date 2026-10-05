# 事件总线与事件订阅

工作流事件总线负责把实例、节点和任务变化分发给站内通知、WebSocket、聊天卡片、自动化、业务桥接、节点监听器和 HTTP Webhook 订阅。事件通过 `event_dispatch` 作业可靠分发，并为每个匹配的 Webhook 订阅生成独立 `webhook_delivery` 作业。

## 事件类型

| 事件 | 触发时机 |
| --- | --- |
| `instance.created` | 实例创建并进入运行 |
| `instance.approved` | 实例通过 |
| `instance.rejected` | 实例驳回终止 |
| `instance.withdrawn` | 发起人撤回 |
| `instance.returned` | 实例退回发起人待重提 |
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

作业入库幂等不等于副作用只执行一次。发送过外部写请求但未能确认结果时，作业保守进入“外部操作结果待确认”死信，不自动再次发送；人工重试前应先与接收方核实结果。操作键跨原请求重试保持稳定，但系统不会假设所有接收方都实现了去重。

## 事件订阅

页面入口为 `工作流引擎 → 事件订阅`。

| 配置 | 说明 |
| --- | --- |
| 名称 / 描述 | 订阅基础信息 |
| 流程定义 | 为空表示订阅所有流程；指定后只订阅该定义 |
| 事件类型 | 可多选事件总线支持的事件 |
| URL | 直连需完整 HTTP/HTTPS 地址；使用连接器时可为相对路径，完整地址需与连接器同源；清除连接器前需将相对路径改为完整地址 |
| 连接器 | 可选 HTTP / Webhook 类型，保留完整事件 JSON，并提供基础地址、鉴权、限流、熔断和调用审计；邮件、短信和 IM 类型不能作为事件投递目标 |
| 签名方式 | `hmacSha256` 或 `none` |
| Secret | HMAC 未配置时自动生成随机密钥，编辑留空保留已有密钥；从 none 切回 HMAC 且无密钥时自动生成。密钥 AES-256-GCM 加密落库，公共响应仅显示掩码，可通过敏感操作查看明文 |
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

保存订阅时按当前租户可见连接器解析最终地址并执行 SSRF 校验，连接器引用不能绕过该校验。运行时仍执行同源约束与 SSRF 防护。HMAC 密钥缺失或无法解密时，测试投递和真实作业均拒绝发送，不降级为无签名请求；应编辑保存订阅重新生成密钥，再按作业状态重试。

## 投递记录与重放

事件订阅页面提供投递记录抽屉。每行来自 `workflow_job_executions` 中的一次 `webhook_delivery` 尝试，包含请求 URL、响应码、响应体、错误和耗时。“本次结果”保持该次执行的事实；“当前作业”独立展示父作业的最新调度状态及下次自动重试时间。后续成功、取消或跳过不会改写此前失败记录，两列可分别筛选。

投递状态含义：

| 状态 | 说明 |
| --- | --- |
| 本次结果 `running` / `success` / `failed` | 本次请求正在执行、成功或失败 |
| 本次结果 `skipped` | 本次未发送，例如执行时订阅已被停用或删除；不计为投递成功 |
| 本次结果 `cancelled` | 执行被取消 |
| 当前作业 `pending` / `running` | 等待首次投递或正在执行 |
| 当前作业 `retrying` | 已失败，系统正等待自动重试；同时展示计划时间 |
| 当前作业 `dead` | 已进入死信，需核查后人工处理 |
| 当前作业 `success` / `skipped` / `cancelled` | 已成功完成、未投递跳过或已取消 |

| 操作 | 说明 |
| --- | --- |
| 重试单条 | 订阅需启用，仅最新记录关联的失败、死信或取消作业可重试；创建新的执行轮次，保留历史尝试。自动重试中的作业无需手工重试 |
| 重新投递 | 订阅需启用，可对最新终态作业补发；已完成作业生成新的独立作业，原记录保持不变 |
| 批量重试 | 按选中记录的实际操作条件重试，每个作业只处理一次 |
| 按筛选重放 | 按订阅、事件类型、当前作业状态和作业创建时间筛选；仅启用订阅参与，成功补发仅包含真实投递成功，排队补投仅提交唤醒 |

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
| `POST` | `/api/workflows/event-subscriptions/{id}/test` | 测试投递 |
| `GET` | `/api/workflows/event-subscriptions/deliveries/list` | 投递记录 |
| `GET` | `/api/workflows/event-subscriptions/deliveries/{id}` | 投递记录详情 |
| `POST` | `/api/workflows/event-subscriptions/deliveries/{id}/retry` | 重试投递 |
| `POST` | `/api/workflows/event-subscriptions/deliveries/{id}/replay` | 重新投递最新终态作业 |
| `POST` | `/api/workflows/event-subscriptions/deliveries/batch-retry` | 批量重试投递 |
| `POST` | `/api/workflows/event-subscriptions/deliveries/replay` | 按筛选重放 |
