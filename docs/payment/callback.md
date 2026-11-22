# 异步通知与对账

本页覆盖支付结果可靠送达链路：渠道回调 → 订单状态机 → 事件 Outbox → 业务订阅者 / Open Platform Webhook 投递，以及查单补偿、定时任务与对账中心。

## 渠道异步通知

### 公开回调端点

```text
POST /api/public/payment/notify/{channel}    # channel: wechat | alipay | unionpay
```

端点为公开路由，渠道服务器不携带管理端 token。安全边界依赖渠道验签、金额校验与状态条件更新。渠道配置的 `notifyUrl` 为空时，按 `PAYMENT_NOTIFY_BASE_URL` 或 `PUBLIC_BASE_URL` 拼接该路径。

### 处理流程

```text
渠道回调
  └─▶ 遍历同渠道启用配置逐个验签
        ├─ 全部失败：写 payment_notify_logs(signatureValid=false)，返回 401
        └─ 任一通过：解析订单/退款信息，校验金额，条件更新状态
              ├─ 成功：写日志，记录 Outbox 事件，返回成功 ACK
              └─ 抛错：写日志，返回渠道失败 ACK，等待渠道重发
```

要点：

- 微信：平台证书 RSA 验签 + AES-256-GCM 回调解密，平台证书按 `Wechatpay-Serial` 自动下载并缓存 12h；退款通知通常只带商户号，支付通知仍强校验 appid 与币种。
- 支付宝：RSA2/RSA 验签。
- 云闪付：银联全渠道 5.1.0 `signMethod=01`（SHA256+RSA）验签；退款受理码 `03` 表示处理中，必须查单收敛。
- 回调金额必须与本地订单金额一致。
- `applyNotify` 使用条件更新推进订单/退款状态，重复通知无副作用。

## 回调日志

每次渠道回调都会写入 `payment_notify_logs`，后台「回调日志」页可查：

| 字段 | 说明 |
| --- | --- |
| `channel` / `scene` | 渠道、场景（payment/refund） |
| `orderNo` | 解析出的关联订单号 |
| `rawBody` / `headers` | 原始报文与请求头摘要 |
| `signatureValid` | 验签结果 |
| `result` / `message` | 处理结果与说明 |
| `ip` | 来源 IP |

## 事件 Outbox

订单/退款进入终态时，状态更新与支付事实写入共享 `event_outbox` 在同一事务内完成，并按发布时已封存的消费者目录为每个匹配消费者登记 `event_consumer_deliveries` 回执；提交后唤醒 worker，worker 轮询兜底，无需支付专属补投 cron。

| 事件 | 说明 |
| --- | --- |
| `payment.succeeded` | 订单支付成功 |
| `payment.closed` | 订单关闭 |
| `payment.failed` | 渠道下单失败 |
| `refund.succeeded` | 退款到账 |
| `refund.failed` | 退款失败或审批驳回 |

投递语义：

- 同一订单的事件以 `payment:{orderNo}` 为 ordering key，按提交顺序消费；
- `payment.local-settlement` 是本地履约的单一一致性单元（资金台账、手续费、收银台会话、业务回写等在同一事务内完成）；
- `payment.ws`、`payment.analytics`、`payment.open-webhook`、`payment.sharing.prepare` 依赖结算消费者完成后再执行，各自独立回执；
- 消费者失败按退避重试，耗尽后进入 dead；「支付事件」页可调用 `POST /api/payment/ops/events/{id}/redispatch` 重试单个消费者回执。

业务订阅者与 Open Platform Webhook 接收方都必须按 `eventId`、`orderNo`、`refundNo` 或业务键幂等。

管理入口分为两个受控视图：`/payment/webhooks` 仅允许支付与退款事件，使用支付中心权限；`/open-platform/webhooks` 管理完整开放事件目录。两者复用同一订阅和投递表，不维护第二套 Webhook 状态机。

## 异常收口

渠道已发生资金事实但本地无法按正常状态机推进时，系统只记录异常，不改写订单终态、不重复履约。异常按去重键幂等写入 `payment_exceptions`；当前自动收口 `late_payment`，其余类型供业务或运维在核对时记录：

| 类型 | 用途 | 处理边界 |
| --- | --- | --- |
| `late_payment` | 订单已 `closed` / `failed` 后渠道确认支付成功，或本地无法继续推进支付 | 保留原始回调报文；运营确认入账或原路退款 |
| `amount_mismatch` | 回调/查单金额与本地订单不一致 | 不自动改单，先核对渠道与订单事实 |
| `refund_unknown` | 退款结果未知且查单未能立即收敛 | 仅允许继续查单，禁止盲目重发 |
| `provider_error` | 渠道明确异常但需要人工跟进 | 保留上下文，处置仍走订单/退款流程 |

- 记录接口：`GET /api/payment/ops/exceptions`，支持关键字、状态、类型与时间范围筛选；
- 处理接口：`POST /api/payment/ops/exceptions/{id}/handle`，`action=resolve` 标记已处理，`action=ignore` 标记忽略，需要 `payment:ops:manage`；
- 处理动作只更新异常状态、处理人、处理时间与备注，不直接入账或退款；
- 健康指标 `paymentExceptionsOpen` 统计待处理异常数量。

## 退款恢复

退款单在调用渠道前先持久化 `channelSubmittedAt`，并累计 `submitAttempts`；进程在提交前后崩溃时可以区分“从未提交”和“结果未知”。

- `channelSubmittedAt IS NULL` 且已审批/免审批的 `processing` 退款，由 `retryUnsubmittedRefunds` 在创建 2 分钟后使用原 `outRefundNo` 重提，渠道幂等键保证不会重复退款；
- `unknown` 退款记录 `unknownSince`，只能通过 `syncRefundStatus` 查单收敛，不允许原单重发；
- 每次退款查单更新 `lastQueryAt`，避免重复扫描；
- 退款、关单、查单使用 `recovery` 模式，支付方式停用、渠道配置停用或支付引擎关闭不阻断存量单收敛；
- `retryUnsubmittedRefunds` 由 `paymentReconciliation` 定时任务调用。

## 查单补偿

| 路径 | 说明 |
| --- | --- |
| `paymentReconciliation` cron | 每 10 分钟扫描 `paying` 且创建超过 2 分钟的订单，调用渠道查单同步终态；同时恢复未提交渠道的退款 |
| `POST /api/payment/orders/{id}/query` | 订单详情手动查单 |
| `POST /api/payment/refunds/{id}/query` | 退款详情手动查单 |
| `retryUnsubmittedRefunds` | 恢复已落库但从未提交渠道的退款，使用原退款单号幂等重提 |
| `syncPaymentTransfers` cron | 每 5 分钟同步处理中转账单 |
| `retryFailedSharing` cron | 重试渠道未受理且未达上限的分账单，并同步处理中分账单 |

查单确认支付成功会走与回调相同的状态更新与 Outbox 事件链路。

## 支付域定时任务

种子内置支付相关任务（见 `packages/shared/src/seed/platform.ts`）：

| handler | 频率 | 职责 |
| --- | --- | --- |
| `closeExpiredPaymentOrders` | 每 5 分钟 | 查单确认后关闭过期未支付订单 |
| `paymentReconciliation` | 每 10 分钟 | 支付中订单查单补偿，并恢复未提交渠道的退款 |
| `retryFailedSharing` | 每 10 分钟 | 分账失败重试与处理中分账同步 |
| `generateDailySettlements` | 每日 01:10 | T+1 生成昨日渠道 × 租户结算批次 |
| `syncPaymentTransfers` | 每 5 分钟 | 同步处理中转账单 |
| `autoPaymentRecon` | 每日调度 | 按渠道出账窗口与持久账期覆盖补齐缺失日期、下载交易/资金账单并提交可恢复核对任务 |
| `executeDueDeductions` | 每分钟 | 执行到期签约代扣 |
| `syncPaymentDisputes` | 每 5 分钟 | 拉取/生成交易投诉工单 |

## 对账中心

入口：`/payment/recon`，接口挂载在 `/api/payment/recon`。

### 创建对账批次

| 方式 | 接口 | 说明 |
| --- | --- | --- |
| 手动上传 | `POST /api/payment/recon/batches` | 上传 CSV，与本地成功/退款订单逐笔比对 |
| 自动拉取 | `POST /api/payment/recon/periods` | 调用适配器 `downloadBill(ctx, billDate, kind)`；微信/支付宝支持交易与资金账单，银联支持交易文件 |
| 账单原件 | `GET /api/payment/recon/files/{id}` | 归档原件必须通过私有存储访问并写下载审计 |

支付宝和云闪付已接入生产账单下载；沙箱与人工导入仍标记为非生产资金证据。云闪付全渠道文件接口只提供交易/差错清算文件，不代表账户余额资金账单。
批次来源由服务端固定为 `manual_upload`、`sandbox_generated` 或 `provider_download`，客户端不能指定或覆盖。

### 比对结果与差异处理

逐笔结果枚举：`matched`、`local_only`、`channel_only`、`amount_diff`、`status_diff`、`identity_diff`、`summary_diff`、`balance_diff`。

差异处理状态：

- `adjusted`：仅渠道适配器下载的账单可选，根据差异类型推导调账方向与金额并原子写入 `recon.adjust` 双分录凭证；
- `suspended`：终态挂账归档，不自动入账；
- `ignored`：确认无需处理。

人工上传和沙箱模拟账单属于不可信资金证据，只能进入 `suspended` 或 `ignored`，不能通过差异处理接口改变 `merchant_available`。

处理接口为 `PATCH /api/payment/recon/items/{id}/handle`，记录处理人、处理时间与备注。
