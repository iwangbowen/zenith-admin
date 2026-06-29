/**
 * 优惠券服务：模板 CRUD + 发券 / 会员领取 / 核销 / 作废 / 批量过期。
 *
 * - 发券通过原子 UPDATE（issuedQuantity + 1 + 库存条件）防超发
 * - 核销 redeemCoupon() 预留统一入口，供未来订单系统接入
 */
import crypto from 'node:crypto';
import { and, desc, eq, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { coupons, memberCoupons, members } from '../db/schema';
import type { CouponRow, MemberCouponRow } from '../db/schema';
import type { DbTransaction } from '../db/types';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../lib/datetime';
import { currentMemberId } from '../lib/member-context';
import { getDecisionOutputs } from './rules.service';
import { escapeLike, withPagination } from '../lib/where-helpers';
import { pageOffset } from '../lib/pagination';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import type { CouponType, CouponValidType, CouponTemplateStatus } from '@zenith/shared';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCoupon(row: CouponRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    faceValue: row.faceValue,
    threshold: row.threshold,
    maxDiscount: row.maxDiscount ?? null,
    totalQuantity: row.totalQuantity,
    issuedQuantity: row.issuedQuantity,
    perLimit: row.perLimit,
    validType: row.validType,
    validStart: formatNullableDateTime(row.validStart),
    validEnd: formatNullableDateTime(row.validEnd),
    validDays: row.validDays ?? null,
    status: row.status,
    description: row.description ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapMemberCoupon(row: MemberCouponRow, coupon?: CouponRow | null, memberName?: string | null) {
  return {
    id: row.id,
    couponId: row.couponId,
    memberId: row.memberId,
    code: row.code,
    status: row.status,
    receivedAt: formatDateTime(row.receivedAt),
    usedAt: formatNullableDateTime(row.usedAt),
    expireAt: formatNullableDateTime(row.expireAt),
    coupon: coupon ? mapCoupon(coupon) : undefined,
    memberName: memberName ?? undefined,
    createdAt: formatDateTime(row.createdAt),
  };
}

// ─── 校验 ─────────────────────────────────────────────────────────────────────
export async function ensureCouponExists(id: number): Promise<CouponRow> {
  const [row] = await db.select().from(coupons).where(eq(coupons.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '优惠券不存在' });
  return row;
}

// ─── 模板 CRUD ────────────────────────────────────────────────────────────────
export interface CreateCouponInput {
  name: string;
  type: CouponType;
  faceValue: number;
  threshold?: number;
  maxDiscount?: number | null;
  totalQuantity?: number;
  perLimit?: number;
  validType: CouponValidType;
  validStart?: string | null;
  validEnd?: string | null;
  validDays?: number | null;
  status?: CouponTemplateStatus;
  description?: string | null;
}
export type UpdateCouponInput = Partial<CreateCouponInput>;

export interface ListCouponsQuery {
  keyword?: string;
  status?: CouponTemplateStatus;
  type?: CouponType;
  page: number;
  pageSize: number;
}

export async function listCoupons(q: ListCouponsQuery) {
  const conds: SQL[] = [];
  if (q.keyword) conds.push(ilike(coupons.name, `%${escapeLike(q.keyword)}%`));
  if (q.status) conds.push(eq(coupons.status, q.status));
  if (q.type) conds.push(eq(coupons.type, q.type));
  const where = conds.length ? and(...conds) : undefined;

  const [total, rows] = await Promise.all([
    db.$count(coupons, where),
    withPagination(db.select().from(coupons).where(where).orderBy(desc(coupons.id)).$dynamic(), q.page, q.pageSize),
  ]);
  return { list: rows.map(mapCoupon), total, page: q.page, pageSize: q.pageSize };
}

export async function getCoupon(id: number) {
  return mapCoupon(await ensureCouponExists(id));
}

export async function getMemberCouponBeforeAudit(id: number) {
  const row = await db.query.memberCoupons.findFirst({
    where: eq(memberCoupons.id, id),
    with: { coupon: true, member: { columns: { nickname: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '领券记录不存在' });
  return mapMemberCoupon(row, row.coupon, row.member?.nickname);
}

export async function createCoupon(input: CreateCouponInput) {
  try {
    const [row] = await db
      .insert(coupons)
      .values({
        name: input.name,
        type: input.type,
        faceValue: input.faceValue,
        threshold: input.threshold ?? 0,
        maxDiscount: input.maxDiscount ?? null,
        totalQuantity: input.totalQuantity ?? 0,
        perLimit: input.perLimit ?? 1,
        validType: input.validType,
        validStart: parseDateTimeInput(input.validStart ?? undefined),
        validEnd: parseDateTimeInput(input.validEnd ?? undefined),
        validDays: input.validDays ?? null,
        status: input.status ?? 'draft',
        description: input.description ?? null,
      })
      .returning();
    return mapCoupon(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '优惠券创建失败');
    throw err;
  }
}

export async function updateCoupon(id: number, input: UpdateCouponInput) {
  await ensureCouponExists(id);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.type !== undefined) patch.type = input.type;
  if (input.faceValue !== undefined) patch.faceValue = input.faceValue;
  if (input.threshold !== undefined) patch.threshold = input.threshold;
  if (input.maxDiscount !== undefined) patch.maxDiscount = input.maxDiscount;
  if (input.totalQuantity !== undefined) patch.totalQuantity = input.totalQuantity;
  if (input.perLimit !== undefined) patch.perLimit = input.perLimit;
  if (input.validType !== undefined) patch.validType = input.validType;
  if (input.validStart !== undefined) patch.validStart = parseDateTimeInput(input.validStart ?? undefined);
  if (input.validEnd !== undefined) patch.validEnd = parseDateTimeInput(input.validEnd ?? undefined);
  if (input.validDays !== undefined) patch.validDays = input.validDays;
  if (input.status !== undefined) patch.status = input.status;
  if (input.description !== undefined) patch.description = input.description;
  const [row] = await db.update(coupons).set(patch).where(eq(coupons.id, id)).returning();
  return mapCoupon(row);
}

export async function deleteCoupon(id: number) {
  await ensureCouponExists(id);
  // member_coupons.couponId 为 ON DELETE CASCADE，会同时删除已发券码
  await db.delete(coupons).where(eq(coupons.id, id));
}

// ─── 发券核心 ─────────────────────────────────────────────────────────────────
function genCouponCode(): string {
  return 'CP' + crypto.randomBytes(8).toString('hex').toUpperCase();
}

function computeExpireAt(coupon: CouponRow): Date | null {
  if (coupon.validType === 'fixed') return coupon.validEnd ?? null;
  if (coupon.validType === 'relative' && coupon.validDays) {
    return new Date(Date.now() + coupon.validDays * 86_400_000);
  }
  return null;
}

/** 在事务内将一张券发放给会员（原子库存扣减 + 限领校验）*/
async function grantCoupon(tx: DbTransaction, coupon: CouponRow, memberId: number): Promise<MemberCouponRow> {
  // 每人限领校验
  if (coupon.perLimit > 0) {
    const held = await tx.$count(memberCoupons, and(eq(memberCoupons.couponId, coupon.id), eq(memberCoupons.memberId, memberId)));
    if (held >= coupon.perLimit) throw new HTTPException(400, { message: '已达每人限领数量' });
  }
  // 原子库存扣减（防超发）
  const stockUpdated = await tx
    .update(coupons)
    .set({ issuedQuantity: sql`${coupons.issuedQuantity} + 1` })
    .where(and(eq(coupons.id, coupon.id), or(eq(coupons.totalQuantity, 0), lt(coupons.issuedQuantity, coupons.totalQuantity))))
    .returning({ id: coupons.id });
  if (stockUpdated.length === 0) throw new HTTPException(400, { message: '优惠券已领完' });

  const [mc] = await tx
    .insert(memberCoupons)
    .values({ couponId: coupon.id, memberId, code: genCouponCode(), status: 'unused', expireAt: computeExpireAt(coupon) })
    .returning();
  return mc;
}

/** 后台：发券给指定会员 */
export async function issueCoupon(couponId: number, memberId: number) {
  return db.transaction(async (tx) => {
    const [coupon] = await tx.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
    if (!coupon) throw new HTTPException(404, { message: '优惠券不存在' });
    const [m] = await tx.select({ id: members.id, levelId: members.levelId, growthValue: members.growthValue })
      .from(members).where(eq(members.id, memberId)).limit(1);
    if (!m) throw new HTTPException(404, { message: '会员不存在' });
    // 规则中心资格判定（可选）：若已发布 coupon_eligibility 决策表且判定不通过则拒发；表缺失/异常默认放行
    const decision = await getDecisionOutputs('coupon_eligibility', { member: m, coupon: { id: coupon.id, faceValue: coupon.faceValue, type: coupon.type } });
    if (decision.eligible === false || decision.eligible === 'false') throw new HTTPException(400, { message: '该会员不满足此优惠券发放资格' });
    return mapMemberCoupon(await grantCoupon(tx, coupon, memberId), coupon);
  });
}

/** 在已有事务内向会员发放指定模板的一张券（供签到里程碑等内部流程复用）。
 * 库存不足 / 超限会抛 HTTPException，由调用方决定是否吞掉。 */
export async function grantCouponInTx(tx: DbTransaction, couponId: number, memberId: number): Promise<MemberCouponRow> {
  const [coupon] = await tx.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
  if (!coupon) throw new HTTPException(404, { message: '优惠券不存在' });
  return grantCoupon(tx, coupon, memberId);
}

/** 前台：会员自助领券 */
export async function receiveCoupon(couponId: number) {
  const memberId = currentMemberId();
  return db.transaction(async (tx) => {
    const [coupon] = await tx.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
    if (!coupon) throw new HTTPException(404, { message: '优惠券不存在' });
    if (coupon.status !== 'active') throw new HTTPException(400, { message: '优惠券不可领取' });
    const now = new Date();
    if (coupon.validType === 'fixed' && coupon.validEnd && coupon.validEnd < now) {
      throw new HTTPException(400, { message: '优惠券已过期' });
    }
    return mapMemberCoupon(await grantCoupon(tx, coupon, memberId), coupon);
  });
}

// ─── 核销 / 作废 / 过期 ───────────────────────────────────────────────────────
/** 核销券码（预留统一入口，供未来订单系统调用）*/
export async function redeemCoupon(code: string, opts?: { bizType?: string; bizId?: string }) {
  return db.transaction(async (tx) => {
    const [mc] = await tx.select().from(memberCoupons).where(eq(memberCoupons.code, code)).limit(1);
    if (!mc) throw new HTTPException(404, { message: '券码不存在' });
    if (mc.status !== 'unused') throw new HTTPException(400, { message: '优惠券不可用' });
    if (mc.expireAt && mc.expireAt < new Date()) {
      await tx.update(memberCoupons).set({ status: 'expired' }).where(eq(memberCoupons.id, mc.id));
      throw new HTTPException(400, { message: '优惠券已过期' });
    }
    const [updated] = await tx
      .update(memberCoupons)
      .set({ status: 'used', usedAt: new Date(), bizType: opts?.bizType ?? null, bizId: opts?.bizId ?? null })
      .where(eq(memberCoupons.id, mc.id))
      .returning();
    return mapMemberCoupon(updated);
  });
}

/** 后台作废券码（冻结，未使用的券才能作废）*/
export async function revokeCoupon(memberCouponId: number) {
  const [mc] = await db.select().from(memberCoupons).where(eq(memberCoupons.id, memberCouponId)).limit(1);
  if (!mc) throw new HTTPException(404, { message: '领券记录不存在' });
  if (mc.status === 'used') throw new HTTPException(400, { message: '已使用的券不可作废' });
  await db.update(memberCoupons).set({ status: 'frozen' }).where(eq(memberCoupons.id, memberCouponId));
}

/** 批量将已过期未使用券置为 expired（可由定时任务调用）*/
export async function expireCoupons(): Promise<number> {
  const res = await db
    .update(memberCoupons)
    .set({ status: 'expired' })
    .where(and(eq(memberCoupons.status, 'unused'), lt(memberCoupons.expireAt, new Date())))
    .returning({ id: memberCoupons.id });
  return res.length;
}

// ─── 列表查询 ─────────────────────────────────────────────────────────────────
/** 前台：可领取的优惠券（active + 未领完 + 未过期）*/
export async function getAvailableCoupons() {
  const now = new Date();
  const rows = await db
    .select()
    .from(coupons)
    .where(and(eq(coupons.status, 'active'), or(eq(coupons.totalQuantity, 0), lt(coupons.issuedQuantity, coupons.totalQuantity))))
    .orderBy(desc(coupons.id));
  return rows.filter((c) => !(c.validType === 'fixed' && c.validEnd && c.validEnd < now)).map(mapCoupon);
}

export interface ListMemberCouponsQuery {
  memberId?: number;
  memberKeyword?: string;
  couponId?: number;
  status?: MemberCouponRow['status'];
  page: number;
  pageSize: number;
}

/** 后台：领券记录分页 */
export async function listMemberCoupons(q: ListMemberCouponsQuery) {
  const conds: SQL[] = [];
  if (q.memberId) {
    conds.push(eq(memberCoupons.memberId, q.memberId));
  } else if (q.memberKeyword) {
    const numId = /^\d+$/.test(q.memberKeyword) ? parseInt(q.memberKeyword, 10) : null;
    if (numId) {
      conds.push(eq(memberCoupons.memberId, numId));
    } else {
      conds.push(inArray(
        memberCoupons.memberId,
        db.select({ id: members.id }).from(members).where(ilike(members.nickname, `%${escapeLike(q.memberKeyword)}%`)),
      ));
    }
  }
  if (q.couponId) conds.push(eq(memberCoupons.couponId, q.couponId));
  if (q.status) conds.push(eq(memberCoupons.status, q.status));
  const where = conds.length ? and(...conds) : undefined;

  const [total, rows] = await Promise.all([
    db.$count(memberCoupons, where),
    db.query.memberCoupons.findMany({
      where,
      with: { coupon: true, member: { columns: { nickname: true } } },
      orderBy: desc(memberCoupons.id),
      limit: q.pageSize,
      offset: pageOffset(q.page, q.pageSize),
    }),
  ]);
  return {
    list: rows.map((r) => mapMemberCoupon(r, r.coupon, r.member?.nickname)),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** 前台：我的优惠券 */
export async function listMyCoupons(q: { status?: MemberCouponRow['status']; page: number; pageSize: number }) {
  const memberId = currentMemberId();
  const conds: SQL[] = [eq(memberCoupons.memberId, memberId)];
  if (q.status) conds.push(eq(memberCoupons.status, q.status));
  const where = and(...conds);

  const [total, rows] = await Promise.all([
    db.$count(memberCoupons, where),
    db.query.memberCoupons.findMany({
      where,
      with: { coupon: true },
      orderBy: desc(memberCoupons.id),
      limit: q.pageSize,
      offset: pageOffset(q.page, q.pageSize),
    }),
  ]);
  return { list: rows.map((r) => mapMemberCoupon(r, r.coupon)), total, page: q.page, pageSize: q.pageSize };
}
