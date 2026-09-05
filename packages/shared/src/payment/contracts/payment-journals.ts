import * as z from 'zod';
import { dateRangeBound, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_FUND_RESERVATION_STATUSES, PAYMENT_LEDGER_ACCOUNT_CODES, PAYMENT_LEDGER_NORMAL_BALANCES } from '../constants';
import {
  createPaymentFundReservationSchema,
  createPaymentLedgerAccountSchema,
  postPaymentJournalSchema,
  reversePaymentJournalSchema,
  transitionPaymentFundReservationSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 资金内核以最小货币单位的十进制字符串承载金额，避免 bigint 精度丢失 */
const amountString = z.string().meta({ description: '最小货币单位的十进制字符串', example: '10000' });

export const paymentLedgerAccountSchema = z.object({
  id: z.int(),
  accountNo: z.string(),
  name: z.string(),
  code: z.enum(PAYMENT_LEDGER_ACCOUNT_CODES),
  normalBalance: z.enum(PAYMENT_LEDGER_NORMAL_BALANCES),
  appId: z.int(),
  channelConfigId: z.int(),
  currency: z.string(),
  status: entityStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentLedgerAccount' });

export type PaymentLedgerAccount = z.infer<typeof paymentLedgerAccountSchema>;

export const paymentJournalLineSchema = z.object({
  id: z.int(),
  lineNo: z.int(),
  accountId: z.int(),
  accountNo: z.string(),
  accountName: z.string(),
  debitAmount: amountString,
  creditAmount: amountString,
  memo: z.string().nullable().optional(),
}).meta({ id: 'PaymentJournalLine' });

export type PaymentJournalLine = z.infer<typeof paymentJournalLineSchema>;

export const paymentJournalSchema = z.object({
  id: z.int(),
  journalNo: z.string(),
  sourceType: z.string(),
  sourceId: z.string(),
  description: z.string(),
  appId: z.int(),
  channelConfigId: z.int(),
  currency: z.string(),
  reversalOfJournalId: z.int().nullable().optional(),
  reversedByJournalId: z.int().nullable().optional().meta({ description: '原始凭证已被冲正时，指向唯一的子冲正凭证' }),
  operatorId: z.int().nullable().optional(),
  postedAt: z.string(),
  createdAt: z.string(),
  lines: z.array(paymentJournalLineSchema),
}).meta({ id: 'PaymentJournal' });

export type PaymentJournal = z.infer<typeof paymentJournalSchema>;

export const paymentFundReservationSchema = z.object({
  id: z.int(),
  reservationNo: z.string(),
  accountId: z.int(),
  sourceType: z.string(),
  sourceId: z.string(),
  amount: amountString,
  status: z.enum(PAYMENT_FUND_RESERVATION_STATUSES),
  version: z.int().nonnegative(),
  reason: z.string().nullable().optional(),
  finalizationReason: z.string().nullable().optional(),
  appId: z.int(),
  channelConfigId: z.int(),
  currency: z.string(),
  expiresAt: z.string().nullable().optional(),
  finalizedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentFundReservation' });

export type PaymentFundReservation = z.infer<typeof paymentFundReservationSchema>;

export const paymentActiveReservationAmountSchema = z.object({
  accountId: z.int(),
  amount: amountString,
}).meta({ id: 'PaymentActiveReservationAmount' });

export type PaymentActiveReservationAmount = z.infer<typeof paymentActiveReservationAmountSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

const currencyQuery = z.string().regex(/^[A-Z]{3}$/).optional();

export const paymentLedgerAccountListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  appId: z.coerce.number().int().positive().optional(),
  channelConfigId: z.coerce.number().int().positive().optional(),
  currency: currencyQuery,
  status: entityStatusSchema.optional(),
});

export const paymentFundReservationListQuery = paginationQuery.extend({
  accountId: z.coerce.number().int().positive().optional(),
  status: z.enum(PAYMENT_FUND_RESERVATION_STATUSES).optional(),
  sourceType: z.string().max(64).optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

export const paymentJournalListQuery = paginationQuery.extend({
  sourceType: z.string().max(64).optional(),
  appId: z.coerce.number().int().positive().optional(),
  channelConfigId: z.coerce.number().int().positive().optional(),
  currency: currencyQuery,
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

/** 双分录资金内核：账本账户 / 资金预占 / 资金凭证 */
export const paymentJournalContract = defineContract('/api/payment/journals', {
  accounts: op.get('/accounts', { query: paymentLedgerAccountListQuery, response: paginated(paymentLedgerAccountSchema), summary: '账本账户列表' }),
  createAccount: op.post('/accounts', { body: createPaymentLedgerAccountSchema, response: paymentLedgerAccountSchema, summary: '创建账本账户' }),
  activeReservation: op.get('/accounts/{id}/active-reservation', { params: idParam, response: paymentActiveReservationAmountSchema, summary: '查询账户有效预占金额' }),
  reservations: op.get('/reservations', { query: paymentFundReservationListQuery, response: paginated(paymentFundReservationSchema), summary: '资金预占列表' }),
  createReservation: op.post('/reservations', { body: createPaymentFundReservationSchema, response: paymentFundReservationSchema, summary: '创建资金预占' }),
  captureReservation: op.post('/reservations/{id}/capture', { params: idParam, body: transitionPaymentFundReservationSchema, response: paymentFundReservationSchema, summary: '核销资金预占' }),
  releaseReservation: op.post('/reservations/{id}/release', { params: idParam, body: transitionPaymentFundReservationSchema, response: paymentFundReservationSchema, summary: '释放资金预占' }),
  list: op.get('/', { query: paymentJournalListQuery, response: paginated(paymentJournalSchema), summary: '资金凭证列表' }),
  post: op.post('/', { body: postPaymentJournalSchema, response: paymentJournalSchema, summary: '过账资金凭证' }),
  detail: op.get('/{id}', { params: idParam, response: paymentJournalSchema, summary: '资金凭证详情' }),
  reverse: op.post('/{id}/reverse', { params: idParam, body: reversePaymentJournalSchema, response: paymentJournalSchema, summary: '冲正资金凭证' }),
}, { tags: ['支付中心-双分录'] });
