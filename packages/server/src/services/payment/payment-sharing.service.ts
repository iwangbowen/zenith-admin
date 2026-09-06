/**
 * 支付分账/分润 Service。
 * 维护分账接收方，针对成功订单发起单笔分账（走渠道 adapter.profitShare 模拟实现），
 * 状态机：pending → processing → success/failed，留存渠道分账单号。
 * 自动分账：订阅 payment.succeeded，对启用 autoShare 的接收方按 ratioBps 自动发起，
 * 确定性分账单号（SHR{orderNo}R{receiverId}）+ 唯一索引保证事件重复投递幂等；
 * 渠道调用失败的分账单由 cron retryFailedSharingOrders 兜底重试（上限 3 次）。
 */
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { randomInt } from 'node:crypto';
import { db } from '../../db';
import { buildListResult } from '../../lib/list-query';
import {
  paymentOrders,
  paymentRefunds,
  paymentSharingOrders,
  paymentSharingReceivers,
  type PaymentOrderRow,
  type PaymentSharingOrderRow,
  type PaymentSharingReceiverRow,
} from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { requireTenantScopeId, tenantCondition, exactTenantCondition } from '../../lib/tenant';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { buildAdapterContext, createOrderConfigResolver, loadOrderConfig } from './payment.service';
import { postSystemJournal } from './payment-journal.service';
import { getAdapter } from '../../lib/payment/registry';
import { paymentEventBus } from '../../lib/payment-event-bus';
import logger from '../../lib/logger';
import { isIndeterminateProviderError } from '../../lib/payment/provider-http';
import type { CreatePaymentSharingReceiverInput, UpdatePaymentSharingReceiverInput, PaymentSharingOrder, PaymentSharingOrderStatus, PaymentSharingReceiver } from '@zenith/shared/payment';
import { assertEffectivePaymentOperation } from './payment-capability-evaluator';
import { assertPaymentEngineConfig } from './payment-channel-config-resolver';

/** 单笔分账渠道调用次数上限（首次 + 重试） */
const MAX_SHARING_ATTEMPTS = 3;

function genNo(): string {
  return `SHR${Date.now()}${randomInt(1000, 9999)}`;
}

async function recordSharingJournal(
  sharing: PaymentSharingOrderRow,
  order: PaymentOrderRow,
  receiverName?: string,
): Promise<void> {
  const amount = sharing.amount.toString();
  await postSystemJournal({
    tenantId: sharing.tenantId ?? null,
    operatorId: null,
    sourceType: 'payment.sharing',
    sourceId: sharing.sharingNo,
    description: receiverName
      ? `支付分账（${receiverName}） ${sharing.sharingNo}`
      : `支付分账 ${sharing.sharingNo}`,
    appId: order.appId,
    channelConfigId: order.channelConfigId,
    currency: order.currency,
    lines: [
      { accountCode: 'merchant_available', debitAmount: amount, memo: '扣减商户可用余额' },
      { accountCode: 'provider_clearing', creditAmount: amount, memo: '渠道分账清算' },
    ],
  });
}

// ─── 接收方映射 + CRUD ────────────────────────────────────────────────────────
export function mapReceiver(row: PaymentSharingReceiverRow): PaymentSharingReceiver {
  return {
    id: row.id,
    name: row.name,
    receiverType: row.receiverType,
    account: row.account,
    ratioBps: row.ratioBps ?? null,
    autoShare: row.autoShare,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapSharingOrder(row: PaymentSharingOrderRow & { receiverName?: string | null }): PaymentSharingOrder {
  return {
    id: row.id,
    sharingNo: row.sharingNo,
    orderNo: row.orderNo,
    receiverId: row.receiverId,
    receiverName: row.receiverName ?? null,
    amount: row.amount,
    status: row.status,
    channelSharingNo: row.channelSharingNo ?? null,
    version: row.version,
    finishedAt: formatNullableDateTime(row.finishedAt),
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export interface ListReceiversQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'enabled' | 'disabled';
}

export async function listReceivers(q: ListReceiversQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  conds.push(keywordCondition(q.keyword, [paymentSharingReceivers.name]));
  if (q.status) conds.push(eq(paymentSharingReceivers.status, q.status));
  const where = buildWhere(...conds, tenantCondition(paymentSharingReceivers, currentUser()));
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentSharingReceivers, where),
    rows: () => withPagination(db.select().from(paymentSharingReceivers).where(where).orderBy(desc(paymentSharingReceivers.id)).$dynamic(), page, pageSize),
    map: mapReceiver,
  });
}

async function ensureReceiver(id: number): Promise<PaymentSharingReceiverRow> {
  const tc = tenantCondition(paymentSharingReceivers, currentUser());
  const [row] = await db.select().from(paymentSharingReceivers).where(and(eq(paymentSharingReceivers.id, id), tc)).limit(1);
  requireRow(row, '分账接收方不存在');
  return row;
}

export async function getReceiver(id: number): Promise<PaymentSharingReceiver> {
  return mapReceiver(await ensureReceiver(id));
}

export async function createReceiver(input: CreatePaymentSharingReceiverInput): Promise<PaymentSharingReceiver> {
  const tenantId = requireTenantScopeId(currentUser());
  const [row] = await db
    .insert(paymentSharingReceivers)
    .values({
      name: input.name,
      receiverType: input.receiverType ?? 'merchant',
      account: input.account,
      ratioBps: input.ratioBps ?? null,
      autoShare: input.autoShare ?? false,
      status: input.status ?? 'enabled',
      remark: input.remark ?? null,
      tenantId,
    })
    .returning();
  return mapReceiver(row);
}

export async function updateReceiver(id: number, input: UpdatePaymentSharingReceiverInput): Promise<PaymentSharingReceiver> {
  requireTenantScopeId(currentUser());
  await ensureReceiver(id);
  const set: Partial<PaymentSharingReceiverRow> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.receiverType !== undefined) set.receiverType = input.receiverType;
  if (input.account !== undefined) set.account = input.account;
  if (input.ratioBps !== undefined) set.ratioBps = input.ratioBps ?? null;
  if (input.autoShare !== undefined) set.autoShare = input.autoShare;
  if (input.status !== undefined) set.status = input.status;
  if (input.remark !== undefined) set.remark = input.remark ?? null;
  const tc = tenantCondition(paymentSharingReceivers, currentUser());
  const [row] = await db.update(paymentSharingReceivers).set(set).where(and(eq(paymentSharingReceivers.id, id), tc)).returning();
  return mapReceiver(row);
}

export async function deleteReceiver(id: number): Promise<void> {
  requireTenantScopeId(currentUser());
  await ensureReceiver(id);
  await db.delete(paymentSharingReceivers).where(eq(paymentSharingReceivers.id, id));
}

// ─── 分账单 ───────────────────────────────────────────────────────────────────
export interface ListSharingOrdersQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: PaymentSharingOrderStatus;
  receiverId?: number;
}

export async function listSharingOrders(q: ListSharingOrdersQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  conds.push(keywordCondition(q.keyword, [paymentSharingOrders.orderNo]));
  if (q.status) conds.push(eq(paymentSharingOrders.status, q.status));
  if (q.receiverId) conds.push(eq(paymentSharingOrders.receiverId, q.receiverId));
  const where = buildWhere(...conds, tenantCondition(paymentSharingOrders, currentUser()));
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentSharingOrders, where),
    rows: () => db.query.paymentSharingOrders.findMany({
      where,
      orderBy: desc(paymentSharingOrders.id),
      limit: pageSize,
      offset: (page - 1) * pageSize,
      with: { receiver: { columns: { name: true } } },
    }),
    map: (r) => mapSharingOrder({ ...r, receiverName: r.receiver?.name ?? null }),
  });
}

export interface DispatchSharingInput {
  orderNo: string;
  receiverId: number;
  amount?: number;
  remark?: string;
}

async function createReservedSharing(input: {
  orderNo: string;
  receiver: PaymentSharingReceiverRow;
  amount?: number;
  sharingNo: string;
  remark?: string | null;
}): Promise<{ order: PaymentOrderRow; sharing: PaymentSharingOrderRow }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM payment_orders WHERE order_no = ${input.orderNo} FOR UPDATE`);
    const [order] = await tx.select().from(paymentOrders).where(eq(paymentOrders.orderNo, input.orderNo)).limit(1);
    requireRow(order, '支付订单不存在');
    if (!['success', 'refunding'].includes(order.status)) {
      throw new HTTPException(400, { message: '只有已支付且未全额退款的订单可发起分账' });
    }
    if ((order.tenantId ?? null) !== (input.receiver.tenantId ?? null)) {
      throw new HTTPException(400, { message: '分账接收方与支付订单不属于同一租户' });
    }

    const paid = order.paidAmount ?? order.amount;
    const amount = input.amount ?? (input.receiver.ratioBps != null
      ? Math.round((paid * input.receiver.ratioBps) / 10000)
      : 0);
    if (amount <= 0) throw new HTTPException(400, { message: '分账金额必须大于 0' });

    // 分账与退款分别聚合，避免两个一对多 JOIN 形成笛卡尔积而放大累计金额。
    const [sharingAgg] = await tx.select({ total: sql<number>`coalesce(sum(${paymentSharingOrders.amount}),0)` })
      .from(paymentSharingOrders)
      .where(and(eq(paymentSharingOrders.orderNo, order.orderNo), inArray(paymentSharingOrders.status, ['pending', 'processing', 'success'])));
    const [refundAgg] = await tx.select({ total: sql<number>`coalesce(sum(${paymentRefunds.refundAmount}),0)` })
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.orderId, order.id), inArray(paymentRefunds.status, ['pending', 'processing', 'unknown', 'success'])));
    const available = paid - Number(sharingAgg?.total ?? 0) - Number(refundAgg?.total ?? 0);
    if (amount > available) {
      throw new HTTPException(400, { message: `分账金额超过可分配余额（剩余 ${Math.max(0, available)} 分）` });
    }

    const [sharing] = await tx
      .insert(paymentSharingOrders)
      .values({
        sharingNo: input.sharingNo,
        orderNo: order.orderNo,
        receiverId: input.receiver.id,
        amount,
        status: 'processing',
        remark: input.remark ?? null,
        tenantId: order.tenantId,
      })
      .returning();
    return { order, sharing };
  });
}

/** 发起单笔分账：校验订单已支付 + 接收方启用 → 创建分账单(processing) → 调渠道 → 落状态。 */
export async function dispatchSharing(input: DispatchSharingInput): Promise<PaymentSharingOrder> {
  requireTenantScopeId(currentUser());
  const receiver = await ensureReceiver(input.receiverId);
  if (receiver.status !== 'enabled') throw new HTTPException(400, { message: '分账接收方已停用' });
  const { order, sharing } = await createReservedSharing({
    orderNo: input.orderNo,
    receiver,
    amount: input.amount,
    sharingNo: genNo(),
    remark: input.remark,
  });
  const updated = await executeSharingAtChannel(sharing, order, receiver);
  if (updated.row.status === 'failed') {
    if (updated.error instanceof HTTPException) throw updated.error;
    throw new HTTPException(502, { message: '渠道分账请求失败，可在分账列表中重试' });
  }
  return mapSharingOrder({ ...updated.row, receiverName: receiver.name });
}

/** 调渠道执行分账并落状态（不抛出渠道异常，统一转 failed + attempts 累加，供手动/自动/重试三路径复用）。 */
async function executeSharingAtChannel(
  sharing: PaymentSharingOrderRow,
  order: PaymentOrderRow,
  receiver: PaymentSharingReceiverRow,
): Promise<{ row: PaymentSharingOrderRow; error?: unknown }> {
  let providerAccepted = false;
  try {
    const config = await loadOrderConfig(order);
    if (!config) throw new HTTPException(400, { message: '支付渠道配置不存在，无法分账' });
    await assertEffectivePaymentOperation({
      configRow: config,
      operation: 'profit-sharing.create',
      currency: order.currency,
    });
    const adapter = getAdapter(order.channel);
    if (!adapter.profitShare) throw new HTTPException(400, { message: `渠道 ${order.channel} 暂不支持分账` });
    const res = await adapter.profitShare(buildAdapterContext(config), order, {
      account: receiver.account,
      amount: sharing.amount,
      name: receiver.name,
      receiverType: receiver.receiverType,
    }, sharing.sharingNo);
    const status: PaymentSharingOrderStatus = res.status === 'success' ? 'success' : res.status === 'failed' ? 'failed' : 'processing';
    providerAccepted = status !== 'failed' || res.channelSharingNo != null;
    if (status === 'success') {
      try {
        // 先记账再落成功状态；记账失败时保持 processing，由查单路径重试收敛。
        await recordSharingJournal(sharing, order, receiver.name);
      } catch (accountingError) {
        logger.error('[payment-sharing] journal posting failed', { sharingNo: sharing.sharingNo, err: accountingError });
        const [pending] = await db
          .update(paymentSharingOrders)
          .set({
            status: 'processing',
            channelSharingNo: res.channelSharingNo ?? sharing.channelSharingNo,
            attempts: sharing.attempts + 1,
            version: sql`${paymentSharingOrders.version} + 1`,
            finishedAt: null,
          })
          .where(and(
            eq(paymentSharingOrders.id, sharing.id),
            eq(paymentSharingOrders.version, sharing.version),
            inArray(paymentSharingOrders.status, ['processing', 'failed']),
          ))
          .returning();
        const latest = pending ?? (await db.select().from(paymentSharingOrders).where(eq(paymentSharingOrders.id, sharing.id)).limit(1))[0];
        return { row: latest ?? sharing, error: accountingError };
      }
    }
    const [updated] = await db
      .update(paymentSharingOrders)
      .set({
        status,
        channelSharingNo: res.channelSharingNo ?? null,
        attempts: sharing.attempts + 1,
        version: sql`${paymentSharingOrders.version} + 1`,
        finishedAt: status === 'success' || status === 'failed' ? new Date() : null,
      })
      .where(and(
        eq(paymentSharingOrders.id, sharing.id),
        eq(paymentSharingOrders.version, sharing.version),
        inArray(paymentSharingOrders.status, ['processing', 'failed']),
      ))
      .returning();
    if (!updated) {
      const [latest] = await db.select().from(paymentSharingOrders).where(eq(paymentSharingOrders.id, sharing.id)).limit(1);
      return { row: latest ?? sharing };
    }
    return { row: updated };
  } catch (err) {
    logger.error('[payment-sharing] channel dispatch failed', { sharingNo: sharing.sharingNo, orderNo: order.orderNo, err });
    const resultUnknown = providerAccepted || isIndeterminateProviderError(err);
    const [updated] = await db
      .update(paymentSharingOrders)
      .set({
        status: resultUnknown ? 'processing' : 'failed',
        attempts: sharing.attempts + 1,
        version: sql`${paymentSharingOrders.version} + 1`,
        finishedAt: resultUnknown ? null : new Date(),
      })
      .where(and(
        eq(paymentSharingOrders.id, sharing.id),
        eq(paymentSharingOrders.version, sharing.version),
        inArray(paymentSharingOrders.status, ['processing', 'failed']),
      ))
      .returning();
    if (!updated) {
      const [latest] = await db.select().from(paymentSharingOrders).where(eq(paymentSharingOrders.id, sharing.id)).limit(1);
      return { row: latest ?? sharing, error: err };
    }
    return { row: updated, error: err };
  }
}

// ─── 自动分账（payment.succeeded 订阅者）──────────────────────────────────────

/** 确定性分账单号：同订单同接收方全局唯一，配合 sharing_no 唯一约束实现事件重复投递幂等。 */
function autoSharingNo(orderNo: string, receiverId: number): string {
  return `SHR${orderNo}R${receiverId}`;
}

/** 支付成功后自动分账：对启用 autoShare 且配置了 ratioBps 的接收方逐个发起。
 * 幂等：确定性 sharingNo + onConflictDoNothing，重复事件不会重复建单；
 * 合计校验：所有自动分账金额之和不超过订单实付。 */
export async function autoShareOrder(orderNo: string): Promise<void> {
  const [order] = await db.select().from(paymentOrders).where(eq(paymentOrders.orderNo, orderNo)).limit(1);
  if (!order) return;
  if (!['success', 'refunding', 'refunded'].includes(order.status)) return;

  const tenantCond = exactTenantCondition(paymentSharingReceivers.tenantId, order.tenantId);
  const receivers = await db
    .select()
    .from(paymentSharingReceivers)
    .where(and(eq(paymentSharingReceivers.status, 'enabled'), eq(paymentSharingReceivers.autoShare, true), tenantCond));
  if (receivers.length === 0) return;

  for (const receiver of receivers) {
    if (receiver.ratioBps == null || receiver.ratioBps <= 0) continue;
    try {
      const reserved = await createReservedSharing({
        orderNo: order.orderNo,
        receiver,
        sharingNo: autoSharingNo(order.orderNo, receiver.id),
        remark: '自动分账',
      });
      await executeSharingAtChannel(reserved.sharing, reserved.order, receiver);
    } catch (err) {
      // 确定性 sharingNo 的唯一冲突代表事件重放；余额不足等业务错误记录后跳过。
      logger.warn('[payment-sharing] auto share skipped', { orderNo, receiverId: receiver.id, err });
    }
  }
}

let sharingSubscribersRegistered = false;
/** 注册自动分账订阅者（支付成功后按接收方配置自动发起分账）。 */
export function registerSharingSubscribers(): void {
  if (sharingSubscribersRegistered) return;
  sharingSubscribersRegistered = true;
  paymentEventBus.on('payment.succeeded', (e) => {
    return autoShareOrder(e.orderNo).catch((err) => {
      logger.error('[payment-sharing] auto share failed', { orderNo: e.orderNo, err });
      throw err;
    });
  });
  logger.info('Payment sharing subscribers registered');
}

// ─── 失败分账重试（cron 兜底）────────────────────────────────────────────────

/** 重试渠道调用失败的分账单：仅处理 channelSharingNo 为空（渠道未受理）且未达尝试上限的 failed 单，
 * 防止渠道已受理的单被重复分账。返回扫描条数。 */
export async function retryFailedSharingOrders(): Promise<{ scanned: number; succeeded: number }> {
  const rows = await db
    .select()
    .from(paymentSharingOrders)
    .where(and(eq(paymentSharingOrders.status, 'failed'), isNull(paymentSharingOrders.channelSharingNo), lt(paymentSharingOrders.attempts, MAX_SHARING_ATTEMPTS)))
    .limit(50);
  if (rows.length === 0) return { scanned: 0, succeeded: 0 };
  // 整批一次取回订单与接收方（同一订单/接收方常被多条分账单引用），替代逐单两次点查
  const { orderByNo, receiverById } = await loadSharingRefs(rows);
  let succeeded = 0;
  for (const sharing of rows) {
    const order = orderByNo.get(sharing.orderNo);
    const receiver = receiverById.get(sharing.receiverId);
    if (!order || !receiver) continue;
    if (receiver.status !== 'enabled') continue;
    const updated = await executeSharingAtChannel(sharing, order, receiver);
    if (updated.row.status === 'success') succeeded++;
  }
  return { scanned: rows.length, succeeded };
}

/** 批量回查分账单引用的订单与接收方，去重后各一次查询 */
async function loadSharingRefs(rows: PaymentSharingOrderRow[]): Promise<{
  orderByNo: Map<string, PaymentOrderRow>;
  receiverById: Map<number, PaymentSharingReceiverRow>;
}> {
  const orderNos = [...new Set(rows.map((r) => r.orderNo))];
  const receiverIds = [...new Set(rows.map((r) => r.receiverId))];
  const [orders, receivers] = await Promise.all([
    db.select().from(paymentOrders).where(inArray(paymentOrders.orderNo, orderNos)),
    db.select().from(paymentSharingReceivers).where(inArray(paymentSharingReceivers.id, receiverIds)),
  ]);
  return {
    orderByNo: new Map(orders.map((o) => [o.orderNo, o])),
    receiverById: new Map(receivers.map((r) => [r.id, r])),
  };
}

/** 同步渠道已受理（processing）分账单的终态：调 adapter.queryProfitShare 查询分账结果并回写。 */
export async function syncProcessingSharingOrders(): Promise<{ scanned: number; finished: number }> {
  const rows = await db
    .select()
    .from(paymentSharingOrders)
    .where(eq(paymentSharingOrders.status, 'processing'))
    .limit(50);
  if (rows.length === 0) return { scanned: 0, finished: 0 };
  const orderNos = [...new Set(rows.map((r) => r.orderNo))];
  const orders = await db.select().from(paymentOrders).where(inArray(paymentOrders.orderNo, orderNos));
  const orderByNo = new Map(orders.map((o) => [o.orderNo, o]));
  // 整批共用配置解析器：这些订单通常只落在少数几份渠道配置上
  const resolveConfig = createOrderConfigResolver();
  let finished = 0;
  for (const sharing of rows) {
    const order = orderByNo.get(sharing.orderNo);
    if (!order) continue;
    const config = await resolveConfig(order);
    if (!config) continue;
    const adapter = getAdapter(order.channel);
    if (!adapter.queryProfitShare) continue;
    try {
      assertPaymentEngineConfig(config);
      await assertEffectivePaymentOperation({
        configRow: config,
        operation: 'profit-sharing.query',
        currency: order.currency,
        recovery: true,
      });
      const res = await adapter.queryProfitShare(buildAdapterContext(config), order, sharing.sharingNo);
      if (res.status === 'processing') continue;
      if (res.status === 'success') await recordSharingJournal(sharing, order);
      const [updated] = await db
        .update(paymentSharingOrders)
        .set({
          status: res.status,
          channelSharingNo: res.channelSharingNo ?? sharing.channelSharingNo,
          finishedAt: res.finishedAt ?? new Date(),
          version: sql`${paymentSharingOrders.version} + 1`,
        })
        .where(and(
          eq(paymentSharingOrders.id, sharing.id),
          eq(paymentSharingOrders.version, sharing.version),
          eq(paymentSharingOrders.status, 'processing'),
        ))
        .returning({ id: paymentSharingOrders.id });
      if (updated) finished++;
    } catch (err) {
      logger.warn('[payment-sharing] query profit share failed', { sharingNo: sharing.sharingNo, err });
    }
  }
  return { scanned: rows.length, finished };
}
