import type { QueryOutputOf } from '@zenith/shared/core';
/** 支付预授权：应用/商户精确作用域、CAS 状态机与 unknown 查单恢复。 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { buildListResult } from '../../lib/list-query';
import { paymentChannelConfigs, paymentOrders, paymentPreauths, type PaymentChannelConfigRow, type PaymentOrderRow, type PaymentPreauthRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { requireRow } from '../../lib/db-assert';
import { currentUser, currentUserOrNull } from '../../lib/context';
import { formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import type { PaymentEvent } from '../../lib/payment-event-bus';
import { getAdapter } from '../../lib/payment';
import logger from '../../lib/logger';
import { pageOffset } from '../../lib/pagination';
import { requireTenantScopeId, tenantCondition, exactTenantCondition } from '../../lib/tenant';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { PAYMENT_METHOD_CHANNEL, paymentPreauthContract } from '@zenith/shared/payment';
import type {
  CapturePaymentPreauthInput,
  CreatePaymentPreauthInput,
  PaymentPreauth,
  PaymentPreauthStatus,
} from '@zenith/shared/payment';
import { resolveApplicationChannelConfig } from './payment-apps.service';
import { assertEffectivePaymentOperation } from './payment-capability-evaluator';
import { postSystemJournalWithin } from './payment-journal.service';
import { recordEvent, processEvent } from './payment-outbox.service';
import { buildAdapterContext, markOrderPaid } from './payment.service';
import { genPaymentNo } from './payment-no';

export function mapPreauth(row: PaymentPreauthRow & { operatorName?: string | null }): PaymentPreauth {
  return {
    id: row.id,
    preauthNo: row.preauthNo,
    channel: row.channel,
    channelConfigId: row.channelConfigId,
    appId: row.appId,
    currency: row.currency,
    channelPreauthNo: row.channelPreauthNo ?? null,
    bizType: row.bizType,
    bizId: row.bizId,
    subject: row.subject,
    payerAccount: row.payerAccount,
    frozenAmount: row.frozenAmount,
    capturedAmount: row.capturedAmount ?? null,
    captureOrderNo: row.captureOrderNo ?? null,
    status: row.status,
    unknownOperation: row.unknownOperation ?? null,
    version: row.version,
    errorMessage: row.errorMessage ?? null,
    frozenAt: formatNullableDateTime(row.frozenAt),
    finishedAt: formatNullableDateTime(row.finishedAt),
    remark: row.remark ?? null,
    operatorName: row.operatorName ?? null,
    ...formatTimestamps(row),
  };
}

function postPreauthJournal(
  executor: DbExecutor,
  row: PaymentPreauthRow,
  operation: 'freeze' | 'release',
): Promise<number> {
  const amount = row.frozenAmount.toString();
  const freeze = operation === 'freeze';
  return postSystemJournalWithin(executor, {
    tenantId: row.tenantId,
    operatorId: row.operatorId,
    sourceType: `payment.preauth.${operation}`,
    sourceId: row.preauthNo,
    description: `${freeze ? '预授权冻结' : '预授权解冻'} ${row.preauthNo}`,
    appId: row.appId,
    channelConfigId: row.channelConfigId,
    currency: row.currency,
    lines: freeze
      ? [
          { accountCode: 'provider_clearing', debitAmount: amount, memo: '渠道冻结应收增加' },
          { accountCode: 'merchant_frozen', creditAmount: amount, memo: '预授权冻结负债增加' },
        ]
      : [
          { accountCode: 'merchant_frozen', debitAmount: amount, memo: '预授权冻结负债减少' },
          { accountCode: 'provider_clearing', creditAmount: amount, memo: '渠道冻结应收减少' },
        ],
  });
}

function postPreauthRemainderRelease(
  executor: DbExecutor,
  row: PaymentPreauthRow,
  amount: number,
): Promise<number> {
  const value = amount.toString();
  return postSystemJournalWithin(executor, {
    tenantId: row.tenantId,
    operatorId: row.operatorId,
    sourceType: 'payment.preauth.release-remainder',
    sourceId: row.preauthNo,
    description: `预授权捕获后释放余款 ${row.preauthNo}`,
    appId: row.appId,
    channelConfigId: row.channelConfigId,
    currency: row.currency,
    lines: [
      { accountCode: 'merchant_frozen', debitAmount: value, memo: '剩余预授权冻结负债减少' },
      { accountCode: 'provider_clearing', creditAmount: value, memo: '剩余渠道冻结应收减少' },
    ],
  });
}

async function loadBoundConfig(row: Pick<PaymentPreauthRow, 'channelConfigId' | 'channel' | 'tenantId'>): Promise<PaymentChannelConfigRow> {
  const [maybeConfig] = await db
    .select()
    .from(paymentChannelConfigs)
    .where(and(
      eq(paymentChannelConfigs.id, row.channelConfigId),
      eq(paymentChannelConfigs.channel, row.channel),
      exactTenantCondition(paymentChannelConfigs.tenantId, row.tenantId),
    ))
    .limit(1);
  const config = requireRow(maybeConfig, '预授权绑定的商户配置不存在或作用域不一致', 409);
  return config;
}

async function assertPreauthOperation(
  config: PaymentChannelConfigRow,
  operation: 'preauth.freeze' | 'preauth.capture' | 'preauth.release' | 'preauth.query',
  payMethod: 'wechat_preauth' | 'alipay_preauth',
  currency: string,
  recovery = false,
) {
  return assertEffectivePaymentOperation({ configRow: config, operation, method: operation === 'preauth.query' ? undefined : payMethod, currency, recovery });
}

function preauthsTenantCondition() {
  const user = currentUserOrNull();
  return user ? tenantCondition(paymentPreauths, user) : undefined;
}

export async function listPreauths(q: QueryOutputOf<typeof paymentPreauthContract.list>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    eq(paymentPreauths.appId, q.applicationId),
    keywordCondition(q.keyword, [paymentPreauths.preauthNo, paymentPreauths.payerAccount, paymentPreauths.subject]),
    q.status ? eq(paymentPreauths.status, q.status) : undefined,
    q.channel ? eq(paymentPreauths.channel, q.channel) : undefined,
    ...dateRangeConditions(paymentPreauths.createdAt, q.startTime, q.endTime),
    preauthsTenantCondition(),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentPreauths, where),
    rows: () => db.query.paymentPreauths.findMany({
      where,
      with: { operator: { columns: { nickname: true } } },
      orderBy: desc(paymentPreauths.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    map: (row) => mapPreauth({ ...row, operatorName: row.operator?.nickname ?? null }),
  });
}

export async function ensurePreauth(id: number, applicationId: number): Promise<PaymentPreauthRow> {
  const [row] = await db.select().from(paymentPreauths).where(and(
    eq(paymentPreauths.id, id),
    eq(paymentPreauths.appId, applicationId),
    preauthsTenantCondition(),
  )).limit(1);
  requireRow(row, '预授权单不存在');
  return row;
}

async function markOrderFailed(order: PaymentOrderRow, reason: string): Promise<void> {
  const eventId = await db.transaction(async (tx) => {
    const [failed] = await tx
      .update(paymentOrders)
      .set({ status: 'failed', errorMessage: reason.slice(0, 500), version: sql`${paymentOrders.version} + 1` })
      .where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.version, order.version), inArray(paymentOrders.status, ['pending', 'paying', 'unknown'])))
      .returning();
    if (!failed) return null;
    const payload: Omit<PaymentEvent, 'eventId' | 'occurredAt'> = {
      type: 'payment.failed', orderNo: failed.orderNo, outTradeNo: failed.outTradeNo,
      bizType: failed.bizType, bizId: failed.bizId, channel: failed.channel,
      channelConfigId: failed.channelConfigId, appId: failed.appId, currency: failed.currency,
      amount: failed.amount, userId: failed.userId, tenantId: failed.tenantId,
    };
    return recordEvent(tx, { type: 'payment.failed', orderNo: failed.orderNo, tenantId: failed.tenantId, payload });
  });
  if (eventId != null) {
    setImmediate(() => { void processEvent(eventId).catch((err) => logger.error('[payment-preauth] process failure event failed', { eventId, err })); });
  }
}

export async function createPreauth(input: CreatePaymentPreauthInput): Promise<PaymentPreauth> {
  const user = currentUser();
  const tenantId = requireTenantScopeId(user);
  const channel = PAYMENT_METHOD_CHANNEL[input.payMethod];
  const application = await resolveApplicationChannelConfig(input.applicationId, channel, tenantId);
  const [maybeConfig] = await db.select().from(paymentChannelConfigs).where(and(
    eq(paymentChannelConfigs.id, application.channelConfigId), exactTenantCondition(paymentChannelConfigs.tenantId, tenantId),
  )).limit(1);
  const config = requireRow(maybeConfig, '支付应用绑定的商户配置不存在', 400);
  await assertPreauthOperation(config, 'preauth.freeze', input.payMethod, input.currency);
  const adapter = getAdapter(channel);
  if (!adapter.preauthFreeze) throw new HTTPException(400, { message: `CAPABILITY_UNSUPPORTED: ${channel}/preauth.freeze` });

  const preauthNo = genPaymentNo('PRE');
  const [row] = await db.insert(paymentPreauths).values({
    preauthNo, channel, channelConfigId: config.id, appId: application.appId, currency: input.currency,
    bizType: input.bizType?.trim() || 'admin_preauth', bizId: input.bizId, subject: input.subject,
    payerAccount: input.payerAccount, frozenAmount: input.frozenAmount, status: 'pending', unknownOperation: 'freeze',
    remark: input.remark ?? null, operatorId: user.userId, tenantId,
  }).returning();
  try {
    const result = await adapter.preauthFreeze(buildAdapterContext(config), {
      outPreauthNo: preauthNo, payerAccount: input.payerAccount, amount: input.frozenAmount, subject: input.subject,
    });
    if (result.status === 'frozen') {
      const updated = await db.transaction(async (tx) => {
        const [frozen] = await tx.update(paymentPreauths).set({
          status: 'frozen', unknownOperation: null, channelPreauthNo: result.channelPreauthNo ?? null,
          frozenAt: new Date(), errorMessage: null, version: sql`${paymentPreauths.version} + 1`,
        }).where(and(eq(paymentPreauths.id, row.id), eq(paymentPreauths.version, row.version), eq(paymentPreauths.status, 'pending'))).returning();
        if (!frozen) return null;
        await postPreauthJournal(tx, frozen, 'freeze');
        return frozen;
      });
      return mapPreauth(updated ?? row);
    }
    const [pending] = await db.update(paymentPreauths).set({
      channelPreauthNo: result.channelPreauthNo ?? null, version: sql`${paymentPreauths.version} + 1`,
    }).where(and(eq(paymentPreauths.id, row.id), eq(paymentPreauths.version, row.version), eq(paymentPreauths.status, 'pending'))).returning();
    return mapPreauth(pending ?? row);
  } catch (err) {
    const reason = (err instanceof Error ? err.message : '渠道冻结结果待确认').slice(0, 500);
    const [unknown] = await db.update(paymentPreauths).set({
      status: 'unknown', unknownOperation: 'freeze', errorMessage: reason, version: sql`${paymentPreauths.version} + 1`,
    }).where(and(eq(paymentPreauths.id, row.id), eq(paymentPreauths.version, row.version), eq(paymentPreauths.status, 'pending'))).returning();
    return mapPreauth(unknown ?? row);
  }
}

async function restoreAfterFailure(row: PaymentPreauthRow, reason: string): Promise<PaymentPreauthRow> {
  const target: PaymentPreauthStatus = row.unknownOperation === 'freeze' ? 'failed' : 'frozen';
  const [updated] = await db.update(paymentPreauths).set({
    status: target, unknownOperation: null, errorMessage: reason.slice(0, 500),
    capturedAmount: target === 'frozen' ? null : row.capturedAmount,
    finishedAt: target === 'failed' ? new Date() : null, version: sql`${paymentPreauths.version} + 1`,
  }).where(and(eq(paymentPreauths.id, row.id), eq(paymentPreauths.version, row.version), inArray(paymentPreauths.status, ['pending', 'unknown']))).returning();
  return updated ?? row;
}

export async function capturePreauth(id: number, applicationId: number, input: CapturePaymentPreauthInput): Promise<PaymentPreauth> {
  requireTenantScopeId(currentUser());
  const row = await ensurePreauth(id, applicationId);
  if (row.status !== 'frozen') throw new HTTPException(400, { message: '仅已冻结的预授权可转支付' });
  if (!row.channelPreauthNo) throw new HTTPException(400, { message: '预授权缺少渠道授权单号' });
  const captureAmount = input.captureAmount ?? row.frozenAmount;
  if (captureAmount > row.frozenAmount) throw new HTTPException(400, { message: '转支付金额不能超过冻结金额' });
  const config = await loadBoundConfig(row);
  const payMethod = row.channel === 'wechat' ? ('wechat_preauth' as const) : ('alipay_preauth' as const);
  await assertPreauthOperation(config, 'preauth.capture', payMethod, row.currency);
  const adapter = getAdapter(row.channel);
  if (!adapter.preauthCapture) throw new HTTPException(400, { message: `CAPABILITY_UNSUPPORTED: ${row.channel}/preauth.capture` });

  const orderNo = `PAC${row.preauthNo.slice(3)}V${row.version + 1}`.slice(0, 64);
  const [maybeClaimed] = await db.update(paymentPreauths).set({
    status: 'unknown', unknownOperation: 'capture', capturedAmount: captureAmount, captureOrderNo: orderNo,
    errorMessage: null, version: sql`${paymentPreauths.version} + 1`,
  }).where(and(eq(paymentPreauths.id, row.id), eq(paymentPreauths.version, row.version), eq(paymentPreauths.status, 'frozen'))).returning();
  const claimed = requireRow(maybeClaimed, '预授权状态已变化，请刷新后重试', 409);

  let order: PaymentOrderRow;
  try {
    [order] = await db.insert(paymentOrders).values({
      orderNo, outTradeNo: orderNo, bizType: row.bizType, bizId: row.bizId,
      subject: `${row.subject}（预授权转支付）`, body: `预授权单 ${row.preauthNo}`,
      amount: captureAmount, currency: row.currency, channel: row.channel, channelConfigId: row.channelConfigId,
      appId: row.appId, payMethod, status: 'pending', openId: row.payerAccount, tenantId: row.tenantId,
    }).returning();
  } catch (err) {
    await db.update(paymentPreauths).set({
      status: 'frozen', unknownOperation: null, capturedAmount: null,
      errorMessage: (err instanceof Error ? err.message : '创建捕获订单失败').slice(0, 500),
      version: sql`${paymentPreauths.version} + 1`,
    }).where(and(eq(paymentPreauths.id, claimed.id), eq(paymentPreauths.version, claimed.version), eq(paymentPreauths.status, 'unknown')));
    throw err;
  }

  try {
    const result = await adapter.preauthCapture(buildAdapterContext(config), {
      channelPreauthNo: row.channelPreauthNo, outPreauthNo: row.preauthNo, outTradeNo: orderNo,
      captureAmount, subject: row.subject,
    });
    if (result.status === 'success') {
      await markOrderPaid(order, { channelTradeNo: result.channelTradeNo, paidAmount: captureAmount, paidAt: new Date() });
      const captured = await db.transaction(async (tx) => {
        const [finalized] = await tx.update(paymentPreauths).set({
          status: 'captured', unknownOperation: null, errorMessage: null, finishedAt: new Date(),
          version: sql`${paymentPreauths.version} + 1`,
        }).where(and(eq(paymentPreauths.id, claimed.id), eq(paymentPreauths.version, claimed.version), eq(paymentPreauths.status, 'unknown'), eq(paymentPreauths.unknownOperation, 'capture'))).returning();
        if (!finalized) return null;
        const remainder = finalized.frozenAmount - captureAmount;
        if (remainder > 0) await postPreauthRemainderRelease(tx, finalized, remainder);
        return finalized;
      });
      return mapPreauth(captured ?? claimed);
    }
    await markOrderFailed(order, result.failReason ?? '渠道预授权捕获失败');
    return mapPreauth(await restoreAfterFailure(claimed, result.failReason ?? '渠道预授权捕获失败'));
  } catch (err) {
    await db.update(paymentOrders).set({
      status: 'unknown', errorMessage: (err instanceof Error ? err.message : '渠道捕获结果待确认').slice(0, 500),
      version: sql`${paymentOrders.version} + 1`,
    }).where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.version, order.version), inArray(paymentOrders.status, ['pending', 'paying'])));
    const [unknown] = await db.update(paymentPreauths).set({
      errorMessage: (err instanceof Error ? err.message : '渠道捕获结果待确认').slice(0, 500),
      version: sql`${paymentPreauths.version} + 1`,
    }).where(and(eq(paymentPreauths.id, claimed.id), eq(paymentPreauths.version, claimed.version), eq(paymentPreauths.status, 'unknown'))).returning();
    return mapPreauth(unknown ?? claimed);
  }
}

export async function releasePreauth(id: number, applicationId: number): Promise<PaymentPreauth> {
  requireTenantScopeId(currentUser());
  const row = await ensurePreauth(id, applicationId);
  if (row.status !== 'frozen') throw new HTTPException(400, { message: '仅已冻结的预授权可解冻' });
  const config = await loadBoundConfig(row);
  const payMethod = row.channel === 'wechat' ? ('wechat_preauth' as const) : ('alipay_preauth' as const);
  await assertPreauthOperation(config, 'preauth.release', payMethod, row.currency);
  const adapter = getAdapter(row.channel);
  if (!adapter.preauthRelease) throw new HTTPException(400, { message: `CAPABILITY_UNSUPPORTED: ${row.channel}/preauth.release` });
  const [maybeClaimed] = await db.update(paymentPreauths).set({
    status: 'unknown', unknownOperation: 'release', errorMessage: null, version: sql`${paymentPreauths.version} + 1`,
  }).where(and(eq(paymentPreauths.id, row.id), eq(paymentPreauths.version, row.version), eq(paymentPreauths.status, 'frozen'))).returning();
  const claimed = requireRow(maybeClaimed, '预授权状态已变化，请刷新后重试', 409);
  try {
    await adapter.preauthRelease(buildAdapterContext(config), { outPreauthNo: row.preauthNo, channelPreauthNo: row.channelPreauthNo ?? undefined });
    const released = await db.transaction(async (tx) => {
      const [finalized] = await tx.update(paymentPreauths).set({
        status: 'released', unknownOperation: null, errorMessage: null, finishedAt: new Date(), version: sql`${paymentPreauths.version} + 1`,
      }).where(and(eq(paymentPreauths.id, claimed.id), eq(paymentPreauths.version, claimed.version), eq(paymentPreauths.status, 'unknown'), eq(paymentPreauths.unknownOperation, 'release'))).returning();
      if (!finalized) return null;
      await postPreauthJournal(tx, finalized, 'release');
      return finalized;
    });
    return mapPreauth(released ?? claimed);
  } catch (err) {
    const [unknown] = await db.update(paymentPreauths).set({
      errorMessage: (err instanceof Error ? err.message : '渠道解冻结果待确认').slice(0, 500), version: sql`${paymentPreauths.version} + 1`,
    }).where(and(eq(paymentPreauths.id, claimed.id), eq(paymentPreauths.version, claimed.version), eq(paymentPreauths.status, 'unknown'))).returning();
    return mapPreauth(unknown ?? claimed);
  }
}

export async function recoverPreauth(id: number, applicationId: number): Promise<PaymentPreauth> {
  requireTenantScopeId(currentUser());
  const row = await ensurePreauth(id, applicationId);
  if (row.status !== 'unknown' && row.status !== 'pending') return mapPreauth(row);
  const operation = row.unknownOperation ?? 'freeze';
  const config = await loadBoundConfig(row);
  const payMethod = row.channel === 'wechat' ? ('wechat_preauth' as const) : ('alipay_preauth' as const);
  try {
    await assertPreauthOperation(config, 'preauth.query', payMethod, row.currency, true);
  } catch (err) {
    const [unchanged] = await db.update(paymentPreauths).set({
      errorMessage: (err instanceof Error ? err.message : '渠道未提供预授权查询能力').slice(0, 500),
      version: sql`${paymentPreauths.version} + 1`,
    }).where(and(eq(paymentPreauths.id, row.id), eq(paymentPreauths.version, row.version), inArray(paymentPreauths.status, ['pending', 'unknown']))).returning();
    return mapPreauth(unchanged ?? row);
  }
  const adapter = getAdapter(row.channel);
  if (!adapter.queryPreauth) {
    const [unchanged] = await db.update(paymentPreauths).set({ errorMessage: 'CAPABILITY_UNSUPPORTED: 渠道未实现预授权查单', version: sql`${paymentPreauths.version} + 1` })
      .where(and(eq(paymentPreauths.id, row.id), eq(paymentPreauths.version, row.version))).returning();
    return mapPreauth(unchanged ?? row);
  }
  let result;
  try {
    result = await adapter.queryPreauth(buildAdapterContext(config), {
      outPreauthNo: row.preauthNo, channelPreauthNo: row.channelPreauthNo ?? undefined, operation,
      outTradeNo: row.captureOrderNo ?? undefined,
      amount: operation === 'capture' ? (row.capturedAmount ?? row.frozenAmount) : row.frozenAmount,
    });
  } catch (err) {
    const [unchanged] = await db.update(paymentPreauths).set({ errorMessage: (err instanceof Error ? err.message : '预授权查单失败').slice(0, 500), version: sql`${paymentPreauths.version} + 1` })
      .where(and(eq(paymentPreauths.id, row.id), eq(paymentPreauths.version, row.version))).returning();
    return mapPreauth(unchanged ?? row);
  }
  if (result.status === 'pending') return mapPreauth(row);
  if (result.status === 'failed') return mapPreauth(await restoreAfterFailure(row, result.failReason ?? '渠道确认操作失败'));
  if (operation === 'freeze' && result.status === 'frozen') {
    const frozen = await db.transaction(async (tx) => {
      const [finalized] = await tx.update(paymentPreauths).set({
        status: 'frozen', unknownOperation: null, channelPreauthNo: result.channelPreauthNo ?? row.channelPreauthNo,
        frozenAt: new Date(), errorMessage: null, version: sql`${paymentPreauths.version} + 1`,
      }).where(and(eq(paymentPreauths.id, row.id), eq(paymentPreauths.version, row.version), inArray(paymentPreauths.status, ['pending', 'unknown']))).returning();
      if (!finalized) return null;
      await postPreauthJournal(tx, finalized, 'freeze');
      return finalized;
    });
    return mapPreauth(frozen ?? row);
  }
  if (operation === 'release' && result.status === 'released') {
    const released = await db.transaction(async (tx) => {
      const [finalized] = await tx.update(paymentPreauths).set({ status: 'released', unknownOperation: null, errorMessage: null, finishedAt: new Date(), version: sql`${paymentPreauths.version} + 1` })
        .where(and(eq(paymentPreauths.id, row.id), eq(paymentPreauths.version, row.version), eq(paymentPreauths.status, 'unknown'))).returning();
      if (!finalized) return null;
      await postPreauthJournal(tx, finalized, 'release');
      return finalized;
    });
    return mapPreauth(released ?? row);
  }
  if (operation === 'capture' && result.status === 'captured' && row.captureOrderNo) {
    const [order] = await db.select().from(paymentOrders).where(and(
      eq(paymentOrders.orderNo, row.captureOrderNo), eq(paymentOrders.appId, row.appId), exactTenantCondition(paymentOrders.tenantId, row.tenantId),
    )).limit(1);
    if (!order) {
      const [unchanged] = await db.update(paymentPreauths).set({ errorMessage: '渠道确认捕获成功，但本地捕获订单缺失', version: sql`${paymentPreauths.version} + 1` })
        .where(and(eq(paymentPreauths.id, row.id), eq(paymentPreauths.version, row.version))).returning();
      return mapPreauth(unchanged ?? row);
    }
    await markOrderPaid(order, { channelTradeNo: result.channelTradeNo, paidAmount: row.capturedAmount ?? row.frozenAmount, paidAt: new Date() });
    const captured = await db.transaction(async (tx) => {
      const [finalized] = await tx.update(paymentPreauths).set({ status: 'captured', unknownOperation: null, channelPreauthNo: result.channelPreauthNo ?? row.channelPreauthNo, errorMessage: null, finishedAt: new Date(), version: sql`${paymentPreauths.version} + 1` })
        .where(and(eq(paymentPreauths.id, row.id), eq(paymentPreauths.version, row.version), eq(paymentPreauths.status, 'unknown'))).returning();
      if (!finalized) return null;
      const capturedAmount = finalized.capturedAmount ?? finalized.frozenAmount;
      const remainder = finalized.frozenAmount - capturedAmount;
      if (remainder > 0) await postPreauthRemainderRelease(tx, finalized, remainder);
      return finalized;
    });
    return mapPreauth(captured ?? row);
  }
  const [unchanged] = await db.update(paymentPreauths).set({ errorMessage: `渠道返回状态 ${result.status} 与待恢复操作 ${operation} 不一致`, version: sql`${paymentPreauths.version} + 1` })
    .where(and(eq(paymentPreauths.id, row.id), eq(paymentPreauths.version, row.version))).returning();
  return mapPreauth(unchanged ?? row);
}
