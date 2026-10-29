import logger from '../../lib/logger';
import { db } from '../../db';
import type { DbTransaction } from '../../db/types';
import { paymentEventBus, type PaymentEvent } from '../../lib/payment-event-bus';
import { postSystemJournalWithin, type PostSystemPaymentJournalInput } from './payment-journal.service';

function eventJournalInput(event: PaymentEvent): PostSystemPaymentJournalInput | null {
  if (event.type !== 'payment.succeeded' && event.type !== 'refund.succeeded') return null;
  if (event.appId == null || event.tenantId === undefined) throw new Error('Payment journal requires an application and explicit tenant');
  const refund = event.type === 'refund.succeeded';
  const amount = refund ? event.refundAmount : event.amount;
  if (!Number.isSafeInteger(amount) || amount! <= 0 || (refund && !event.refundNo)) throw new Error('Payment journal fact requires a positive amount and source identity');
  const preauth = !refund && (event.payMethod === 'wechat_preauth' || event.payMethod === 'alipay_preauth');
  const value = amount!.toString();
  return {
    tenantId: event.tenantId, operatorId: null, appId: event.appId, channelConfigId: event.channelConfigId,
    currency: event.currency, sourceType: refund ? 'payment.refund' : preauth ? 'payment.preauth.capture' : 'payment.capture',
    sourceId: refund ? event.refundNo! : event.orderNo,
    description: refund ? `支付退款 ${event.refundNo}` : `支付收款 ${event.orderNo}`,
    lines: refund
      ? [{ accountCode: 'merchant_available', debitAmount: value, memo: '商户可用余额减少' }, { accountCode: 'provider_clearing', creditAmount: value, memo: '渠道应收减少' }]
      : preauth
        ? [{ accountCode: 'merchant_frozen', debitAmount: value, memo: '预授权冻结负债减少' }, { accountCode: 'merchant_available', creditAmount: value, memo: '商户可用余额增加' }]
        : [{ accountCode: 'provider_clearing', debitAmount: value, memo: '渠道应收增加' }, { accountCode: 'merchant_available', creditAmount: value, memo: '商户可用余额增加' }],
  };
}

/** Post only through the caller's transaction; no global pool or independent commit. */
export async function postPaymentEventJournalWithin(tx: DbTransaction, event: PaymentEvent): Promise<void> {
  const input = eventJournalInput(event);
  if (input) await postSystemJournalWithin(tx, input);
}

let registered = false;
export function registerPaymentJournalSubscribers(): void {
  if (registered) return;
  registered = true;
  const post = (event: PaymentEvent) => db.transaction((tx) => postPaymentEventJournalWithin(tx, event));
  paymentEventBus.on('payment.succeeded', post);
  paymentEventBus.on('refund.succeeded', post);
  logger.info('Payment journal subscribers registered');
}
