# 渠道适配与配置

支付中心通过**渠道适配层**屏蔽各支付渠道的差异。每个渠道实现统一的 `PaymentChannelAdapter` 接口，注册到 `adapterRegistry` 后即可被门面调用。新增渠道对业务层与门面**零侵入**。

| 渠道 | 适配器 | 支付方式 |
| --- | --- | --- |
| 微信支付 | `wechatPayAdapter` | `wechat_native`（Native 扫码）/ `wechat_jsapi` / `wechat_h5` |
| 支付宝 | `alipayAdapter` | `alipay_page`（电脑网站）/ `alipay_wap`（手机网站）/ `alipay_app` |
| 云闪付 | `unionpayAdapter` | `unionpay_qr`（银联二维码申码；全渠道 5.1.0 `signMethod=01` RSA-SHA256 签名；`sandbox=true` 模拟） |

## 1. 适配器接口（需求 ①⑤）

```ts
// lib/payment/types.ts
export interface PaymentChannelAdapter {
  readonly channel: PaymentChannel;
  /** 下单：返回前端可直接使用的支付参数（二维码 URL / JSAPI 参数 / 跳转链接 / APP 调起串） */
  createPayment(ctx: AdapterContext, order: PaymentOrderRow): Promise<CreatePaymentResult>;
  /** 主动查询支付状态（回调兜底） */
  queryPayment(ctx: AdapterContext, order: PaymentOrderRow): Promise<PaymentQueryResult>;
  /** 关闭订单 */
  closePayment(ctx: AdapterContext, order: PaymentOrderRow): Promise<void>;
  /** 申请退款 */
  refund(ctx: AdapterContext, order: PaymentOrderRow, refund: PaymentRefundRow): Promise<RefundResult>;
  /** 查询退款状态 */
  queryRefund(ctx: AdapterContext, refund: PaymentRefundRow, order: PaymentOrderRow): Promise<RefundQueryResult>;
  /** 验签 + 解析异步回调，返回标准化结果 */
  verifyNotify(ctx: AdapterContext, rawBody: string, headers: Headers): Promise<NotifyResult>;
  /** 连通性测试（可选）：探测一个不存在的订单号，验证商户凭据是否有效 */
  testConnectivity?(ctx: AdapterContext): Promise<void>;
}
```

`AdapterContext` 持有**已解密**的渠道配置（私钥、API V3 Key 等）与解析好的 `notifyUrl`。适配器内部所有外呼走 [`httpGet` / `httpPost`](../backend/http-client)，签名 / 验签封装在适配器内，门面与业务层完全不可见。

```ts
interface AdapterContext {
  config: PaymentChannelConfigRow;   // 渠道配置行
  secrets: DecryptedSecrets;         // 解密后的密钥
  notifyUrl: string;                 // 完整回调地址
}
```

## 2. 注册表

```ts
// lib/payment/index.ts
const adapterRegistry = new Map<PaymentChannel, PaymentChannelAdapter>();
registerAdapter(wechatPayAdapter);
registerAdapter(alipayAdapter);

export function getAdapter(channel: PaymentChannel): PaymentChannelAdapter { /* ... */ }
```

门面通过 `getAdapter(channel)` 取适配器，再调用对应方法。渠道差异、签名算法、回调格式全部封装在适配器内部。

## 3. 新增渠道步骤

> 全程**不改动**门面、业务模块、前端订阅者。

1. **加枚举**：`paymentChannelEnum` 增加新渠道值（pgEnum / TS union / Zod enum 三端同步），生成并执行迁移。
2. **加配置字段**：`payment_channel_configs` 表补充该渠道所需字段（密钥字段以 `xxxEncrypted` 命名、加密存储）。
3. **实现适配器**：新建 `lib/payment/xxx.adapter.ts`，实现 `PaymentChannelAdapter` 接口，外呼统一走 `http-client`。
4. **注册**：启动时 `registerAdapter(xxxAdapter)`。
5. 如有新增支付方式，同步 `PAYMENT_METHOD_CHANNEL` 映射。

## 4. 渠道配置表字段

`payment_channel_configs` 关键字段（密钥字段加密存储，**响应永不返回明文**）：

| 字段 | 说明 |
| --- | --- |
| `name` / `channel` | 配置名称 / 渠道 |
| `status` | `enabled` / `disabled` |
| `isDefault` | 是否为该渠道默认（同租户同渠道**互斥**） |
| `sandbox` | 沙箱模式开关 |
| `notifyUrl` | 回调基址（留空则用 `PAYMENT_NOTIFY_BASE_URL` / `PUBLIC_BASE_URL` 环境变量） |
| `wechatAppId` / `wechatMchId` / `wechatSerialNo` | 微信 AppID / 商户号 / 证书序列号 |
| `wechatApiV3KeyEncrypted` / `wechatPrivateKeyEncrypted` | 微信 APIv3 Key / 商户私钥（加密） |
| `wechatPlatformCert` | 微信支付平台证书（验签回退用；优先按 `Wechatpay-Serial` 自动下载平台证书） |
| `alipayAppId` / `alipaySignType` / `alipayGateway` | 支付宝 AppID / 签名算法（`RSA2` / `RSA`）/ 网关地址 |
| `alipayPrivateKeyEncrypted` | 支付宝应用私钥（加密） |
| `alipayPublicKey` | 支付宝公钥（验签用） |
| `unionpayMerId` / `unionpayCertId` / `unionpayGateway` | 云闪付商户号 / 证书序列号 / 网关地址 |
| `unionpayPrivateKeyEncrypted` | 云闪付商户私钥（加密） |
| `unionpayPublicKey` | 银联验签公钥 |

### 密钥脱敏

列表 / 详情 DTO **绝不返回密文或明文**，仅以 `hasXxx` 布尔位标识密钥是否已配置：

```ts
hasWechatApiV3Key: Boolean(row.wechatApiV3KeyEncrypted)
hasWechatPrivateKey: Boolean(row.wechatPrivateKeyEncrypted)
hasAlipayPrivateKey: Boolean(row.alipayPrivateKeyEncrypted)
```

更新时密钥字段**留空表示不修改**（仅当传入非空值才覆盖加密存储）。详见 [安全设计](./security)。

## 5. 连通性测试

`POST /api/payment/channels/{id}/test` 调用适配器的 `testConnectivity()`，向渠道发起一个轻量探测请求（查询一个不存在的订单号）：

- **"订单不存在"属预期结果** → 凭据有效，返回 `{ success: true, latencyMs }`；
- **签名错误 / 鉴权失败** → 凭据有问题，返回 `{ success: false, message }`。

后台「支付渠道」页的「测试」按钮即调用此接口，便于上线前快速校验商户配置。

## 6. 设为默认

`POST /api/payment/channels/{id}/default` 将指定配置设为该渠道默认：

- 同租户同渠道内**互斥**（先把同渠道其他配置 `isDefault` 置 false，再设当前为 true）；
- 自动将该配置 `status` 置为 `enabled`；
- 事务保证原子性，带操作审计。

业务下单时若不指定 `channelConfigId`，门面按「渠道 + `isDefault=true` + `enabled`」解析默认配置。
