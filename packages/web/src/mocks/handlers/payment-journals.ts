import {
  paymentJournalContract,
  type PaymentFundReservation,
  type PaymentJournal,
  type PaymentJournalLine,
  type PaymentLedgerAccount,
  type PaymentLedgerAccountCode,
} from '@zenith/shared/payment';
import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '@/mocks/utils/date';
import { badRequest, conflict, notFound } from '@/mocks/utils/handlers';

type NormalBalance = PaymentLedgerAccount['normalBalance'];

const ACCOUNT_META: Record<PaymentLedgerAccountCode, { name: string; normalBalance: NormalBalance }> = {
  provider_clearing: { name: '渠道清算', normalBalance: 'debit' },
  merchant_pending: { name: '商户待结算', normalBalance: 'credit' },
  merchant_available: { name: '商户可用', normalBalance: 'credit' },
  merchant_frozen: { name: '商户冻结', normalBalance: 'credit' },
  platform_fee: { name: '平台手续费', normalBalance: 'credit' },
  refund_payable: { name: '退款应付', normalBalance: 'credit' },
  sharing_payable: { name: '分账应付', normalBalance: 'credit' },
  payout_payable: { name: '出款应付', normalBalance: 'credit' },
  suspense: { name: '待查资金', normalBalance: 'credit' },
};

const accounts: PaymentLedgerAccount[] = [];
const journals: PaymentJournal[] = [];
const reservations: PaymentFundReservation[] = [];
let nextAccountId = 1;
let nextJournalId = 1;
let nextLineId = 1;
let nextReservationId = 1;

export interface MockSystemJournalInput {
  sourceType: string;
  sourceId: string;
  description: string;
  appId: number;
  channelConfigId: number;
  currency: string;
  lines: Array<{
    accountCode: PaymentLedgerAccountCode;
    debitAmount?: string;
    creditAmount?: string;
    memo?: string;
  }>;
}

function ensureAccount(scope: Pick<MockSystemJournalInput, 'appId' | 'channelConfigId' | 'currency'>, code: PaymentLedgerAccountCode): PaymentLedgerAccount {
  const existing = accounts.find((account) => account.appId === scope.appId
    && account.channelConfigId === scope.channelConfigId
    && account.currency === scope.currency
    && account.code === code);
  if (existing) return existing;
  const meta = ACCOUNT_META[code];
  const now = mockDateTime();
  const account: PaymentLedgerAccount = {
    id: nextAccountId++,
    accountNo: `PLA${scope.appId}${scope.channelConfigId}${code.replaceAll('_', '').toUpperCase()}`,
    name: meta.name,
    code,
    normalBalance: meta.normalBalance,
    appId: scope.appId,
    channelConfigId: scope.channelConfigId,
    currency: scope.currency,
    status: 'enabled',
    createdAt: now,
    updatedAt: now,
  };
  accounts.push(account);
  return account;
}

function totals(lines: Array<Pick<PaymentJournalLine, 'debitAmount' | 'creditAmount'>>) {
  return lines.reduce((sum, line) => ({
    debit: sum.debit + BigInt(line.debitAmount),
    credit: sum.credit + BigInt(line.creditAmount),
  }), { debit: 0n, credit: 0n });
}

export function recordMockSystemJournal(input: MockSystemJournalInput): PaymentJournal {
  const existing = journals.find((journal) => journal.sourceType === input.sourceType
    && journal.sourceId === input.sourceId
    && journal.appId === input.appId
    && journal.channelConfigId === input.channelConfigId
    && journal.currency === input.currency);
  if (existing) return existing;
  const now = mockDateTime();
  const journalId = nextJournalId++;
  const lines: PaymentJournalLine[] = input.lines.map((line, index) => {
    const account = ensureAccount(input, line.accountCode);
    return {
      id: nextLineId++,
      lineNo: index + 1,
      accountId: account.id,
      accountNo: account.accountNo,
      accountName: account.name,
      debitAmount: line.debitAmount ?? '0',
      creditAmount: line.creditAmount ?? '0',
      memo: line.memo ?? null,
    };
  });
  const total = totals(lines);
  if (total.debit <= 0n || total.debit !== total.credit) throw new Error('Mock Journal 借贷不平衡');
  const journal: PaymentJournal = {
    id: journalId,
    journalNo: `JRNMOCK${String(journalId).padStart(8, '0')}`,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    description: input.description,
    appId: input.appId,
    channelConfigId: input.channelConfigId,
    currency: input.currency,
    reversalOfJournalId: null,
    reversedByJournalId: null,
    operatorId: null,
    postedAt: now,
    createdAt: now,
    lines,
  };
  journals.unshift(journal);
  return journal;
}

recordMockSystemJournal({
  sourceType: 'payment.capture',
  sourceId: 'PAY1700000000001',
  description: '支付收款 PAY1700000000001',
  appId: 1,
  channelConfigId: 1,
  currency: 'CNY',
  lines: [
    { accountCode: 'provider_clearing', debitAmount: '9900', memo: '渠道应收增加' },
    { accountCode: 'merchant_available', creditAmount: '9900', memo: '商户可用余额增加' },
  ],
});

function reservationTransition(reservation: PaymentFundReservation, action: 'capture' | 'release', body: { version: number; reason: string }) {
  if (body.version !== reservation.version) return conflict('资金预占版本已变化');
  if (reservation.status !== 'active') return conflict('资金预占已处理');
  reservation.status = action === 'capture' ? 'captured' : 'released';
  reservation.finalizationReason = body.reason;
  reservation.finalizedAt = mockDateTime();
  reservation.updatedAt = mockDateTime();
  reservation.version += 1;
  return null;
}

export const paymentJournalHandlers = [
  mock(paymentJournalContract.accounts, ({ query, ok, paginate }) => {
    const keyword = query.keyword?.trim() ?? '';
    const filtered = accounts.filter((account) => (!keyword || account.accountNo.includes(keyword) || account.name.includes(keyword))
      && (!query.appId || account.appId === query.appId)
      && (!query.channelConfigId || account.channelConfigId === query.channelConfigId)
      && (!query.currency || account.currency === query.currency)
      && (!query.status || account.status === query.status));
    return ok(paginate([...filtered].reverse()));
  }),
  mock(paymentJournalContract.createAccount, ({ body, ok }) => {
    if (accounts.some((account) => account.appId === body.appId && account.channelConfigId === body.channelConfigId && account.currency === body.currency && account.code === body.code)) {
      return conflict('同一账务作用域下该科目已存在');
    }
    const account = ensureAccount({ appId: body.appId, channelConfigId: body.channelConfigId, currency: body.currency }, body.code);
    account.name = body.name;
    return ok(account, '创建成功');
  }),
  mock(paymentJournalContract.activeReservation, ({ params, ok }) => {
    const accountId = params.id;
    if (!accounts.some((account) => account.id === accountId)) return notFound('账本账户不存在');
    const amount = reservations
      .filter((reservation) => reservation.accountId === accountId && reservation.status === 'active')
      .reduce((sum, reservation) => sum + BigInt(reservation.amount), 0n);
    return ok({ accountId, amount: amount.toString() });
  }),
  mock(paymentJournalContract.reservations, ({ query, ok, paginate }) => {
    const filtered = reservations.filter((reservation) => (!query.accountId || reservation.accountId === query.accountId)
      && (!query.sourceType || reservation.sourceType === query.sourceType)
      && (!query.status || reservation.status === query.status)
      && (!query.startTime || reservation.createdAt >= query.startTime)
      && (!query.endTime || reservation.createdAt <= query.endTime));
    return ok(paginate([...filtered].reverse()));
  }),
  mock(paymentJournalContract.createReservation, ({ body, ok }) => {
    const account = accounts.find((item) => item.id === body.accountId);
    if (!account) return notFound('账本账户不存在');
    const now = mockDateTime();
    const reservation: PaymentFundReservation = {
      id: nextReservationId++,
      reservationNo: `RSVMOCK${String(nextReservationId).padStart(8, '0')}`,
      accountId: account.id,
      sourceType: body.sourceType,
      sourceId: body.sourceId,
      amount: body.amount,
      status: 'active',
      version: 0,
      reason: body.reason,
      finalizationReason: null,
      appId: account.appId,
      channelConfigId: account.channelConfigId,
      currency: account.currency,
      expiresAt: body.expiresAt ?? null,
      finalizedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    reservations.push(reservation);
    return ok(reservation, '预占成功');
  }),
  mock(paymentJournalContract.captureReservation, ({ params, body, ok }) => {
    const reservation = reservations.find((item) => item.id === params.id);
    if (!reservation) return notFound('资金预占不存在');
    return reservationTransition(reservation, 'capture', body) ?? ok(reservation, '核销成功');
  }),
  mock(paymentJournalContract.releaseReservation, ({ params, body, ok }) => {
    const reservation = reservations.find((item) => item.id === params.id);
    if (!reservation) return notFound('资金预占不存在');
    return reservationTransition(reservation, 'release', body) ?? ok(reservation, '释放成功');
  }),
  mock(paymentJournalContract.list, ({ query, ok, paginate }) => {
    const filtered = journals.filter((journal) => (!query.sourceType || journal.sourceType === query.sourceType)
      && (!query.appId || journal.appId === query.appId)
      && (!query.channelConfigId || journal.channelConfigId === query.channelConfigId)
      && (!query.currency || journal.currency === query.currency)
      && (!query.startTime || journal.postedAt >= query.startTime)
      && (!query.endTime || journal.postedAt <= query.endTime));
    return ok(paginate(filtered));
  }),
  mock(paymentJournalContract.detail, ({ params, ok }) => {
    const journal = journals.find((item) => item.id === params.id);
    return journal ? ok(journal) : notFound('资金凭证不存在');
  }),
  mock(paymentJournalContract.post, ({ body, ok }) => {
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const lines = body.lines.map((line, index): PaymentJournalLine | null => {
      const account = accountById.get(line.accountId);
      if (!account || account.appId !== body.appId || account.channelConfigId !== body.channelConfigId || account.currency !== body.currency) return null;
      return { id: nextLineId++, lineNo: index + 1, accountId: account.id, accountNo: account.accountNo, accountName: account.name, debitAmount: line.debitAmount, creditAmount: line.creditAmount, memo: line.memo ?? null };
    });
    if (lines.some((line) => line == null)) return badRequest('凭证账户与账务作用域不一致');
    const typedLines = lines as PaymentJournalLine[];
    const total = totals(typedLines);
    if (total.debit <= 0n || total.debit !== total.credit) return badRequest('资金凭证借贷金额必须相等且大于 0');
    const existing = journals.find((journal) => journal.sourceType === body.sourceType && journal.sourceId === body.sourceId && journal.appId === body.appId && journal.channelConfigId === body.channelConfigId && journal.currency === body.currency);
    if (existing) return ok(existing, '过账成功');
    const now = mockDateTime();
    const journal: PaymentJournal = { id: nextJournalId++, journalNo: `JRNMOCK${String(nextJournalId).padStart(8, '0')}`, sourceType: body.sourceType, sourceId: body.sourceId, description: body.description, appId: body.appId, channelConfigId: body.channelConfigId, currency: body.currency, reversalOfJournalId: null, reversedByJournalId: null, operatorId: 1, postedAt: now, createdAt: now, lines: typedLines };
    journals.unshift(journal);
    return ok(journal, '过账成功');
  }),
  mock(paymentJournalContract.reverse, ({ params, body, ok }) => {
    const original = journals.find((item) => item.id === params.id);
    if (!original) return notFound('资金凭证不存在');
    if (journals.some((journal) => journal.reversalOfJournalId === original.id)) return conflict('该资金凭证已冲正');
    const now = mockDateTime();
    const reversal: PaymentJournal = {
      ...original,
      id: nextJournalId++,
      journalNo: `JRNMOCK${String(nextJournalId).padStart(8, '0')}`,
      sourceType: 'manual.reversal',
      sourceId: `reversal:${original.id}`,
      description: `冲正 ${original.journalNo}：${body.reason}`,
      reversalOfJournalId: original.id,
      reversedByJournalId: null,
      operatorId: 1,
      postedAt: now,
      createdAt: now,
      lines: original.lines.map((line, index) => ({ ...line, id: nextLineId++, lineNo: index + 1, debitAmount: line.creditAmount, creditAmount: line.debitAmount })),
    };
    original.reversedByJournalId = reversal.id;
    journals.unshift(reversal);
    return ok(reversal, '冲正成功');
  }),
];
