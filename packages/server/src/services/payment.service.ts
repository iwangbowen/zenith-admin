/**
 * 支付中心门面 Service。
 *
 * 业务模块统一入口：createPayment / queryPayment / refund / closePayment。
 * 内部负责：解析渠道配置、解密密钥组装 AdapterContext、订单状态机、事务落库、
 * 回调验签后处理、发支付事件。所有渠道差异封装在适配器内，业务层无感知。
 */
import { and, desc, eq, gte, like, lte, ne, notInArray, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { randomInt } from 'node:crypto';
import { db } from '../db';
import {
  paymentChannelConfigs,
  paymentNotifyLogs,
  paymentOrders,
  paymentRefunds,
  users,
  type PaymentChannelConfigRow,
  type PaymentNotifyLogRow,
  type PaymentOrderRow,
  type PaymentRefundRow,
} from '../db/schema';
import { currentUser, currentUserOrNull } from '../lib/context';
import { getCreateTenantId, tenantCondition } from '../lib/tenant';
import { getDataScopeCondition } from '../lib/data-scope';
import { escapeLike, mergeWhere, withPagination } from '../lib/where-helpers';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../lib/datetime';
import { decryptField } from '../lib/encryption';
import logger from '../lib/logger';
import { PAYMENT_METHOD_CHANNEL } from '@zenith/shared';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  CreateRefundInput,
  PaymentChannel,
  PaymentNotifyLog,
  PaymentOrder,
  PaymentOrderStatus,
  PaymentRefund,
} from '@zenith/shared';
import { getAdapter } from '../lib/payment';
import type { AdapterContext, DecryptedSecrets, NotifyResult } from '../lib/payment';
import { paymentEventBus, type PaymentEventType } from '../lib/payment-event-bus';

// ─── 工具 ─────────────────────────────────────────────────────────────────────

function genNo(prefix: string): string {
  return `${prefix}${Date.now()}${randomInt(1000, 9999)}`;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : '未知错误';
}

function resolveNotifyUrl(channel: PaymentChannel, config: PaymentChannelConfigRow): string {
  const base = (config.notifyUrl || process.env.PAYMENT_NOTIFY_BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/api/public/payment/notify/${channel}`;
}

/** 校验回调地址为公网 http(s) 绝对地址；下单/退款前调用，缺失时快速报错而非让渠道接口报晦涩错误 */
function assertNotifyUrl(notifyUrl: string): void {
  if (!/^https?:\/\//.test(notifyUrl)) {
    throw new HTTPException(400, {
      message: '未配置有效的支付回调地址（需公网 http(s) 绝对地址）：请在渠道配置填写 notifyUrl，或设置 PAYMENT_NOTIFY_BASE_URL / PUBLIC_BASE_URL 环境变量',
    });
  }
}

/** 解密渠道密钥并组装适配器上下文 */
export function buildAdapterContext(config: PaymentChannelConfigRow): AdapterContext {
  const secrets: DecryptedSecrets = {
    wechatApiV3Key: decryptField(config.wechatApiV3KeyEncrypted) ?? undefined,
    wechatPrivateKey: decryptField(config.wechatPrivateKeyEncrypted) ?? undefined,
    alipayPrivateKey: decryptField(config.alipayPrivateKeyEncrypted) ?? undefined,
  };
  return { config, secrets, notifyUrl: resolveNotifyUrl(config.channel, config) };
}

async function resolveChannelConfig(channel: PaymentChannel, channelConfigId?: number): Promise<PaymentChannelConfigRow> {
  const tc = currentUserOrNull() ? tenantCondition(paymentChannelConfigs, currentUser()) : undefined;
  if (channelConfigId) {
    const [row] = await db.select().from(paymentChannelConfigs).where(and(eq(paymentChannelConfigs.id, channelConfigId), tc)).limit(1);
    if (!row) throw new HTTPException(404, { message: '支付渠道配置不存在' });
    return row;
  }
  const [row] = await db
    .select()
    .from(paymentChannelConfigs)
    .where(and(eq(paymentChannelConfigs.channel, channel), eq(paymentChannelConfigs.isDefault, true), eq(paymentChannelConfigs.status, 'enabled'), tc))
    .limit(1);
  if (!row) throw new HTTPException(400, { message: `未配置默认${channel === 'wechat' ? '微信' : '支付宝'}支付渠道` });
  return row;
}

/** 根据订单加载其渠道配置（不做租户过滤，供 cron/回调使用） */
export async function loadOrderConfig(order: PaymentOrderRow): Promise<PaymentChannelConfigRow | null> {
  if (order.channelConfigId) {
    const [row] = await db.select().from(paymentChannelConfigs).where(eq(paymentChannelConfigs.id, order.channelConfigId)).limit(1);
    if (row) return row;
  }
  const [row] = await db
    .select()
    .from(paymentChannelConfigs)
    .where(and(eq(paymentChannelConfigs.channel, order.channel), eq(paymentChannelConfigs.status, 'enabled')))
    .limit(1);
  return row ?? null;
}

async function getOrderRowByNo(orderNo: string): Promise<PaymentOrderRow> {
  const tc = currentUserOrNull() ? tenantCondition(paymentOrders, currentUser()) : undefined;
  const [row] = await db.select().from(paymentOrders).where(and(eq(paymentOrders.orderNo, orderNo), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '支付订单不存在' });
  return row;
}

function emitPaymentEvent(type: PaymentEventType, order: PaymentOrderRow, extra?: { refundNo?: string; refundAmount?: number }): void {
  paymentEventBus.emit({
    type,
    orderNo: order.orderNo,
    outTradeNo: order.outTradeNo,
    bizType: order.bizType,
    bizId: order.bizId,
    channel: order.channel,
    amount: order.amount,
    userId: order.userId,
    tenantId: order.tenantId,
    refundNo: extra?.refundNo,
    refundAmount: extra?.refundAmount,
  });
}

// ─── 映射 ─────────────────────────────────────────────────────────────────────

export function mapOrder(row: PaymentOrderRow): PaymentOrder {
  return {
    id: row.id,
    orderNo: row.orderNo,
    outTradeNo: row.outTradeNo,
    channelTradeNo: row.channelTradeNo ?? null,
    bizType: row.bizType,
    bizId: row.bizId,
    subject: row.subject,
    body: row.body ?? null,
    amount: row.amount,
    currency: row.currency,
    channel: row.channel,
    channelConfigId: row.channelConfigId ?? null,
    payMethod: row.payMethod,
    status: row.status,
    userId: row.userId ?? null,
    openId: row.openId ?? null,
    clientIp: row.clientIp ?? null,
    departmentId: row.departmentId ?? null,
    paidAmount: row.paidAmount ?? null,
    paidAt: formatNullableDateTime(row.paidAt),
    expiredAt: formatNullableDateTime(row.expiredAt),
    errorMessage: row.errorMessage ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapRefund(row: PaymentRefundRow): PaymentRefund {
  return {
    id: row.id,
    refundNo: row.refundNo,
    outRefundNo: row.outRefundNo,
    orderNo: row.orderNo,
    orderId: row.orderId ?? null,
    channelRefundNo: row.channelRefundNo ?? null,
    channel: row.channel,
    refundAmount: row.refundAmount,
    totalAmount: row.totalAmount,
    reason: row.reason ?? null,
    status: row.status,
    operatorId: row.operatorId ?? null,
    refundedAt: formatNullableDateTime(row.refundedAt),
    errorMessage: row.errorMessage ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapNotifyLog(row: PaymentNotifyLogRow): PaymentNotifyLog {
  return {
    id: row.id,
    channel: row.channel,
    scene: row.scene,
    orderNo: row.orderNo ?? null,
    signatureValid: row.signatureValid,
    result: row.result ?? null,
    message: row.message ?? null,
    ip: row.ip ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

// ─── 下单 ─────────────────────────────────────────────────────────────────────

export async function createPayment(input: CreatePaymentInput & { clientIp?: string }): Promise<{ orderNo: string; payParams: CreatePaymentResult }> {
  const channel = PAYMENT_METHOD_CHANNEL[input.payMethod];
  const config = await resolveChannelConfig(channel, input.channelConfigId);

  const user = currentUserOrNull();
  const tenantId = user ? getCreateTenantId(user) : null;
  let departmentId: number | null = null;
  if (user) {
    const [creator] = await db.select({ departmentId: users.departmentId }).from(users).where(eq(users.id, user.userId)).limit(1);
    departmentId = creator?.departmentId ?? null;
  }
  const userId = input.userId ?? user?.userId ?? null;

  const orderNo = genNo('PAY');
  const expireMinutes = input.expireMinutes ?? 30;
  const expiredAt = new Date(Date.now() + expireMinutes * 60_000);

  const [orderRow] = await db
    .insert(paymentOrders)
    .values({
      orderNo,
      outTradeNo: orderNo,
      bizType: input.bizType,
      bizId: input.bizId,
      subject: input.subject,
      body: input.body ?? null,
      amount: input.amount,
      currency: 'CNY',
      channel,
      channelConfigId: config.id,
      payMethod: input.payMethod,
      status: 'pending',
      userId,
      openId: input.openId ?? null,
      clientIp: input.clientIp ?? null,
      departmentId,
      expiredAt,
      tenantId,
    })
    .returning();

  try {
    const ctx = buildAdapterContext(config);
    assertNotifyUrl(ctx.notifyUrl);
    const payParams = await getAdapter(channel).createPayment(ctx, orderRow);
    await db.update(paymentOrders).set({ status: 'paying' }).where(and(eq(paymentOrders.id, orderRow.id), eq(paymentOrders.status, 'pending')));
    return { orderNo, payParams };
  } catch (err) {
    await db.update(paymentOrders).set({ status: 'failed', errorMessage: errMessage(err).slice(0, 500) }).where(eq(paymentOrders.id, orderRow.id));
    throw err;
  }
}

// ─── 标记支付成功 / 状态同步 ───────────────────────────────────────────────────

export async function markOrderPaid(
  order: PaymentOrderRow,
  info: { channelTradeNo?: string; paidAmount?: number; paidAt?: Date; notifyData?: string },
): Promise<boolean> {
  // 原子条件更新：仅当订单尚未进入成功/退款态时才置为 success，
  // 确保并发回调（渠道重试）下「标记成功 + 发事件」息恰好执行一次，避免重复履约。
  const updated = await db
    .update(paymentOrders)
    .set({
      status: 'success',
      channelTradeNo: info.channelTradeNo ?? order.channelTradeNo,
      paidAmount: info.paidAmount ?? order.amount,
      paidAt: info.paidAt ?? new Date(),
      notifyData: info.notifyData ?? order.notifyData,
    })
    .where(and(eq(paymentOrders.id, order.id), notInArray(paymentOrders.status, ['success', 'refunding', 'refunded'])))
    .returning({ id: paymentOrders.id });
  if (updated.length === 0) return false; // 已被并发处理，幂等跳过
  emitPaymentEvent('payment.succeeded', order);
  return true;
}

/** 主动查单并同步本地状态（回调兜底，供查单接口与对账任务复用） */
export async function syncOrderStatus(order: PaymentOrderRow): Promise<PaymentOrderRow> {
  if (order.status === 'success' || order.status === 'closed' || order.status === 'refunded') return order;
  const config = await loadOrderConfig(order);
  if (!config) return order;
  let res;
  try {
    res = await getAdapter(order.channel).queryPayment(buildAdapterContext(config), order);
  } catch (err) {
    logger.warn('[payment] query failed', { orderNo: order.orderNo, err: errMessage(err) });
    return order;
  }
  if (res.status === 'success') {
    await markOrderPaid(order, { channelTradeNo: res.channelTradeNo, paidAmount: res.paidAmount, paidAt: res.paidAt });
    return { ...order, status: 'success' };
  }
  if (res.status === 'closed') {
    await db.update(paymentOrders).set({ status: 'closed' }).where(eq(paymentOrders.id, order.id));
    emitPaymentEvent('payment.closed', order);
    return { ...order, status: 'closed' };
  }
  return order;
}

// ─── 查单 / 关单（门面，供业务模块按 orderNo 调用）─────────────────────────────

export async function queryPayment(orderNo: string): Promise<PaymentOrder> {
  const order = await getOrderRowByNo(orderNo);
  return mapOrder(await syncOrderStatus(order));
}

export async function closePayment(orderNo: string): Promise<void> {
  const order = await getOrderRowByNo(orderNo);
  if (order.status !== 'pending' && order.status !== 'paying') {
    throw new HTTPException(400, { message: '当前订单状态无法关闭' });
  }
  const config = await loadOrderConfig(order);
  if (config) {
    try {
      await getAdapter(order.channel).closePayment(buildAdapterContext(config), order);
    } catch (err) {
      logger.warn('[payment] close failed', { orderNo, err: errMessage(err) });
    }
  }
  await db.update(paymentOrders).set({ status: 'closed' }).where(eq(paymentOrders.id, order.id));
}

// ─── 退款 ─────────────────────────────────────────────────────────────────────

async function finalizeRefund(order: PaymentOrderRow, refundNo: string, refundAmount: number): Promise<void> {
  const rows = await db
    .select({ amount: paymentRefunds.refundAmount, status: paymentRefunds.status })
    .from(paymentRefunds)
    .where(eq(paymentRefunds.orderId, order.id));
  const successTotal = rows.filter((r) => r.status === 'success').reduce((s, r) => s + r.amount, 0);
  const newStatus: PaymentOrderStatus = successTotal >= order.amount ? 'refunded' : 'success';
  await db.update(paymentOrders).set({ status: newStatus }).where(eq(paymentOrders.id, order.id));
  emitPaymentEvent('refund.succeeded', order, { refundNo, refundAmount });
}

export async function refund(input: CreateRefundInput & { operatorId?: number }): Promise<{ refundNo: string; status: string }> {
  const order = await getOrderRowByNo(input.orderNo);
  if (order.status !== 'success' && order.status !== 'refunding') {
    throw new HTTPException(400, { message: '订单未支付成功，无法退款' });
  }
  const existing = await db
    .select({ amount: paymentRefunds.refundAmount, status: paymentRefunds.status })
    .from(paymentRefunds)
    .where(eq(paymentRefunds.orderId, order.id));
  const lockedTotal = existing.filter((r) => r.status === 'success' || r.status === 'processing').reduce((s, r) => s + r.amount, 0);
  if (lockedTotal + input.refundAmount > order.amount) {
    throw new HTTPException(400, { message: '退款金额超过可退余额' });
  }
  const config = await loadOrderConfig(order);
  if (!config) throw new HTTPException(400, { message: '支付渠道配置不存在，无法退款' });

  const refundNo = genNo('REF');
  const operatorId = input.operatorId ?? currentUserOrNull()?.userId ?? null;
  const [refundRow] = await db
    .insert(paymentRefunds)
    .values({
      refundNo,
      outRefundNo: refundNo,
      orderNo: order.orderNo,
      orderId: order.id,
      channel: order.channel,
      refundAmount: input.refundAmount,
      totalAmount: order.amount,
      reason: input.reason ?? null,
      status: 'pending',
      operatorId,
      tenantId: order.tenantId,
    })
    .returning();
  await db.update(paymentOrders).set({ status: 'refunding' }).where(eq(paymentOrders.id, order.id));

  try {
    const ctx = buildAdapterContext(config);
    assertNotifyUrl(ctx.notifyUrl);
    const res = await getAdapter(order.channel).refund(ctx, order, refundRow);
    await db
      .update(paymentRefunds)
      .set({ status: res.status, channelRefundNo: res.channelRefundNo ?? null, refundedAt: res.status === 'success' ? new Date() : null })
      .where(eq(paymentRefunds.id, refundRow.id));

    if (res.status === 'success') {
      await finalizeRefund(order, refundNo, input.refundAmount);
    } else if (res.status === 'failed') {
      await db.update(paymentOrders).set({ status: 'success' }).where(eq(paymentOrders.id, order.id));
    }
    return { refundNo, status: res.status };
  } catch (err) {
    await db.update(paymentRefunds).set({ status: 'failed', errorMessage: errMessage(err).slice(0, 500) }).where(eq(paymentRefunds.id, refundRow.id));
    await db.update(paymentOrders).set({ status: 'success' }).where(eq(paymentOrders.id, order.id));
    throw err;
  }
}

// ─── 异步回调处理 ───────────────────────────────────────────────────────────────

function serializeHeaders(headers: Headers): string {
  const obj: Record<string, string> = {};
  headers.forEach((value, key) => {
    obj[key] = value;
  });
  return JSON.stringify(obj);
}

async function applyNotify(channel: PaymentChannel, result: NotifyResult): Promise<void> {
  if (result.scene === 'refund') {
    if (!result.outRefundNo) return;
    const [refundRow] = await db.select().from(paymentRefunds).where(eq(paymentRefunds.outRefundNo, result.outRefundNo)).limit(1);
    if (!refundRow) return;
    if (result.tradeStatus === 'refunded') {
      // 原子条件更新：仅当退款单尚未成功时才置为 success，
      // 确保 finalizeRefund（发 refund.succeeded 事件）在并发退款回调下息恰执行一次。
      const updated = await db
        .update(paymentRefunds)
        .set({
          status: 'success',
          refundedAt: result.paidAt ?? new Date(),
          channelRefundNo: result.channelRefundNo ?? refundRow.channelRefundNo,
          notifyData: result.raw ? JSON.stringify(result.raw).slice(0, 8000) : null,
        })
        .where(and(eq(paymentRefunds.id, refundRow.id), ne(paymentRefunds.status, 'success')))
        .returning({ id: paymentRefunds.id });
      if (updated.length === 0) return; // 已被并发处理，幂等跳过
      if (refundRow.orderId) {
        const [order] = await db.select().from(paymentOrders).where(eq(paymentOrders.id, refundRow.orderId)).limit(1);
        if (order) await finalizeRefund(order, refundRow.refundNo, refundRow.refundAmount);
      }
    } else {
      await db.update(paymentRefunds).set({ status: 'failed' }).where(and(eq(paymentRefunds.id, refundRow.id), ne(paymentRefunds.status, 'success')));
    }
    return;
  }

  if (!result.outTradeNo) return;
  const [order] = await db
    .select()
    .from(paymentOrders)
    .where(and(eq(paymentOrders.outTradeNo, result.outTradeNo), eq(paymentOrders.channel, channel)))
    .limit(1);
  if (!order) return;
  if (order.status === 'success' || order.status === 'refunded' || order.status === 'refunding') return; // 幂等
  if (result.tradeStatus === 'success') {
    await markOrderPaid(order, {
      channelTradeNo: result.channelTradeNo,
      paidAmount: result.paidAmount,
      paidAt: result.paidAt,
      notifyData: result.raw ? JSON.stringify(result.raw).slice(0, 8000) : undefined,
    });
  } else if (result.tradeStatus === 'closed') {
    await db.update(paymentOrders).set({ status: 'closed' }).where(eq(paymentOrders.id, order.id));
    emitPaymentEvent('payment.closed', order);
  }
}

/** 处理渠道异步回调：遍历该渠道启用配置逐个验签，成功后处理业务并落日志，返回需回写渠道的 ACK */
export async function handleNotify(
  channel: PaymentChannel,
  rawBody: string,
  headers: Headers,
  ip: string,
): Promise<{ ack: NotifyResult['ack'] }> {
  const configs = await db
    .select()
    .from(paymentChannelConfigs)
    .where(and(eq(paymentChannelConfigs.channel, channel), eq(paymentChannelConfigs.status, 'enabled')));

  let chosen: { result: NotifyResult; config: PaymentChannelConfigRow } | null = null;
  let lastResult: NotifyResult | null = null;
  for (const cfg of configs) {
    const result = await getAdapter(channel).verifyNotify(buildAdapterContext(cfg), rawBody, headers);
    lastResult = result;
    if (result.valid) {
      chosen = { result, config: cfg };
      break;
    }
  }

  const effective = chosen?.result ?? lastResult;
  await db.insert(paymentNotifyLogs).values({
    channel,
    scene: effective?.scene ?? 'payment',
    orderNo: effective?.outTradeNo ?? null,
    rawBody: rawBody.slice(0, 8000),
    headers: serializeHeaders(headers).slice(0, 2000),
    signatureValid: effective?.valid ?? false,
    result: effective?.valid ? effective.tradeStatus : 'invalid_sign',
    message: effective?.message ?? null,
    ip,
    tenantId: chosen?.config.tenantId ?? null,
  });

  if (!chosen) {
    return { ack: effective?.ack ?? { body: 'failure', contentType: 'text/plain', status: 401 } };
  }
  try {
    await applyNotify(channel, chosen.result);
  } catch (err) {
    logger.error('[payment] apply notify failed', { channel, err: errMessage(err) });
  }
  return { ack: chosen.result.ack };
}

// ─── 后台查询接口 ───────────────────────────────────────────────────────────────

export interface ListOrdersQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: PaymentOrderStatus;
  channel?: PaymentChannel;
  bizType?: string;
  startTime?: string;
  endTime?: string;
}

export async function listOrders(q: ListOrdersQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const user = currentUser();
  const conditions = [];
  if (q.keyword) {
    conditions.push(
      or(
        like(paymentOrders.orderNo, `%${escapeLike(q.keyword)}%`),
        like(paymentOrders.outTradeNo, `%${escapeLike(q.keyword)}%`),
        like(paymentOrders.subject, `%${escapeLike(q.keyword)}%`),
      ),
    );
  }
  if (q.status) conditions.push(eq(paymentOrders.status, q.status));
  if (q.channel) conditions.push(eq(paymentOrders.channel, q.channel));
  if (q.bizType) conditions.push(eq(paymentOrders.bizType, q.bizType));
  const startTime = parseDateTimeInput(q.startTime);
  const endTime = parseDateTimeInput(q.endTime);
  if (startTime) conditions.push(gte(paymentOrders.createdAt, startTime));
  if (endTime) conditions.push(lte(paymentOrders.createdAt, endTime));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const tc = tenantCondition(paymentOrders, user);
  const scope = await getDataScopeCondition({ currentUserId: user.userId, deptColumn: paymentOrders.departmentId, ownerColumn: paymentOrders.userId });
  const finalWhere = mergeWhere(mergeWhere(where, tc), scope);

  const [total, list] = await Promise.all([
    db.$count(paymentOrders, finalWhere),
    withPagination(db.select().from(paymentOrders).where(finalWhere).orderBy(desc(paymentOrders.id)).$dynamic(), page, pageSize),
  ]);
  return { list: list.map(mapOrder), total, page, pageSize };
}

export async function getOrderDetail(id: number): Promise<PaymentOrder> {
  const tc = tenantCondition(paymentOrders, currentUser());
  const [row] = await db.select().from(paymentOrders).where(and(eq(paymentOrders.id, id), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '支付订单不存在' });
  return mapOrder(row);
}

export async function refreshOrderById(id: number): Promise<PaymentOrder> {
  const tc = tenantCondition(paymentOrders, currentUser());
  const [row] = await db.select().from(paymentOrders).where(and(eq(paymentOrders.id, id), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '支付订单不存在' });
  return mapOrder(await syncOrderStatus(row));
}

export async function closeOrderById(id: number): Promise<void> {
  const tc = tenantCondition(paymentOrders, currentUser());
  const [row] = await db.select({ orderNo: paymentOrders.orderNo }).from(paymentOrders).where(and(eq(paymentOrders.id, id), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '支付订单不存在' });
  await closePayment(row.orderNo);
}

export interface ListRefundsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'pending' | 'processing' | 'success' | 'failed';
  channel?: PaymentChannel;
}

export async function listRefunds(q: ListRefundsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conditions = [];
  if (q.keyword) {
    conditions.push(or(like(paymentRefunds.refundNo, `%${escapeLike(q.keyword)}%`), like(paymentRefunds.orderNo, `%${escapeLike(q.keyword)}%`)));
  }
  if (q.status) conditions.push(eq(paymentRefunds.status, q.status));
  if (q.channel) conditions.push(eq(paymentRefunds.channel, q.channel));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const finalWhere = mergeWhere(where, tenantCondition(paymentRefunds, currentUser()));
  const [total, list] = await Promise.all([
    db.$count(paymentRefunds, finalWhere),
    withPagination(db.select().from(paymentRefunds).where(finalWhere).orderBy(desc(paymentRefunds.id)).$dynamic(), page, pageSize),
  ]);
  return { list: list.map(mapRefund), total, page, pageSize };
}

export async function getRefundDetail(id: number): Promise<PaymentRefund> {
  const tc = tenantCondition(paymentRefunds, currentUser());
  const [row] = await db.select().from(paymentRefunds).where(and(eq(paymentRefunds.id, id), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '退款记录不存在' });
  return mapRefund(row);
}

export interface ListNotifyLogsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  channel?: PaymentChannel;
}

export async function listNotifyLogs(q: ListNotifyLogsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conditions = [];
  if (q.keyword) conditions.push(like(paymentNotifyLogs.orderNo, `%${escapeLike(q.keyword)}%`));
  if (q.channel) conditions.push(eq(paymentNotifyLogs.channel, q.channel));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const finalWhere = mergeWhere(where, tenantCondition(paymentNotifyLogs, currentUser()));
  const [total, list] = await Promise.all([
    db.$count(paymentNotifyLogs, finalWhere),
    withPagination(db.select().from(paymentNotifyLogs).where(finalWhere).orderBy(desc(paymentNotifyLogs.id)).$dynamic(), page, pageSize),
  ]);
  return { list: list.map(mapNotifyLog), total, page, pageSize };
}
