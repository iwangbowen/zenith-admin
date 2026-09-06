import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { PaymentSharingReversal, PaymentSharingReversalStatus } from '@zenith/shared/payment';
import { db } from '../../db';
import { buildListResult } from '../../lib/list-query';
import {
  paymentOrders,
  paymentChannelConfigs,
  paymentSharingOrders,
  paymentSharingReversals,
  type PaymentOrderRow,
  type PaymentSharingOrderRow,
  type PaymentSharingReversalRow,
} from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { assertProviderCapability, getAdapter, type AdapterContext, type ProfitShareReverseInput, type ProfitShareReverseResult } from '../../lib/payment';
import { tenantCondition, exactTenantCondition } from '../../lib/tenant';
import { buildWhere, dateRangeConditions, withPagination } from '../../lib/where-helpers';
import { buildAdapterContext, loadOrderConfig } from './payment.service';
import { assertPaymentEngineConfig } from './payment-channel-config-resolver';
import { postSystemJournal } from './payment-journal.service';

type ReversalWithSharing = PaymentSharingReversalRow & { sharingNo: string; orderNo: string };

function mapSharingReversal(row: ReversalWithSharing): PaymentSharingReversal {
  return {
    id: row.id,
    reversalNo: row.reversalNo,
    sharingOrderId: row.sharingOrderId,
    sharingNo: row.sharingNo,
    orderNo: row.orderNo,
    amount: row.amount,
    status: row.status,
    channelReversalNo: row.channelReversalNo ?? null,
    reason: row.reason,
    attempts: row.attempts,
    queryAttempts: row.queryAttempts,
    version: row.version,
    errorMessage: row.errorMessage ?? null,
    finishedAt: formatNullableDateTime(row.finishedAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function loadReversal(id: number): Promise<ReversalWithSharing> {
  const [row] = await db
    .select({
      reversal: paymentSharingReversals,
      sharingNo: paymentSharingOrders.sharingNo,
      orderNo: paymentSharingOrders.orderNo,
    })
    .from(paymentSharingReversals)
    .innerJoin(paymentSharingOrders, eq(paymentSharingOrders.id, paymentSharingReversals.sharingOrderId))
    .where(and(eq(paymentSharingReversals.id, id), tenantCondition(paymentSharingReversals, currentUser())))
    .limit(1);
  requireRow(row, '分账冲正记录不存在');
  return { ...row.reversal, sharingNo: row.sharingNo, orderNo: row.orderNo };
}

export function getSharingReversal(id: number): Promise<PaymentSharingReversal> {
  return loadReversal(id).then(mapSharingReversal);
}

export interface ListSharingReversalsQuery {
  page?: number;
  pageSize?: number;
  sharingOrderId?: number;
  status?: PaymentSharingReversalStatus;
  startTime?: string;
  endTime?: string;
}

export async function listSharingReversals(q: ListSharingReversalsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  const conditions = [...dateRangeConditions(paymentSharingReversals.createdAt, q.startTime, q.endTime)];
  if (q.sharingOrderId) conditions.push(eq(paymentSharingReversals.sharingOrderId, q.sharingOrderId));
  if (q.status) conditions.push(eq(paymentSharingReversals.status, q.status));
  const where = buildWhere(...conditions, tenantCondition(paymentSharingReversals, currentUser()));
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentSharingReversals, where),
    rows: () => withPagination(
      db
        .select({ reversal: paymentSharingReversals, sharingNo: paymentSharingOrders.sharingNo, orderNo: paymentSharingOrders.orderNo })
        .from(paymentSharingReversals)
        .innerJoin(paymentSharingOrders, eq(paymentSharingOrders.id, paymentSharingReversals.sharingOrderId))
        .where(where)
        .orderBy(desc(paymentSharingReversals.id))
        .$dynamic(),
      page,
      pageSize,
    ),
    map: (row) => mapSharingReversal({ ...row.reversal, sharingNo: row.sharingNo, orderNo: row.orderNo }),
  });
}

interface ReversalContext {
  sharing: PaymentSharingOrderRow;
  order: PaymentOrderRow;
  adapterContext: AdapterContext;
  adapter: ReturnType<typeof getAdapter>;
}

async function resolveReversalContext(sharing: PaymentSharingOrderRow, options?: { recovery?: boolean }): Promise<ReversalContext> {
  const [order] = await db.select().from(paymentOrders).where(eq(paymentOrders.orderNo, sharing.orderNo)).limit(1);
  if (!order || (order.tenantId ?? null) !== (sharing.tenantId ?? null)) {
    throw new HTTPException(409, { message: '原分账关联的支付订单不存在或租户不一致' });
  }
  const config = options?.recovery
    ? (await db
      .select()
      .from(paymentChannelConfigs)
      .where(and(
        eq(paymentChannelConfigs.id, order.channelConfigId),
        eq(paymentChannelConfigs.channel, order.channel),
        exactTenantCondition(paymentChannelConfigs.tenantId, order.tenantId),
      ))
      .limit(1))[0]
    : await loadOrderConfig(order);
  if (!config) throw new HTTPException(409, { message: '原分账绑定的商户配置不可用' });
  if (!options?.recovery) assertPaymentEngineConfig(config);
  const environment = config.sandbox ? 'sandbox' : 'live';
  const capability = assertProviderCapability(order.channel, 'profit-sharing.reverse', environment);
  if (!capability.currencies.includes(order.currency)) {
    throw new HTTPException(400, { message: `CAPABILITY_UNSUPPORTED: ${order.channel}/profit-sharing.reverse/${order.currency}` });
  }
  const adapter = getAdapter(order.channel);
  if (!adapter.reverseProfitShare || !adapter.queryProfitShareReverse) {
    throw new HTTPException(400, { message: `CAPABILITY_UNSUPPORTED: ${order.channel}/profit-sharing.reverse/${environment}` });
  }
  const adapterContext = buildAdapterContext(config);
  if (config.sandbox && !adapterContext.secrets.sandboxNotifySecret) {
    throw new HTTPException(400, { message: '沙箱冲正签名密钥不可用' });
  }
  return { sharing, order, adapterContext, adapter };
}

function providerInput(reversal: PaymentSharingReversalRow, sharing: PaymentSharingOrderRow): ProfitShareReverseInput {
  return {
    outSharingNo: sharing.sharingNo,
    channelSharingNo: sharing.channelSharingNo ?? undefined,
    outReversalNo: reversal.reversalNo,
    amount: reversal.amount,
    reason: reversal.reason,
  };
}

function requestHash(sharing: PaymentSharingOrderRow, reason: string): string {
  return createHash('sha256').update(JSON.stringify({
    sharingOrderId: sharing.id,
    sharingNo: sharing.sharingNo,
    amount: sharing.amount,
    reason,
  })).digest('hex');
}

async function loadReversalBySharingOrder(sharingOrderId: number): Promise<PaymentSharingReversalRow | null> {
  const [row] = await db
    .select()
    .from(paymentSharingReversals)
    .where(eq(paymentSharingReversals.sharingOrderId, sharingOrderId))
    .limit(1);
  return row ?? null;
}

async function finishReversalSuccess(
  reversal: PaymentSharingReversalRow,
  sharing: PaymentSharingOrderRow,
  order: PaymentOrderRow,
  result: ProfitShareReverseResult,
  incrementAttempts: boolean,
): Promise<PaymentSharingReversalRow> {
  const amount = reversal.amount.toString();
  // 先落幂等 Journal，再确认业务终态；失败时保留可查单状态以便重试。
  await postSystemJournal({
    tenantId: reversal.tenantId ?? null,
    operatorId: null,
    sourceType: 'payment.sharing_reversal',
    sourceId: reversal.reversalNo,
    description: `分账冲正 ${reversal.reversalNo}`,
    appId: order.appId,
    channelConfigId: order.channelConfigId,
    currency: order.currency,
    lines: [
      { accountCode: 'provider_clearing', debitAmount: amount, memo: '渠道冲正资金回收' },
      { accountCode: 'merchant_available', creditAmount: amount, memo: '恢复商户可用余额' },
    ],
  });
  return db.transaction(async (tx) => {
    const [updatedReversal] = await tx
      .update(paymentSharingReversals)
      .set({
        status: 'success',
        channelReversalNo: result.channelReversalNo ?? reversal.channelReversalNo,
        attempts: incrementAttempts ? reversal.attempts + 1 : reversal.attempts,
        errorMessage: null,
        finishedAt: new Date(),
        version: sql`${paymentSharingReversals.version} + 1`,
      })
      .where(and(
        eq(paymentSharingReversals.id, reversal.id),
        eq(paymentSharingReversals.version, reversal.version),
        inArray(paymentSharingReversals.status, ['processing', 'unknown']),
      ))
      .returning();
    if (!updatedReversal) {
      const [latest] = await tx.select().from(paymentSharingReversals).where(eq(paymentSharingReversals.id, reversal.id)).limit(1);
      if (latest?.status === 'success') return latest;
      throw new HTTPException(409, { message: '分账冲正状态已变化，请刷新后重试' });
    }
    const [maybeUpdatedSharing] = await tx
      .update(paymentSharingOrders)
      .set({ status: 'reversed', version: sql`${paymentSharingOrders.version} + 1` })
      .where(and(
        eq(paymentSharingOrders.id, sharing.id),
        eq(paymentSharingOrders.version, sharing.version),
        eq(paymentSharingOrders.status, 'success'),
      ))
      .returning({ id: paymentSharingOrders.id });
    requireRow(maybeUpdatedSharing, '原分账单状态已变化，无法确认冲正', 409);
    return updatedReversal;
  });
}

async function applyProviderResult(
  reversal: PaymentSharingReversalRow,
  sharing: PaymentSharingOrderRow,
  order: PaymentOrderRow,
  result: ProfitShareReverseResult,
  incrementAttempts: boolean,
): Promise<PaymentSharingReversalRow> {
  if (result.status === 'success') return finishReversalSuccess(reversal, sharing, order, result, incrementAttempts);
  const [updated] = await db
    .update(paymentSharingReversals)
    .set({
      status: result.status,
      channelReversalNo: result.channelReversalNo ?? reversal.channelReversalNo,
      attempts: incrementAttempts ? reversal.attempts + 1 : reversal.attempts,
      errorMessage: result.failReason?.slice(0, 500) ?? null,
      finishedAt: result.status === 'failed' ? new Date() : null,
      version: sql`${paymentSharingReversals.version} + 1`,
    })
    .where(and(
      eq(paymentSharingReversals.id, reversal.id),
      eq(paymentSharingReversals.version, reversal.version),
      inArray(paymentSharingReversals.status, ['processing', 'unknown']),
    ))
    .returning();
  if (updated) return updated;
  return (await db.select().from(paymentSharingReversals).where(eq(paymentSharingReversals.id, reversal.id)).limit(1))[0] ?? reversal;
}

export async function createSharingReversal(input: {
  sharingOrderId: number;
  idempotencyKey: string;
  reason: string;
}): Promise<PaymentSharingReversal> {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) throw new HTTPException(400, { message: '分账冲正必须提供 Idempotency-Key' });
  if (idempotencyKey.length > 128) throw new HTTPException(400, { message: 'Idempotency-Key 最长 128 个字符' });
  const reason = input.reason.trim();
  const user = currentUser();
  const sharingTenant = tenantCondition(paymentSharingOrders, user);
  const [initialSharing] = await db
    .select()
    .from(paymentSharingOrders)
    .where(and(eq(paymentSharingOrders.id, input.sharingOrderId), sharingTenant))
    .limit(1);
  requireRow(initialSharing, '分账单不存在');
  if (initialSharing.status !== 'success' && initialSharing.status !== 'reversed') {
    throw new HTTPException(400, { message: '只有成功分账可以发起冲正' });
  }
  const hash = requestHash(initialSharing, reason);
  const preexisting = await loadReversalBySharingOrder(initialSharing.id);
  if (preexisting) {
    if (preexisting.idempotencyKey !== idempotencyKey || preexisting.requestHash !== hash) {
      throw new HTTPException(409, { message: '该分账单已存在不同的冲正请求' });
    }
    return getSharingReversal(preexisting.id);
  }
  const context = await resolveReversalContext(initialSharing);

  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM payment_sharing_orders WHERE id = ${initialSharing.id} FOR UPDATE`);
    const [sharing] = await tx.select().from(paymentSharingOrders).where(eq(paymentSharingOrders.id, initialSharing.id)).limit(1);
    requireRow(sharing, '分账单不存在');
    const [existing] = await tx
      .select()
      .from(paymentSharingReversals)
      .where(eq(paymentSharingReversals.sharingOrderId, sharing.id))
      .limit(1);
    if (existing) {
      if (existing.idempotencyKey !== idempotencyKey || existing.requestHash !== hash) {
        throw new HTTPException(409, { message: '该分账单已存在不同的冲正请求' });
      }
      return { reversal: existing, sharing, reused: true };
    }
    if (sharing.status !== 'success') throw new HTTPException(409, { message: '原分账单状态已变化，无法发起冲正' });
    const [reversal] = await tx.insert(paymentSharingReversals).values({
      reversalNo: `PSR${randomUUID().replaceAll('-', '')}`,
      sharingOrderId: sharing.id,
      amount: sharing.amount,
      status: 'processing',
      idempotencyKey,
      requestHash: hash,
      reason,
      tenantId: sharing.tenantId,
    }).returning();
    return { reversal, sharing, reused: false };
  });

  if (created.reused) return getSharingReversal(created.reversal.id);
  try {
    const result = await context.adapter.reverseProfitShare!(
      context.adapterContext,
      context.order,
      providerInput(created.reversal, created.sharing),
    );
    await applyProviderResult(created.reversal, created.sharing, context.order, result, true);
  } catch (err) {
    await db
      .update(paymentSharingReversals)
      .set({
        status: 'unknown',
        attempts: created.reversal.attempts + 1,
        errorMessage: `渠道结果待确认：${err instanceof Error ? err.message : '未知错误'}`.slice(0, 500),
        version: sql`${paymentSharingReversals.version} + 1`,
      })
      .where(and(
        eq(paymentSharingReversals.id, created.reversal.id),
        eq(paymentSharingReversals.version, created.reversal.version),
        eq(paymentSharingReversals.status, 'processing'),
      ));
  }
  return getSharingReversal(created.reversal.id);
}

export async function querySharingReversal(id: number): Promise<PaymentSharingReversal> {
  const current = await loadReversal(id);
  if (current.status === 'success' || current.status === 'failed') return mapSharingReversal(current);
  const [maybeSharing] = await db
    .select()
    .from(paymentSharingOrders)
    .where(eq(paymentSharingOrders.id, current.sharingOrderId))
    .limit(1);
  const sharing = requireRow(maybeSharing, '原分账单不存在', 409);
  const context = await resolveReversalContext(sharing, { recovery: true });
  const [claimed] = await db
    .update(paymentSharingReversals)
    .set({ queryAttempts: current.queryAttempts + 1, version: sql`${paymentSharingReversals.version} + 1` })
    .where(and(
      eq(paymentSharingReversals.id, current.id),
      eq(paymentSharingReversals.version, current.version),
      inArray(paymentSharingReversals.status, ['processing', 'unknown']),
    ))
    .returning();
  if (!claimed) return getSharingReversal(id);
  try {
    const result = await context.adapter.queryProfitShareReverse!(
      context.adapterContext,
      context.order,
      providerInput(claimed, sharing),
    );
    await applyProviderResult(claimed, sharing, context.order, result, false);
  } catch (err) {
    await db
      .update(paymentSharingReversals)
      .set({ errorMessage: `冲正查单失败：${err instanceof Error ? err.message : '未知错误'}`.slice(0, 500) })
      .where(and(eq(paymentSharingReversals.id, claimed.id), eq(paymentSharingReversals.version, claimed.version)));
  }
  return getSharingReversal(id);
}

export async function findSharingReversalByOrder(sharingOrderId: number): Promise<PaymentSharingReversal | null> {
  const row = await loadReversalBySharingOrder(sharingOrderId);
  if (!row) return null;
  return getSharingReversal(row.id);
}
