# 渠道适配与配置

渠道层位于 `packages/server/src/lib/payment/`，通过适配器模式封装渠道差异：

```text
packages/server/src/lib/payment/
├── types.ts               # PaymentChannelAdapter 接口、AdapterContext、方法出入参
├── registry.ts            # registerAdapter / getAdapter
├── index.ts               # initPaymentAdapters() 注册微信、支付宝、云闪付
├── wechat.adapter.ts      # 微信支付 v3
├── wechat-certs.ts        # 微信平台证书下载与 12h 缓存
├── alipay.adapter.ts      # 支付宝开放平台
├── unionpay.adapter.ts    # 云闪付/银联全渠道 5.1.0
└── signing.ts             # 共享签名工具
```

`initPaymentAdapters()` 由启动装配调用。服务层通过 `getAdapter(channel)` 获取适配器，不直接感知签名、报文或状态映射。

## 适配器接口

`PaymentChannelAdapter` 基础方法覆盖一次性收款闭环，扩展方法按渠道能力实现：

```ts
export interface PaymentChannelAdapter {
  channel: PaymentChannel;

  createPayment(ctx, order): Promise<CreatePaymentChannelResult>;
  queryPayment(ctx, order): Promise<PaymentQueryResult>;
  closePayment(ctx, order): Promise<void>;
  refund(ctx, order, refund): Promise<RefundResult>;
  queryRefund(ctx, order, refund): Promise<RefundQueryResult>;
  verifyNotify(ctx, req): Promise<NotifyVerifyResult>;

  testConnectivity?(ctx): Promise<void>;
  profitShare?(ctx, order, receiver, outSharingNo): Promise<ProfitShareResult>;
  queryProfitShare?(ctx, order, outSharingNo): Promise<ProfitShareQueryResult>;
  transfer?(ctx, input): Promise<TransferResult>;
  queryTransfer?(ctx, input): Promise<TransferQueryResult>;
  signContract?(ctx, input): Promise<ContractSignResult>;
  terminateContract?(ctx, input): Promise<void>;
  deductContract?(ctx, input): Promise<ContractDeductResult>;
  preauthFreeze?(ctx, input): Promise<PreauthFreezeResult>;
  preauthCapture?(ctx, input): Promise<PreauthCaptureResult>;
  preauthRelease?(ctx, input): Promise<void>;
  downloadBill?(ctx, billDate, kind?: 'trade' | 'fund'): Promise<ProviderBillResult>;
}
```

`AdapterContext` 携带渠道配置与临时解密后的 `secrets`。解密只发生在适配器调用瞬间，密钥不写日志、不进 API 响应。

## 三渠道能力矩阵

| 能力 | 微信支付 v3 | 支付宝 | 云闪付（银联） |
| --- | :-: | :-: | :-: |
| 收银台方式 | native / jsapi / h5 | page / wap / app | qr |
| 查单 / 退款 / 退款查询 | ✅ | ✅ | ✅ |
| 关单 | ✅ | ✅ | 本地关单 |
| 回调验签 | 平台证书 RSA + AES-256-GCM 解密 | RSA2/RSA | SHA256+RSA（`signMethod=01`） |
| 连通性测试 | ✅ | ✅ | ✅ |
| 分账 | 真实 API；接收方未添加时自动添加后重试一次 | 模拟实现 | — |
| 转账/代付 | 商家转账到零钱 | `alipay.fund.trans.uni.transfer` | — |
| 签约代扣 | `wechat_papay` | `alipay_cycle` | — |
| 预授权 | `wechat_preauth` | `alipay_preauth` | — |
| 自动下载对账单 | `trade` + `fund`（交易/资金账单） | `trade` + `fund`（交易/资金账单） | `trade`（全渠道 ZM/ZME 文件；不提供独立余额资金账单） |

沙箱配置不外呼真实渠道，账单任务不会把本地模拟事实伪装成渠道原件；需要演示时使用 `sandbox_generated` 独立来源。支付宝账单下载地址仅接受官方 HTTPS 主机；银联文件下载使用 `filedownload.95516.com` 的交易类型 76。

## 渠道配置管理

后台页面：**支付中心 → 支付渠道**（`/payment/channels`）。同一渠道可存在多份配置；「设为默认」控制缺省渠道配置。

### 配置字段

| 渠道 | 字段 | 说明 |
| --- | --- | --- |
| 通用 | `name` / `channel` / `status` / `isDefault` / `sandbox` / `notifyUrl` / `remark` | `notifyUrl` 为空时按 `PAYMENT_NOTIFY_BASE_URL` 或 `PUBLIC_BASE_URL` 拼接公开回调路径 |
| 微信 | `wechatAppId` / `wechatMchId` / `wechatApiV3Key`🔒 / `wechatPrivateKey`🔒 / `wechatSerialNo` / `wechatPlatformCert` | 平台证书可由回调验签时按 `Wechatpay-Serial` 自动下载并缓存 |
| 支付宝 | `alipayAppId` / `alipayPrivateKey`🔒 / `alipayPublicKey` / `alipaySignType` / `alipayGateway` | `alipaySignType` 支持 RSA2/RSA |
| 云闪付 | `unionpayMerId` / `unionpayCertId` / `unionpayPrivateKey`🔒 / `unionpayPublicKey` / `unionpayGateway` | 银联全渠道 5.1.0，`certId` 为签名证书序列号 |

🔒 字段使用 `encryptField` 加密落库。列表与详情接口只返回 `hasWechatApiV3Key`、`hasWechatPrivateKey`、`hasAlipayPrivateKey`、`hasUnionpayPrivateKey` 等布尔位；编辑时密钥字段留空表示保留原值。

### 配置解析优先级

统一下单通过 `resolveChannelConfig` 解析配置：

1. OAuth2 client：按 `payment_apps` 绑定的渠道配置路由；
2. `channelConfigId`：显式指定渠道配置；
3. 默认配置：该渠道 `isDefault=true` 且 `status=enabled` 的配置。

应用路由由服务端从已认证的 OAuth2 client 推导，调用方不能覆盖租户或商户配置。渠道回调由 `handleNotify` 遍历该渠道所有启用配置逐个验签，任一配置通过即处理。

## 公开回调地址

```text
POST /api/public/payment/notify/{channel}    # channel: wechat | alipay | unionpay
```

该端点无管理端鉴权，依赖渠道验签、金额校验与状态条件更新保证安全性。详见[异步通知与对账](./callback.md#渠道异步通知)。

## 新增渠道步骤

1. 在 `packages/shared/src/payment/constants.ts` 登记 `PAYMENT_CHANNELS`、`PAYMENT_METHODS`、`PAYMENT_METHOD_CHANNEL` 与标签；同步 `packages/server/src/db/schema/payment.ts` 的 pg enum 并生成迁移。
2. 在 `payment_channel_configs` 与共享 Zod schema 中添加渠道配置字段；敏感字段走加密存储与 `hasXxx` 响应。
3. 新建适配器，实现基础 6 个方法；扩展方法按需实现。
4. 在 `packages/server/src/lib/payment/index.ts` 注册适配器。
5. 更新公开回调路由的 `channel` 枚举与后台渠道配置表单。
6. 同步支付方式种子、MSW mock 与展示映射。
