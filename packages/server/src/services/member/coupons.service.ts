import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * 优惠券服务：模板 CRUD + 发券 / 会员领取 / 核销 / 作废 / 批量过期。
 *
 * - 发券通过原子 UPDATE（issuedQuantity + 1 + 库存条件）防超发
 * - 核销 redeemCoupon() 预留统一入口，供未来订单系统接入
 */
import crypto from 'node:crypto';
import { and, desc, eq, gt, gte, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { coupons, memberCoupons, memberPointAccounts, memberPointTransactions, members } from '../../db/schema';
import type { CouponRow, MemberCouponRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { formatDateTime, formatNullableDateTime, formatTimestamps, parseDateTimeInput } from '../../lib/datetime';
import { currentMemberId } from '../../lib/member-context';
import { decide } from '../platform/rules-runtime.service';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { trackServerEvent } from '../analytics/analytics-server-events.service';
import type { CouponType, CouponValidType, CouponTemplateStatus } from '@zenith/shared/member';
import { COUPON_TEMPLATE_STATUS_LABELS, couponContract, memberSelfContract } from '@zenith/shared/member';
import { ANALYTICS_EVENT_NAMES } from '@zenith/shared/analytics';
import { memberReferenceCondition } from './member-query-helpers';

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
    exchangePoints: row.exchangePoints,
    status: row.status,
    description: row.description ?? null,
    ...formatTimestamps(row),
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
  return requireRow(row, '优惠券不存在');
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
  /** 积分兑换所需积分（0 = 不可积分兑换）*/
  exchangePoints?: number;
  status?: CouponTemplateStatus;
  description?: string | null;
}
export type UpdateCouponInput = Partial<CreateCouponInput>;

export async function listCoupons(q: QueryOutputOf<typeof couponContract.list>) {
  const where = buildWhere(
    keywordCondition(q.keyword, [coupons.name], 'ilike'),
    q.status ? eq(coupons.status, q.status) : undefined,
    q.type ? eq(coupons.type, q.type) : undefined,
  );

  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(coupons, where),
    rows: () => withPagination(db.select().from(coupons).where(where).orderBy(desc(coupons.id)).$dynamic(), q.page, q.pageSize),
    map: mapCoupon,
  });
}

export async function getCoupon(id: number) {
  return mapCoupon(await ensureCouponExists(id));
}

export async function getMemberCouponBeforeAudit(id: number) {
  const row = await db.query.memberCoupons.findFirst({
    where: eq(memberCoupons.id, id),
    with: { coupon: true, member: { columns: { nickname: true } } },
  });
  const memberCoupon = requireRow(row, '领券记录不存在');
  return mapMemberCoupon(memberCoupon, memberCoupon.coupon, memberCoupon.member?.nickname);
}

export async function createCoupon(input: CreateCouponInput) {
  // 草稿允许保存不完整配置；上架（active）时必须配置完整的有效期
  if ((input.status ?? 'draft') === 'active') {
    assertCouponValidityConfig({
      validType: input.validType,
      validStart: parseDateTimeInput(input.validStart ?? undefined) ?? null,
      validEnd: parseDateTimeInput(input.validEnd ?? undefined) ?? null,
      validDays: input.validDays ?? null,
    });
  }
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
        exchangePoints: input.exchangePoints ?? 0,
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
  const existing = await ensureCouponExists(id);
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
  if (input.exchangePoints !== undefined) patch.exchangePoints = input.exchangePoints;
  if (input.status !== undefined) patch.status = input.status;
  if (input.description !== undefined) patch.description = input.description;
  // 上架（或维持上架）时必须配置完整的有效期：按合并后的最终值校验
  const finalStatus = (patch.status ?? existing.status) as CouponTemplateStatus;
  if (finalStatus === 'active') {
    assertCouponValidityConfig({
      validType: (patch.validType ?? existing.validType) as CouponRow['validType'],
      validStart: (patch.validStart !== undefined ? patch.validStart : existing.validStart) as Date | null,
      validEnd: (patch.validEnd !== undefined ? patch.validEnd : existing.validEnd) as Date | null,
      validDays: (patch.validDays !== undefined ? patch.validDays : existing.validDays) as number | null,
    });
  }
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

/**
 * 有效期配置完整性校验：上架（active）与发放前强制。
 * fixed 必须有起止时间且 start < end；relative 必须有正数有效天数——
 * 否则发出的券 expireAt 为 null，等同永久有效。
 */
function assertCouponValidityConfig(c: Pick<CouponRow, 'validType' | 'validStart' | 'validEnd' | 'validDays'>) {
  if (c.validType === 'fixed') {
    if (!c.validStart || !c.validEnd) throw new HTTPException(400, { message: '固定有效期券必须配置生效与失效时间' });
    if (c.validStart >= c.validEnd) throw new HTTPException(400, { message: '失效时间必须晚于生效时间' });
  } else if (c.validType === 'relative' && (!c.validDays || c.validDays <= 0)) {
    throw new HTTPException(400, { message: '相对有效期券必须配置有效天数' });
  }
}

/** 发放资格校验：所有发放路径（后台发券 / 自助领取 / 积分兑换 / 里程碑奖励）统一收口 */
function assertCouponIssuable(coupon: CouponRow) {
  if (coupon.status !== 'active') {
    throw new HTTPException(400, { message: `仅「生效中」的优惠券可发放，当前状态：${COUPON_TEMPLATE_STATUS_LABELS[coupon.status as CouponTemplateStatus] ?? coupon.status}` });
  }
  assertCouponValidityConfig(coupon);
  if (coupon.validType === 'fixed' && coupon.validEnd && coupon.validEnd < new Date()) {
    throw new HTTPException(400, { message: '优惠券已过期' });
  }
}

function computeExpireAt(coupon: CouponRow): Date | null {
  if (coupon.validType === 'fixed') return coupon.validEnd ?? null;
  if (coupon.validType === 'relative' && coupon.validDays) {
    return new Date(Date.now() + coupon.validDays * 86_400_000);
  }
  return null;
}

/** 在事务内将一张券发放给会员（原子库存扣减 + 限领校验）*/
async function grantCoupon(
  tx: DbTransaction,
  coupon: CouponRow,
  memberId: number,
  opts?: { bizType?: string; bizId?: string },
): Promise<MemberCouponRow> {
  assertCouponIssuable(coupon);
  // 每人限领校验：先锁模板行串行化同一模板的并发发放，防止「先数后写」竞态突破限领
  if (coupon.perLimit > 0) {
    await tx.select({ id: coupons.id }).from(coupons).where(eq(coupons.id, coupon.id)).for('update');
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
    .values({
      couponId: coupon.id,
      memberId,
      code: genCouponCode(),
      status: 'unused',
      expireAt: computeExpireAt(coupon),
      bizType: opts?.bizType ?? null,
      bizId: opts?.bizId ?? null,
    })
    .returning();
  return mc;
}

/** 后台：发券给指定会员 */
export async function issueCoupon(couponId: number, memberId: number) {
  return db.transaction(async (tx) => {
    const [coupon] = await tx.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
    const couponRow = requireRow(coupon, '优惠券不存在');
    const [m] = await tx.select({ id: members.id, levelId: members.levelId, growthValue: members.growthValue })
      .from(members).where(and(eq(members.id, memberId), isNull(members.deletedAt))).limit(1);
    const member = requireRow(m, '会员不存在');
    // 规则中心资格判定（可选）：若已发布 coupon_eligibility 决策表且判定不通过则拒发；表缺失/异常默认放行
    const decision = await decide(
      { kind: 'table', key: 'coupon_eligibility' },
      { member, coupon: { id: couponRow.id, faceValue: couponRow.faceValue, type: couponRow.type } },
      { caller: 'member.coupon', bizRef: `member:${memberId}` },
    );
    if (decision.outputs.eligible === false || decision.outputs.eligible === 'false') throw new HTTPException(400, { message: '该会员不满足此优惠券发放资格' });
    return mapMemberCoupon(await grantCoupon(tx, couponRow, memberId), couponRow);
  });
}

/** 在已有事务内向会员发放指定模板的一张券（供签到里程碑、生日礼等内部流程复用）。
 * 库存不足 / 超限会抛 HTTPException，由调用方决定是否吞掉。 */
export async function grantCouponInTx(
  tx: DbTransaction,
  couponId: number,
  memberId: number,
  opts?: { bizType?: string; bizId?: string },
): Promise<MemberCouponRow> {
  const [coupon] = await tx.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
  return grantCoupon(tx, requireRow(coupon, '优惠券不存在'), memberId, opts);
}

/** 前台：会员自助领券 */
export async function receiveCoupon(couponId: number) {
  const memberId = currentMemberId();
  const result = await db.transaction(async (tx) => {
    const [coupon] = await tx.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
    const couponRow = requireRow(coupon, '优惠券不存在');
    if (couponRow.status !== 'active') throw new HTTPException(400, { message: '优惠券不可领取' });
    const now = new Date();
    if (couponRow.validType === 'fixed' && couponRow.validEnd && couponRow.validEnd < now) {
      throw new HTTPException(400, { message: '优惠券已过期' });
    }
    return mapMemberCoupon(await grantCoupon(tx, couponRow, memberId), couponRow);
  });
  // 服务端权威事件（best-effort，事务已提交后触发）
  trackServerEvent({
    eventName: ANALYTICS_EVENT_NAMES.memberCouponReceived,
    memberId,
    tenantId: null,
    properties: { memberId, couponId, memberCouponId: result.id },
  });
  return result;
}

/** 前台：积分兑换优惠券（事务内条件扣积分 + 发券，防超扣防超发）*/
export async function exchangePointsForCoupon(couponId: number) {
  const memberId = currentMemberId();
  return db.transaction(async (tx) => {
    const [coupon] = await tx.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
    const couponRow = requireRow(coupon, '优惠券不存在');
    if (couponRow.status !== 'active' || couponRow.exchangePoints <= 0) {
      throw new HTTPException(400, { message: '该优惠券不支持积分兑换' });
    }
    const now = new Date();
    if (couponRow.validType === 'fixed' && couponRow.validEnd && couponRow.validEnd < now) {
      throw new HTTPException(400, { message: '优惠券已过期' });
    }
    const cost = couponRow.exchangePoints;
    // 条件扣减防超扣（同补签模式）：余额不足时 UPDATE 不命中
    const deducted = await tx.update(memberPointAccounts).set({
      balance: sql`${memberPointAccounts.balance} - ${cost}`,
      totalSpent: sql`${memberPointAccounts.totalSpent} + ${cost}`,
      version: sql`${memberPointAccounts.version} + 1`,
    }).where(and(eq(memberPointAccounts.memberId, memberId), gte(memberPointAccounts.balance, cost))).returning();
    if (deducted.length === 0) throw new HTTPException(400, { message: '积分余额不足' });
    await tx.insert(memberPointTransactions).values({
      memberId,
      type: 'redeem',
      amount: -cost,
      balanceAfter: deducted[0].balance,
      bizType: 'coupon_exchange',
      bizId: String(couponRow.id),
      remark: `积分兑换「${couponRow.name}」`,
    });
    const mc = await grantCoupon(tx, couponRow, memberId, { bizType: 'points_exchange', bizId: String(couponRow.id) });
    return mapMemberCoupon(mc, couponRow);
  });
}

/** 按券码查询券详情（核销前预览）*/
export async function getMemberCouponByCode(code: string) {
  const row = await db.query.memberCoupons.findFirst({
    where: eq(memberCoupons.code, code.trim()),
    with: { coupon: true, member: { columns: { nickname: true } } },
  });
  const memberCoupon = requireRow(row, '券码不存在');
  return mapMemberCoupon(memberCoupon, memberCoupon.coupon, memberCoupon.member?.nickname);
}

// ─── 核销 / 作废 / 过期 ───────────────────────────────────────────────────────
/** 核销券码（预留统一入口，供未来订单系统调用）。
 * 单条原子条件更新（code + unused + 未过期），并发核销同一券码仅一次成功，防双花。 */
export async function redeemCoupon(code: string, opts?: { bizType?: string; bizId?: string }) {
  const now = new Date();
  const [updated] = await db
    .update(memberCoupons)
    .set({ status: 'used', usedAt: now, bizType: opts?.bizType ?? null, bizId: opts?.bizId ?? null })
    .where(and(
      eq(memberCoupons.code, code),
      eq(memberCoupons.status, 'unused'),
      or(isNull(memberCoupons.expireAt), gt(memberCoupons.expireAt, now)),
    ))
    .returning();
  if (updated) {
    // 服务端权威事件（best-effort，核销原子 UPDATE 已提交后触发）
    trackServerEvent({
      eventName: ANALYTICS_EVENT_NAMES.memberCouponRedeemed,
      memberId: updated.memberId,
      tenantId: null,
      properties: {
        memberId: updated.memberId,
        couponId: updated.couponId,
        memberCouponId: updated.id,
        bizType: opts?.bizType ?? null,
        bizId: opts?.bizId ?? null,
      },
    });
    return mapMemberCoupon(updated);
  }

  // 未命中：区分券码不存在 / 已过期 / 其它不可用
  const [mc] = await db.select().from(memberCoupons).where(eq(memberCoupons.code, code)).limit(1);
  const memberCoupon = requireRow(mc, '券码不存在');
  if (memberCoupon.status === 'unused' && memberCoupon.expireAt && memberCoupon.expireAt <= now) {
    // 独立落库过期标记（不在抛错事务内，不会被回滚）
    await db
      .update(memberCoupons)
      .set({ status: 'expired' })
      .where(and(eq(memberCoupons.id, memberCoupon.id), eq(memberCoupons.status, 'unused')));
    throw new HTTPException(400, { message: '优惠券已过期' });
  }
  throw new HTTPException(400, { message: '优惠券不可用' });
}

/** 后台作废券码（冻结，未使用的券才能作废）*/
export async function revokeCoupon(memberCouponId: number) {
  const [mc] = await db.select().from(memberCoupons).where(eq(memberCoupons.id, memberCouponId)).limit(1);
  const memberCoupon = requireRow(mc, '领券记录不存在');
  if (memberCoupon.status === 'used') throw new HTTPException(400, { message: '已使用的券不可作废' });
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

/** 前台：可积分兑换的优惠券（active + 配置兑换积分 + 未领完 + 未过期）*/
export async function getExchangeableCoupons() {
  const now = new Date();
  const rows = await db
    .select()
    .from(coupons)
    .where(and(
      eq(coupons.status, 'active'),
      gt(coupons.exchangePoints, 0),
      or(eq(coupons.totalQuantity, 0), lt(coupons.issuedQuantity, coupons.totalQuantity)),
    ))
    .orderBy(desc(coupons.id));
  return rows.filter((c) => !(c.validType === 'fixed' && c.validEnd && c.validEnd < now)).map(mapCoupon);
}

export type ListMemberCouponsQuery = QueryOutputOf<typeof couponContract.records> & { memberId?: number };

/** 后台：领券记录分页 */
export function buildMemberCouponWhere(q: { memberId?: number; memberKeyword?: string; couponId?: number; status?: MemberCouponRow['status'] }): SQL | undefined {
  return buildWhere(
    memberReferenceCondition(memberCoupons.memberId, q),
    q.couponId ? eq(memberCoupons.couponId, q.couponId) : undefined,
    q.status ? eq(memberCoupons.status, q.status) : undefined,
  );
}

export async function listMemberCoupons(q: ListMemberCouponsQuery) {
  const where = buildMemberCouponWhere(q);

  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(memberCoupons, where),
    rows: () => db.query.memberCoupons.findMany({
      where,
      with: { coupon: true, member: { columns: { nickname: true } } },
      orderBy: desc(memberCoupons.id),
      limit: q.pageSize,
      offset: pageOffset(q.page, q.pageSize),
    }),
    map: (r) => mapMemberCoupon(r, r.coupon, r.member?.nickname),
  });
}

/** 前台：我的优惠券 */
export async function listMyCoupons(q: QueryOutputOf<typeof memberSelfContract.coupons>) {
  const memberId = currentMemberId();
  const where = buildWhere(
    eq(memberCoupons.memberId, memberId),
    q.status ? eq(memberCoupons.status, q.status) : undefined,
  );

  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(memberCoupons, where),
    rows: () => db.query.memberCoupons.findMany({
      where,
      with: { coupon: true },
      orderBy: desc(memberCoupons.id),
      limit: q.pageSize,
      offset: pageOffset(q.page, q.pageSize),
    }),
    map: (r) => mapMemberCoupon(r, r.coupon),
  });
}
