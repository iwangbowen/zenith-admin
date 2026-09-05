# 业务接入

业务模块通过 `packages/server/src/services/payment/payment.service.ts` 的统一门面接入支付，不直接调用渠道 SDK。完整接入走读见[业务接入实战示例](./integration-example.md)。

## 服务端统一门面

```ts
import { createPayment, queryPayment, closePayment, refund } from '../payment/payment.service';

const { orderNo, payParams } = await createPayment({
  bizType: 'member_recharge',
  bizId: String(rechargeId),
  subject: '钱包充值',
  amount: 9900,              // 分
  payMethod: 'wechat_native',
  openId,                    // wechat_jsapi 必填
  userId,
  applicationId,             // 内部应用路由；开放 API 不由调用方传入
  channelConfigId,           // 可选：显式指定渠道配置
  expireMinutes: 30,
  clientIp,
});

const order = await queryPayment(orderNo);
await closePayment(orderNo);
const { refundNo, status } = await refund({ orderNo, refundAmount: 500, reason: '用户申请' });
```

`payParams` 按支付方式返回：`codeUrl`、`jsapiParams`、`payUrl`、`formHtml`、`appOrderStr`，并包含 `orderNo`、`payMethod`、`channel`、`expiredAt`。

## 下单内部流程

| 环节 | 行为 |
| --- | --- |
| 支付方式校验 | 统一下单仅接受 `PAYMENT_CASHIER_METHODS`；`payment_method_configs` 禁用的方式拒绝下单 |
| 渠道路由 | `payMethod → channel`；服务端按 OAuth2 client 绑定应用路由，再解析商户配置 |
| 风控前置 | `payment_risk` 决策表优先裁决；未裁决时执行原生规则；`block` 拦截，`review` 挂起订单进入人工审核 |
| 业务防重 | 同一 `bizType + bizId` 的 pending/paying 订单可复用；参数变化时先查单再关闭旧单；`payment_orders_active_biz_uq` 兜底并发 |
| 优惠券立减 | 会员侧可传 `memberCouponId + couponMemberId`：下单冻结券，实付金额至少 1 分，订单记录原价与优惠 |
| 渠道下单 | 生成 `PAY` 单号，渠道下单成功后 `pending → paying`；渠道失败置 `failed` 并记录 `payment.failed` 事件 |

### 风控返回语义

支付风控由两层组成：

1. L2：规则中心决策表 `payment_risk` 通过 `decide({ kind: 'table', key: 'payment_risk' }, facts, { caller: 'payment.risk' })` 裁决，输出 `action=block/review/pass`。`pass` 为显式放行并跳过原生规则；未发布、未命中或输出无效时回退 L1。
2. L1：原生 `payment_risk_rules` 按作用域检查白名单、黑名单、单笔限额、当日累计金额与当日笔数；黑白名单字段为规则中心名单库 key，多主体（openid/userId/IP）批量判定。

`block` 在落渠道单前拒绝；`review` 生成挂起订单与 `payment_risk_reviews`，用户需等待后台审核。审核放行后重新下单可复用挂起订单继续支付，审核拒绝则本地关单。规则中心执行记录可在 `/rules/evaluation` 追溯。

## 退款与审批

- 可退余额在事务内锁单校验：实付金额 − 已成功退款 − 进行中退款。
- 审批阈值来源：运行时设置 `payment.refundApprovalThreshold`（租户作用域，按订单所属租户解析，未覆盖继承平台值；见[运行时设置](../backend/settings.md)）；`0` 表示不启用审批。
- `refundAmount ≥ 阈值` 时退款单进入 `approvalStatus=pending`，不占用订单 `refunding` 状态；通过后执行渠道退款，驳回置 `failed` 并记录 `refund.failed`。
- 免审批退款立即执行渠道退款。全额退完订单置 `refunded`，部分退款完成后订单回到 `success`。
- 退款原因可选；投诉退款未传原因时使用「交易投诉退款（投诉单号）」作为默认原因。

## 字段约定

| 字段 | 约定 |
| --- | --- |
| `amount` / `refundAmount` | 正整数，单位分 |
| `bizType` | 业务类型，如 `member_recharge`、`member_renewal`、`biz_pay_demo` |
| `bizId` | 业务单据 ID，字符串 |
| `orderNo` | 支付中心订单号，`PAY` 前缀 |
| `payMethod` | 收银台 7 种方式；`wechat_jsapi` 必须携带 `openId` |
| 时间 | API 实体使用格式化时间字符串 |

## HTTP 接口

管理端/业务后台可使用支付 HTTP API（均需登录与权限）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/payment/orders` | 统一下单，带 `idempotencyGuard` |
| GET | `/api/payment/orders` | 订单列表 |
| GET | `/api/payment/orders/{id}` | 订单详情 |
| GET | `/api/payment/orders/by-no/{orderNo}` | 按订单号查询 |
| GET | `/api/payment/orders/{id}/refunds` | 订单关联退款 |
| POST | `/api/payment/orders/{id}/query` | 主动查单 |
| POST | `/api/payment/orders/{id}/close` | 关闭订单 |
| POST | `/api/payment/refunds` | 发起退款，带 `idempotencyGuard` |
| GET | `/api/payment/refunds` / `/api/payment/refunds/{id}` | 退款列表 / 详情 |
| POST | `/api/payment/refunds/{id}/query` | 主动同步退款 |
| POST | `/api/payment/refunds/{id}/approve` / `/api/payment/refunds/{id}/reject` | 审批通过 / 驳回 |
| GET | `/api/payment/stats` / `/api/payment/trend?days=N` | 统计概览 / 收款趋势 |

会员前台充值接口 `POST /api/member/wallet/recharge` 是前台业务调用统一门面的内置范例。

## 订阅支付结果事件

支付结果通过事件总线 + Outbox 送达业务方。业务方不应轮询订单作为履约主链路，而应订阅事件完成履约。

`packages/server/src/lib/payment-event-bus.ts` 定义 5 类事件：

| 事件 | 触发时机 |
| --- | --- |
| `payment.succeeded` | 订单支付成功（回调 / 主动查单 / 运营模拟支付） |
| `payment.closed` | 订单关闭（主动关单 / 超时自动关单） |
| `payment.failed` | 渠道下单失败 |
| `refund.succeeded` | 退款到账 |
| `refund.failed` | 退款失败或退款审批被驳回 |

```ts
paymentEventBus.on('payment.succeeded', async (e) => {
  if (e.bizType !== 'xxx_order') return;
  await fulfillXxxOrder(e.bizId, e.orderNo); // 必须幂等
});
```

订阅者在 `packages/server/src/bootstrap/subscribers.ts` 注册。Outbox 为至少一次送达，handler 抛错会触发重试；失败死信可在「支付事件」页重派。

## WebSocket 与 Open Platform Webhook

- 订单归属用户会收到站内 WebSocket 推送：`payment:success`、`payment:closed`、`payment:failed`、`payment:refunded`、`payment:refund-failed`。
- 跨系统接入在 Open Platform 创建应用订阅接收上述事件，签名、重放窗口与重试由统一应用 Webhook 投递层负责。

## 进阶交易能力

- **签约代扣**：`/api/payment/deduct-plans` 与 `/api/payment/contracts` 管理计划和协议；到期扣款生成 `payment_orders` 并复用支付事件。
- **预授权**：`/api/payment/preauths` 支持冻结、转支付、解冻；转支付生成支付订单。
- **支付链接**：`/api/payment/links` 创建后台链接，公开收银台使用 `/api/public/payment/link/{token}` 系列接口。
- **投诉退款**：`/api/payment/disputes/{id}/refund` 复用统一退款门面与审批阈值。
