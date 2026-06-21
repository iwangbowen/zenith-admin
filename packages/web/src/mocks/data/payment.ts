import type { PaymentChannelConfig, PaymentOrder, PaymentRefund, PaymentNotifyLog } from '@zenith/shared';

const SEED = '2024-01-01 00:00:00';

export const mockPaymentChannels: PaymentChannelConfig[] = [
  {
    id: 1, name: '微信主商户', channel: 'wechat', status: 'enabled', isDefault: true, sandbox: false, notifyUrl: 'https://demo.zenith.dev',
    wechatAppId: 'wx1234567890abcd', wechatMchId: '1600000000', wechatSerialNo: '5F2D...A1B2', wechatPlatformCert: null,
    hasWechatApiV3Key: true, hasWechatPrivateKey: true,
    alipayAppId: null, alipayPublicKey: null, alipaySignType: null, alipayGateway: null, hasAlipayPrivateKey: false,
    remark: '演示数据', createdAt: SEED, updatedAt: SEED,
  },
  {
    id: 2, name: '支付宝主商户', channel: 'alipay', status: 'enabled', isDefault: true, sandbox: true, notifyUrl: 'https://demo.zenith.dev',
    wechatAppId: null, wechatMchId: null, wechatSerialNo: null, wechatPlatformCert: null, hasWechatApiV3Key: false, hasWechatPrivateKey: false,
    alipayAppId: '2021000000000000', alipayPublicKey: 'MIIBIjANBgkqhkiG9w0...', alipaySignType: 'RSA2', alipayGateway: null, hasAlipayPrivateKey: true,
    remark: '沙箱演示', createdAt: SEED, updatedAt: SEED,
  },
];
let nextChannelId = 3;
export const getNextPaymentChannelId = () => nextChannelId++;

export const mockPaymentOrders: PaymentOrder[] = [
  { id: 1, orderNo: 'PAY1700000000001', outTradeNo: 'PAY1700000000001', channelTradeNo: '4200001234567890', bizType: 'membership', bizId: '1001', subject: '会员充值-年度套餐', body: null, amount: 9900, currency: 'CNY', channel: 'wechat', channelConfigId: 1, payMethod: 'wechat_native', status: 'success', userId: 1, openId: null, clientIp: '127.0.0.1', departmentId: null, paidAmount: 9900, paidAt: SEED, expiredAt: SEED, errorMessage: null, createdAt: SEED, updatedAt: SEED },
  { id: 2, orderNo: 'PAY1700000000002', outTradeNo: 'PAY1700000000002', channelTradeNo: null, bizType: 'order', bizId: '2002', subject: '商品订单-手机壳', body: null, amount: 4990, currency: 'CNY', channel: 'alipay', channelConfigId: 2, payMethod: 'alipay_page', status: 'paying', userId: 1, openId: null, clientIp: '127.0.0.1', departmentId: null, paidAmount: null, paidAt: null, expiredAt: SEED, errorMessage: null, createdAt: SEED, updatedAt: SEED },
  { id: 3, orderNo: 'PAY1700000000003', outTradeNo: 'PAY1700000000003', channelTradeNo: '4200009876543210', bizType: 'membership', bizId: '1002', subject: '会员充值-月度套餐', body: null, amount: 1900, currency: 'CNY', channel: 'wechat', channelConfigId: 1, payMethod: 'wechat_jsapi', status: 'refunded', userId: 1, openId: 'oABC123XYZ', clientIp: '127.0.0.1', departmentId: null, paidAmount: 1900, paidAt: SEED, expiredAt: SEED, errorMessage: null, createdAt: SEED, updatedAt: SEED },
  { id: 4, orderNo: 'PAY1700000000004', outTradeNo: 'PAY1700000000004', channelTradeNo: '2024010122001234567', bizType: 'order', bizId: '2008', subject: '商品订单-蓝牙耳机', body: null, amount: 8800, currency: 'CNY', channel: 'alipay', channelConfigId: 2, payMethod: 'alipay_wap', status: 'refunding', userId: 1, openId: null, clientIp: '127.0.0.1', departmentId: null, paidAmount: 8800, paidAt: SEED, expiredAt: SEED, errorMessage: null, createdAt: SEED, updatedAt: SEED },
];
let nextOrderId = 5;
export const getNextPaymentOrderId = () => nextOrderId++;

export const mockPaymentRefunds: PaymentRefund[] = [
  { id: 1, refundNo: 'REF1700000000003', outRefundNo: 'REF1700000000003', orderNo: 'PAY1700000000003', orderId: 3, channelRefundNo: '50000012345', channel: 'wechat', refundAmount: 1900, totalAmount: 1900, reason: '用户申请退款', status: 'success', approvalStatus: 'none', operatorId: 1, refundedAt: SEED, errorMessage: null, createdAt: SEED, updatedAt: SEED },
  { id: 2, refundNo: 'REF1700000000004', outRefundNo: 'REF1700000000004', orderNo: 'PAY1700000000004', orderId: 4, channelRefundNo: null, channel: 'alipay', refundAmount: 3000, totalAmount: 8800, reason: '部分退款-差价补偿', status: 'processing', approvalStatus: 'none', operatorId: 1, refundedAt: null, errorMessage: null, createdAt: SEED, updatedAt: SEED },
  { id: 3, refundNo: 'REF1700000000005', outRefundNo: 'REF1700000000005', orderNo: 'PAY1700000000001', orderId: 1, channelRefundNo: null, channel: 'wechat', refundAmount: 5000, totalAmount: 9900, reason: '大额退款（待审批演示）', status: 'pending', approvalStatus: 'pending', appliedById: 1, operatorId: 1, refundedAt: null, errorMessage: null, createdAt: SEED, updatedAt: SEED },
];
let nextRefundId = 4;
export const getNextPaymentRefundId = () => nextRefundId++;

export const mockPaymentLogs: PaymentNotifyLog[] = [
  { id: 1, channel: 'wechat', scene: 'payment', orderNo: 'PAY1700000000001', signatureValid: true, result: 'success', message: null, ip: '127.0.0.1', rawBody: '{"id":"EV-DEMO-001","event_type":"TRANSACTION.SUCCESS","resource":{"ciphertext":"***","original_type":"transaction"}}', headers: '{"wechatpay-serial":"5F2D...A1B2","wechatpay-signature":"***","content-type":"application/json"}', createdAt: SEED },
  { id: 2, channel: 'wechat', scene: 'refund', orderNo: 'PAY1700000000003', signatureValid: true, result: 'refunded', message: null, ip: '127.0.0.1', rawBody: '{"id":"EV-DEMO-002","event_type":"REFUND.SUCCESS","resource":{"ciphertext":"***","original_type":"refund"}}', headers: '{"wechatpay-serial":"5F2D...A1B2","wechatpay-signature":"***","content-type":"application/json"}', createdAt: SEED },
];
