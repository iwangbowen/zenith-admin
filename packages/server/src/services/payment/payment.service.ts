/**
 * 支付中心门面 Service。
 *
 * 业务模块统一入口：createPayment / queryPayment / refund / closePayment。
 * 内部负责：解析渠道配置、解密密钥组装 AdapterContext、订单状态机、事务落库、
 * 回调验签后处理、发支付事件。所有渠道差异封装在适配器内，业务层无感知。
 */
import { and, desc, eq, gte, inArray, isNull, like, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { randomInt } from 'node:crypto';
import { db } from '../../db';
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
} from '../../db/schema';
import { config } from '../../config';
import { currentUser, currentUserOrNull } from '../../lib/context';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { getDataScopeCondition } from '../../lib/data-scope';
import { escapeLike, mergeWhere, withPagination } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { decryptField } from '../../lib/encryption';
import { isPgUniqueViolation } from '../../lib/db-errors';
import logger from '../../lib/logger';
import { PAYMENT_METHOD_CHANNEL, PAYMENT_CHANNEL_LABELS } from '@zenith/shared';
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
import { getAdapter } from '../../lib/payment';
import type { AdapterContext, DecryptedSecrets, NotifyResult } from '../../lib/payment';
import type { PaymentEvent, PaymentEventType } from '../../lib/payment-event-bus';
import { recordEvent, processEvent } from './payment-outbox.service';
import { assertMethodEnabled } from './payment-method.service';
import { assertWithinRiskLimits } from './payment-risk.service';
import { resolveAppChannelConfig } from './payment-apps.service';

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
    unionpayPrivateKey: decryptField(config.unionpayPrivateKeyEncrypted) ?? undefined,
  };
  return { config, secrets, notifyUrl: resolveNotifyUrl(config.channel, config) };
}

async function resolveChannelConfig(channel: PaymentChannel, channelConfigId?: number, tenantId?: number | null): Promise<PaymentChannelConfigRow> {
  const tc = channelConfigTenantCondition(tenantId) ?? (currentUserOrNull() ? tenantCondition(paymentChannelConfigs, currentUser()) : undefined);
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
  if (!row) throw new HTTPException(400, { message: `未配置默认${PAYMENT_CHANNEL_LABELS[channel]}支付渠道` });
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

function channelConfigTenantCondition(tenantId: number | null | undefined) {
  if (tenantId === undefined || !config.multiTenantMode) return undefined;
  return tenantId === null ? isNull(paymentChannelConfigs.tenantId) : eq(paymentChannelConfigs.tenantId, tenantId);
}

async function buildOrderIdWhere(id: number) {
  const user = currentUser();
  const scope = await getDataScopeCondition({ currentUserId: user.userId, deptColumn: paymentOrders.departmentId, ownerColumn: paymentOrders.createdBy });
  return mergeWhere(mergeWhere(eq(paymentOrders.id, id), tenantCondition(paymentOrders, user)), scope);
}

async function buildOrderNoWhere(orderNo: string) {
  const user = currentUser();
  const scope = await getDataScopeCondition({ currentUserId: user.userId, deptColumn: paymentOrders.departmentId, ownerColumn: paymentOrders.createdBy });
  return mergeWhere(mergeWhere(eq(paymentOrders.orderNo, orderNo), tenantCondition(paymentOrders, user)), scope);
}

function buildEventPayload(type: PaymentEventType, order: PaymentOrderRow, extra?: { refundNo?: string; refundAmount?: number }): Omit<PaymentEvent, 'eventId' | 'occurredAt'> {
  return {
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
  };
}

function enqueuePaymentEvent(eventId: number | null): void {
  if (eventId == null) return;
  setImmediate(() => { void processEvent(eventId); });
}

async function markOrderClosed(order: PaymentOrderRow): Promise<void> {
  const eventId = await db.transaction(async (tx) => {
    const updated = await tx
      .update(paymentOrders)
      .set({ status: 'closed' })
      .where(and(eq(paymentOrders.id, order.id), or(eq(paymentOrders.status, 'pending'), eq(paymentOrders.status, 'paying'))))
      .returning({ id: paymentOrders.id });
    if (updated.length === 0) return null;
    return recordEvent(tx, { type: 'payment.closed', orderNo: order.orderNo, tenantId: order.tenantId, payload: buildEventPayload('payment.closed', order) });
  });
  enqueuePaymentEvent(eventId);
}

async function markRefundFailed(order: PaymentOrderRow, refund: Pick<PaymentRefundRow, 'id' | 'refundNo' | 'refundAmount'>, message?: string): Promise<void> {
  const setValues: Partial<PaymentRefundRow> = { status: 'failed' };
  if (message) setValues.errorMessage = message.slice(0, 500);
  const eventId = await db.transaction(async (tx) => {
    const updated = await tx
      .update(paymentRefunds)
      .set(setValues)
      .where(and(eq(paymentRefunds.id, refund.id), notInArray(paymentRefunds.status, ['success', 'failed'])))
      .returning({ id: paymentRefunds.id });
    await tx.update(paymentOrders).set({ status: 'success' }).where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, 'refunding')));
    if (updated.length === 0) return null;
    return recordEvent(tx, {
      type: 'refund.failed',
      orderNo: order.orderNo,
      tenantId: order.tenantId,
      payload: buildEventPayload('refund.failed', order, { refundNo: refund.refundNo, refundAmount: refund.refundAmount }),
    });
  });
  enqueuePaymentEvent(eventId);
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
    approvalStatus: row.approvalStatus,
    appliedById: row.appliedById ?? null,
    approverId: row.approverId ?? null,
    approvedAt: formatNullableDateTime(row.approvedAt),
    approvalRemark: row.approvalRemark ?? null,
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
    rawBody: row.rawBody ?? null,
    headers: row.headers ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

// ─── 下单 ─────────────────────────────────────────────────────────────────────

interface InternalCreatePaymentInput extends CreatePaymentInput {
  clientIp?: string;
  tenantId?: number | null;
}

/** 查找同业务单（bizType+bizId）的活跃订单（pending/paying），与部分唯一索引 payment_orders_active_biz_uq 对应 */
async function findActiveBizOrder(bizType: string, bizId: string): Promise<PaymentOrderRow | null> {
  const [row] = await db
    .select()
    .from(paymentOrders)
    .where(and(eq(paymentOrders.bizType, bizType), eq(paymentOrders.bizId, bizId), inArray(paymentOrders.status, ['pending', 'paying'])))
    .limit(1);
  return row ?? null;
}

/**
 * 下单业务幂等：同 bizType+bizId 已存在未过期活跃单时直接复用（重新生成支付参数，渠道侧同 outTradeNo 幂等）；
 * 金额/支付方式变化或已过期时，先主动查单防边界支付，再关闭旧单放行新建。
 * 返回 null 表示无可复用订单（调用方继续新建流程）。
 */
async function reuseActiveBizOrder(input: InternalCreatePaymentInput): Promise<{ orderNo: string; payParams: CreatePaymentResult } | null> {
  const existing = await findActiveBizOrder(input.bizType, input.bizId);
  if (!existing) return null;

  const expired = existing.expiredAt != null && existing.expiredAt.getTime() <= Date.now();
  const reusable = !expired && existing.amount === input.amount && existing.payMethod === input.payMethod;

  if (!reusable) {
    // 参数已变化或旧单过期：先同步渠道状态（防止用户恰好已扫码支付），再清场
    const synced = await syncOrderStatus(existing);
    if (synced.status === 'success' || synced.status === 'refunding' || synced.status === 'refunded') {
      throw new HTTPException(400, { message: `该业务单已支付成功，请勿重复下单（订单号 ${existing.orderNo}）` });
    }
    if (synced.status === 'pending' || synced.status === 'paying') {
      const config = await loadOrderConfig(existing);
      if (config) {
        try {
          await getAdapter(existing.channel).closePayment(buildAdapterContext(config), existing);
        } catch (err) {
          logger.warn('[payment] close stale biz order failed', { orderNo: existing.orderNo, err: errMessage(err) });
        }
      }
      await markOrderClosed(existing);
    }
    return null;
  }

  const config = await loadOrderConfig(existing);
  if (!config) return null;
  try {
    const ctx = buildAdapterContext(config);
    assertNotifyUrl(ctx.notifyUrl);
    const payParams = await getAdapter(existing.channel).createPayment(ctx, existing);
    await db.update(paymentOrders).set({ status: 'paying' }).where(and(eq(paymentOrders.id, existing.id), eq(paymentOrders.status, 'pending')));
    logger.info('[payment] reuse active biz order', { orderNo: existing.orderNo, bizType: input.bizType, bizId: input.bizId });
    return { orderNo: existing.orderNo, payParams };
  } catch (err) {
    // 渠道重下单失败可能因原单已被支付/受理，同步一次状态后再决定
    const synced = await syncOrderStatus(existing);
    if (synced.status === 'success' || synced.status === 'refunding' || synced.status === 'refunded') {
      throw new HTTPException(400, { message: `该业务单已支付成功，请勿重复下单（订单号 ${existing.orderNo}）` });
    }
    throw err;
  }
}

export async function createPayment(input: InternalCreatePaymentInput): Promise<{ orderNo: string; payParams: CreatePaymentResult }> {
  const channel = PAYMENT_METHOD_CHANNEL[input.payMethod];
  if (input.payMethod === 'wechat_jsapi' && !input.openId?.trim()) {
    throw new HTTPException(400, { message: '微信 JSAPI 支付必须提供 OpenID' });
  }
  // App 维度：按 appKey 路由到应用绑定的渠道配置（优先于 channelConfigId）
  let appId: number | null = null;
  let channelConfigId = input.channelConfigId;
  if (input.appKey) {
    const resolved = await resolveAppChannelConfig(input.appKey, channel);
    appId = resolved.appId;
    channelConfigId = resolved.channelConfigId;
  }
  const config = await resolveChannelConfig(channel, channelConfigId, input.tenantId);

  const user = currentUserOrNull();
  const tenantId = input.tenantId !== undefined ? input.tenantId : user ? getCreateTenantId(user) : null;
  let departmentId: number | null = null;
  if (user) {
    const [creator] = await db.select({ departmentId: users.departmentId }).from(users).where(eq(users.id, user.userId)).limit(1);
    departmentId = creator?.departmentId ?? null;
  }
  const userId = input.userId ?? user?.userId ?? null;

  // ── B 档：支付方式启停校验 ────────────────────────────────────────────────────
  await assertMethodEnabled(input.payMethod);

  // ── 业务幂等：同业务单存在活跃订单时直接复用（不重复风控/落单）──────────────────
  const reused = await reuseActiveBizOrder(input);
  if (reused) return reused;

  // ── B 档：风控限额校验（仅对真正新建的订单，命中即拦截下单）───────────────────
  await assertWithinRiskLimits({ channel, bizType: input.bizType, amount: input.amount, openId: input.openId ?? null, userId, tenantId });

  const orderNo = genNo('PAY');
  const expireMinutes = input.expireMinutes ?? 30;
  const expiredAt = new Date(Date.now() + expireMinutes * 60_000);

  let orderRow: PaymentOrderRow;
  try {
    [orderRow] = await db
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
        appId,
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
  } catch (err) {
    // 并发下单撞 payment_orders_active_biz_uq：复用对方刚创建的活跃单
    if (isPgUniqueViolation(err)) {
      const raced = await reuseActiveBizOrder(input);
      if (raced) return raced;
      throw new HTTPException(400, { message: '该业务单存在处理中的支付订单，请稍后重试' });
    }
    throw err;
  }

  try {
    const ctx = buildAdapterContext(config);
    assertNotifyUrl(ctx.notifyUrl);
    const payParams = await getAdapter(channel).createPayment(ctx, orderRow);
    await db.update(paymentOrders).set({ status: 'paying' }).where(and(eq(paymentOrders.id, orderRow.id), eq(paymentOrders.status, 'pending')));
    return { orderNo, payParams };
  } catch (err) {
    const eventId = await db.transaction(async (tx) => {
      await tx.update(paymentOrders).set({ status: 'failed', errorMessage: errMessage(err).slice(0, 500) }).where(eq(paymentOrders.id, orderRow.id));
      return recordEvent(tx, { type: 'payment.failed', orderNo: orderRow.orderNo, tenantId: orderRow.tenantId, payload: buildEventPayload('payment.failed', orderRow) });
    });
    enqueuePaymentEvent(eventId);
    throw err;
  }
}

// ─── 标记支付成功 / 状态同步 ───────────────────────────────────────────────────

export async function markOrderPaid(
  order: PaymentOrderRow,
  info: { channelTradeNo?: string; paidAmount?: number; paidAt?: Date; notifyData?: string },
): Promise<boolean> {
  // 原子条件更新 + outbox 事件同事务持久化：确保「标记成功 + 可靠发事件」exactly-once，
  // 即使进程在发事件前崩溃，cron 也会从 outbox 补投，杜绝漏履约。
  const eventId = await db.transaction(async (tx) => {
    const updated = await tx
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
    if (updated.length === 0) return null; // 已被并发处理，幂等跳过
    return recordEvent(tx, { type: 'payment.succeeded', orderNo: order.orderNo, tenantId: order.tenantId, payload: buildEventPayload('payment.succeeded', order) });
  });
  if (eventId == null) return false;
  setImmediate(() => { void processEvent(eventId); }); // 低延迟即时投递；崩溃由 cron 兜底
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
    await markOrderClosed(order);
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
  await markOrderClosed(order);
}

// ─── 退款 ─────────────────────────────────────────────────────────────────────

async function finalizeRefund(order: PaymentOrderRow, refundNo: string, refundAmount: number): Promise<void> {
  const eventId = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ amount: paymentRefunds.refundAmount, status: paymentRefunds.status })
      .from(paymentRefunds)
      .where(eq(paymentRefunds.orderId, order.id));
    const successTotal = rows.filter((r) => r.status === 'success').reduce((s, r) => s + BigInt(r.amount), 0n);
    const newStatus: PaymentOrderStatus = successTotal >= BigInt(order.amount) ? 'refunded' : 'success';
    await tx.update(paymentOrders).set({ status: newStatus }).where(eq(paymentOrders.id, order.id));
    return recordEvent(tx, { type: 'refund.succeeded', orderNo: order.orderNo, tenantId: order.tenantId, payload: buildEventPayload('refund.succeeded', order, { refundNo, refundAmount }) });
  });
  setImmediate(() => { void processEvent(eventId); });
}

/** 执行渠道退款并落库（审批通过或免审批后调用）。失败时回滚订单状态并抛出。 */
async function executeChannelRefund(
  order: PaymentOrderRow,
  refundRow: PaymentRefundRow,
  config: PaymentChannelConfigRow,
): Promise<{ refundNo: string; status: string }> {
  try {
    const ctx = buildAdapterContext(config);
    assertNotifyUrl(ctx.notifyUrl);
    const res = await getAdapter(order.channel).refund(ctx, order, refundRow);

    if (res.status === 'success') {
      await db
        .update(paymentRefunds)
        .set({ status: res.status, channelRefundNo: res.channelRefundNo ?? null, refundedAt: new Date() })
        .where(eq(paymentRefunds.id, refundRow.id));
      await finalizeRefund(order, refundRow.refundNo, refundRow.refundAmount);
    } else if (res.status === 'failed') {
      await db.update(paymentRefunds).set({ channelRefundNo: res.channelRefundNo ?? null }).where(eq(paymentRefunds.id, refundRow.id));
      await markRefundFailed(order, refundRow, '渠道退款失败');
    } else {
      await db
        .update(paymentRefunds)
        .set({ status: res.status, channelRefundNo: res.channelRefundNo ?? null, refundedAt: null })
        .where(eq(paymentRefunds.id, refundRow.id));
    }
    return { refundNo: refundRow.refundNo, status: res.status };
  } catch (err) {
    await markRefundFailed(order, refundRow, errMessage(err));
    throw err;
  }
}

/** 退款审批金额阈值（分）；≥阈值需审批。0=不审批，由 PAYMENT_REFUND_APPROVAL_THRESHOLD 控制。 */
function refundApprovalThreshold(): number {
  const v = Number(process.env.PAYMENT_REFUND_APPROVAL_THRESHOLD || 0);
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
}

export async function refund(input: CreateRefundInput & { operatorId?: number }): Promise<{ refundNo: string; status: string }> {
  const order = await getOrderRowByNo(input.orderNo);
  if (order.status !== 'success' && order.status !== 'refunding') {
    throw new HTTPException(400, { message: '订单未支付成功，无法退款' });
  }
  const config = await loadOrderConfig(order);
  if (!config) throw new HTTPException(400, { message: '支付渠道配置不存在，无法退款' });

  const refundNo = genNo('REF');
  const operatorId = input.operatorId ?? currentUserOrNull()?.userId ?? null;
  const threshold = refundApprovalThreshold();
  const needApproval = threshold > 0 && input.refundAmount >= threshold;

  // ── 原子校验 + 插入（事务内 SELECT FOR UPDATE 防并发超退） ──────────────────
  const refundRow = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM payment_orders WHERE id = ${order.id} FOR UPDATE`);
    const existing = await tx
      .select({ amount: paymentRefunds.refundAmount, status: paymentRefunds.status })
      .from(paymentRefunds)
      .where(eq(paymentRefunds.orderId, order.id));
    const lockedTotal = calcLockedRefundAmount(existing);
    if (lockedTotal + input.refundAmount > order.amount) {
      throw new HTTPException(400, { message: `退款金额超过可退余额（剩余 ${order.amount - lockedTotal} 分）` });
    }
    const [row] = await tx
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
        approvalStatus: needApproval ? 'pending' : 'none',
        appliedById: operatorId,
        operatorId,
        tenantId: order.tenantId,
      })
      .returning();
    // 待审批退款不立即占用订单状态，避免长时间挂在 refunding；免审批才置 refunding
    if (!needApproval) await tx.update(paymentOrders).set({ status: 'refunding' }).where(eq(paymentOrders.id, order.id));
    return row;
  });

  if (needApproval) return { refundNo, status: 'pending' };
  return executeChannelRefund(order, refundRow, config);
}

/** 审批通过待审批退款单并执行渠道退款。 */
export async function approveRefund(id: number, remark?: string): Promise<{ refundNo: string; status: string }> {
  const user = currentUser();
  const tc = tenantCondition(paymentRefunds, user);
  const [refundRow] = await db.select().from(paymentRefunds).where(and(eq(paymentRefunds.id, id), tc)).limit(1);
  if (!refundRow) throw new HTTPException(404, { message: '退款记录不存在' });
  if (refundRow.approvalStatus !== 'pending') throw new HTTPException(400, { message: '该退款单无需审批或已处理' });
  const [order] = await db.select().from(paymentOrders).where(eq(paymentOrders.orderNo, refundRow.orderNo)).limit(1);
  if (!order) throw new HTTPException(404, { message: '原支付订单不存在' });
  const config = await loadOrderConfig(order);
  if (!config) throw new HTTPException(400, { message: '支付渠道配置不存在，无法退款' });

  await db
    .update(paymentRefunds)
    .set({ approvalStatus: 'approved', approverId: user.userId, approvedAt: new Date(), approvalRemark: remark ?? null })
    .where(eq(paymentRefunds.id, id));
  await db.update(paymentOrders).set({ status: 'refunding' }).where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, 'success')));
  return executeChannelRefund(order, { ...refundRow, approvalStatus: 'approved' }, config);
}

/** 驳回待审批退款单（退款单置失败，订单不变）。 */
export async function rejectRefund(id: number, remark: string): Promise<void> {
  const user = currentUser();
  const tc = tenantCondition(paymentRefunds, user);
  const [refundRow] = await db.select().from(paymentRefunds).where(and(eq(paymentRefunds.id, id), tc)).limit(1);
  if (!refundRow) throw new HTTPException(404, { message: '退款记录不存在' });
  if (refundRow.approvalStatus !== 'pending') throw new HTTPException(400, { message: '该退款单无需审批或已处理' });
  const [order] = await db.select().from(paymentOrders).where(eq(paymentOrders.orderNo, refundRow.orderNo)).limit(1);
  if (!order) throw new HTTPException(404, { message: '原支付订单不存在' });
  const eventId = await db.transaction(async (tx) => {
    const updated = await tx
      .update(paymentRefunds)
      .set({ approvalStatus: 'rejected', approverId: user.userId, approvedAt: new Date(), approvalRemark: remark, status: 'failed', errorMessage: '退款审批被驳回' })
      .where(and(eq(paymentRefunds.id, id), eq(paymentRefunds.approvalStatus, 'pending')))
      .returning({ id: paymentRefunds.id });
    if (updated.length === 0) return null;
    return recordEvent(tx, {
      type: 'refund.failed',
      orderNo: order.orderNo,
      tenantId: order.tenantId,
      payload: buildEventPayload('refund.failed', order, { refundNo: refundRow.refundNo, refundAmount: refundRow.refundAmount }),
    });
  });
  enqueuePaymentEvent(eventId);
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
      if (refundRow.orderId) {
        const [order] = await db.select().from(paymentOrders).where(eq(paymentOrders.id, refundRow.orderId)).limit(1);
        if (order) await markRefundFailed(order, refundRow, '渠道退款回调失败');
      } else {
        await db.update(paymentRefunds).set({ status: 'failed' }).where(and(eq(paymentRefunds.id, refundRow.id), notInArray(paymentRefunds.status, ['success', 'failed'])));
      }
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
    await markOrderClosed(order);
  }
}

/** 业务处理失败时的渠道失败应答：渠道将按各自重试策略再次通知（与验签失败的安全拒绝区分开）。 */
function buildFailureAck(channel: PaymentChannel): NotifyResult['ack'] {
  if (channel === 'wechat') {
    return { body: JSON.stringify({ code: 'FAIL', message: '业务处理失败，请重试' }), contentType: 'application/json', status: 500 };
  }
  return { body: 'failure', contentType: 'text/plain', status: 200 };
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
    // 验签已通过但本地落库失败：返回失败 ACK 让渠道重发通知（幂等保护已就位），避免静默吞错后只能依赖查单兜底
    logger.error('[payment] apply notify failed', { channel, err: errMessage(err) });
    return { ack: buildFailureAck(channel) };
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
  payMethod?: PaymentOrderRow['payMethod'];
  bizType?: string;
  minAmount?: number;
  maxAmount?: number;
  startTime?: string;
  endTime?: string;
}

export async function buildOrdersWhere(q: ListOrdersQuery) {
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
  if (q.payMethod) conditions.push(eq(paymentOrders.payMethod, q.payMethod));
  if (q.bizType) conditions.push(eq(paymentOrders.bizType, q.bizType));
  if (q.minAmount != null) conditions.push(gte(paymentOrders.amount, q.minAmount));
  if (q.maxAmount != null) conditions.push(lte(paymentOrders.amount, q.maxAmount));
  const startTime = parseDateTimeInput(q.startTime);
  const endTime = parseDateTimeInput(q.endTime);
  if (startTime) conditions.push(gte(paymentOrders.createdAt, startTime));
  if (endTime) conditions.push(lte(paymentOrders.createdAt, endTime));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const tc = tenantCondition(paymentOrders, user);
  const scope = await getDataScopeCondition({ currentUserId: user.userId, deptColumn: paymentOrders.departmentId, ownerColumn: paymentOrders.createdBy });
  return mergeWhere(mergeWhere(where, tc), scope);
}

export async function listOrders(q: ListOrdersQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const finalWhere = await buildOrdersWhere(q);
  const [total, list] = await Promise.all([
    db.$count(paymentOrders, finalWhere),
    withPagination(db.select().from(paymentOrders).where(finalWhere).orderBy(desc(paymentOrders.id)).$dynamic(), page, pageSize),
  ]);
  return { list: list.map(mapOrder), total, page, pageSize };
}

export async function getOrderDetail(id: number): Promise<PaymentOrder> {
  const [row] = await db.select().from(paymentOrders).where(await buildOrderIdWhere(id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '支付订单不存在' });
  return mapOrder(row);
}

export async function getOrderDetailByNo(orderNo: string): Promise<PaymentOrder> {
  const [row] = await db.select().from(paymentOrders).where(await buildOrderNoWhere(orderNo)).limit(1);
  if (!row) throw new HTTPException(404, { message: '支付订单不存在' });
  return mapOrder(row);
}

export async function refreshOrderById(id: number): Promise<PaymentOrder> {
  const [row] = await db.select().from(paymentOrders).where(await buildOrderIdWhere(id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '支付订单不存在' });
  return mapOrder(await syncOrderStatus(row));
}

export async function closeOrderById(id: number): Promise<void> {
  const [row] = await db.select({ orderNo: paymentOrders.orderNo }).from(paymentOrders).where(await buildOrderIdWhere(id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '支付订单不存在' });
  await closePayment(row.orderNo);
}

export async function listOrderRefunds(orderId: number): Promise<PaymentRefund[]> {
  const [order] = await db.select({ id: paymentOrders.id }).from(paymentOrders).where(await buildOrderIdWhere(orderId)).limit(1);
  if (!order) throw new HTTPException(404, { message: '支付订单不存在' });
  const rows = await db
    .select()
    .from(paymentRefunds)
    .where(and(eq(paymentRefunds.orderId, order.id), tenantCondition(paymentRefunds, currentUser())))
    .orderBy(desc(paymentRefunds.id));
  return rows.map(mapRefund);
}

export interface ListRefundsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'pending' | 'processing' | 'success' | 'failed';
  approvalStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  channel?: PaymentChannel;
  startTime?: string;
  endTime?: string;
}

export function buildRefundsWhere(q: ListRefundsQuery) {
  const conditions = [];
  if (q.keyword) {
    conditions.push(or(like(paymentRefunds.refundNo, `%${escapeLike(q.keyword)}%`), like(paymentRefunds.orderNo, `%${escapeLike(q.keyword)}%`)));
  }
  if (q.status) conditions.push(eq(paymentRefunds.status, q.status));
  if (q.approvalStatus) conditions.push(eq(paymentRefunds.approvalStatus, q.approvalStatus));
  if (q.channel) conditions.push(eq(paymentRefunds.channel, q.channel));
  const startTime = parseDateTimeInput(q.startTime);
  const endTime = parseDateTimeInput(q.endTime);
  if (startTime) conditions.push(gte(paymentRefunds.createdAt, startTime));
  if (endTime) conditions.push(lte(paymentRefunds.createdAt, endTime));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return mergeWhere(where, tenantCondition(paymentRefunds, currentUser()));
}

export async function listRefunds(q: ListRefundsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const finalWhere = buildRefundsWhere(q);
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

/** 主动向渠道查询退款状态并同步本地（供后台「退款查单」与对账复用） */
export async function refreshRefundById(id: number): Promise<PaymentRefund> {
  const tc = tenantCondition(paymentRefunds, currentUser());
  const [refundRow] = await db.select().from(paymentRefunds).where(and(eq(paymentRefunds.id, id), tc)).limit(1);
  if (!refundRow) throw new HTTPException(404, { message: '退款记录不存在' });
  if (refundRow.status === 'success') return mapRefund(refundRow);

  const [order] = await db.select().from(paymentOrders).where(eq(paymentOrders.orderNo, refundRow.orderNo)).limit(1);
  if (!order) throw new HTTPException(404, { message: '原支付订单不存在' });
  const config = await loadOrderConfig(order);
  if (!config) throw new HTTPException(400, { message: '支付渠道配置不存在，无法查单' });

  let res;
  try {
    res = await getAdapter(refundRow.channel).queryRefund(buildAdapterContext(config), refundRow, order);
  } catch (err) {
    logger.warn('[payment] query refund failed', { refundNo: refundRow.refundNo, err: errMessage(err) });
    throw new HTTPException(502, { message: `退款查单失败：${errMessage(err)}` });
  }

  if (res.status === 'success') {
    const updated = await db
      .update(paymentRefunds)
      .set({ status: 'success', refundedAt: res.refundedAt ?? new Date(), channelRefundNo: res.channelRefundNo ?? refundRow.channelRefundNo })
      .where(and(eq(paymentRefunds.id, refundRow.id), ne(paymentRefunds.status, 'success')))
      .returning();
    if (updated.length > 0) await finalizeRefund(order, refundRow.refundNo, refundRow.refundAmount);
  } else if (res.status === 'failed') {
    await markRefundFailed(order, refundRow, '渠道退款查单失败');
  } else if (res.channelRefundNo && res.channelRefundNo !== refundRow.channelRefundNo) {
    await db.update(paymentRefunds).set({ channelRefundNo: res.channelRefundNo }).where(eq(paymentRefunds.id, refundRow.id));
  }

  const [latest] = await db.select().from(paymentRefunds).where(eq(paymentRefunds.id, refundRow.id)).limit(1);
  return mapRefund(latest ?? refundRow);
}

export interface ListNotifyLogsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  channel?: PaymentChannel;
  scene?: string;
  signatureValid?: boolean;
  startTime?: string;
  endTime?: string;
}

export async function listNotifyLogs(q: ListNotifyLogsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conditions = [];
  if (q.keyword) conditions.push(like(paymentNotifyLogs.orderNo, `%${escapeLike(q.keyword)}%`));
  if (q.channel) conditions.push(eq(paymentNotifyLogs.channel, q.channel));
  if (q.scene) conditions.push(eq(paymentNotifyLogs.scene, q.scene));
  if (q.signatureValid != null) conditions.push(eq(paymentNotifyLogs.signatureValid, q.signatureValid));
  const startTime = parseDateTimeInput(q.startTime);
  const endTime = parseDateTimeInput(q.endTime);
  if (startTime) conditions.push(gte(paymentNotifyLogs.createdAt, startTime));
  if (endTime) conditions.push(lte(paymentNotifyLogs.createdAt, endTime));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const finalWhere = mergeWhere(where, tenantCondition(paymentNotifyLogs, currentUser()));
  const [total, list] = await Promise.all([
    db.$count(paymentNotifyLogs, finalWhere),
    withPagination(db.select().from(paymentNotifyLogs).where(finalWhere).orderBy(desc(paymentNotifyLogs.id)).$dynamic(), page, pageSize),
  ]);
  return { list: list.map(mapNotifyLog), total, page, pageSize };
}

// ─── 纯函数：可供单测直接导入 ──────────────────────────────────────────────────

/**
 * 计算指定退款记录列表中的"已锁定退款总额"（待审批/处理中/成功均占用可退余额）。
 * 纯函数，无副作用，可独立单测。
 */
export function calcLockedRefundAmount(refunds: Array<{ amount: number; status: string }>): number {
  return refunds
    .filter((r) => r.status === 'pending' || r.status === 'processing' || r.status === 'success')
    .reduce((s, r) => s + r.amount, 0);
}

// ─── 渠道连通性测试 ─────────────────────────────────────────────────────────────

/**
 * 对指定渠道配置发起轻量探测请求（查询一个不存在的订单号），
 * 验证商户凭据（API Key / 私钥 / 商户号等）是否正确。
 * @returns { success, message, latencyMs }
 */
export async function testChannelConnectivity(
  id: number,
): Promise<{ success: boolean; message: string; latencyMs: number }> {
  const { ensureChannelConfigExists } = await import('./payment-channels.service');
  const config = await ensureChannelConfigExists(id);
  const adapter = getAdapter(config.channel as PaymentChannel);
  if (!adapter.testConnectivity) {
    return { success: false, message: `渠道 ${config.channel} 暂不支持连通性测试`, latencyMs: 0 };
  }
  const ctx = buildAdapterContext(config);
  const start = Date.now();
  try {
    await adapter.testConnectivity(ctx);
    return { success: true, message: '连通性测试通过（凭据有效）', latencyMs: Date.now() - start };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof HTTPException ? err.message : String(err);
    return { success: false, message: `连通性测试失败：${msg}`, latencyMs };
  }
}
