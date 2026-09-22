import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { memberWalletTransactionSchema } from './member-wallets';
import { memberVipRenewalSchema } from './member-renewal';

export const memberWalletTransactionDetailSchema = memberWalletTransactionSchema.extend({
  paymentIntentNo: z.string().nullable(),
}).meta({ id: 'MemberWalletTransactionDetail' });

export const memberVipRenewalDetailSchema = memberVipRenewalSchema.extend({
  memberId: z.int(),
  memberName: z.string().nullable(),
}).meta({ id: 'MemberVipRenewalDetail' });

/** Admin fulfillment reads are separate from the member-facing renewal session. */
export const memberFulfillmentContract = defineContract('/api/member-fulfillment', {
  walletTransaction: op.get('/wallet-transactions/{id}', { access: { permission: 'member:wallet:list' }, params: idParam, response: memberWalletTransactionDetailSchema, summary: '钱包流水详情' }),
  vipRenewal: op.get('/vip-renewals/{id}', { access: { permission: 'member:member:list' }, params: idParam, response: memberVipRenewalDetailSchema, summary: 'VIP 续费履约详情' }),
}, { tags: ['会员履约'] });
