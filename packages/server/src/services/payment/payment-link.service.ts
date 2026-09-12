import { paymentLinkContract } from '@zenith/shared/payment';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * 支付链接/收款码 Service。
 * 后台生成可分享的收款链接（固定/用户填写金额，可限次/限时），
 * 公开端点按 token 展示并下单（复用 payment.service.createPayment）。
 */
import { and, desc, eq, gt, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { randomBytes } from 'node:crypto';
import { genPaymentNo } from './payment-no';
import { db } from '../../db';
import { buildListResult } from '../../lib/list-query';
import { paymentCashierSessions, paymentLinkRedemptions, paymentLinks, paymentOrders, type PaymentLinkRow } from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { requireTenantScopeId, tenantCondition, exactTenantCondition } from '../../lib/tenant';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatNullableDateTime, formatTimestamps, parseDateTimeInput } from '../../lib/datetime';
import { createPayment } from './payment.service';
import { bindCashierSession, bindCashierSessionAfterCreateFailure, buildCashierSessionExpiry, createCashierSession, failCashierSession, getPublicCashierSession, releaseExpiredCashierUseSlots } from './payment-cashier-session.service';
import type { CreatePaymentLinkInput, UpdatePaymentLinkInput } from '@zenith/shared/payment';
import type { PaymentCashierSession, PaymentLink, PaymentLinkPublic, PaymentLinkStatus, PaymentMethod, PaymentCashierMethod } from '@zenith/shared/payment';
import { assertEffectiveCashierMethod, listEffectiveCashierMethods } from './payment-cashier-capability.service';
import logger from '../../lib/logger';

const PUBLIC_LINK_PAY_METHOD_LIST = ['wechat_native', 'wechat_h5', 'alipay_page', 'alipay_wap', 'unionpay_qr'] as const satisfies readonly PaymentCashierMethod[];
const PUBLIC_LINK_PAY_METHODS = new Set<PaymentCashierMethod>(PUBLIC_LINK_PAY_METHOD_LIST);

function isPublicLinkPayMethod(method: PaymentMethod): method is PaymentCashierMethod {
  return PUBLIC_LINK_PAY_METHODS.has(method as PaymentCashierMethod);
}

function genToken(): string {
  return randomBytes(16).toString('hex');
}

/** 计算链接的展示状态：停用 / 过期(超时或超次) / 生效。 */
export function computeLinkStatus(row: PaymentLinkRow): PaymentLinkStatus {
  if (row.status === 'disabled') return 'disabled';
  if (row.expiredAt && row.expiredAt.getTime() < Date.now()) return 'expired';
  if (row.maxUses != null && row.usedCount + row.reservedCount >= row.maxUses) return 'expired';
  return 'active';
}

function computeLinkUnavailableReason(row: PaymentLinkRow): PaymentLinkPublic['unavailableReason'] {
  if (row.status === 'disabled') return 'disabled';
  if (row.status === 'expired' || (row.expiredAt && row.expiredAt.getTime() < Date.now())) return 'expired';
  if (row.maxUses != null && row.usedCount + row.reservedCount >= row.maxUses) return 'usage_limit';
  return null;
}

export function mapLink(row: PaymentLinkRow): PaymentLink {
  return {
    id: row.id,
    linkNo: row.linkNo,
    token: row.token,
    appId: row.appId,
    subject: row.subject,
    amount: row.amount ?? null,
    payMethod: row.payMethod ?? null,
    bizType: row.bizType,
    maxUses: row.maxUses ?? null,
    usedCount: row.usedCount,
    reservedCount: row.reservedCount,
    expiredAt: formatNullableDateTime(row.expiredAt),
    status: computeLinkStatus(row),
    remark: row.remark ?? null,
    ...formatTimestamps(row),
  };
}

export function mapLinkPublic(row: PaymentLinkRow, availableMethods: PaymentLinkPublic['availableMethods']): PaymentLinkPublic {
  return {
    token: row.token,
    subject: row.subject,
    amount: row.amount ?? null,
    payMethod: row.payMethod ?? null,
    bizType: row.bizType,
    status: computeLinkStatus(row),
    unavailableReason: computeLinkUnavailableReason(row),
    expiredAt: formatNullableDateTime(row.expiredAt),
    remainingUses: row.maxUses != null ? Math.max(0, row.maxUses - row.usedCount - row.reservedCount) : null,
    availableMethods,
  };
}

export type ListLinksQuery = QueryOutputOf<typeof paymentLinkContract.list>;

function linkStatusCondition(status: ListLinksQuery['status']) {
  if (status === 'active') {
    return and(
      eq(paymentLinks.status, 'active'),
      or(isNull(paymentLinks.expiredAt), gt(paymentLinks.expiredAt, new Date())),
      or(isNull(paymentLinks.maxUses), sql`${paymentLinks.usedCount} + ${paymentLinks.reservedCount} < ${paymentLinks.maxUses}`),
    );
  }
  if (status === 'expired') {
    return or(
      eq(paymentLinks.status, 'expired'),
      and(
        eq(paymentLinks.status, 'active'),
        or(
          and(sql`${paymentLinks.expiredAt} is not null`, sql`${paymentLinks.expiredAt} <= now()`),
          and(sql`${paymentLinks.maxUses} is not null`, sql`${paymentLinks.usedCount} + ${paymentLinks.reservedCount} >= ${paymentLinks.maxUses}`),
        ),
      ),
    );
  }
  return status === 'disabled' ? eq(paymentLinks.status, 'disabled') : undefined;
}

export async function listLinks(q: ListLinksQuery) {
  const { page, pageSize } = q;
  const where = buildWhere(
    keywordCondition(q.keyword, [paymentLinks.subject]),
    linkStatusCondition(q.status),
    tenantCondition(paymentLinks, currentUser()),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentLinks, where),
    rows: () => withPagination(db.select().from(paymentLinks).where(where).orderBy(desc(paymentLinks.id)).$dynamic(), page, pageSize),
    map: mapLink,
  });
}

async function ensureLink(id: number): Promise<PaymentLinkRow> {
  const tc = tenantCondition(paymentLinks, currentUser());
  const [row] = await db.select().from(paymentLinks).where(and(eq(paymentLinks.id, id), tc)).limit(1);
  requireRow(row, '支付链接不存在');
  return row;
}

export async function getLink(id: number): Promise<PaymentLink> {
  return mapLink(await ensureLink(id));
}

function parseExpiredAt(value?: string): Date | null {
  if (!value) return null;
  const d = parseDateTimeInput(value);
  if (!d) throw new HTTPException(400, { message: '失效时间格式不正确' });
  return d;
}

async function listLinkCashierMethods(input: {
  applicationId: number;
  tenantId: number | null;
  payMethod?: PaymentMethod | null;
}): Promise<PaymentLinkPublic['availableMethods']> {
  if (input.payMethod && !isPublicLinkPayMethod(input.payMethod)) return [];
  const methods = await listEffectiveCashierMethods({
    tenantId: input.tenantId,
    applicationId: input.applicationId,
    currency: 'CNY',
    allowedMethods: PUBLIC_LINK_PAY_METHOD_LIST,
    fixedMethod: input.payMethod as PaymentCashierMethod | null | undefined,
  });
  return methods.map(({ method, label, icon }) => ({ method, label, icon }));
}

async function assertLinkConfigurationAvailable(input: {
  applicationId: number;
  tenantId: number | null;
  payMethod?: PaymentMethod | null;
}): Promise<void> {
  if (input.payMethod && !isPublicLinkPayMethod(input.payMethod)) {
    throw new HTTPException(400, { message: '该支付方式不支持公开收银台' });
  }
  const methods = await listLinkCashierMethods(input);
  if (methods.length === 0) {
    throw new HTTPException(400, {
      message: input.payMethod
        ? `支付应用绑定的商户配置当前不支持支付方式 ${input.payMethod}`
        : '支付应用当前没有可用的公开收银台支付方式',
    });
  }
}

export async function createLink(input: CreatePaymentLinkInput): Promise<PaymentLink> {
  const tenantId = requireTenantScopeId(currentUser());
  await assertLinkConfigurationAvailable({ applicationId: input.applicationId, tenantId, payMethod: input.payMethod });
  const [row] = await db
    .insert(paymentLinks)
    .values({
      linkNo: genPaymentNo('LINK'),
      token: genToken(),
      appId: input.applicationId,
      subject: input.subject,
      amount: input.amount ?? null,
      payMethod: input.payMethod ?? null,
      bizType: input.bizType,
      maxUses: input.maxUses ?? null,
      expiredAt: parseExpiredAt(input.expiredAt),
      status: input.status ?? 'active',
      remark: input.remark ?? null,
      tenantId,
    })
    .returning();
  return mapLink(row);
}

export async function updateLink(id: number, input: UpdatePaymentLinkInput): Promise<PaymentLink> {
  requireTenantScopeId(currentUser());
  const existing = await ensureLink(id);
  const nextMethod = input.payMethod !== undefined ? input.payMethod : existing.payMethod;
  await assertLinkConfigurationAvailable({ applicationId: existing.appId, tenantId: existing.tenantId ?? null, payMethod: nextMethod });
  const set: Partial<PaymentLinkRow> = {};
  if (input.subject !== undefined) set.subject = input.subject;
  if (input.amount !== undefined) set.amount = input.amount ?? null;
  if (input.payMethod !== undefined) set.payMethod = input.payMethod ?? null;
  if (input.bizType !== undefined) set.bizType = input.bizType;
  if (input.maxUses !== undefined) set.maxUses = input.maxUses ?? null;
  if (input.expiredAt !== undefined) set.expiredAt = parseExpiredAt(input.expiredAt);
  if (input.status !== undefined) set.status = input.status;
  if (input.remark !== undefined) set.remark = input.remark ?? null;
  return db.transaction(async (tx) => {
    const tc = tenantCondition(paymentLinks, currentUser());
    const [locked] = await tx.select().from(paymentLinks).where(and(eq(paymentLinks.id, id), tc)).for('update').limit(1);
    requireRow(locked, '支付链接不存在');
    const identityChanged = (input.bizType !== undefined && input.bizType !== locked.bizType)
      || (input.amount !== undefined && (input.amount ?? null) !== (locked.amount ?? null))
      || (input.payMethod !== undefined && (input.payMethod ?? null) !== (locked.payMethod ?? null));
    if (identityChanged) {
      const sessionCount = await tx.$count(paymentCashierSessions, eq(paymentCashierSessions.linkId, id));
      const orderTenant = exactTenantCondition(paymentOrders.tenantId, locked.tenantId);
      const orderCount = await tx.$count(paymentOrders, and(
        eq(paymentOrders.appId, locked.appId),
        eq(paymentOrders.bizType, locked.bizType),
        like(paymentOrders.bizId, `${locked.linkNo}:%`),
        orderTenant,
      ));
      if (sessionCount > 0 || orderCount > 0) {
        throw new HTTPException(409, { message: '链接已有收银台会话或支付订单，业务类型、金额和支付方式不可再修改' });
      }
    }
    const nextMaxUses = input.maxUses !== undefined ? input.maxUses : locked.maxUses;
    if (nextMaxUses != null && nextMaxUses < locked.usedCount + locked.reservedCount) {
      throw new HTTPException(400, { message: '使用上限不能小于已核销次数与有效预占次数之和' });
    }
    const [row] = await tx.update(paymentLinks).set(set).where(eq(paymentLinks.id, id)).returning();
    return mapLink(row);
  });
}

export async function deleteLink(id: number): Promise<void> {
  requireTenantScopeId(currentUser());
  const link = await ensureLink(id);
  const sessionCount = await db.$count(paymentCashierSessions, eq(paymentCashierSessions.linkId, id));
  if (sessionCount > 0) {
    throw new HTTPException(400, { message: `该链接已有 ${sessionCount} 个收银台会话，请停用而不是删除` });
  }
  const linkedOrderCount = await db.$count(
    paymentOrders,
    and(
      eq(paymentOrders.bizType, link.bizType),
      like(paymentOrders.bizId, `${link.linkNo}:%`),
      exactTenantCondition(paymentOrders.tenantId, link.tenantId),
    ),
  );
  if (linkedOrderCount > 0) {
    throw new HTTPException(400, { message: `该链接已关联 ${linkedOrderCount} 笔支付订单，请停用而不是删除` });
  }
  const redemptionCount = await db.$count(paymentLinkRedemptions, eq(paymentLinkRedemptions.linkId, id));
  if (redemptionCount > 0) {
    throw new HTTPException(400, { message: `该链接已有 ${redemptionCount} 笔成功支付，请停用而不是删除` });
  }
  await db.delete(paymentLinks).where(eq(paymentLinks.id, id));
}

/** 重置链接 token（安全轮换）：生成新 token，旧分享链接立即失效。 */
export async function rotateLinkToken(id: number): Promise<PaymentLink> {
  requireTenantScopeId(currentUser());
  await ensureLink(id);
  const activeSessionCount = await db.$count(paymentCashierSessions, and(
    eq(paymentCashierSessions.linkId, id),
    inArray(paymentCashierSessions.status, ['ready', 'creating', 'awaiting', 'processing', 'unknown']),
    gt(paymentCashierSessions.expiresAt, new Date()),
  ));
  if (activeSessionCount > 0) {
    throw new HTTPException(400, { message: `该链接仍有 ${activeSessionCount} 个进行中的收银台会话，暂不可轮换 token` });
  }
  const tc = tenantCondition(paymentLinks, currentUser());
  const [row] = await db.update(paymentLinks).set({ token: genToken() }).where(and(eq(paymentLinks.id, id), tc)).returning();
  return mapLink(row);
}

// ─── 公开端点 ─────────────────────────────────────────────────────────────────
async function getLinkRowByToken(token: string): Promise<PaymentLinkRow> {
  const [row] = await db.select().from(paymentLinks).where(eq(paymentLinks.token, token)).limit(1);
  requireRow(row, '支付链接不存在或已删除');
  return row;
}

export async function getPublicLink(token: string): Promise<PaymentLinkPublic> {
  let row = await getLinkRowByToken(token);
  if (row.maxUses != null && row.reservedCount > 0) {
    await releaseExpiredCashierUseSlots(row.id);
    row = await getLinkRowByToken(token);
  }
  const availableMethods = await listLinkCashierMethods({
    applicationId: row.appId,
    tenantId: row.tenantId ?? null,
    payMethod: row.payMethod,
  });
  return mapLinkPublic(row, availableMethods);
}

export interface PayByLinkInput {
  amount?: number;
  payMethod?: PaymentMethod;
  openId?: string;
  clientIp?: string;
}

/** 公开下单：先持久化 Cashier Session，再创建支付并保存订单与支付参数。 */
export async function payByLink(token: string, input: PayByLinkInput): Promise<PaymentCashierSession> {
  let row = await getLinkRowByToken(token);
  if (row.maxUses != null && row.reservedCount > 0) {
    await releaseExpiredCashierUseSlots(row.id);
    row = await getLinkRowByToken(token);
  }
  const status = computeLinkStatus(row);
  if (status === 'disabled') throw new HTTPException(400, { message: '该支付链接已停用' });
  if (status === 'expired') throw new HTTPException(400, { message: '该支付链接已过期或已达使用上限' });

  const amount = row.amount ?? input.amount;
  if (!amount || amount <= 0) throw new HTTPException(400, { message: '请输入有效的支付金额' });
  if (row.amount != null && input.amount != null && input.amount !== row.amount) {
    throw new HTTPException(400, { message: '支付金额与链接不一致' });
  }
  const payMethod = row.payMethod ?? input.payMethod;
  if (!payMethod) throw new HTTPException(400, { message: '请选择支付方式' });
  if (!isPublicLinkPayMethod(payMethod)) {
    throw new HTTPException(400, { message: '该支付方式暂不支持在公开收款页发起' });
  }
  await assertEffectiveCashierMethod({
    tenantId: row.tenantId ?? null,
    applicationId: row.appId,
    method: payMethod,
    currency: 'CNY',
    allowedMethods: PUBLIC_LINK_PAY_METHOD_LIST,
  });
  const expiresAt = buildCashierSessionExpiry(row);
  if (expiresAt <= new Date()) throw new HTTPException(400, { message: '该支付链接已过期' });
  const session = await createCashierSession({ link: row, linkToken: token, payMethod, amount, expiresAt });
  const bizId = `${row.linkNo}:${session.sessionToken}`;
  const expireMinutes = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 60_000));
  try {
    const result = await createPayment({
      bizType: row.bizType,
      bizId,
      subject: row.subject,
      amount,
      currency: 'CNY',
      payMethod,
      openId: input.openId,
      expireMinutes,
      clientIp: input.clientIp,
      tenantId: row.tenantId,
      applicationId: row.appId,
      idempotencyKey: `cashier:${session.sessionToken}`,
      returnUrl: session.returnUrl,
    });
    const [maybeOrder] = await db.select().from(paymentOrders).where(eq(paymentOrders.orderNo, result.orderNo)).limit(1);
    const order = requireRow(maybeOrder, '支付订单创建后无法回读', 409);
    const bound = await bindCashierSession({ session, order, payParams: result.payParams });
    if (order.status === 'success' || order.status === 'refunding' || order.status === 'refunded') {
      await recordPaymentLinkRedemption({
        orderNo: order.orderNo,
        bizType: order.bizType,
        bizId: order.bizId,
        appId: order.appId,
        tenantId: order.tenantId,
      });
      return getPublicCashierSession(token, session.sessionToken);
    }
    return bound;
  } catch (err) {
    const tenantScope = exactTenantCondition(paymentOrders.tenantId, row.tenantId);
    const [order] = await db
      .select()
      .from(paymentOrders)
      .where(and(
        eq(paymentOrders.appId, row.appId),
        eq(paymentOrders.bizType, row.bizType),
        eq(paymentOrders.bizId, bizId),
        tenantScope,
      ))
      .limit(1);
    if (order) {
      const bound = await bindCashierSessionAfterCreateFailure({ session, order, error: err });
      if (order.status === 'success' || order.status === 'refunding' || order.status === 'refunded') {
        await recordPaymentLinkRedemption({
          orderNo: order.orderNo,
          bizType: order.bizType,
          bizId: order.bizId,
          appId: order.appId,
          tenantId: order.tenantId,
        });
        return getPublicCashierSession(token, session.sessionToken);
      }
      return bound;
    }
    return failCashierSession(session, err);
  }
}

/** 支付成功事件核销链接次数；orderNo 唯一记录保证 Outbox 重放不重复累计。 */
export async function recordPaymentLinkRedemption(event: {
  orderNo: string;
  bizType: string;
  bizId: string;
  appId?: number | null;
  tenantId?: number | null;
}): Promise<boolean> {
  if (event.appId == null) return false;
  const appId = event.appId;
  const separator = event.bizId.indexOf(':');
  if (separator <= 0) return false;
  const linkNo = event.bizId.slice(0, separator);
  const sessionToken = event.bizId.slice(separator + 1);
  if (!sessionToken || sessionToken.includes(':')) return false;
  const tenantId = event.tenantId ?? null;
  const exactTenant = exactTenantCondition(paymentLinks.tenantId, tenantId);
  return db.transaction(async (tx) => {
    const [link] = await tx
      .select({ id: paymentLinks.id, maxUses: paymentLinks.maxUses, usedCount: paymentLinks.usedCount })
      .from(paymentLinks)
      .where(and(eq(paymentLinks.linkNo, linkNo), eq(paymentLinks.bizType, event.bizType), eq(paymentLinks.appId, appId), exactTenant))
      .for('update')
      .limit(1);
    if (!link) return false;
    const [session] = await tx
      .select()
      .from(paymentCashierSessions)
      .where(and(
        eq(paymentCashierSessions.sessionToken, sessionToken),
        eq(paymentCashierSessions.linkId, link.id),
        eq(paymentCashierSessions.appId, appId),
        eq(paymentCashierSessions.orderNo, event.orderNo),
        exactTenantCondition(paymentCashierSessions.tenantId, tenantId),
      ))
      .for('update')
      .limit(1);
    // A session may have been expired and its slot released before a delayed
    // provider success callback arrives. The order is still the source of
    // truth, so allow an idempotent redemption for `released` as well. Only a
    // previously consumed slot is terminal and must be rejected.
    if (!session || session.useSlotStatus === 'consumed') return false;
    const [inserted] = await tx
      .insert(paymentLinkRedemptions)
      .values({ linkId: link.id, orderNo: event.orderNo, tenantId })
      .onConflictDoNothing({ target: paymentLinkRedemptions.orderNo })
      .returning({ id: paymentLinkRedemptions.id });
    if (!inserted) return false;
    // A released uncertain session should be rare after the expiry guard. If
    // it still races with another success, preserve the authoritative
    // successful redemption and close admission for future sessions rather
    // than dropping the event silently.
    if (link.maxUses != null && link.usedCount >= link.maxUses) {
      logger.warn('[payment-link] delayed success exceeded usage limit after slot release', {
        linkId: link.id,
        orderNo: event.orderNo,
        usedCount: link.usedCount,
        maxUses: link.maxUses,
      });
    }
    await tx.update(paymentLinks).set({
      usedCount: sql`${paymentLinks.usedCount} + 1`,
      ...(session.useSlotStatus === 'reserved'
        ? { reservedCount: sql`greatest(${paymentLinks.reservedCount} - 1, 0)` }
        : {}),
    }).where(eq(paymentLinks.id, link.id));
    await tx.update(paymentCashierSessions).set({
      status: 'succeeded',
      useSlotStatus: 'consumed',
      version: sql`${paymentCashierSessions.version} + 1`,
    }).where(eq(paymentCashierSessions.id, session.id));
    return true;
  });
}
