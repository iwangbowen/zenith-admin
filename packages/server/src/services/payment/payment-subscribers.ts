/**
 * 支付事件订阅者：监听支付/退款成功事件，通过 WebSocket 实时推送给付款用户。
 * 业务模块（履约/发货/开通会员）可在各自初始化处再追加 paymentEventBus.on(...)。
 */
import { paymentEventBus } from '../../lib/payment-event-bus';
import { sendToUser } from '../../lib/ws-manager';
import logger from '../../lib/logger';
import { creditWalletOnRecharge, WALLET_RECHARGE_BIZ_TYPE } from '../member/member-wallet.service';
import { extendVipOnRenewal } from '../member/member-renewal.service';
import { MEMBER_RENEWAL_BIZ_TYPE } from '@zenith/shared';

let registered = false;

export function registerPaymentSubscribers(): void {
  if (registered) return;
  registered = true;

  paymentEventBus.on('payment.succeeded', (e) => {
    logger.info('[payment] payment.succeeded', { orderNo: e.orderNo, bizType: e.bizType, bizId: e.bizId, amount: e.amount });
    const userId = e.userId;
    if (!userId) return;
    setImmediate(() => {
      sendToUser(userId, { type: 'payment:success', payload: { orderNo: e.orderNo, bizType: e.bizType, bizId: e.bizId, amount: e.amount } });
    });
  });

  paymentEventBus.on('payment.closed', (e) => {
    logger.info('[payment] payment.closed', { orderNo: e.orderNo, bizType: e.bizType, bizId: e.bizId });
    const userId = e.userId;
    if (!userId) return;
    setImmediate(() => {
      sendToUser(userId, { type: 'payment:closed', payload: { orderNo: e.orderNo, bizType: e.bizType, bizId: e.bizId } });
    });
  });

  paymentEventBus.on('payment.failed', (e) => {
    logger.info('[payment] payment.failed', { orderNo: e.orderNo, bizType: e.bizType, bizId: e.bizId });
    const userId = e.userId;
    if (!userId) return;
    setImmediate(() => {
      sendToUser(userId, { type: 'payment:failed', payload: { orderNo: e.orderNo, bizType: e.bizType, bizId: e.bizId } });
    });
  });

  paymentEventBus.on('refund.succeeded', (e) => {
    logger.info('[payment] refund.succeeded', { orderNo: e.orderNo, refundNo: e.refundNo });
    const userId = e.userId;
    const refundNo = e.refundNo;
    if (!userId || !refundNo) return;
    const refundAmount = e.refundAmount ?? 0;
    setImmediate(() => {
      sendToUser(userId, { type: 'payment:refunded', payload: { orderNo: e.orderNo, refundNo, refundAmount } });
    });
  });

  paymentEventBus.on('refund.failed', (e) => {
    logger.info('[payment] refund.failed', { orderNo: e.orderNo, refundNo: e.refundNo });
    const userId = e.userId;
    const refundNo = e.refundNo;
    if (!userId || !refundNo) return;
    const refundAmount = e.refundAmount ?? 0;
    setImmediate(() => {
      sendToUser(userId, { type: 'payment:refund-failed', payload: { orderNo: e.orderNo, refundNo, refundAmount } });
    });
  });

  // 会员钱包充值到账（bizType=member_recharge，由 member-wallet 幂等入账）
  paymentEventBus.on('payment.succeeded', (e) => {
    if (e.bizType !== WALLET_RECHARGE_BIZ_TYPE) return;
    return creditWalletOnRecharge({ bizId: e.bizId, orderNo: e.orderNo, amount: e.amount }).catch((err) => {
      logger.error('[member] 钱包充值入账失败', { orderNo: e.orderNo, err });
      throw err;
    });
  });

  // 会员自动续费扣款到账（bizType=member_renewal，按订单号幂等延长 VIP 有效期）
  paymentEventBus.on('payment.succeeded', (e) => {
    if (e.bizType !== MEMBER_RENEWAL_BIZ_TYPE) return;
    return extendVipOnRenewal({ bizId: e.bizId, orderNo: e.orderNo, amount: e.amount }).catch((err) => {
      logger.error('[member] VIP 续费延期失败', { orderNo: e.orderNo, err });
      throw err;
    });
  });

  logger.info('Payment event subscribers registered');
}
