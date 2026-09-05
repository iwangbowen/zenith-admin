/**
 * 支付中心门面 Service。
 *
 * 业务模块统一入口：createPayment / queryPayment / refund / closePayment。
 * 内部负责：解析渠道配置、解密密钥组装 AdapterContext、订单状态机、事务落库、
 * 回调验签后处理、发支付事件。所有渠道差异封装在适配器内，业务层无感知。
 */
import { and, desc, eq, gte, inArray, isNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { createHash, randomInt } from 'node:crypto';
import { db } from '../../db';
import {
  paymentChannelConfigs,
  paymentApps,
  paymentNotifyLogs,
  paymentOrders,
  paymentRefunds,
  paymentSharingOrders,
  users,
  type PaymentChannelConfigRow,
  type PaymentNotifyLogRow,
  type PaymentOrderRow,
  type PaymentRefundRow,
} from '../../db/schema';
import { config } from '../../config';
import { currentUser, currentUserOrNull } from '../../lib/context';
import { requireTenantScopeId, tenantCondition } from '../../lib/tenant';
import { getDataScopeCondition } from '../../lib/data-scope';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { decryptField } from '../../lib/encryption';
import { isPgUniqueViolation } from '../../lib/db-errors';
import { getSettings } from '../../lib/settings';
import logger from '../../lib/logger';
import { PAYMENT_METHOD_CHANNEL } from '@zenith/shared/payment';
import type { CreatePaymentInput, CreatePaymentResult, CreateRefundInput, PaymentChannel, PaymentNotifyLog, PaymentOrder, PaymentOrderStatus, PaymentRefund } from '@zenith/shared/payment';
import { getAdapter } from '../../lib/payment';
import type { AdapterContext, DecryptedSecrets, NotifyResult } from '../../lib/payment';
import type { PaymentEvent, PaymentEventType } from '../../lib/payment-event-bus';
import { recordEvent, processEvent } from './payment-outbox.service';
import { assertMethodEnabled } from './payment-method.service';
import { assertNoPendingRiskReview, evaluateRisk, recordRiskHit, suspendOrderForReview, type RiskCheckInput } from './payment-risk.service';
import { lockCouponForPayment, releaseCouponForPayment, type CouponLockResult } from './payment-coupon.service';
import { resolveApplicationChannelConfig } from './payment-apps.service';
import { assertPaymentEngineConfig, resolvePaymentChannelConfig } from './payment-channel-config-resolver';
import type { DbExecutor } from '../../db/types';
import { assertEffectivePaymentOperation } from './payment-capability-evaluator';

// ─── 工具 ─────────────────────────────────────────────────────────────────────

function genNo(prefix: string): string {
  return `${prefix}${Date.now()}${randomInt(1000, 9999)}`;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : '未知错误';
}

function resolveNotifyUrl(channel: PaymentChannel, config: PaymentChannelConfigRow): string {
  const base = (config.notifyUrl || process.env.PAYMENT_NOTIFY_BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/api/public/payment/notify/${channel}/${config.callbackToken}`;
}

/**
 * 校验回调地址为公网 http(s) 绝对地址；下单/退款前调用，缺失时快速报错而非让渠道接口报晦涩错误。
 * 沙箱渠道豁免：模拟实现不产生真实渠道回调，不应因缺少公网地址阻断联调/演示。
 */
function assertNotifyUrl(notifyUrl: string, sandbox: boolean): void {
  if (sandbox) return;
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
    sandboxNotifySecret: decryptField(config.sandboxNotifySecretEncrypted) ?? undefined,
  };
  return { config, secrets, notifyUrl: resolveNotifyUrl(config.channel, config) };
}

async function resolveChannelConfig(channel: PaymentChannel, channelConfigId?: number, tenantId?: number | null): Promise<PaymentChannelConfigRow> {
  const tc = channelConfigTenantCondition(tenantId) ?? (currentUserOrNull() ? tenantCondition(paymentChannelConfigs, currentUser()) : undefined);
  return resolvePaymentChannelConfig({ channel, channelConfigId, scope: tc });
}

async function assertPaymentOperation(
  configRow: PaymentChannelConfigRow,
  operation: Parameters<typeof assertEffectivePaymentOperation>[0]['operation'],
  payMethod?: PaymentOrderRow['payMethod'],
  currency = 'CNY',
  options?: { recovery?: boolean },
): Promise<void> {
  await assertEffectivePaymentOperation({
    configRow,
    operation,
    method: payMethod,
    currency,
    recovery: options?.recovery,
  });
}

/** 根据订单快照精确加载渠道配置，禁止按渠道回退到其他商户账户。 */
export async function loadOrderConfig(order: PaymentOrderRow): Promise<PaymentChannelConfigRow | null> {
  const tenantScope = order.tenantId == null
    ? isNull(paymentChannelConfigs.tenantId)
    : eq(paymentChannelConfigs.tenantId, order.tenantId);
  const [row] = await db
    .select()
    .from(paymentChannelConfigs)
    .where(and(
      eq(paymentChannelConfigs.id, order.channelConfigId),
      eq(paymentChannelConfigs.channel, order.channel),
      tenantScope,
    ))
    .limit(1);
  return row ?? null;
}

/** 订单 → 渠道配置的解析函数；批量任务可传入带缓存的实现替换默认的逐单查询 */
export type OrderConfigResolver = (order: PaymentOrderRow) => Promise<PaymentChannelConfigRow | null>;

/**
 * 批量任务专用的渠道配置解析器：一批订单通常只落在少数几份配置上，
 * 逐单调用 `loadOrderConfig` 会把同一份配置反复查回来。
 *
 * 缓存键取 `channelConfigId + channel + tenantId`，三者共同构成订单绑定的商户身份。
 * 每个任务实例独立 new，不跨任务复用，避免长驻缓存读到过期配置。
 */
export function createOrderConfigResolver(): OrderConfigResolver {
  const cache = new Map<string, Promise<PaymentChannelConfigRow | null>>();
  return (order) => {
    const key = `${order.channelConfigId}|${order.channel}|${order.tenantId ?? 'global'}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = loadOrderConfig(order);
    cache.set(key, pending);
    // 失败不留缓存：一次数据库抖动不应让整批后续订单直接复用这次失败
    void pending.catch(() => cache.delete(key));
    return pending;
  };
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
  return buildWhere(buildWhere(eq(paymentOrders.id, id), tenantCondition(paymentOrders, user)), scope);
}

async function buildOrderNoWhere(orderNo: string) {
  const user = currentUser();
  const scope = await getDataScopeCondition({ currentUserId: user.userId, deptColumn: paymentOrders.departmentId, ownerColumn: paymentOrders.createdBy });
  return buildWhere(buildWhere(eq(paymentOrders.orderNo, orderNo), tenantCondition(paymentOrders, user)), scope);
}

function buildEventPayload(type: PaymentEventType, order: PaymentOrderRow, extra?: { refundNo?: string; refundAmount?: number }): Omit<PaymentEvent, 'eventId' | 'occurredAt'> {
  return {
    type,
    orderNo: order.orderNo,
    outTradeNo: order.outTradeNo,
    bizType: order.bizType,
    bizId: order.bizId,
    channel: order.channel,
    channelConfigId: order.channelConfigId,
    payMethod: order.payMethod,
    appId: order.appId,
    currency: order.currency,
    amount: order.paidAmount ?? order.amount,
    originalAmount: order.originalAmount ?? null,
    userId: order.userId,
    tenantId: order.tenantId,
    refundNo: extra?.refundNo,
    refundAmount: extra?.refundAmount,
  };
}

function enqueuePaymentEvent(eventId: number | null): void {
  if (eventId == null) return;
  setImmediate(() => {
    void processEvent(eventId).catch((err) => logger.error('[payment] process event failed', { eventId, err: errMessage(err) }));
  });
}

async function markOrderClosed(order: PaymentOrderRow): Promise<void> {
  const eventId = await db.transaction(async (tx) => {
    const updated = await tx
      .update(paymentOrders)
      .set({ status: 'closed', version: sql`${paymentOrders.version} + 1` })
      .where(and(
        eq(paymentOrders.id, order.id),
        eq(paymentOrders.version, order.version),
        inArray(paymentOrders.status, ['pending', 'paying', 'unknown']),
      ))
      .returning();
    if (updated.length === 0) return null;
    const finalOrder = updated[0];
    return recordEvent(tx, { type: 'payment.closed', orderNo: finalOrder.orderNo, tenantId: finalOrder.tenantId, payload: buildEventPayload('payment.closed', finalOrder) });
  });
  enqueuePaymentEvent(eventId);
}

async function recomputeOrderRefundState(executor: DbExecutor, orderId: number): Promise<PaymentOrderStatus> {
  await executor.execute(sql`SELECT id FROM payment_orders WHERE id = ${orderId} FOR UPDATE`);
  const [order] = await executor
    .select({ amount: paymentOrders.amount, status: paymentOrders.status })
    .from(paymentOrders)
    .where(eq(paymentOrders.id, orderId))
    .limit(1);
  if (!order) throw new HTTPException(404, { message: '原支付订单不存在' });
  const refunds = await executor
    .select({ amount: paymentRefunds.refundAmount, status: paymentRefunds.status })
    .from(paymentRefunds)
    .where(eq(paymentRefunds.orderId, orderId));
  const hasActive = refunds.some((item) => ['pending', 'processing', 'unknown'].includes(item.status));
  const successTotal = refunds
    .filter((item) => item.status === 'success')
    .reduce((sum, item) => sum + BigInt(item.amount), 0n);
  const nextStatus: PaymentOrderStatus = hasActive
    ? 'refunding'
    : successTotal >= BigInt(order.amount)
      ? 'refunded'
      : 'success';
  if (order.status !== nextStatus) {
    await executor
      .update(paymentOrders)
      .set({ status: nextStatus, version: sql`${paymentOrders.version} + 1` })
      .where(and(eq(paymentOrders.id, orderId), inArray(paymentOrders.status, ['success', 'refunding', 'refunded'])));
  }
  return nextStatus;
}

async function markRefundFailed(order: PaymentOrderRow, refund: Pick<PaymentRefundRow, 'id' | 'refundNo' | 'refundAmount'>, message?: string): Promise<void> {
  const setValues: Partial<PaymentRefundRow> = { status: 'failed' };
  if (message) setValues.errorMessage = message.slice(0, 500);
  const eventId = await db.transaction(async (tx) => {
    const updated = await tx
      .update(paymentRefunds)
      .set({ ...setValues, version: sql`${paymentRefunds.version} + 1` })
      .where(and(eq(paymentRefunds.id, refund.id), notInArray(paymentRefunds.status, ['success', 'failed'])))
      .returning({ id: paymentRefunds.id });
    if (updated.length === 0) return null;
    await recomputeOrderRefundState(tx, order.id);
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
    channelConfigId: row.channelConfigId,
    appId: row.appId,
    payMethod: row.payMethod,
    status: row.status,
    userId: row.userId ?? null,
    openId: row.openId ?? null,
    clientIp: row.clientIp ?? null,
    departmentId: row.departmentId ?? null,
    paidAmount: row.paidAmount ?? null,
    feeAmount: row.feeAmount ?? null,
    netAmount: row.netAmount ?? null,
    originalAmount: row.originalAmount ?? null,
    discountAmount: row.discountAmount ?? null,
    memberCouponId: row.memberCouponId ?? null,
    paidAt: formatNullableDateTime(row.paidAt),
    expiredAt: formatNullableDateTime(row.expiredAt),
    returnUrl: row.returnUrl ?? null,
    errorMessage: row.errorMessage ?? null,
    version: row.version,
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
    orderId: row.orderId,
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
    version: row.version,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapNotifyLog(row: PaymentNotifyLogRow): PaymentNotifyLog {
  return {
    id: row.id,
    channel: row.channel,
    channelConfigId: row.channelConfigId,
    appId: row.appId ?? null,
    providerEventId: row.providerEventId ?? null,
    scene: row.scene,
    orderNo: row.orderNo ?? null,
    signatureValid: row.signatureValid,
    merchantId: row.merchantId ?? null,
    providerAppId: row.providerAppId ?? null,
    paidAmount: row.paidAmount ?? null,
    currency: row.currency ?? null,
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
  idempotencyKey?: string;
  /** 服务端构造的同步回跳地址，仅允许与 PAYMENT_CASHIER_BASE_URL 同源。 */
  returnUrl?: string;
  /** 支付立减：使用的会员券 id（须与 couponMemberId 成对传入，由会员侧业务入口组装） */
  memberCouponId?: number;
  /** 券归属会员 id（锁券校验归属，防串用他人券） */
  couponMemberId?: number;
}

interface PaymentOrderScope {
  tenantId: number | null;
  appId: number | null;
  currency: string;
}

function orderScopeConditions(scope: PaymentOrderScope) {
  return [
    scope.tenantId == null ? isNull(paymentOrders.tenantId) : eq(paymentOrders.tenantId, scope.tenantId),
    scope.appId == null ? isNull(paymentOrders.appId) : eq(paymentOrders.appId, scope.appId),
    eq(paymentOrders.currency, scope.currency),
  ];
}

function hashPaymentRequest(input: InternalCreatePaymentInput, scope: PaymentOrderScope, channelConfigId: number, userId: number | null): string {
  return createHash('sha256').update(JSON.stringify({
    tenantId: scope.tenantId,
    appId: scope.appId,
    channelConfigId,
    bizType: input.bizType,
    bizId: input.bizId,
    subject: input.subject.trim(),
    body: input.body?.trim() || null,
    amount: input.amount,
    currency: scope.currency,
    payMethod: input.payMethod,
    openId: input.openId?.trim() || null,
    userId,
    expireMinutes: input.expireMinutes ?? 30,
    memberCouponId: input.memberCouponId ?? null,
    couponMemberId: input.couponMemberId ?? null,
    returnUrl: input.returnUrl ?? null,
  })).digest('hex');
}

/** 查找同租户、应用、币种和业务单的活跃订单，与 payment_orders_active_biz_uq 对应。 */
async function findActiveBizOrder(input: InternalCreatePaymentInput, scope: PaymentOrderScope): Promise<PaymentOrderRow | null> {
  const [row] = await db
    .select()
    .from(paymentOrders)
    .where(and(
      ...orderScopeConditions(scope),
      eq(paymentOrders.bizType, input.bizType),
      eq(paymentOrders.bizId, input.bizId),
      inArray(paymentOrders.status, ['pending', 'paying', 'unknown']),
    ))
    .limit(1);
  return row ?? null;
}

async function findIdempotentOrder(key: string, scope: PaymentOrderScope): Promise<PaymentOrderRow | null> {
  const [row] = await db
    .select()
    .from(paymentOrders)
    .where(and(...orderScopeConditions(scope), eq(paymentOrders.idempotencyKey, key)))
    .limit(1);
  return row ?? null;
}

async function markOrderUnknown(order: PaymentOrderRow, error: unknown): Promise<void> {
  await db
    .update(paymentOrders)
    .set({
      status: 'unknown',
      errorMessage: `渠道结果待确认：${errMessage(error)}`.slice(0, 500),
      version: sql`${paymentOrders.version} + 1`,
    })
    .where(and(
      eq(paymentOrders.id, order.id),
      eq(paymentOrders.version, order.version),
      inArray(paymentOrders.status, ['pending', 'paying']),
    ));
}

/**
 * 下单业务幂等：同 bizType+bizId 已存在未过期活跃单时直接复用（重新生成支付参数，渠道侧同 outTradeNo 幂等）；
 * 金额/支付方式变化或已过期时，先主动查单防边界支付，再关闭旧单放行新建。
 * 返回 null 表示无可复用订单（调用方继续新建流程）。
 */
async function reuseActiveBizOrder(input: InternalCreatePaymentInput, scope: PaymentOrderScope): Promise<{ orderNo: string; payParams: CreatePaymentResult } | null> {
  let existing = await findActiveBizOrder(input, scope);
  if (!existing) return null;

  if (existing.status === 'unknown') {
    existing = await syncOrderStatus(existing);
    if (existing.status === 'unknown') {
      throw new HTTPException(409, { message: `该业务单渠道结果待确认，请先查单（订单号 ${existing.orderNo}）` });
    }
  }

  const expired = existing.expiredAt != null && existing.expiredAt.getTime() <= Date.now();
  const requestHash = hashPaymentRequest(input, scope, existing.channelConfigId, input.userId ?? currentUserOrNull()?.userId ?? null);
  const reusable = !expired && existing.requestHash === requestHash;

  if (!reusable) {
    // 参数已变化或旧单过期：先同步渠道状态（防止用户恰好已扫码支付），再清场
    const synced = await syncOrderStatus(existing);
    if (synced.status === 'success' || synced.status === 'refunding' || synced.status === 'refunded') {
      throw new HTTPException(400, { message: `该业务单已支付成功，请勿重复下单（订单号 ${existing.orderNo}）` });
    }
    if (synced.status === 'unknown') {
      throw new HTTPException(409, { message: `该业务单渠道结果待确认，请先查单（订单号 ${existing.orderNo}）` });
    }
    if (synced.status === 'pending' || synced.status === 'paying') {
      const config = await loadOrderConfig(existing);
      if (!config) throw new HTTPException(409, { message: '原订单绑定的商户配置不可用，无法安全关闭' });
      assertPaymentEngineConfig(config);
      try {
        await getAdapter(existing.channel).closePayment(buildAdapterContext(config), existing);
      } catch (err) {
        await markOrderUnknown(existing, err);
        throw new HTTPException(409, { message: `原订单关单结果待确认，禁止创建新订单（订单号 ${existing.orderNo}）` });
      }
      await markOrderClosed(existing);
    }
    return null;
  }

  const config = await loadOrderConfig(existing);
  if (!config) return null;
  assertPaymentEngineConfig(config);
  await assertPaymentOperation(config, 'payment.create', existing.payMethod, existing.currency);
  try {
    const ctx = buildAdapterContext(config);
    assertNotifyUrl(ctx.notifyUrl, config.sandbox);
    const payParams = await getAdapter(existing.channel).createPayment(ctx, existing);
    await db
      .update(paymentOrders)
      .set({ status: 'paying', errorMessage: null, version: sql`${paymentOrders.version} + 1` })
      .where(and(eq(paymentOrders.id, existing.id), eq(paymentOrders.version, existing.version), eq(paymentOrders.status, 'pending')));
    logger.info('[payment] reuse active biz order', { orderNo: existing.orderNo, bizType: input.bizType, bizId: input.bizId });
    return { orderNo: existing.orderNo, payParams };
  } catch (err) {
    // 渠道重下单失败可能因原单已被支付/受理，同步一次状态后再决定
    const synced = await syncOrderStatus(existing);
    if (synced.status === 'success' || synced.status === 'refunding' || synced.status === 'refunded') {
      throw new HTTPException(400, { message: `该业务单已支付成功，请勿重复下单（订单号 ${existing.orderNo}）` });
    }
    await markOrderUnknown(existing, err);
    throw new HTTPException(409, { message: `支付请求结果待确认，请勿重复下单（订单号 ${existing.orderNo}）` });
  }
}

function assertInternalReturnUrl(returnUrl?: string): void {
  if (!returnUrl) return;
  if (returnUrl.length > 512) throw new HTTPException(400, { message: '支付回跳地址过长' });
  let target: URL;
  let cashierBase: URL;
  try {
    target = new URL(returnUrl);
    cashierBase = new URL(config.payment.cashierBaseUrl);
  } catch {
    throw new HTTPException(400, { message: '支付回跳地址格式不正确' });
  }
  if (target.origin !== cashierBase.origin) {
    throw new HTTPException(400, { message: '支付回跳地址必须与收银台配置同源' });
  }
}

export async function createPayment(input: InternalCreatePaymentInput): Promise<{ orderNo: string; payParams: CreatePaymentResult }> {
  assertInternalReturnUrl(input.returnUrl);
  const channel = PAYMENT_METHOD_CHANNEL[input.payMethod];
  if (input.payMethod === 'wechat_jsapi' && !input.openId?.trim()) {
    throw new HTTPException(400, { message: '微信 JSAPI 支付必须提供 OpenID' });
  }
  const user = currentUserOrNull();
  let tenantId: number | null;
  if (input.tenantId !== undefined) {
    tenantId = input.tenantId;
  } else {
    if (!user) throw new HTTPException(500, { message: '内部支付下单必须显式提供租户作用域' });
    tenantId = requireTenantScopeId(user);
  }
  // App 维度：只接受内部可信 applicationId；开放 API 从已验签 principal 注入后再进入门面。
  const resolved = await resolveApplicationChannelConfig(input.applicationId, channel, tenantId);
  const appId = resolved.appId;
  const channelConfigId = resolved.channelConfigId;
  tenantId = resolved.tenantId;
  const currency = input.currency ?? 'CNY';
  const scope: PaymentOrderScope = { tenantId, appId, currency };
  const config = await resolveChannelConfig(channel, channelConfigId, tenantId);
  if ((config.tenantId ?? null) !== tenantId) {
    throw new HTTPException(400, { message: '支付应用、商户配置与订单租户不一致' });
  }
  await assertPaymentOperation(config, 'payment.create', input.payMethod, currency);
  // 回调地址前置校验（fail-fast）：在订单落库前发现配置缺失，避免每次尝试都留下 failed 脏订单
  assertNotifyUrl(resolveNotifyUrl(channel, config), config.sandbox);

  let departmentId: number | null = null;
  if (user) {
    const [creator] = await db.select({ departmentId: users.departmentId }).from(users).where(eq(users.id, user.userId)).limit(1);
    departmentId = creator?.departmentId ?? null;
  }
  const userId = input.userId ?? user?.userId ?? null;

  // ── B 档：支付方式启停校验 ────────────────────────────────────────────────────
  await assertMethodEnabled(input.payMethod, tenantId);

  // ── 风控人工审核前置：同业务单存在待审核记录时禁止重复下单 ─────────────────────
  await assertNoPendingRiskReview({
    bizType: input.bizType,
    bizId: input.bizId,
    tenantId,
    appId,
    currency,
  });

  // ── 业务幂等：同业务单存在活跃订单时直接复用（不重复风控/落单）──────────────────
  const idempotencyKey = input.idempotencyKey?.trim().slice(0, 128) || null;
  const requestHash = hashPaymentRequest(input, scope, config.id, userId);
  if (idempotencyKey) {
    const existing = await findIdempotentOrder(idempotencyKey, scope);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new HTTPException(409, { message: '同一幂等键对应的支付参数不一致' });
      }
      const replayed = await reuseActiveBizOrder(input, scope);
      if (replayed) return replayed;
      throw new HTTPException(409, { message: `该幂等请求已处理（订单号 ${existing.orderNo}，状态 ${existing.status}）` });
    }
  }
  const reused = await reuseActiveBizOrder(input, scope);
  if (reused) return reused;

  // ── B 档：风控评估（仅对真正新建的订单）：block=拦截留痕，review=落单挂起人工审核 ──
  const riskInput: RiskCheckInput = {
    channel,
    bizType: input.bizType,
    bizId: input.bizId,
    amount: input.amount,
    openId: input.openId ?? null,
    userId,
    clientIp: input.clientIp ?? null,
    tenantId,
  };
  const riskDecision = await evaluateRisk(riskInput);
  if (riskDecision.action === 'block') {
    await recordRiskHit(riskDecision, riskInput);
    throw new HTTPException(400, { message: riskDecision.message });
  }

  const orderNo = genNo('PAY');
  const expireMinutes = input.expireMinutes ?? 30;
  const expiredAt = new Date(Date.now() + expireMinutes * 60_000);

  // ── 支付立减：锁券（unused→frozen）并计算实付金额；后续失败路径释放/由事件订阅者释放 ──
  let coupon: CouponLockResult | null = null;
  if (input.memberCouponId != null) {
    if (input.couponMemberId == null) throw new HTTPException(400, { message: '用券支付缺少会员上下文' });
    coupon = await lockCouponForPayment(input.memberCouponId, input.couponMemberId, input.amount);
  }
  const payAmount = coupon ? input.amount - coupon.discount : input.amount;

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
        amount: payAmount,
        originalAmount: coupon ? input.amount : null,
        discountAmount: coupon ? coupon.discount : null,
        memberCouponId: coupon ? coupon.memberCouponId : null,
        currency,
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
        returnUrl: input.returnUrl ?? null,
        tenantId,
        idempotencyKey,
        requestHash,
      })
      .returning();
  } catch (err) {
    // 落库失败：立即释放刚锁定的券（订单不存在，事件订阅者不会兜底）
    if (coupon) await releaseCouponForPayment(coupon.memberCouponId);
    // 并发下单撞 payment_orders_active_biz_uq：复用对方刚创建的活跃单
    if (isPgUniqueViolation(err)) {
      if (idempotencyKey) {
        const duplicate = await findIdempotentOrder(idempotencyKey, scope);
        if (duplicate && duplicate.requestHash !== requestHash) {
          throw new HTTPException(409, { message: '同一幂等键对应的支付参数不一致' });
        }
      }
      const raced = await reuseActiveBizOrder(input, scope);
      if (raced) return raced;
      throw new HTTPException(400, { message: '该业务单存在处理中的支付订单，请稍后重试' });
    }
    throw err;
  }

  // ── review 动作：订单落库后挂起（不调渠道），生成人工审核单等待处理 ─────────────
  if (riskDecision.action === 'review') {
    const review = await suspendOrderForReview(orderRow, riskDecision, riskInput);
    throw new HTTPException(400, { message: `交易已触发风控人工审核（审核单 ${review.reviewNo}），审核通过后请重新发起支付` });
  }

  try {
    const ctx = buildAdapterContext(config);
    const payParams = await getAdapter(channel).createPayment(ctx, orderRow);
    await db
      .update(paymentOrders)
      .set({ status: 'paying', version: sql`${paymentOrders.version} + 1` })
      .where(and(eq(paymentOrders.id, orderRow.id), eq(paymentOrders.version, orderRow.version), eq(paymentOrders.status, 'pending')));
    return { orderNo, payParams };
  } catch (err) {
    await markOrderUnknown(orderRow, err);
    throw new HTTPException(502, { message: `支付请求结果待确认，请通过订单号 ${orderNo} 查单` });
  }
}

// ─── 标记支付成功 / 状态同步 ───────────────────────────────────────────────────

export async function markOrderPaid(
  order: PaymentOrderRow,
  info: { channelTradeNo?: string; paidAmount?: number; paidAt?: Date; notifyData?: string },
): Promise<boolean> {
  const paidAmount = info.paidAmount ?? order.amount;
  if (paidAmount !== order.amount) {
    throw new HTTPException(409, { message: `支付金额不一致：订单 ${order.amount} 分，渠道 ${paidAmount} 分` });
  }
  // 原子条件更新 + outbox 事件同事务持久化：确保「标记成功 + 可靠发事件」exactly-once，
  // 即使进程在发事件前崩溃，cron 也会从 outbox 补投，杜绝漏履约。
  const eventId = await db.transaction(async (tx) => {
    const updated = await tx
      .update(paymentOrders)
      .set({
        status: 'success',
        channelTradeNo: info.channelTradeNo ?? order.channelTradeNo,
        paidAmount,
        paidAt: info.paidAt ?? new Date(),
        notifyData: info.notifyData ?? order.notifyData,
        errorMessage: null,
        version: sql`${paymentOrders.version} + 1`,
      })
      .where(and(
        eq(paymentOrders.id, order.id),
        eq(paymentOrders.version, order.version),
        inArray(paymentOrders.status, ['pending', 'paying', 'unknown']),
      ))
      .returning();
    if (updated.length === 0) return null; // 已被并发处理，幂等跳过
    const finalOrder = updated[0];
    return recordEvent(tx, { type: 'payment.succeeded', orderNo: finalOrder.orderNo, tenantId: finalOrder.tenantId, payload: buildEventPayload('payment.succeeded', finalOrder) });
  });
  if (eventId == null) return false;
  enqueuePaymentEvent(eventId);
  return true;
}

class ProviderResultMismatchError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ProviderResultMismatchError';
  }
}

type ProviderIdentityResult = Pick<NotifyResult, 'merchantId' | 'providerAppId' | 'paidAmount' | 'currency'>;

function expectedProviderIdentity(configRow: PaymentChannelConfigRow): { merchantId: string; providerAppId?: string } {
  const sandboxMerchantId = `sandbox-merchant-${configRow.id}`;
  const sandboxAppId = `sandbox-app-${configRow.id}`;
  if (configRow.channel === 'wechat') {
    return {
      merchantId: configRow.wechatMchId || (configRow.sandbox ? sandboxMerchantId : ''),
      providerAppId: configRow.wechatAppId || (configRow.sandbox ? sandboxAppId : ''),
    };
  }
  if (configRow.channel === 'alipay') {
    return {
      merchantId: configRow.alipaySellerId || (configRow.sandbox ? sandboxMerchantId : ''),
      providerAppId: configRow.alipayAppId || (configRow.sandbox ? sandboxAppId : ''),
    };
  }
  return { merchantId: configRow.unionpayMerId || (configRow.sandbox ? sandboxMerchantId : '') };
}

async function assertProviderResultMatchesOrder(
  configRow: PaymentChannelConfigRow,
  order: PaymentOrderRow,
  result: ProviderIdentityResult,
  expectedAmount?: number,
): Promise<void> {
  if (order.channelConfigId !== configRow.id || (order.tenantId ?? null) !== (configRow.tenantId ?? null)) {
    throw new ProviderResultMismatchError('CONFIG_MISMATCH', '回调商户配置或租户与订单不一致');
  }
  if (order.appId != null) {
    const tenantScope = order.tenantId == null ? isNull(paymentApps.tenantId) : eq(paymentApps.tenantId, order.tenantId);
    const [app] = await db
      .select({ id: paymentApps.id })
      .from(paymentApps)
      .where(and(eq(paymentApps.id, order.appId), tenantScope))
      .limit(1);
    if (!app) throw new ProviderResultMismatchError('APPLICATION_MISMATCH', '订单归属支付应用不存在或租户不一致');
  }

  const expected = expectedProviderIdentity(configRow);
  if (!expected.merchantId || !result.merchantId || result.merchantId !== expected.merchantId) {
    throw new ProviderResultMismatchError('MERCHANT_MISMATCH', '渠道商户身份与订单绑定配置不一致');
  }
  if (expected.providerAppId && result.providerAppId !== expected.providerAppId) {
    throw new ProviderResultMismatchError('PROVIDER_APP_MISMATCH', '渠道应用身份与订单绑定配置不一致');
  }
  if (expectedAmount !== undefined) {
    if (result.paidAmount == null || result.paidAmount !== expectedAmount) {
      throw new ProviderResultMismatchError('AMOUNT_MISMATCH', `渠道金额与预期金额不一致（预期 ${expectedAmount} 分）`);
    }
    if (!result.currency || result.currency.toUpperCase() !== order.currency.toUpperCase()) {
      throw new ProviderResultMismatchError('CURRENCY_MISMATCH', `渠道币种与订单币种不一致（订单 ${order.currency}）`);
    }
  }
}

async function markOrderFailedAfterQuery(order: PaymentOrderRow): Promise<PaymentOrderRow> {
  const result = await db.transaction(async (tx) => {
    const [failed] = await tx
      .update(paymentOrders)
      .set({ status: 'failed', errorMessage: '渠道查单确认支付失败', version: sql`${paymentOrders.version} + 1` })
      .where(and(
        eq(paymentOrders.id, order.id),
        eq(paymentOrders.version, order.version),
        inArray(paymentOrders.status, ['pending', 'paying', 'unknown']),
      ))
      .returning();
    if (!failed) return { row: order, eventId: null };
    const eventId = await recordEvent(tx, {
      type: 'payment.failed',
      orderNo: failed.orderNo,
      tenantId: failed.tenantId,
      payload: buildEventPayload('payment.failed', failed),
    });
    return { row: failed, eventId };
  });
  enqueuePaymentEvent(result.eventId);
  return result.row;
}

/** 主动查单并同步本地状态（回调兜底，供查单接口与对账任务复用） */
export async function syncOrderStatus(order: PaymentOrderRow, resolveConfig: OrderConfigResolver = loadOrderConfig): Promise<PaymentOrderRow> {
  if (order.status === 'success' || order.status === 'closed' || order.status === 'refunded') return order;
  const config = await resolveConfig(order);
  if (!config) return order;
  assertPaymentEngineConfig(config, { recovery: true });
  await assertPaymentOperation(config, 'payment.query', order.payMethod, order.currency, { recovery: true });
  let res;
  try {
    res = await getAdapter(order.channel).queryPayment(buildAdapterContext(config), order);
  } catch (err) {
    logger.warn('[payment] query failed', { orderNo: order.orderNo, err: errMessage(err) });
    return order;
  }
  if (res.status === 'success') {
    await assertProviderResultMatchesOrder(config, order, res, order.amount);
    await markOrderPaid(order, { channelTradeNo: res.channelTradeNo, paidAmount: res.paidAmount, paidAt: res.paidAt });
    return (await db.select().from(paymentOrders).where(eq(paymentOrders.id, order.id)).limit(1))[0] ?? order;
  }
  if (res.status === 'closed') {
    await markOrderClosed(order);
    return (await db.select().from(paymentOrders).where(eq(paymentOrders.id, order.id)).limit(1))[0] ?? order;
  }
  if (res.status === 'failed') {
    return markOrderFailedAfterQuery(order);
  }
  if (order.status === 'unknown') {
    const [pending] = await db
      .update(paymentOrders)
      .set({ status: 'paying', errorMessage: null, version: sql`${paymentOrders.version} + 1` })
      .where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.version, order.version), eq(paymentOrders.status, 'unknown')))
      .returning();
    return pending ?? order;
  }
  return order;
}

/** 定时过期任务的安全关单入口：查单与关单均明确成功后才落本地 closed + Outbox。 */
export async function closeExpiredOrderSafely(
  order: PaymentOrderRow,
  resolveConfig: OrderConfigResolver = loadOrderConfig,
): Promise<boolean> {
  const synced = await syncOrderStatus(order, resolveConfig);
  if (synced.status !== 'pending' && synced.status !== 'paying') return false;
  const config = await resolveConfig(synced);
  if (!config) throw new HTTPException(409, { message: '订单绑定的商户配置不可用，无法安全关单' });
  assertPaymentEngineConfig(config, { recovery: true });
  await assertPaymentOperation(config, 'payment.close', synced.payMethod, synced.currency, { recovery: true });
  try {
    await getAdapter(synced.channel).closePayment(buildAdapterContext(config), synced);
  } catch (err) {
    await markOrderUnknown(synced, err);
    throw new HTTPException(409, { message: '渠道关单结果待确认，本地订单保持未终结' });
  }
  await markOrderClosed(synced);
  return true;
}

// ─── 查单 / 关单（门面，供业务模块按 orderNo 调用）─────────────────────────────

export async function queryPayment(orderNo: string): Promise<PaymentOrder> {
  const order = await getOrderRowByNo(orderNo);
  return mapOrder(await syncOrderStatus(order));
}

export async function closePayment(orderNo: string): Promise<void> {
  let order = await getOrderRowByNo(orderNo);
  if (order.status === 'unknown') order = await syncOrderStatus(order);
  if (order.status !== 'pending' && order.status !== 'paying') {
    throw new HTTPException(400, { message: '当前订单状态无法关闭' });
  }
  const config = await loadOrderConfig(order);
  if (!config) throw new HTTPException(409, { message: '订单绑定的商户配置不可用，无法安全关单' });
  assertPaymentEngineConfig(config);
  await assertPaymentOperation(config, 'payment.close', order.payMethod, order.currency);
  try {
    await getAdapter(order.channel).closePayment(buildAdapterContext(config), order);
  } catch (err) {
    await markOrderUnknown(order, err);
    throw new HTTPException(409, { message: '渠道关单结果待确认，请先查单' });
  }
  await markOrderClosed(order);
}

// ─── 退款 ─────────────────────────────────────────────────────────────────────

/**
 * 退款成功统一收口（单事务原子化）：
 * 1) 条件更新退款单置 success（幂等 claim，并发下只有一方生效）；
 * 2) 同事务汇总成功退款重算订单状态（退满 → refunded，部分退 → 回到 success）；
 * 3) 同事务写 refund.succeeded Outbox 事件。
 * 渠道受理、异步回调、主动查单三条路径共用，杜绝「退款单已成功但订单状态/事件丢失」的中间态。
 */
async function settleRefundSuccess(
  order: PaymentOrderRow,
  refund: Pick<PaymentRefundRow, 'id' | 'refundNo' | 'refundAmount'>,
  patch: { channelRefundNo?: string | null; refundedAt?: Date; notifyData?: string | null } = {},
): Promise<boolean> {
  const eventId = await db.transaction(async (tx) => {
    const setValues: Partial<PaymentRefundRow> = {
      status: 'success',
      refundedAt: patch.refundedAt ?? new Date(),
    };
    if (patch.channelRefundNo !== undefined && patch.channelRefundNo !== null) setValues.channelRefundNo = patch.channelRefundNo;
    if (patch.notifyData !== undefined) setValues.notifyData = patch.notifyData;
    const claimed = await tx
      .update(paymentRefunds)
      .set({ ...setValues, version: sql`${paymentRefunds.version} + 1` })
      .where(and(eq(paymentRefunds.id, refund.id), ne(paymentRefunds.status, 'success')))
      .returning({ id: paymentRefunds.id });
    if (claimed.length === 0) return null; // 已被并发处理，幂等跳过

    await recomputeOrderRefundState(tx, order.id);
    return recordEvent(tx, { type: 'refund.succeeded', orderNo: order.orderNo, tenantId: order.tenantId, payload: buildEventPayload('refund.succeeded', order, { refundNo: refund.refundNo, refundAmount: refund.refundAmount }) });
  });
  if (eventId == null) return false;
  enqueuePaymentEvent(eventId);
  return true;
}

/** 执行渠道退款并落库（审批通过或免审批后调用）。失败时回滚订单状态并抛出。 */
async function executeChannelRefund(
  order: PaymentOrderRow,
  refundRow: PaymentRefundRow,
  config: PaymentChannelConfigRow,
): Promise<{ refundNo: string; status: string }> {
  assertPaymentEngineConfig(config);
  await assertPaymentOperation(config, 'refund.create', order.payMethod, order.currency);
  try {
    const ctx = buildAdapterContext(config);
    assertNotifyUrl(ctx.notifyUrl, config.sandbox);
    const res = await getAdapter(order.channel).refund(ctx, order, refundRow);

    if (res.status === 'success') {
      // 单事务收口：退款单置 success + 订单状态流转 + refund.succeeded 事件原子持久化
      await settleRefundSuccess(order, refundRow, { channelRefundNo: res.channelRefundNo ?? null });
    } else if (res.status === 'failed') {
      await db.update(paymentRefunds).set({ channelRefundNo: res.channelRefundNo ?? null }).where(eq(paymentRefunds.id, refundRow.id));
      await markRefundFailed(order, refundRow, '渠道退款失败');
    } else {
      await db
        .update(paymentRefunds)
        .set({ status: res.status, channelRefundNo: res.channelRefundNo ?? null, refundedAt: null, version: sql`${paymentRefunds.version} + 1` })
        .where(and(eq(paymentRefunds.id, refundRow.id), inArray(paymentRefunds.status, ['pending', 'processing'])));
    }
    return { refundNo: refundRow.refundNo, status: res.status };
  } catch (err) {
    const [unknownRefund] = await db
      .update(paymentRefunds)
      .set({
        status: 'unknown',
        errorMessage: `渠道结果待确认：${errMessage(err)}`.slice(0, 500),
        version: sql`${paymentRefunds.version} + 1`,
      })
      .where(and(
        eq(paymentRefunds.id, refundRow.id),
        eq(paymentRefunds.version, refundRow.version),
        inArray(paymentRefunds.status, ['pending', 'processing']),
      ))
      .returning({ status: paymentRefunds.status });
    if (unknownRefund) return { refundNo: refundRow.refundNo, status: unknownRefund.status };
    const [latest] = await db
      .select({ status: paymentRefunds.status })
      .from(paymentRefunds)
      .where(eq(paymentRefunds.id, refundRow.id))
      .limit(1);
    return { refundNo: refundRow.refundNo, status: latest?.status ?? 'unknown' };
  }
}

/** 退款审批金额阈值（分）；≥阈值需审批，0=不审批。来源：运行时设置 payment.refundApprovalThreshold，按订单所属租户解析（未覆盖继承平台）。 */
async function refundApprovalThreshold(tenantId: number | null): Promise<number> {
  const v = (await getSettings('payment', { tenantId })).refundApprovalThreshold;
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
}

function hashRefundRequest(input: CreateRefundInput): string {
  return createHash('sha256').update(JSON.stringify({
    orderNo: input.orderNo,
    refundAmount: input.refundAmount,
    reason: input.reason?.trim() || null,
  })).digest('hex');
}

async function findIdempotentRefund(order: PaymentOrderRow, idempotencyKey: string): Promise<PaymentRefundRow | null> {
  const exactTenant = order.tenantId == null ? isNull(paymentRefunds.tenantId) : eq(paymentRefunds.tenantId, order.tenantId);
  const [row] = await db
    .select()
    .from(paymentRefunds)
    .where(and(
      eq(paymentRefunds.orderId, order.id),
      eq(paymentRefunds.idempotencyKey, idempotencyKey),
      exactTenant,
    ))
    .limit(1);
  return row ?? null;
}

export async function refund(input: CreateRefundInput & { idempotencyKey: string; operatorId?: number }): Promise<{ refundNo: string; status: string }> {
  const order = await getOrderRowByNo(input.orderNo);
  if (order.status !== 'success' && order.status !== 'refunding') {
    throw new HTTPException(400, { message: '订单未支付成功，无法退款' });
  }
  const config = await loadOrderConfig(order);
  if (!config) throw new HTTPException(400, { message: '支付渠道配置不存在，无法退款' });
  const activeSharingCount = await db.$count(
    paymentSharingOrders,
    and(
      eq(paymentSharingOrders.orderNo, order.orderNo),
      inArray(paymentSharingOrders.status, ['processing', 'success']),
      order.tenantId == null ? isNull(paymentSharingOrders.tenantId) : eq(paymentSharingOrders.tenantId, order.tenantId),
    ),
  );
  if (activeSharingCount > 0) {
    throw new HTTPException(409, { message: '订单存在已受理分账，请先完成分账回退后再退款' });
  }

  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) throw new HTTPException(400, { message: '退款请求必须提供 Idempotency-Key' });
  const requestHash = hashRefundRequest(input);
  const existingIdempotent = await findIdempotentRefund(order, idempotencyKey);
  if (existingIdempotent) {
    if (existingIdempotent.requestHash !== requestHash) {
      throw new HTTPException(409, { message: '同一 Idempotency-Key 不可用于不同退款请求' });
    }
    return { refundNo: existingIdempotent.refundNo, status: existingIdempotent.status };
  }

  // Reject deterministic configuration/capability failures before creating a
  // refund row. Otherwise the row would reserve the order's refundable amount
  // and leave the order in `refunding` even though no provider call occurred.
  assertPaymentEngineConfig(config);
  await assertPaymentOperation(config, 'refund.create', order.payMethod, order.currency);
  assertNotifyUrl(buildAdapterContext(config).notifyUrl, config.sandbox);

  const refundNo = genNo('REF');
  const operatorId = input.operatorId ?? currentUserOrNull()?.userId ?? null;
  const threshold = await refundApprovalThreshold(order.tenantId ?? null);
  const needApproval = threshold > 0 && input.refundAmount >= threshold;

  // ── 原子校验 + 插入（事务内 SELECT FOR UPDATE 防并发超退） ──────────────────
  const refundResult = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM payment_orders WHERE id = ${order.id} FOR UPDATE`);
    const exactTenant = order.tenantId == null ? isNull(paymentRefunds.tenantId) : eq(paymentRefunds.tenantId, order.tenantId);
    const [raced] = await tx
      .select()
      .from(paymentRefunds)
      .where(and(
        eq(paymentRefunds.orderId, order.id),
        eq(paymentRefunds.idempotencyKey, idempotencyKey),
        exactTenant,
      ))
      .limit(1);
    if (raced) {
      if (raced.requestHash !== requestHash) {
        throw new HTTPException(409, { message: '同一 Idempotency-Key 不可用于不同退款请求' });
      }
      return { row: raced, reused: true };
    }
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
        status: needApproval ? 'pending' : 'processing',
        approvalStatus: needApproval ? 'pending' : 'none',
        appliedById: operatorId,
        operatorId,
        idempotencyKey,
        requestHash,
        tenantId: order.tenantId,
      })
      .returning();
    // 退款申请一经落库即占用可退额度，订单状态统一由全部退款操作重算。
    await recomputeOrderRefundState(tx, order.id);
    return { row, reused: false };
  });

  const refundRow = refundResult.row;
  if (refundResult.reused) return { refundNo: refundRow.refundNo, status: refundRow.status };

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

  const [approved] = await db
    .update(paymentRefunds)
    .set({
      approvalStatus: 'approved',
      status: 'processing',
      approverId: user.userId,
      approvedAt: new Date(),
      approvalRemark: remark ?? null,
      version: sql`${paymentRefunds.version} + 1`,
    })
    .where(and(eq(paymentRefunds.id, id), eq(paymentRefunds.version, refundRow.version), eq(paymentRefunds.approvalStatus, 'pending')))
    .returning();
  if (!approved) throw new HTTPException(409, { message: '退款审批状态已变化，请刷新后重试' });
  await db
    .update(paymentOrders)
    .set({ status: 'refunding', version: sql`${paymentOrders.version} + 1` })
    .where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, 'success')));
  return executeChannelRefund(order, approved, config);
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
      .set({ approvalStatus: 'rejected', approverId: user.userId, approvedAt: new Date(), approvalRemark: remark, status: 'failed', errorMessage: '退款审批被驳回', version: sql`${paymentRefunds.version} + 1` })
      .where(and(eq(paymentRefunds.id, id), eq(paymentRefunds.version, refundRow.version), eq(paymentRefunds.approvalStatus, 'pending')))
      .returning({ id: paymentRefunds.id });
    if (updated.length === 0) return null;
    await recomputeOrderRefundState(tx, order.id);
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

async function applyNotify(
  configRow: PaymentChannelConfigRow,
  result: NotifyResult,
): Promise<{ orderNo: string; appId: number | null }> {
  if (result.scene === 'refund') {
    if (!result.outRefundNo) throw new ProviderResultMismatchError('REFUND_NO_MISSING', '退款回调缺少商户退款单号');
    const [refundRow] = await db.select().from(paymentRefunds).where(eq(paymentRefunds.outRefundNo, result.outRefundNo)).limit(1);
    if (!refundRow) throw new ProviderResultMismatchError('REFUND_NOT_FOUND', '退款回调未匹配到本地退款单');
    const order = refundRow.orderId
      ? (await db.select().from(paymentOrders).where(and(
        eq(paymentOrders.id, refundRow.orderId),
        eq(paymentOrders.channelConfigId, configRow.id),
      )).limit(1))[0]
      : undefined;
    if (!order) throw new ProviderResultMismatchError('ORDER_NOT_FOUND', '退款回调未匹配到绑定该商户配置的订单');
    await assertProviderResultMatchesOrder(
      configRow,
      order,
      result,
      result.tradeStatus === 'refunded' ? refundRow.refundAmount : undefined,
    );
    if (result.tradeStatus === 'refunded') {
      await settleRefundSuccess(order, refundRow, {
        channelRefundNo: result.channelRefundNo ?? refundRow.channelRefundNo,
        refundedAt: result.paidAt ?? new Date(),
        notifyData: result.raw ? JSON.stringify(result.raw).slice(0, 8000) : null,
      });
    } else if (result.tradeStatus === 'failed') {
      await markRefundFailed(order, refundRow, '渠道退款回调确认失败');
    }
    return { orderNo: order.orderNo, appId: order.appId ?? null };
  }

  if (!result.outTradeNo) throw new ProviderResultMismatchError('ORDER_NO_MISSING', '支付回调缺少商户订单号');
  const [order] = await db
    .select()
    .from(paymentOrders)
    .where(and(
      eq(paymentOrders.outTradeNo, result.outTradeNo),
      eq(paymentOrders.channel, configRow.channel),
      eq(paymentOrders.channelConfigId, configRow.id),
    ))
    .limit(1);
  if (!order) throw new ProviderResultMismatchError('ORDER_NOT_FOUND', '支付回调未匹配到绑定该商户配置的订单');
  await assertProviderResultMatchesOrder(
    configRow,
    order,
    result,
    result.tradeStatus === 'success' ? order.amount : undefined,
  );
  if (order.status === 'success' || order.status === 'refunded' || order.status === 'refunding') {
    return { orderNo: order.orderNo, appId: order.appId ?? null };
  }
  if (result.tradeStatus === 'success') {
    await markOrderPaid(order, {
      channelTradeNo: result.channelTradeNo,
      paidAmount: result.paidAmount,
      paidAt: result.paidAt,
      notifyData: result.raw ? JSON.stringify(result.raw).slice(0, 8000) : undefined,
    });
  } else if (result.tradeStatus === 'closed') {
    await markOrderClosed(order);
  } else if (result.tradeStatus === 'failed') {
    await markOrderFailedAfterQuery(order);
  }
  return { orderNo: order.orderNo, appId: order.appId ?? null };
}

/** 业务处理失败时的渠道失败应答：渠道将按各自重试策略再次通知（与验签失败的安全拒绝区分开）。 */
function buildFailureAck(channel: PaymentChannel): NotifyResult['ack'] {
  if (channel === 'wechat') {
    return { body: JSON.stringify({ code: 'FAIL', message: '业务处理失败，请重试' }), contentType: 'application/json', status: 500 };
  }
  return { body: 'failure', contentType: 'text/plain', status: 200 };
}

/** 处理渠道异步回调：callbackToken 精确绑定单一配置，验签与业务校验后再推进订单状态。 */
export async function handleNotify(
  channel: PaymentChannel,
  callbackToken: string,
  rawBody: string,
  headers: Headers,
  ip: string,
): Promise<{ ack: NotifyResult['ack'] }> {
  const [configRow] = await db
    .select()
    .from(paymentChannelConfigs)
    .where(and(
      eq(paymentChannelConfigs.channel, channel),
      eq(paymentChannelConfigs.callbackToken, callbackToken),
    ))
    .limit(1);
  if (!configRow) {
    return { ack: { body: 'failure', contentType: 'text/plain', status: 401 } };
  }
  try {
    assertPaymentEngineConfig(configRow, { recovery: true });
  } catch (err) {
    logger.warn('[payment] callback rejected by engine mode', { channel, configId: configRow.id, err: errMessage(err) });
    return { ack: buildFailureAck(channel) };
  }

  const result = await getAdapter(channel).verifyNotify(buildAdapterContext(configRow), rawBody, headers);

  const [insertedLog] = await db.insert(paymentNotifyLogs).values({
    channel,
    channelConfigId: configRow.id,
    providerEventId: result.providerEventId ?? null,
    scene: result.scene,
    orderNo: result.outTradeNo ?? result.outRefundNo ?? null,
    rawBody: rawBody.slice(0, 8000),
    headers: serializeHeaders(headers).slice(0, 2000),
    signatureValid: result.valid,
    merchantId: result.merchantId ?? null,
    providerAppId: result.providerAppId ?? null,
    paidAmount: result.paidAmount ?? null,
    currency: result.currency ?? null,
    result: result.valid ? `verified:${result.tradeStatus}` : 'invalid_sign',
    message: result.message ?? null,
    ip,
    tenantId: configRow.tenantId ?? null,
  }).onConflictDoNothing().returning({ id: paymentNotifyLogs.id });

  let notifyLogId = insertedLog?.id ?? null;
  if (notifyLogId == null && result.providerEventId) {
    const [existingLog] = await db
      .select({ id: paymentNotifyLogs.id })
      .from(paymentNotifyLogs)
      .where(and(
        eq(paymentNotifyLogs.channelConfigId, configRow.id),
        eq(paymentNotifyLogs.providerEventId, result.providerEventId),
      ))
      .limit(1);
    notifyLogId = existingLog?.id ?? null;
  }

  if (!result.valid) return { ack: result.ack };
  try {
    const applied = await applyNotify(configRow, result);
    if (notifyLogId != null) {
      await db
        .update(paymentNotifyLogs)
        .set({ orderNo: applied.orderNo, appId: applied.appId, result: `processed:${result.tradeStatus}` })
        .where(eq(paymentNotifyLogs.id, notifyLogId));
    }
  } catch (err) {
    if (err instanceof ProviderResultMismatchError) {
      if (notifyLogId != null) {
        await db
          .update(paymentNotifyLogs)
          .set({ result: `rejected:${err.code}`, message: err.message.slice(0, 500) })
          .where(eq(paymentNotifyLogs.id, notifyLogId));
      }
      logger.warn('[payment] provider callback rejected', { channel, configId: configRow.id, code: err.code, err: err.message });
      return { ack: result.ack };
    }
    // 验签已通过但本地落库失败：返回失败 ACK 让渠道重发通知（幂等保护已就位），避免静默吞错后只能依赖查单兜底
    logger.error('[payment] apply notify failed', { channel, err: errMessage(err) });
    if (notifyLogId != null) {
      await db
        .update(paymentNotifyLogs)
        .set({ result: 'processing_failed', message: errMessage(err).slice(0, 500) })
        .where(eq(paymentNotifyLogs.id, notifyLogId));
    }
    return { ack: buildFailureAck(channel) };
  }
  return { ack: result.ack };
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
  const conditions = [keywordCondition(q.keyword, [paymentOrders.orderNo, paymentOrders.outTradeNo, paymentOrders.subject])];
  if (q.status) conditions.push(eq(paymentOrders.status, q.status));
  if (q.channel) conditions.push(eq(paymentOrders.channel, q.channel));
  if (q.payMethod) conditions.push(eq(paymentOrders.payMethod, q.payMethod));
  if (q.bizType) conditions.push(eq(paymentOrders.bizType, q.bizType));
  if (q.minAmount != null) conditions.push(gte(paymentOrders.amount, q.minAmount));
  if (q.maxAmount != null) conditions.push(lte(paymentOrders.amount, q.maxAmount));
  conditions.push(...dateRangeConditions(paymentOrders.createdAt, q.startTime, q.endTime));
  const where = buildWhere(...conditions);
  const tc = tenantCondition(paymentOrders, user);
  const scope = await getDataScopeCondition({ currentUserId: user.userId, deptColumn: paymentOrders.departmentId, ownerColumn: paymentOrders.createdBy });
  return buildWhere(buildWhere(where, tc), scope);
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
  status?: 'pending' | 'processing' | 'unknown' | 'success' | 'failed';
  approvalStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  channel?: PaymentChannel;
  startTime?: string;
  endTime?: string;
}

export function buildRefundsWhere(q: ListRefundsQuery) {
  const conditions = [];
  conditions.push(keywordCondition(q.keyword, [paymentRefunds.refundNo, paymentRefunds.orderNo]));
  if (q.status) conditions.push(eq(paymentRefunds.status, q.status));
  if (q.approvalStatus) conditions.push(eq(paymentRefunds.approvalStatus, q.approvalStatus));
  if (q.channel) conditions.push(eq(paymentRefunds.channel, q.channel));
  conditions.push(...dateRangeConditions(paymentRefunds.createdAt, q.startTime, q.endTime));
  const where = buildWhere(...conditions);
  return buildWhere(where, tenantCondition(paymentRefunds, currentUser()));
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

/** 已持久化退款单的查单收敛入口，供人工查询与后台 unknown 扫描复用。 */
export async function syncRefundStatus(
  refundRow: PaymentRefundRow,
  order: PaymentOrderRow,
  config: PaymentChannelConfigRow,
): Promise<PaymentRefundRow> {
  if (refundRow.status === 'success' || refundRow.status === 'failed') return refundRow;
  assertPaymentEngineConfig(config, { recovery: true });
  await assertPaymentOperation(config, 'refund.query', order.payMethod, order.currency, { recovery: true });
  const res = await getAdapter(refundRow.channel).queryRefund(buildAdapterContext(config), refundRow, order);

  if (res.status === 'success') {
    // 单事务收口：退款单置 success + 订单状态流转 + refund.succeeded 事件原子持久化
    await settleRefundSuccess(order, refundRow, { channelRefundNo: res.channelRefundNo ?? refundRow.channelRefundNo, refundedAt: res.refundedAt ?? new Date() });
  } else if (res.status === 'failed') {
    await markRefundFailed(order, refundRow, '渠道退款查单失败');
  } else {
    await db
      .update(paymentRefunds)
      .set({
        status: 'processing',
        channelRefundNo: res.channelRefundNo ?? refundRow.channelRefundNo,
        errorMessage: null,
        version: sql`${paymentRefunds.version} + 1`,
      })
      .where(and(
        eq(paymentRefunds.id, refundRow.id),
        eq(paymentRefunds.version, refundRow.version),
        inArray(paymentRefunds.status, ['pending', 'processing', 'unknown']),
      ));
  }

  const [latest] = await db.select().from(paymentRefunds).where(eq(paymentRefunds.id, refundRow.id)).limit(1);
  return latest ?? refundRow;
}

/** 主动向渠道查询退款状态并同步本地（供后台「退款查单」）。 */
export async function refreshRefundById(id: number): Promise<PaymentRefund> {
  const tc = tenantCondition(paymentRefunds, currentUser());
  const [refundRow] = await db.select().from(paymentRefunds).where(and(eq(paymentRefunds.id, id), tc)).limit(1);
  if (!refundRow) throw new HTTPException(404, { message: '退款记录不存在' });
  if (refundRow.status === 'success' || refundRow.status === 'failed') return mapRefund(refundRow);

  const exactTenant = refundRow.tenantId == null ? isNull(paymentOrders.tenantId) : eq(paymentOrders.tenantId, refundRow.tenantId);
  const [order] = await db
    .select()
    .from(paymentOrders)
    .where(and(eq(paymentOrders.orderNo, refundRow.orderNo), exactTenant))
    .limit(1);
  if (!order) throw new HTTPException(404, { message: '原支付订单不存在' });
  const config = await loadOrderConfig(order);
  if (!config) throw new HTTPException(400, { message: '支付渠道配置不存在，无法查单' });
  try {
    return mapRefund(await syncRefundStatus(refundRow, order, config));
  } catch (err) {
    logger.warn('[payment] query refund failed', { refundNo: refundRow.refundNo, err: errMessage(err) });
    throw new HTTPException(502, { message: `退款查单失败：${errMessage(err)}` });
  }
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
  conditions.push(keywordCondition(q.keyword, [paymentNotifyLogs.orderNo]));
  if (q.channel) conditions.push(eq(paymentNotifyLogs.channel, q.channel));
  if (q.scene) conditions.push(eq(paymentNotifyLogs.scene, q.scene));
  if (q.signatureValid != null) conditions.push(eq(paymentNotifyLogs.signatureValid, q.signatureValid));
  conditions.push(...dateRangeConditions(paymentNotifyLogs.createdAt, q.startTime, q.endTime));
  const where = buildWhere(...conditions);
  const finalWhere = buildWhere(where, tenantCondition(paymentNotifyLogs, currentUser()));
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
    .filter((r) => r.status === 'pending' || r.status === 'processing' || r.status === 'unknown' || r.status === 'success')
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
  const channelConfig = await ensureChannelConfigExists(id);
  try {
    // Connectivity probes exercise the provider's query path. Reuse the same
    // effective capability gate as real payment operations so engine
    // sandbox/off modes can never reach a live adapter by mistake.
    await assertEffectivePaymentOperation({
      configRow: channelConfig,
      operation: 'payment.query',
      currency: 'CNY',
    });
  } catch (err) {
    const message = err instanceof HTTPException ? err.message : String(err);
    return { success: false, message: `连通性测试被支付能力策略阻止：${message}`, latencyMs: 0 };
  }
  // 沙箱渠道全链路为模拟实现，不外呼真实渠道；直接判定可用，避免「渠道可用但测试报凭据缺失」的矛盾
  if (channelConfig.sandbox) {
    return { success: true, message: '沙箱模式：跳过真实渠道探测（所有支付操作走模拟实现）', latencyMs: 0 };
  }
  const adapter = getAdapter(channelConfig.channel as PaymentChannel);
  if (!adapter.testConnectivity) {
    return { success: false, message: `渠道 ${channelConfig.channel} 暂不支持连通性测试`, latencyMs: 0 };
  }
  const ctx = buildAdapterContext(channelConfig);
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
