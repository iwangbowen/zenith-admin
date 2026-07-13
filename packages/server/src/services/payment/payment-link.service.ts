/**
 * 支付链接/收款码 Service。
 * 后台生成可分享的收款链接（固定/用户填写金额，可限次/限时），
 * 公开端点按 token 展示并下单（复用 payment.service.createPayment）。
 */
import { and, desc, eq, gt, isNull, like, lt, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { randomBytes, randomInt } from 'node:crypto';
import { db } from '../../db';
import { paymentLinks, type PaymentLinkRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { createPayment } from './payment.service';
import type { CreatePaymentLinkInput, UpdatePaymentLinkInput } from '@zenith/shared';
import type { CreatePaymentResult, PaymentLink, PaymentLinkPublic, PaymentLinkStatus, PaymentMethod, PaymentCashierMethod } from '@zenith/shared';

const PUBLIC_LINK_PAY_METHODS = new Set<PaymentCashierMethod>(['wechat_native', 'wechat_h5', 'alipay_page', 'alipay_wap', 'unionpay_qr']);

function isPublicLinkPayMethod(method: PaymentMethod): method is PaymentCashierMethod {
  return PUBLIC_LINK_PAY_METHODS.has(method as PaymentCashierMethod);
}

function genLinkNo(): string {
  return `LINK${Date.now()}${randomInt(1000, 9999)}`;
}
function genToken(): string {
  return randomBytes(16).toString('hex');
}

/** 计算链接的展示状态：停用 / 过期(超时或超次) / 生效。 */
export function computeLinkStatus(row: PaymentLinkRow): PaymentLinkStatus {
  if (row.status === 'disabled') return 'disabled';
  if (row.expiredAt && row.expiredAt.getTime() < Date.now()) return 'expired';
  if (row.maxUses != null && row.usedCount >= row.maxUses) return 'expired';
  return 'active';
}

export function mapLink(row: PaymentLinkRow): PaymentLink {
  return {
    id: row.id,
    linkNo: row.linkNo,
    token: row.token,
    subject: row.subject,
    amount: row.amount ?? null,
    payMethod: row.payMethod ?? null,
    bizType: row.bizType,
    maxUses: row.maxUses ?? null,
    usedCount: row.usedCount,
    expiredAt: formatNullableDateTime(row.expiredAt),
    status: computeLinkStatus(row),
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapLinkPublic(row: PaymentLinkRow): PaymentLinkPublic {
  return {
    token: row.token,
    subject: row.subject,
    amount: row.amount ?? null,
    payMethod: row.payMethod ?? null,
    bizType: row.bizType,
    status: computeLinkStatus(row),
    expiredAt: formatNullableDateTime(row.expiredAt),
    remainingUses: row.maxUses != null ? Math.max(0, row.maxUses - row.usedCount) : null,
  };
}

export interface ListLinksQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'active' | 'disabled';
}

export async function listLinks(q: ListLinksQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  if (q.keyword) conds.push(like(paymentLinks.subject, `%${escapeLike(q.keyword)}%`));
  if (q.status) conds.push(eq(paymentLinks.status, q.status));
  const where = mergeWhere(conds.length ? and(...conds) : undefined, tenantCondition(paymentLinks, currentUser()));
  const [total, list] = await Promise.all([
    db.$count(paymentLinks, where),
    withPagination(db.select().from(paymentLinks).where(where).orderBy(desc(paymentLinks.id)).$dynamic(), page, pageSize),
  ]);
  return { list: list.map(mapLink), total, page, pageSize };
}

async function ensureLink(id: number): Promise<PaymentLinkRow> {
  const tc = tenantCondition(paymentLinks, currentUser());
  const [row] = await db.select().from(paymentLinks).where(and(eq(paymentLinks.id, id), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '支付链接不存在' });
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

export async function createLink(input: CreatePaymentLinkInput): Promise<PaymentLink> {
  const [row] = await db
    .insert(paymentLinks)
    .values({
      linkNo: genLinkNo(),
      token: genToken(),
      subject: input.subject,
      amount: input.amount ?? null,
      payMethod: input.payMethod ?? null,
      bizType: input.bizType,
      maxUses: input.maxUses ?? null,
      expiredAt: parseExpiredAt(input.expiredAt),
      status: input.status ?? 'active',
      remark: input.remark ?? null,
      tenantId: getCreateTenantId(currentUser()),
    })
    .returning();
  return mapLink(row);
}

export async function updateLink(id: number, input: UpdatePaymentLinkInput): Promise<PaymentLink> {
  await ensureLink(id);
  const set: Partial<PaymentLinkRow> = {};
  if (input.subject !== undefined) set.subject = input.subject;
  if (input.amount !== undefined) set.amount = input.amount ?? null;
  if (input.payMethod !== undefined) set.payMethod = input.payMethod ?? null;
  if (input.bizType !== undefined) set.bizType = input.bizType;
  if (input.maxUses !== undefined) set.maxUses = input.maxUses ?? null;
  if (input.expiredAt !== undefined) set.expiredAt = parseExpiredAt(input.expiredAt);
  if (input.status !== undefined) set.status = input.status;
  if (input.remark !== undefined) set.remark = input.remark ?? null;
  const tc = tenantCondition(paymentLinks, currentUser());
  const [row] = await db.update(paymentLinks).set(set).where(and(eq(paymentLinks.id, id), tc)).returning();
  return mapLink(row);
}

export async function deleteLink(id: number): Promise<void> {
  await ensureLink(id);
  await db.delete(paymentLinks).where(eq(paymentLinks.id, id));
}

/** 重置链接 token（安全轮换）：生成新 token，旧分享链接立即失效。 */
export async function rotateLinkToken(id: number): Promise<PaymentLink> {
  await ensureLink(id);
  const tc = tenantCondition(paymentLinks, currentUser());
  const [row] = await db.update(paymentLinks).set({ token: genToken() }).where(and(eq(paymentLinks.id, id), tc)).returning();
  return mapLink(row);
}

// ─── 公开端点 ─────────────────────────────────────────────────────────────────
async function getLinkRowByToken(token: string): Promise<PaymentLinkRow> {
  const [row] = await db.select().from(paymentLinks).where(eq(paymentLinks.token, token)).limit(1);
  if (!row) throw new HTTPException(404, { message: '支付链接不存在或已删除' });
  return row;
}

export async function getPublicLink(token: string): Promise<PaymentLinkPublic> {
  return mapLinkPublic(await getLinkRowByToken(token));
}

export interface PayByLinkInput {
  amount?: number;
  payMethod?: PaymentMethod;
  openId?: string;
  clientIp?: string;
}

/** 公开下单：校验链接有效性 + 解析金额/方式 → createPayment → 原子自增 usedCount。 */
export async function payByLink(token: string, input: PayByLinkInput): Promise<{ orderNo: string; payParams: CreatePaymentResult }> {
  const row = await getLinkRowByToken(token);
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

  const [reserved] = await db
    .update(paymentLinks)
    .set({ usedCount: sql`${paymentLinks.usedCount} + 1` })
    .where(
      and(
        eq(paymentLinks.id, row.id),
        eq(paymentLinks.status, 'active'),
        or(isNull(paymentLinks.expiredAt), gt(paymentLinks.expiredAt, new Date())),
        row.maxUses != null ? lt(paymentLinks.usedCount, row.maxUses) : undefined,
      ),
    )
    .returning({ id: paymentLinks.id });

  if (!reserved) {
    throw new HTTPException(400, { message: '该支付链接已过期或已达使用上限' });
  }

  try {
    return await createPayment({
      bizType: row.bizType,
      // 每次下单生成唯一 bizId（linkNo:随机后缀）：同一链接可由多位付款人并发支付，
      // 不能共享 bizId，否则会命中下单业务幂等（payment_orders_active_biz_uq）错误复用他人订单
      bizId: `${row.linkNo}:${randomBytes(8).toString('hex')}`,
      subject: row.subject,
      amount,
      payMethod,
      openId: input.openId,
      expireMinutes: 30,
      clientIp: input.clientIp,
      tenantId: row.tenantId,
    });
  } catch (err) {
    await db
      .update(paymentLinks)
      .set({ usedCount: sql`${paymentLinks.usedCount} - 1` })
      .where(and(eq(paymentLinks.id, row.id), gt(paymentLinks.usedCount, 0)));
    throw err;
  }
}
