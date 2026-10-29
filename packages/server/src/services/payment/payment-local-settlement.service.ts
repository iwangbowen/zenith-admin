import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '../../db/types';
import { paymentOrders, paymentRefunds } from '../../db/schema';
import type { PaymentEvent } from '../../lib/payment-event-bus';
import { exactTenantCondition } from '../../lib/tenant';
import { MEMBER_RENEWAL_BIZ_TYPE } from '@zenith/shared/member';
import { creditWalletOnRechargeWithin, reverseWalletRechargeOnRefundWithin, WALLET_RECHARGE_BIZ_TYPE } from '../member/member-wallet.service';
import { extendVipOnRenewalWithin } from '../member/member-renewal.service';
import { updateCashierSessionFromPaymentEventWithin } from './payment-cashier-session.service';
import { completeDisputeRefundWithin, recordDisputeRefundFailureWithin } from './payment-dispute.service';
import { advanceContractOnPaidWithin } from './payment-contract.service';
import { settlePaymentCouponWithin } from './payment-coupon.service';
import { BIZ_PAY_DEMO_TYPE, markBizPayDemoPaidWithin } from './biz-pay-demo.service';
import { postPaymentEventJournalWithin } from './payment-journal-subscribers.service';
import { reverseFeeOnRefundWithin, settleOrderFeeWithin } from './payment-fee.service';

/** Validate and lock the immutable payment identity before invoking domain effects. */
async function lockPaymentFact(tx: DbTransaction, event: PaymentEvent): Promise<void> {
  if (event.tenantId === undefined || event.appId == null || !Number.isSafeInteger(event.amount) || event.amount <= 0) {
    throw new Error('Payment settlement requires an explicit tenant, application and positive amount');
  }
  const [order] = await tx.select().from(paymentOrders).where(and(
    eq(paymentOrders.orderNo, event.orderNo), eq(paymentOrders.appId, event.appId),
    exactTenantCondition(paymentOrders.tenantId, event.tenantId),
  )).for('update').limit(1);
  if (!order || order.bizType !== event.bizType || order.bizId !== event.bizId || order.channel !== event.channel
    || order.channelConfigId !== event.channelConfigId || order.currency !== event.currency
    || (order.paidAmount ?? order.amount) !== event.amount
    || (event.originalAmount != null && event.originalAmount !== (order.originalAmount ?? order.amount))) {
    throw new Error('Payment settlement fact does not match its source order');
  }
  if (event.type === 'payment.succeeded' && (!order.paidAt || !['success', 'refunding', 'refunded'].includes(order.status))) {
    throw new Error('Payment settlement requires a committed paid fact');
  }
  if (event.type.startsWith('refund.')) {
    if (!event.refundNo || typeof event.refundAmount !== 'number' || !Number.isSafeInteger(event.refundAmount) || event.refundAmount <= 0) {
      throw new Error('Refund settlement requires a refund identity and positive amount');
    }
    const [refund] = await tx.select({ amount: paymentRefunds.refundAmount, status: paymentRefunds.status }).from(paymentRefunds).where(and(
      eq(paymentRefunds.refundNo, event.refundNo), eq(paymentRefunds.orderId, order.id),
      exactTenantCondition(paymentRefunds.tenantId, event.tenantId),
    )).for('update').limit(1);
    if (!refund || refund.amount !== event.refundAmount || (event.type === 'refund.succeeded' && refund.status !== 'success')) {
      throw new Error('Refund settlement fact does not match its source refund');
    }
  }
}

/**
 * A local consistency unit. Its caller confirms the consumer in this same tx.
 * No provider request, queue publication or independently committed db work is allowed here.
 */
export async function settlePaymentEventWithin(tx: DbTransaction, event: PaymentEvent): Promise<void> {
  await lockPaymentFact(tx, event);
  switch (event.type) {
    case 'payment.succeeded':
      await updateCashierSessionFromPaymentEventWithin(tx, event, 'succeeded');
      if (event.bizType === WALLET_RECHARGE_BIZ_TYPE) await creditWalletOnRechargeWithin(tx, event);
      if (event.bizType === MEMBER_RENEWAL_BIZ_TYPE) await extendVipOnRenewalWithin(tx, event);
      await advanceContractOnPaidWithin(tx, event);
      await settlePaymentCouponWithin(tx, event);
      if (event.bizType === BIZ_PAY_DEMO_TYPE) await markBizPayDemoPaidWithin(tx, event);
      await postPaymentEventJournalWithin(tx, event);
      await settleOrderFeeWithin(tx, event.orderNo);
      return;
    case 'payment.closed':
    case 'payment.failed':
      await updateCashierSessionFromPaymentEventWithin(tx, event, 'failed');
      await settlePaymentCouponWithin(tx, event);
      return;
    case 'refund.succeeded':
      await completeDisputeRefundWithin(tx, event.refundNo!, event.tenantId!);
      if (event.bizType === WALLET_RECHARGE_BIZ_TYPE) await reverseWalletRechargeOnRefundWithin(tx, event);
      // Release the refundable fee before the gross refund debit is checked.
      await reverseFeeOnRefundWithin(tx, event);
      await postPaymentEventJournalWithin(tx, event);
      return;
    case 'refund.failed':
      await recordDisputeRefundFailureWithin(tx, event.refundNo!, event.tenantId!);
      return;
    default: {
      const unsupported: never = event.type;
      throw new Error(`Unsupported payment settlement event: ${unsupported}`);
    }
  }
}
