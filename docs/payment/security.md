# 安全设计

支付链路的安全防线依次为：渠道验签 → 幂等防重 → 资金一致性 → 规则中心风控与人工审批 → 投诉分流 → 权限、数据权限与审计。

## 安全矩阵

| 风险 | 防线 |
| --- | --- |
| 伪造回调 | 微信平台证书、支付宝 RSA2/RSA、银联 SHA256+RSA 验签；验签失败只记日志并返回 401 |
| 重复回调 / 重复事件 | 订单/退款状态条件更新 + Outbox 至少一次投递 + 订阅者幂等 |
| 重复提交 | 下单、退款、转账等写接口使用 `idempotencyGuard`；业务活跃单复用；唯一索引兜底 |
| 并发超退 | 退款事务内锁单校验可退余额 |
| 转账双付 | `(channel, out_transfer_no)` 唯一；只有渠道未受理且尝试次数未达上限的失败单可重试 |
| 重复记账 | 台账唯一索引限制同订单收款/手续费、同退款退款/手续费冲销重复入账 |
| 密钥泄露 | 渠道密钥 AES-256-GCM 加密落库，API 只返回 `hasXxx` 布尔位 |
| 大额误退 | 退款审批阈值链路 |
| 欺诈交易 | `payment_risk` 决策表 + 原生名单/限额规则双层裁决 |
| 投诉处理不一致 | `dispute_triage` 分流建议、SLA 收紧、时间线留痕；资金动作仍需人工确认 |
| 越权操作 | 19 个支付页面权限码、服务端 `guard()`、数据权限与租户隔离 |
| 争议无凭据 | 回调日志、风控命中、规则执行记录、投诉时间线、Open Platform Webhook 投递日志 |

## 密钥与证书存储

`payment_channel_configs` 的敏感字段使用 `encryptField` 加密存储：

| 渠道 | 加密字段 | 明文字段 |
| --- | --- | --- |
| 微信 | APIv3 Key、商户私钥 | AppID、商户号、证书序列号、平台证书 |
| 支付宝 | 应用私钥 | AppID、支付宝公钥、签名类型、网关 |
| 云闪付 | 商户私钥 | 商户号、证书序列号、银联公钥、网关 |

- 字段加密密钥来自 `FIELD_ENCRYPTION_KEY`（64 位 hex，按数据库共享）；`NODE_ENV=development` 下缺省使用内置开发密钥，其他环境必填且与 `JWT_SECRET` 相互独立。
- 查询接口返回 `hasWechatApiV3Key`、`hasWechatPrivateKey`、`hasAlipayPrivateKey`、`hasUnionpayPrivateKey`，不返回明文或掩码内容。
- 编辑渠道时密钥字段留空表示保留原值。
- 适配器调用期间通过 `AdapterContext.secrets` 临时解密。
- 微信平台证书可通过 `/v3/certificates` 自动下载、解密并按序列号缓存 12h。

## 回调验签与防伪

公开回调端点：

```text
POST /api/public/payment/notify/{channel}
```

安全行为：

1. 遍历同渠道所有启用配置逐个验签；
2. 全部失败时写 `payment_notify_logs(signatureValid=false)` 并返回 401；
3. 验签通过后校验订单号、金额、状态；
4. 使用条件更新推进状态，重复回调不产生重复事件或重复履约；
5. 业务处理失败时返回渠道失败 ACK，等待渠道重试。

## 幂等与防重

| 层次 | 机制 |
| --- | --- |
| HTTP | `idempotencyGuard` 支持 `X-Idempotency-Key`，否则按用户、方法、路径与请求体指纹生成 15s 幂等键 |
| 业务订单 | 同一 `bizType + bizId` 的 pending/paying 订单复用；`payment_orders_active_biz_uq` 兜底 |
| 渠道单号 | `out_trade_no`、`out_refund_no`、`out_transfer_no`、确定性分账单号作为渠道侧幂等键 |
| 事件 | `payment_events` at-least-once；订阅者用条件更新或业务唯一键幂等 |
| 记账 | Journal 来源作用域唯一键、借贷平衡约束与 reservation 版本 CAS 兜底重复过账与并发超支 |

## 资金一致性

- 金额全链路使用整数分。
- 退款在事务内锁定订单并计算可退余额，审批中的退款不占用订单 `refunding` 状态。
- 支付成功后内置订阅者写收款双分录凭证、计算手续费、回写 `feeAmount` / `netAmount`。
- `refund.succeeded` 订阅者写退款双分录凭证，并按退款比例冲销手续费；全额退款末笔补差以消除舍入残差。
- 订单 `feeAmount` 保持下单/成功时手续费快照；资金事实以台账流水为准。
- Journal 是资金唯一事实来源；账户、凭证和 reservation 按应用/商户配置/币种隔离，所有资金流出通过版本化 reservation 防并发超支。
- 结算确认写 `type=settlement` 台账，将待结算划转到可用余额。
- 投诉退款复用统一退款链路与审批阈值，不由分流规则直接执行资金动作。

## 退款审批

审批阈值单位为分，来自运行时设置模块 `payment`（`refundApprovalThreshold` 退款、`transferApprovalThreshold` 转账；租户作用域，按单据所属租户解析，未覆盖继承平台值，管理入口 `/system/settings?module=payment`）。`0` 表示不启用审批。

- `refundAmount ≥ 阈值` 的退款进入 `approvalStatus=pending`；
- `payment:refund:approve` 权限可审批通过或驳回；
- 审批通过后执行渠道退款；驳回置 `failed` 并记录 `refund.failed`；
- 申请人、审批人、审批时间与意见留痕。

## 支付风控

下单前调用 `evaluateRisk()`，执行两层裁决：

### L2：规则中心决策表

- 规则引用：`decide({ kind: 'table', key: 'payment_risk' }, facts, { caller: 'payment.risk' })`。
- 决策表发布后优先裁决，输出 `action=block/review/pass` 与可选 `reason`。
- `pass` 是显式放行，直接跳过 L1；`block` 和 `review` 写 `payment_risk_hits`，其中 `dimension=decision`、`ruleName='决策表 payment_risk'`。
- 决策表未发布、未命中或输出无效时回退 L1。
- 可用事实包括 `order.*`、`today.*`、`hit.*`、`subject.*`；执行记录可在 `/rules/evaluation` 追溯。

### L1：原生维度规则

`payment_risk_rules` 支持以下维度：

| 维度 | 说明 |
| --- | --- |
| `blocklist` | 黑/灰名单库 key 命中 openid、用户 ID 或客户端 IP |
| `single_limit` | 单笔金额上限 |
| `daily_limit` | 当日累计已支付金额上限 |
| `daily_count` | 当日已支付笔数上限 |

规则作用域为 `global`、`channel`、`bizType`。`allowListKeys` 只能引用白名单库，命中后跳过该规则；`blockListKeys` 可引用黑/灰名单库。名单批量判定由规则中心名单库提供。

动作：

- `block`：落渠道单前拦截；
- `review`：先落挂起订单与 `payment_risk_reviews`，渠道侧不下单；审核放行后重新发起支付复用该订单，审核拒绝则本地关单。

## 交易投诉分流

新投诉工单创建后调用：

```ts
decide({ kind: 'table', key: 'dispute_triage' }, facts, { caller: 'payment.dispute' })
```

决策表按投诉类型、涉诉金额、投诉人 90 天投诉数输出：

| 输出 | 说明 |
| --- | --- |
| `route` | `urgent` / `manual` / `auto_refund_suggest` |
| `priority` | 分流优先级，数值越大越紧急 |
| `slaHours` | 建议处理时效，写入 `deadline` 时只收紧不放松 |

`auto_refund_suggest` 只作为 UI 徽标与预填退款建议；退款必须由具备 `payment:dispute:handle` 权限的人员确认，最终仍走统一退款与审批链路。每次命中会写入 system 时间线，规则执行记录可在 `/rules/evaluation` 追溯。

## 权限与数据权限

| 页面 | 权限码 |
| --- | --- |
| 支付渠道 | `payment:channel:list / create / update / delete` |
| 支付订单 | `payment:order:list / create / close / refund` |
| 退款记录 | `payment:refund:list / approve` |
| 回调日志 | `payment:log:list` |
| 对账中心 | `payment:recon:list / create / delete / handle` |
| 资金凭证与预占 | `payment:ledger:list`、`payment:ledger:post`、`payment:ledger:reverse`、`payment:ledger:reserve` |
| Open Platform Webhook | `open-platform:webhook:list / manage` |
| 支付 Webhook 视图 | `payment:webhook:list / manage` |
| 支付事件 | `payment:ops:manage` |
| 费率管理 | `payment:fee:list / create / update / delete` |
| 结算管理 | `payment:settlement:list / generate / settle` |
| 分账管理 | `payment:sharing:list / manage / dispatch` |
| 支付链接 | `payment:link:list / create / update / delete` |
| 风控中心 | `payment:risk:list / create / update / delete / review` |
| 支付方式 | `payment:method:list / update` |
| 财务报表 | `payment:report:view` |
| 转账管理 | `payment:transfer:list / create` |
| 应用管理 | `payment:app:list / manage` |
| 签约代扣 | `payment:contract:list / manage / plan` |
| 交易投诉 | `payment:dispute:list / handle` |
| 预授权 | `payment:preauth:list / manage` |

- 支付订单列表按部门与创建人的数据权限范围过滤。
- 支付表带 `tenant_id`，查询按租户隔离。
- 渠道配置、支付/退款、关单、审批、调账、转账、差异处理、风控审核、投诉处理等敏感操作写操作日志。

## 相关环境变量

| 变量 | 说明 |
| --- | --- |
| `FIELD_ENCRYPTION_KEY` | 字段级 AES-256-GCM 加密密钥（64 位 hex，按数据库共享）；开发模式缺省用内置开发密钥，其他环境必填 |
| `PAYMENT_NOTIFY_BASE_URL` / `PUBLIC_BASE_URL` | 渠道回调地址基址 |
| `PAYMENT_MOCK_DISPUTES` | `true` 时定时任务为沙箱成功订单生成模拟投诉；手动模拟接口不受该变量限制 |
