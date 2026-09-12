/**
 * 签到里程碑服务：累计签到天数达标奖励的 CRUD。
 * rewardType=points 发放积分；rewardType=coupon 发放指定优惠券模板。
 */
import { asc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { checkinMilestones, coupons } from '../../db/schema';
import type { CheckinMilestoneRow } from '../../db/schema';
import type { CheckinMilestoneRewardType } from '@zenith/shared/member';
import { formatTimestamps } from '../../lib/datetime';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';

export function mapCheckinMilestone(row: CheckinMilestoneRow, couponName?: string | null) {
  return {
    id: row.id,
    title: row.title,
    cumulativeDays: row.cumulativeDays,
    rewardType: row.rewardType,
    rewardPoints: row.rewardPoints,
    couponId: row.couponId ?? null,
    couponName: couponName ?? null,
    enabled: row.enabled,
    remark: row.remark ?? null,
    ...formatTimestamps(row),
  };
}

export async function ensureMilestoneExists(id: number): Promise<CheckinMilestoneRow> {
  return requireFirstRow(db.select().from(checkinMilestones).where(eq(checkinMilestones.id, id)).limit(1), '签到里程碑不存在');
}

export async function listCheckinMilestones() {
  const rows = await db.query.checkinMilestones.findMany({
    with: { coupon: { columns: { name: true } } },
    orderBy: asc(checkinMilestones.cumulativeDays),
  });
  return rows.map((r) => mapCheckinMilestone(r, r.coupon?.name));
}

interface MilestoneInput {
  title: string;
  cumulativeDays: number;
  rewardType: CheckinMilestoneRewardType;
  rewardPoints?: number;
  couponId?: number | null;
  enabled?: boolean;
  remark?: string | null;
}

async function ensureCouponValid(rewardType: CheckinMilestoneRewardType, couponId?: number | null) {
  if (rewardType !== 'coupon') return;
  if (!couponId) throw new HTTPException(400, { message: '优惠券奖励必须选择优惠券模板' });
  const [maybeC] = await db.select({ id: coupons.id }).from(coupons).where(eq(coupons.id, couponId)).limit(1);
  requireRow(maybeC, '优惠券模板不存在', 400);
}

export async function createCheckinMilestone(input: MilestoneInput) {
  await ensureCouponValid(input.rewardType, input.couponId);
  try {
    const [row] = await db.insert(checkinMilestones).values({
      title: input.title,
      cumulativeDays: input.cumulativeDays,
      rewardType: input.rewardType,
      rewardPoints: input.rewardType === 'points' ? (input.rewardPoints ?? 0) : 0,
      couponId: input.rewardType === 'coupon' ? (input.couponId ?? null) : null,
      enabled: input.enabled ?? true,
      remark: input.remark ?? null,
    }).returning();
    return mapCheckinMilestone(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, `累计 ${input.cumulativeDays} 天的里程碑已存在`);
    throw err;
  }
}

export async function updateCheckinMilestone(id: number, input: Partial<MilestoneInput>) {
  const existing = await ensureMilestoneExists(id);
  const rewardType = input.rewardType ?? existing.rewardType;
  if (input.rewardType !== undefined || input.couponId !== undefined) {
    await ensureCouponValid(rewardType, input.couponId ?? existing.couponId);
  }
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.cumulativeDays !== undefined) patch.cumulativeDays = input.cumulativeDays;
  if (input.rewardType !== undefined) patch.rewardType = input.rewardType;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.remark !== undefined) patch.remark = input.remark;
  if (rewardType === 'points') {
    if (input.rewardPoints !== undefined) patch.rewardPoints = input.rewardPoints;
    patch.couponId = null;
  } else {
    if (input.couponId !== undefined) patch.couponId = input.couponId;
    patch.rewardPoints = 0;
  }
  try {
    const [row] = await db.update(checkinMilestones).set(patch).where(eq(checkinMilestones.id, id)).returning();
    return mapCheckinMilestone(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, `累计 ${input.cumulativeDays ?? ''} 天的里程碑已存在`.trim());
    throw err;
  }
}

export async function deleteCheckinMilestone(id: number) {
  await ensureMilestoneExists(id);
  await db.delete(checkinMilestones).where(eq(checkinMilestones.id, id));
}
