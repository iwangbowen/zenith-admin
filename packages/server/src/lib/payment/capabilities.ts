import type { PaymentProviderManifest } from './types';

const CNY = ['CNY'] as const;
const SANDBOX_AND_LIVE = ['sandbox', 'live'] as const;
const SANDBOX_ONLY = ['sandbox'] as const;
const LIVE_ONLY = ['live'] as const;

export const WECHAT_PROVIDER_MANIFEST = {
  channel: 'wechat',
  displayName: '微信支付',
  sandboxRequiredConfigFields: ['sandboxNotifySecret'],
  capabilities: [
    { operation: 'payment.create', environments: SANDBOX_AND_LIVE, paymentMethods: ['wechat_native', 'wechat_jsapi', 'wechat_h5'], currencies: CNY, execution: 'redirect', requiredConfigFields: ['wechatAppId', 'wechatMchId', 'wechatSerialNo', 'wechatPrivateKey'] },
    { operation: 'payment.query', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'synchronous', requiredConfigFields: ['wechatMchId', 'wechatSerialNo', 'wechatPrivateKey'] },
    { operation: 'payment.close', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'synchronous', requiredConfigFields: ['wechatMchId', 'wechatSerialNo', 'wechatPrivateKey'] },
    { operation: 'refund.create', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'asynchronous', requiredConfigFields: ['wechatMchId', 'wechatSerialNo', 'wechatPrivateKey'] },
    { operation: 'refund.query', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'synchronous', requiredConfigFields: ['wechatMchId', 'wechatSerialNo', 'wechatPrivateKey'] },
    { operation: 'notification.verify', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'asynchronous', requiredConfigFields: ['wechatMchId', 'wechatAppId', 'wechatApiV3Key', 'wechatPlatformCert'] },
    { operation: 'profit-sharing.create', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'asynchronous', requiredConfigFields: ['wechatAppId', 'wechatMchId', 'wechatSerialNo', 'wechatPrivateKey'] },
    { operation: 'profit-sharing.query', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'synchronous', requiredConfigFields: ['wechatMchId', 'wechatSerialNo', 'wechatPrivateKey'] },
    { operation: 'profit-sharing.reverse', environments: SANDBOX_ONLY, currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'transfer.create', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'asynchronous', requiredConfigFields: ['wechatAppId', 'wechatMchId', 'wechatSerialNo', 'wechatPrivateKey'], limits: { maxAmount: 199_999, receiverNameRequiredAtOrAbove: 200_000 } },
    { operation: 'transfer.query', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'synchronous', requiredConfigFields: ['wechatMchId', 'wechatSerialNo', 'wechatPrivateKey'] },
    { operation: 'contract.sign', environments: SANDBOX_ONLY, paymentMethods: ['wechat_papay'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'contract.query', environments: SANDBOX_ONLY, paymentMethods: ['wechat_papay'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'contract.terminate', environments: SANDBOX_ONLY, paymentMethods: ['wechat_papay'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'contract.deduct', environments: SANDBOX_ONLY, paymentMethods: ['wechat_papay'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'preauth.freeze', environments: SANDBOX_ONLY, paymentMethods: ['wechat_preauth'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'preauth.query', environments: SANDBOX_ONLY, paymentMethods: ['wechat_preauth'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'preauth.capture', environments: SANDBOX_ONLY, paymentMethods: ['wechat_preauth'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'preauth.release', environments: SANDBOX_ONLY, paymentMethods: ['wechat_preauth'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'bill.download', environments: LIVE_ONLY, billKinds: ['trade', 'fund'], currencies: CNY, execution: 'synchronous', requiredConfigFields: ['wechatMchId', 'wechatSerialNo', 'wechatPrivateKey', 'wechatApiV3Key'] },
  ],
} as const satisfies PaymentProviderManifest;

export const ALIPAY_PROVIDER_MANIFEST = {
  channel: 'alipay',
  displayName: '支付宝',
  sandboxRequiredConfigFields: ['sandboxNotifySecret'],
  capabilities: [
    { operation: 'bill.download', environments: LIVE_ONLY, billKinds: ['trade', 'fund'], currencies: CNY, execution: 'synchronous', requiredConfigFields: ['alipayAppId', 'alipaySellerId', 'alipayPrivateKey', 'alipayPublicKey'] },
    { operation: 'payment.create', environments: SANDBOX_AND_LIVE, paymentMethods: ['alipay_page', 'alipay_wap', 'alipay_app'], currencies: CNY, execution: 'redirect', requiredConfigFields: ['alipayAppId', 'alipaySellerId', 'alipayPrivateKey', 'alipayPublicKey'] },
    { operation: 'payment.query', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'synchronous', requiredConfigFields: ['alipayAppId', 'alipaySellerId', 'alipayPrivateKey', 'alipayPublicKey'] },
    { operation: 'payment.close', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'synchronous', requiredConfigFields: ['alipayAppId', 'alipaySellerId', 'alipayPrivateKey', 'alipayPublicKey'] },
    { operation: 'refund.create', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'synchronous', requiredConfigFields: ['alipayAppId', 'alipaySellerId', 'alipayPrivateKey', 'alipayPublicKey'] },
    { operation: 'refund.query', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'synchronous', requiredConfigFields: ['alipayAppId', 'alipaySellerId', 'alipayPrivateKey', 'alipayPublicKey'] },
    { operation: 'notification.verify', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'asynchronous', requiredConfigFields: ['alipayAppId', 'alipaySellerId', 'alipayPublicKey'] },
    { operation: 'profit-sharing.create', environments: SANDBOX_ONLY, currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'profit-sharing.reverse', environments: SANDBOX_ONLY, currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'transfer.create', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'asynchronous', requiredConfigFields: ['alipayAppId', 'alipaySellerId', 'alipayPrivateKey', 'alipayPublicKey'] },
    { operation: 'transfer.query', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'synchronous', requiredConfigFields: ['alipayAppId', 'alipaySellerId', 'alipayPrivateKey', 'alipayPublicKey'] },
    { operation: 'contract.sign', environments: SANDBOX_ONLY, paymentMethods: ['alipay_cycle'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'contract.query', environments: SANDBOX_ONLY, paymentMethods: ['alipay_cycle'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'contract.terminate', environments: SANDBOX_ONLY, paymentMethods: ['alipay_cycle'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'contract.deduct', environments: SANDBOX_ONLY, paymentMethods: ['alipay_cycle'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'preauth.freeze', environments: SANDBOX_ONLY, paymentMethods: ['alipay_preauth'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'preauth.query', environments: SANDBOX_ONLY, paymentMethods: ['alipay_preauth'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'preauth.capture', environments: SANDBOX_ONLY, paymentMethods: ['alipay_preauth'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
    { operation: 'preauth.release', environments: SANDBOX_ONLY, paymentMethods: ['alipay_preauth'], currencies: CNY, execution: 'synchronous', requiredConfigFields: [] },
  ],
} as const satisfies PaymentProviderManifest;

export const UNIONPAY_PROVIDER_MANIFEST = {
  channel: 'unionpay',
  displayName: '云闪付',
  sandboxRequiredConfigFields: ['sandboxNotifySecret'],
  capabilities: [
    { operation: 'bill.download', environments: LIVE_ONLY, billKinds: ['trade'], currencies: CNY, execution: 'synchronous', requiredConfigFields: ['unionpayMerId', 'unionpayCertId', 'unionpayPrivateKey', 'unionpayPublicKey'] },
    { operation: 'payment.create', environments: SANDBOX_AND_LIVE, paymentMethods: ['unionpay_qr'], currencies: CNY, execution: 'redirect', requiredConfigFields: ['unionpayMerId', 'unionpayCertId', 'unionpayPrivateKey', 'unionpayPublicKey'] },
    { operation: 'payment.query', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'synchronous', requiredConfigFields: ['unionpayMerId', 'unionpayCertId', 'unionpayPrivateKey', 'unionpayPublicKey'] },
    { operation: 'refund.create', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'asynchronous', requiredConfigFields: ['unionpayMerId', 'unionpayCertId', 'unionpayPrivateKey', 'unionpayPublicKey'] },
    { operation: 'refund.query', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'synchronous', requiredConfigFields: ['unionpayMerId', 'unionpayCertId', 'unionpayPrivateKey', 'unionpayPublicKey'] },
    { operation: 'notification.verify', environments: SANDBOX_AND_LIVE, currencies: CNY, execution: 'asynchronous', requiredConfigFields: ['unionpayMerId', 'unionpayPublicKey'] },
  ],
} as const satisfies PaymentProviderManifest;
