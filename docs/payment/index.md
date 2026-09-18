# 支付中心总览

支付中心是平台级统一支付网关：业务模块调用统一门面完成下单、查询、关单、退款、进阶交易与结果订阅，微信支付 / 支付宝 / 云闪付差异由适配器层封装。支付域同时提供双分录资金凭证、手续费、结算、分账、转账、对账、风控、交易投诉、签约代扣、预授权、支付链接、应用路由与 Open Platform Webhook。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [渠道适配与配置](./channels.md) | 适配器接口、三渠道能力矩阵、渠道配置、应用路由与新增渠道步骤 |
| [业务接入](./integration.md) | 统一门面、HTTP API、事件订阅、幂等、金额与进阶交易接入 |
| [业务接入实战示例](./integration-example.md) | 以 `biz_pay_demo` 为例走读下单、支付成功履约与演示接口 |
| [异步通知与对账](./callback.md) | 渠道回调、Outbox、查单补偿、定时任务、Open Platform Webhook、账单获取与对账入口 |
| [生产对账操作](./reconciliation.md) | 交易/资金/银行到账对账、证据、重试、差异案件与银行分配 |
| [安全设计](./security.md) | 验签、密钥、幂等、资金一致性、规则中心风控、投诉分流、权限与审计 |
| [后台管理页面](./admin.md) | `/payment/*` 下 19 个后台页面的功能清单与操作说明 |

## 能力总览

```text
业务模块（会员充值 / VIP 续费 / 订单支付 / 支付链接 / 签约代扣 / 预授权 / …）
        │
        ▼
统一门面 createPayment / queryPayment / closePayment / refund / deduct / capture
        │
        ├─ 业务幂等：bizType + bizId 活跃单复用，HTTP 写接口 15s 幂等窗口
        ├─ 支付方式启停：payment_method_configs 控制收银台可用方式
        ├─ 应用路由：OAuth2 client → payment_apps 绑定的渠道配置
        ├─ 支付风控：L2 规则中心 payment_risk 决策表 → L1 原生限额/名单规则
        └─ 优惠券立减：下单冻结，支付成功核销，关闭/失败释放
        │
        ▼
适配器注册表：wechat / alipay / unionpay
        │
        ▼
渠道下单 / 查单 / 回调验签 / 退款 / 扩展能力
        │
        ▼
订单状态机 + 事件 Outbox（payment_events）
        │
        ├─ 业务订阅者（进程内，至少一次送达）
        ├─ 资金台账 / 手续费 / 分账 / 签约扣款排期等内置订阅者
        └─ Open Platform Webhook（HMAC 签名 + 指数退避）
        │
        ▼
结算批次 / 账户快照 / 财务报表 / 对账中心 / 投诉处理
```

| 能力域 | 实现范围 |
| --- | --- |
| 基础交易 | 统一下单、查单、关单、退款；7 种收银台方式；退款审批阈值；超时关单 |
| 渠道适配 | 微信支付 v3、支付宝开放平台、云闪付/银联全渠道；统一适配器接口与沙箱模式 |
| 资金运营 | 资金台账、手续费费率、退款手续费按比例冲销、渠道账户快照、结算、分账、转账 |
| 对账 | 三渠道账单获取、资金与银行到账核验、可恢复任务、差异案件、审批调账与审计 |
| 风控 | 规则中心 `payment_risk` 决策表优先裁决；原生规则提供名单、单笔、单日金额、单日笔数校验 |
| 投诉 | `dispute_triage` 决策表分流，投诉回复/完结/退款，SLA 收紧与时间线留痕 |
| 进阶交易 | 签约代扣、预授权、支付链接公开收银台、应用维度渠道路由 |
| 可观测 | 回调日志、Outbox 事件、Open Platform Webhook 投递日志、支付链路健康指标 |

后台共 **19 个管理页面**，入口与操作见[后台管理页面](./admin.md)。

## 关键工程决策

| 决策 | 说明 |
| --- | --- |
| 金额一律整数「分」 | DB、API、事件载荷均使用分；前端展示层格式化为元 |
| `bizType` / `bizId` 松耦合 | 支付订单不外键关联业务表，业务方以业务类型与业务单 ID 建立关联 |
| 适配器模式 | 渠道签名、报文、状态映射封装在 `packages/server/src/lib/payment/` |
| 事件 Outbox | 支付/退款终态事件先落 `payment_events`，再低延迟派发，cron 补投，至少一次送达 |
| 条件更新状态机 | 回调、查单、模拟支付、退款查询均通过条件 UPDATE 推进状态，重复触发无副作用 |
| 密钥加密落库 | 渠道私钥/密钥用 `encryptField` 存储，API 只返回 `hasXxx` 布尔位 |
| 规则中心决策 | 支付风控与交易投诉通过 `decide()` 接入规则中心，执行记录可在规则中心追溯 |
| 沙箱模式 | 渠道配置可开启沙箱，不外呼真实渠道，返回模拟凭据并支持演示链路 |

## 数据模型

支付域模型定义在 `packages/server/src/db/schema/payment.ts`。

### 基础交易

| 表 | 职责 |
| --- | --- |
| `payment_channel_configs` | 渠道配置；微信/支付宝/云闪付密钥加密存储，支持沙箱与默认配置 |
| `payment_orders` | 支付订单；记录业务标识、金额、渠道、方式、应用、部门、手续费、净额与状态 |
| `payment_refunds` | 退款单；记录可退余额校验、审批状态、渠道退款号与退款结果 |
| `payment_notify_logs` | 渠道回调日志；记录原始报文、请求头、验签结果、来源 IP 与处理结果 |
| `payment_events` | 支付事件 Outbox；`pending` / `done` / `failed`，最多 5 次投递 |

关键索引：`payment_orders_channel_out_trade_no_uq`、`payment_orders_active_biz_uq`、`payment_journals_source_scope_uq`、`payment_fund_reservations_source_uq`。

### 资金运营

| 表 | 职责 |
| --- | --- |
| `payment_ledger_accounts` / `payment_journals` / `payment_journal_lines` | 按应用 × 商户配置 × 币种隔离的不可变双分录账户与凭证 |
| `payment_fund_reservations` | 转账等资金流出操作的并发安全预占、核销与释放 |
| `payment_fee_rules` | 手续费规则：渠道、支付方式、万分比、固定费、上下限、优先级 |
| `payment_settlement_batches` | 结算批次：按渠道与账期聚合，结算确认后写台账并划转账户快照 |
| `payment_transfers` | 转账/代付单；渠道幂等键 `(channel, out_transfer_no)` |
| `payment_sharing_receivers` / `payment_sharing_orders` | 分账接收方与分账单 |

### 对账 / 风控 / 投诉

| 表 | 职责 |
| --- | --- |
| `payment_statement_periods` / `payment_statements` / `payment_statement_files` / `payment_statement_entries` | 账期、账单版本、私有原件、标准明细和摘要/校验结果 |
| `payment_recon_runs` / `payment_recon_cases` / `payment_recon_case_events` | 可恢复核对运行、差异案件与追加处置历史 |
| `payment_bank_matches` | 银行到账与渠道结算多对多分配及审计 |
| `payment_risk_rules` | 原生风控规则；黑白名单字段引用规则中心名单库 key |
| `payment_risk_hits` | 风控命中留痕；决策表命中使用 `dimension=decision` |
| `payment_risk_reviews` | 人工审核队列；同一订单最多一条待审记录 |
| `payment_disputes` / `payment_dispute_replies` | 交易投诉工单与回复/系统时间线 |

### 进阶交易 / 生态

| 表 | 职责 |
| --- | --- |
| `payment_deduct_plans` / `payment_contracts` | 周期扣款计划与签约协议 |
| `payment_preauths` | 预授权单：冻结、转支付、解冻 |
| `payment_links` | 支付链接：公开 token 收银台，一码多付 |
| `payment_apps` | 应用维度路由：绑定 OAuth2 client 与三渠道配置 |
| `payment_method_configs` | 收银台支付方式启停、排序与展示配置 |
| `app_webhook_subscriptions` / `app_webhook_deliveries` | Open Platform 应用事件订阅与投递日志 |

## 订单状态机

```text
pending ──(渠道下单成功)──▶ paying ──(回调/查单成功)──▶ success
   │                          │                          │
   │(渠道下单失败)             │(超时/主动关单)            │(发起退款)
   ▼                          ▼                          ▼
 failed                    closed                    refunding ──▶ refunded（全额退完）
                                                         │
                                                         └──▶ success（部分退款完成）
```

- `closeExpiredPaymentOrders` 先查单再关单，避免边界支付被误关。
- `review` 风控命中会先生成挂起订单与审核单，渠道侧不下单；审核放行后用户重新发起支付时复用该订单继续渠道下单。

## 渠道与支付方式

渠道枚举：`wechat`、`alipay`、`unionpay`。

支付方式共 11 种，其中 7 种用于收银台统一下单，4 种由签约代扣 / 预授权模块内部使用：

| 分类 | 方式 | 说明 |
| --- | --- | --- |
| 收银台 | `wechat_native` | 微信扫码，返回 `codeUrl` |
| 收银台 | `wechat_jsapi` | 微信公众号/小程序，需 `openId`，返回 `jsapiParams` |
| 收银台 | `wechat_h5` | 微信 H5，返回 `payUrl` |
| 收银台 | `alipay_page` | 支付宝电脑网站，返回 `formHtml` |
| 收银台 | `alipay_wap` | 支付宝手机网站，返回 `formHtml` |
| 收银台 | `alipay_app` | 支付宝 APP，返回 `appOrderStr` |
| 收银台 | `unionpay_qr` | 云闪付二维码，返回 `codeUrl` |
| 签约代扣 | `wechat_papay` / `alipay_cycle` | 周期扣款单使用 |
| 预授权 | `wechat_preauth` / `alipay_preauth` | 冻结资金转支付单使用 |

枚举事实来源为 `packages/shared/src/payment/constants.ts`。

## 与会员体系联动

- 钱包充值：`POST /api/member/wallet/recharge` 调用统一门面，支持 `memberCouponId` 用券；`payment.succeeded` 订阅者按订单号幂等入账。
- VIP 续费：`bizType='member_renewal'` 的支付成功事件由订阅者延长会员有效期。
- 优惠券状态：下单冻结（unused → frozen），支付成功核销（used），订单关闭/失败释放（unused）。
