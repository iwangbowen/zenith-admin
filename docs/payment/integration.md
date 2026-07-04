# 业务接入

业务模块（会员、订单、充值等）通过**统一支付门面**接入支付能力，无需感知任何渠道差异。接入一个新业务点约等于「调用 1 个下单函数 + 订阅 1 个成功事件」。

## 1. 统一支付门面（需求 ②④）

```ts
// services/payment/payment.service.ts —— 业务模块唯一入口
createPayment(input: {
  bizType: string; bizId: string; amount: number; subject: string; body?: string;
  payMethod: PayMethod; channelConfigId?: number;   // 不传则用 isDefault 渠道
  userId?: number; openId?: string; clientIp: string; expireMinutes?: number;
}): Promise<{ orderNo: string; payParams: CreatePaymentResult }>;

queryPayment(orderNo: string): Promise<PaymentOrder>;
refund(input: { orderNo: string; refundAmount: number; reason?: string; operatorId?: number }): Promise<{ refundNo: string; status: string }>;
closePayment(orderNo: string): Promise<void>;
```

- 业务模块直接 `import { createPayment } from '../services/payment.service'`，**无需 HTTP 往返**；
- 同时提供后台 HTTP 路由 `/api/payment/*`（发起、查询、手动退款），供后台运营使用；
- 下单 / 退款接口挂 [`idempotencyGuard`](../backend/idempotency)（15s 窗口，自动指纹或客户端 `X-Idempotency-Key`）防重复提交；
- **业务级下单幂等**：同 `bizType + bizId` 存在未过期活跃单（`pending` / `paying`）时**直接复用**（重新生成支付参数返回同一 `orderNo`，渠道侧同 `outTradeNo` 幂等）；金额或支付方式变化时先查单防边界支付、再关旧单新建；并发下单由部分唯一索引 `payment_orders_active_biz_uq` 兜底（冲突方复用对方刚创建的订单）。同一业务单已支付成功再下单会抛 400；
- **App 维度下单**：入参可选 `appKey`（「应用管理」页维护），支付中心路由到该应用绑定的对应渠道配置并在订单落 `appId` 归属；`appKey` 与 `channelConfigId` 同时提供时 `appKey` 优先。

### 字段约定

| 字段 | 说明 |
| --- | --- |
| `bizType` | 业务类型标识，支付中心不做枚举限制；内置会员钱包充值使用 `member_recharge`，事件订阅者据此路由 |
| `bizId` | 业务方主键（字符串），用于回填业务状态 |
| `amount` | 金额，**整数分**（如 `9900` = 99.00 元） |
| `payMethod` | 支付方式，门面据 `PAYMENT_METHOD_CHANNEL` 自动选渠道 |
| `openId` | 微信 JSAPI 必填 |
| `expireMinutes` | 订单过期分钟数，默认 30，超时由 cron 关单 |

### HTTP 路由

| 路由 | 说明 | 幂等 |
| --- | --- | --- |
| `POST /api/payment/orders` | 后台发起支付下单，返回二维码 URL / 跳转链接 / JSAPI 参数 / APP 调起串 | `idempotencyGuard` 15s，支持 `X-Idempotency-Key` |
| `GET /api/payment/orders/{id}` | 支付订单详情 | - |
| `POST /api/payment/orders/{id}/query` | 主动查单并同步本地订单状态 | - |
| `POST /api/payment/orders/{id}/close` | 关闭待支付订单 | - |
| `POST /api/payment/refunds` | 发起退款 | `idempotencyGuard` 15s，支持 `X-Idempotency-Key` |
| `POST /api/payment/refunds/{id}/query` | 主动查询退款状态并同步本地退款单 | - |
| `POST /api/member/wallet/recharge` | 会员钱包充值下单，固定接入 `bizType='member_recharge'` | `idempotencyGuard` 10s，支持 `X-Idempotency-Key` |

## 2. 监听支付结果（事件总线）

支付 / 退款结果通过 **`paymentEventBus`** 进程内事件总线广播，业务模块订阅对应事件完成履约（发货、开通会员、入账等），与支付中心解耦。

### 事件类型定义

| 事件 | 说明 |
| --- | --- |
| `payment.succeeded` | 支付成功（回调验签成功或主动查单确认），通过 Outbox 投递 |
| `payment.closed` | 主动查单确认渠道侧关闭时直接广播 |
| `payment.failed` | 支付失败事件类型 |
| `refund.succeeded` | 退款成功，通过 Outbox 投递 |
| `refund.failed` | 退款失败事件类型 |

### 事件载荷

```ts
interface PaymentEvent {
  eventId: string;          // 幂等键
  type: PaymentEventType;
  occurredAt: string;
  orderNo: string;
  outTradeNo: string;
  bizType: string;
  bizId: string;
  channel: PaymentChannel;
  amount: number;           // 分
  refundNo?: string;        // 退款事件
  refundAmount?: number;
  userId?: number | null;
  tenantId?: number | null;
}
```

### 订阅示例

```ts
import { paymentEventBus } from '../lib/payment-event-bus';
import { createPayment } from '../services/payment.service';
import { creditWalletOnRecharge, WALLET_RECHARGE_BIZ_TYPE } from '../services/member-wallet.service';

// 1) 下单（拿到二维码 / 跳转链接给前端）
const { orderNo, payParams } = await createPayment({
  bizType: WALLET_RECHARGE_BIZ_TYPE,
  bizId: String(memberId),
  amount: 9900,                 // 99.00 元
  subject: '会员钱包充值',
  payMethod: 'wechat_native',
  clientIp: c.req.header('x-forwarded-for') ?? '',
});

// 2) 监听支付成功，履约
paymentEventBus.on('payment.succeeded', async (e) => {
  if (e.bizType === WALLET_RECHARGE_BIZ_TYPE) {
    await creditWalletOnRecharge({ bizId: e.bizId, orderNo: e.orderNo, amount: e.amount });
  }
});
```

> 实际案例参考会员钱包充值：下单时 `bizType='member_recharge'`，订阅 `payment.succeeded` 入账（`services/payment/payment-subscribers.ts`）。

## 3. 幂等要求（重要）

业务订阅者**必须自身幂等**：同一笔支付成功事件可能被**低延迟投递**与 **cron 兜底补投**重复投递（at-least-once）。处理时应：

- 用 `eventId` 或 `orderNo` 去重；
- 或让履约操作天然幂等（如「若已开通会员则跳过」）。

事件投递的可靠性机制详见 [异步通知与对账](./callback)。

## 4. 金额规范

- **全链路整数分**（`integer`），杜绝浮点误差；
- 退款金额 ≤ 原单可退余额（门面在事务内 `SELECT ... FOR UPDATE` 锁单校验，防并发超退）；
- 前端展示 `¥${(cents / 100).toFixed(2)}`，提交时 `Math.round(yuan * 100)`。
