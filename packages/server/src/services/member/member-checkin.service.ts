import dayjs from 'dayjs';
import type { QueryOutputOf } from '@zenith/shared/core';
import { memberCheckinContract, memberSelfContract } from '@zenith/shared/member';
import { and, asc, count, desc, eq, gte, isNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { checkinRules, checkinMilestones, memberCheckins, memberCheckinMilestoneAwards, memberPointAccounts, memberPointTransactions, members } from '../../db/schema';
import type { MemberCheckinRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';
import { currentMemberId } from '../../lib/member-context';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { getCheckinSettingsRow } from './checkin-settings.service';
import { grantCouponInTx } from './coupons.service';
import { applyGrowthDeltaInTx } from './member-levels.service';
import { getMemberDetail } from './admin-members.service';
import { getPointAccountBeforeAudit } from './member-points.service';
import { trackServerEvent } from '../analytics/analytics-server-events.service';
import { ANALYTICS_EVENT_NAMES } from '@zenith/shared/analytics';
import { memberReferenceCondition } from './member-query-helpers';

function mapMemberCheckin(row: MemberCheckinRow, memberNickname?: string | null) {
  return {
    id: row.id,
    memberId: row.memberId,
    memberNickname: memberNickname ?? null,
    checkinDate: row.checkinDate,
    consecutiveDays: row.consecutiveDays,
    pointsAwarded: row.pointsAwarded,
    experienceAwarded: row.experienceAwarded,
    isMakeup: row.isMakeup,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

export function buildCheckinWhere(params: { memberId?: number; memberKeyword?: string; dateStart?: string; dateEnd?: string }): SQL | undefined {
  return buildWhere(
    memberReferenceCondition(memberCheckins.memberId, params),
    params.dateStart ? gte(memberCheckins.checkinDate, params.dateStart) : undefined,
    params.dateEnd ? lte(memberCheckins.checkinDate, params.dateEnd) : undefined,
  );
}

export async function listMemberCheckins(params: QueryOutputOf<typeof memberCheckinContract.list> & { memberId?: number }) {
  const where = buildCheckinWhere(params);
  const baseQuery = db
    .select({
      id: memberCheckins.id,
      memberId: memberCheckins.memberId,
      memberNickname: members.nickname,
      checkinDate: memberCheckins.checkinDate,
      consecutiveDays: memberCheckins.consecutiveDays,
      pointsAwarded: memberCheckins.pointsAwarded,
      experienceAwarded: memberCheckins.experienceAwarded,
      isMakeup: memberCheckins.isMakeup,
      remark: memberCheckins.remark,
      createdAt: memberCheckins.createdAt,
    })
    .from(memberCheckins)
    .leftJoin(members, eq(memberCheckins.memberId, members.id))
    .where(where)
    .orderBy(desc(memberCheckins.createdAt));

  return buildListResult({
    page: params.page,
    pageSize: params.pageSize,
    count: () => db.$count(memberCheckins, where),
    rows: () => withPagination(baseQuery.$dynamic(), params.page, params.pageSize),
    map: (row) => ({
      id: row.id,
      memberId: row.memberId,
      memberNickname: row.memberNickname ?? null,
      checkinDate: row.checkinDate,
      consecutiveDays: row.consecutiveDays,
      pointsAwarded: row.pointsAwarded,
      experienceAwarded: row.experienceAwarded,
      isMakeup: row.isMakeup,
      remark: row.remark ?? null,
      createdAt: formatDateTime(row.createdAt),
    }),
  });
}

/** 签到日历：按月聚合每日签到人数与补签数（管理端日历视图；明细由悬浮层按日分页懒加载） */
export async function getCheckinCalendar(month: string) {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const endDate = new Date(y, m, 1); // 下月 1 日
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-01`;
  const rows = await db
    .select({
      date: memberCheckins.checkinDate,
      count: count(),
      makeupCount: sql<number>`coalesce(sum(case when ${memberCheckins.isMakeup} then 1 else 0 end), 0)::int`,
    })
    .from(memberCheckins)
    .where(and(gte(memberCheckins.checkinDate, start), lt(memberCheckins.checkinDate, end)))
    .groupBy(memberCheckins.checkinDate)
    .orderBy(memberCheckins.checkinDate);
  return rows.map((r) => ({ date: r.date, count: r.count, makeupCount: r.makeupCount }));
}

export async function getMakeupCheckinBeforeAudit(memberId: number, date: string) {
  const [member, points, existing, recentRows] = await Promise.all([
    getMemberDetail(memberId),
    getPointAccountBeforeAudit(memberId),
    db.query.memberCheckins.findFirst({
      where: and(eq(memberCheckins.memberId, memberId), eq(memberCheckins.checkinDate, date)),
    }),
    db.query.memberCheckins.findMany({
      where: eq(memberCheckins.memberId, memberId),
      orderBy: desc(memberCheckins.checkinDate),
      limit: 5,
    }),
  ]);
  return {
    member,
    points,
    targetDate: date,
    targetCheckin: existing ? mapMemberCheckin(existing) : null,
    recentCheckins: recentRows.map((row) => mapMemberCheckin(row)),
  };
}

async function getRewardForConsecutiveDays(consecutiveDays: number): Promise<{ points: number; experience: number }> {
  const rules = await db.select().from(checkinRules).orderBy(asc(checkinRules.dayNumber));
  if (rules.length === 0) return { points: 0, experience: 0 };
  const lastRule = rules[rules.length - 1];
  const exactRule = rules.find((rule) => rule.dayNumber === consecutiveDays);
  if (exactRule) {
    return { points: exactRule.points, experience: exactRule.experience };
  }
  if (consecutiveDays > lastRule.dayNumber) {
    return { points: lastRule.points, experience: lastRule.experience };
  }
  const fallbackRule = rules
    .filter((rule) => rule.dayNumber <= consecutiveDays)
    .at(-1) ?? rules[0];
  return { points: fallbackRule.points, experience: fallbackRule.experience };
}

async function ensurePointAccount(tx: DbTransaction, memberId: number) {
  const [acc] = await tx.select({ id: memberPointAccounts.id }).from(memberPointAccounts)
    .where(eq(memberPointAccounts.memberId, memberId)).limit(1);
  if (!acc) await tx.insert(memberPointAccounts).values({ memberId });
}

/**
 * 签到 / 补签后触发：按累计签到天数发放未领取的里程碑奖励。
 * - points：原子加积分 + 写流水；coupon：发放优惠券模板。
 * - 优惠券库存不足等业务异常（HTTPException）静默跳过，不阻断签到主流程，下次再试。
 * - 发放记录唯一约束 (memberId, milestoneId) 防重复。
 */
async function awardMilestones(tx: DbTransaction, memberId: number, totalDays: number) {
  const milestones = await tx.select().from(checkinMilestones)
    .where(and(eq(checkinMilestones.enabled, true), lte(checkinMilestones.cumulativeDays, totalDays)))
    .orderBy(asc(checkinMilestones.cumulativeDays));
  if (milestones.length === 0) return;

  const awardedRows = await tx.select({ milestoneId: memberCheckinMilestoneAwards.milestoneId })
    .from(memberCheckinMilestoneAwards)
    .where(eq(memberCheckinMilestoneAwards.memberId, memberId));
  const awardedSet = new Set(awardedRows.map((a) => a.milestoneId));

  const pending = milestones.filter((m) => !awardedSet.has(m.id));
  if (pending.length === 0) return;
  // 积分账户只需确保一次，无需每个里程碑重复查询
  if (pending.some((m) => m.rewardType === 'points' && m.rewardPoints > 0)) {
    await ensurePointAccount(tx, memberId);
  }

  for (const m of pending) {
    if (m.rewardType === 'points') {
      if (m.rewardPoints > 0) {
        const [acc] = await tx.update(memberPointAccounts).set({
          balance: sql`${memberPointAccounts.balance} + ${m.rewardPoints}`,
          totalEarned: sql`${memberPointAccounts.totalEarned} + ${m.rewardPoints}`,
          version: sql`${memberPointAccounts.version} + 1`,
        }).where(eq(memberPointAccounts.memberId, memberId)).returning();
        await tx.insert(memberPointTransactions).values({
          memberId,
          type: 'earn',
          amount: m.rewardPoints,
          balanceAfter: acc.balance,
          bizType: 'checkin_milestone',
          remark: `累计签到 ${m.cumulativeDays} 天里程碑奖励`,
        });
      }
      await tx.insert(memberCheckinMilestoneAwards).values({
        memberId, milestoneId: m.id, cumulativeDays: m.cumulativeDays,
        rewardType: 'points', rewardPoints: m.rewardPoints, couponId: null, memberCouponId: null,
      }).onConflictDoNothing();
    } else if (m.rewardType === 'coupon' && m.couponId) {
      try {
        const mc = await grantCouponInTx(tx, m.couponId, memberId);
        await tx.insert(memberCheckinMilestoneAwards).values({
          memberId, milestoneId: m.id, cumulativeDays: m.cumulativeDays,
          rewardType: 'coupon', rewardPoints: 0, couponId: m.couponId, memberCouponId: mc.id,
        }).onConflictDoNothing();
      } catch (err) {
        if (err instanceof HTTPException) continue;
        throw err;
      }
    }
  }
}

export async function getMemberCheckinStatus() {
  const memberId = currentMemberId();
  const todayStr = dayjs().format('YYYY-MM-DD');
  const yesterdayStr = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  const monthStart = dayjs().startOf('month').format('YYYY-MM-DD');
  const monthEnd = dayjs().endOf('month').format('YYYY-MM-DD');

  const [todayRows, lastRows, totalDays, monthRows] = await Promise.all([
    db.select().from(memberCheckins)
      .where(and(eq(memberCheckins.memberId, memberId), eq(memberCheckins.checkinDate, todayStr)))
      .limit(1),
    db.select().from(memberCheckins)
      .where(eq(memberCheckins.memberId, memberId))
      .orderBy(desc(memberCheckins.checkinDate))
      .limit(1),
    db.$count(memberCheckins, eq(memberCheckins.memberId, memberId)),
    db.select({ checkinDate: memberCheckins.checkinDate })
      .from(memberCheckins)
      .where(and(
        eq(memberCheckins.memberId, memberId),
        gte(memberCheckins.checkinDate, monthStart),
        lte(memberCheckins.checkinDate, monthEnd),
      ))
      .orderBy(asc(memberCheckins.checkinDate)),
  ]);

  const todayRow = todayRows[0];
  const lastRow = lastRows[0];
  const checkedToday = !!todayRow;

  let consecutiveDays = 0;
  if (lastRow?.checkinDate === todayStr) {
    consecutiveDays = lastRow.consecutiveDays;
  } else if (lastRow?.checkinDate === yesterdayStr) {
    consecutiveDays = lastRow.consecutiveDays;
  }

  const potentialTodayDays = checkedToday ? consecutiveDays : consecutiveDays + 1;
  const [todayReward, nextDayReward] = await Promise.all([
    checkedToday
      ? Promise.resolve({
        points: todayRow.pointsAwarded,
        experience: todayRow.experienceAwarded,
      })
      : getRewardForConsecutiveDays(potentialTodayDays),
    getRewardForConsecutiveDays(potentialTodayDays + 1),
  ]);

  return {
    checkedToday,
    consecutiveDays,
    totalDays,
    todayPoints: todayReward.points,
    todayExperience: todayReward.experience,
    nextDayPoints: nextDayReward.points,
    nextDayExperience: nextDayReward.experience,
    thisMonthDates: monthRows.map((row) => row.checkinDate),
  };
}

export async function doCheckin() {
  const memberId = currentMemberId();
  const todayStr = dayjs().format('YYYY-MM-DD');
  const yesterdayStr = dayjs().subtract(1, 'day').format('YYYY-MM-DD');

  const [existing] = await db.select().from(memberCheckins)
    .where(and(eq(memberCheckins.memberId, memberId), eq(memberCheckins.checkinDate, todayStr)))
    .limit(1);
  if (existing) throw new HTTPException(400, { message: '今天已经签到过了' });

  const [yesterdayRow] = await db.select().from(memberCheckins)
    .where(and(eq(memberCheckins.memberId, memberId), eq(memberCheckins.checkinDate, yesterdayStr)))
    .limit(1);
  const consecutiveDays = yesterdayRow ? yesterdayRow.consecutiveDays + 1 : 1;
  const { points, experience } = await getRewardForConsecutiveDays(consecutiveDays);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(memberCheckins).values({
        memberId,
        checkinDate: todayStr,
        consecutiveDays,
        pointsAwarded: points,
        experienceAwarded: experience,
      });

      if (points > 0) {
        const [account] = await tx.select().from(memberPointAccounts)
          .where(eq(memberPointAccounts.memberId, memberId))
          .limit(1);
        if (!account) {
          await tx.insert(memberPointAccounts).values({ memberId });
        }

        const [updatedAccount] = await tx.update(memberPointAccounts).set({
          balance: sql`${memberPointAccounts.balance} + ${points}`,
          totalEarned: sql`${memberPointAccounts.totalEarned} + ${points}`,
          version: sql`${memberPointAccounts.version} + 1`,
        }).where(eq(memberPointAccounts.memberId, memberId)).returning();

        await tx.insert(memberPointTransactions).values({
          memberId,
          type: 'earn',
          amount: points,
          balanceAfter: updatedAccount.balance,
          bizType: 'checkin',
          remark: `第 ${consecutiveDays} 天签到奖励`,
        });
      }

      if (experience > 0) {
        await tx.update(members).set({
          experience: sql`${members.experience} + ${experience}`,
        }).where(eq(members.id, memberId));
        // 经验值同步累加成长值并按阈值自动重定级（等级成长闭环）
        await applyGrowthDeltaInTx(tx, memberId, experience);
      }

      const totalDays = await tx.$count(memberCheckins, eq(memberCheckins.memberId, memberId));
      await awardMilestones(tx, memberId, totalDays);
    });
  } catch (err) {
    rethrowPgUniqueViolation(err, '今天已经签到过了');
    throw err;
  }

  // 服务端权威事件（best-effort，事务已提交后触发）
  trackServerEvent({
    eventName: ANALYTICS_EVENT_NAMES.memberCheckinCompleted,
    memberId,
    tenantId: null,
    properties: {
      memberId,
      consecutiveDays,
      pointsAwarded: points,
      experienceAwarded: experience,
      checkinDate: todayStr,
    },
  });

  return { consecutiveDays, points, experience, checkinDate: todayStr };
}

export async function getMyCheckinHistory(params: QueryOutputOf<typeof memberSelfContract.checkinHistory>) {
  const memberId = currentMemberId();
  const where = buildWhere(
    eq(memberCheckins.memberId, memberId),
    params.dateStart ? gte(memberCheckins.checkinDate, params.dateStart) : undefined,
    params.dateEnd ? lte(memberCheckins.checkinDate, params.dateEnd) : undefined,
  );
  return buildListResult({
    page: params.page,
    pageSize: params.pageSize,
    count: () => db.$count(memberCheckins, where),
    rows: () => db.select().from(memberCheckins)
      .where(where)
      .orderBy(desc(memberCheckins.checkinDate))
      .limit(params.pageSize)
      .offset(pageOffset(params.page, params.pageSize)),
    map: (row) => mapMemberCheckin(row),
  });
}

function isValidDateStr(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs(value).isValid();
}

/**
 * 补签：mode='admin' 由后台为会员补签（不消耗积分，须提供原因 reason 记入备注）；
 * mode='self' 会员自助补签（消耗设置中的积分）。
 * 仅可补签 [今天-makeupMaxDays, 昨天] 区间内、尚未签到的日期；连续天数以补签日前一天为基准计算。
 */
export async function doMakeupCheckin(params: { memberId: number; date: string; mode: 'admin' | 'self'; reason?: string }) {
  const { memberId, date, mode, reason } = params;
  if (!isValidDateStr(date)) throw new HTTPException(400, { message: '补签日期格式不正确' });
  const target = dayjs(date);
  const dateStr = target.format('YYYY-MM-DD');
  const todayStr = dayjs().format('YYYY-MM-DD');
  if (dateStr >= todayStr) throw new HTTPException(400, { message: '只能补签过去的日期' });

  const settings = await getCheckinSettingsRow();
  if (mode === 'self' && !settings.makeupEnabled) throw new HTTPException(400, { message: '补签功能未开启' });
  const earliestStr = dayjs().subtract(settings.makeupMaxDays, 'day').format('YYYY-MM-DD');
  if (dateStr < earliestStr) throw new HTTPException(400, { message: `仅可补签最近 ${settings.makeupMaxDays} 天内的签到` });

  const [member] = await db.select({ id: members.id }).from(members)
    .where(and(eq(members.id, memberId), isNull(members.deletedAt))).limit(1);
  requireRow(member, '会员不存在');

  const [existing] = await db.select({ id: memberCheckins.id }).from(memberCheckins)
    .where(and(eq(memberCheckins.memberId, memberId), eq(memberCheckins.checkinDate, dateStr))).limit(1);
  if (existing) throw new HTTPException(400, { message: '该日期已签到，无需补签' });

  const prevStr = target.subtract(1, 'day').format('YYYY-MM-DD');
  const [prevRow] = await db.select().from(memberCheckins)
    .where(and(eq(memberCheckins.memberId, memberId), eq(memberCheckins.checkinDate, prevStr))).limit(1);
  const consecutiveDays = prevRow ? prevRow.consecutiveDays + 1 : 1;
  const { points, experience } = await getRewardForConsecutiveDays(consecutiveDays);
  const costPoints = mode === 'self' ? settings.makeupCostPoints : 0;

  try {
    return await db.transaction(async (tx) => {
      await ensurePointAccount(tx, memberId);

      if (costPoints > 0) {
        const deducted = await tx.update(memberPointAccounts).set({
          balance: sql`${memberPointAccounts.balance} - ${costPoints}`,
          totalSpent: sql`${memberPointAccounts.totalSpent} + ${costPoints}`,
          version: sql`${memberPointAccounts.version} + 1`,
        }).where(and(eq(memberPointAccounts.memberId, memberId), gte(memberPointAccounts.balance, costPoints))).returning();
        if (deducted.length === 0) throw new HTTPException(400, { message: '积分余额不足，无法补签' });
        await tx.insert(memberPointTransactions).values({
          memberId,
          type: 'redeem',
          amount: -costPoints,
          balanceAfter: deducted[0].balance,
          bizType: 'checkin_makeup',
          remark: `补签 ${dateStr} 消耗积分`,
        });
      }

      await tx.insert(memberCheckins).values({
        memberId,
        checkinDate: dateStr,
        consecutiveDays,
        pointsAwarded: points,
        experienceAwarded: experience,
        isMakeup: true,
        remark: mode === 'admin' && reason ? reason : null,
      });

      if (points > 0) {
        const [acc] = await tx.update(memberPointAccounts).set({
          balance: sql`${memberPointAccounts.balance} + ${points}`,
          totalEarned: sql`${memberPointAccounts.totalEarned} + ${points}`,
          version: sql`${memberPointAccounts.version} + 1`,
        }).where(eq(memberPointAccounts.memberId, memberId)).returning();
        await tx.insert(memberPointTransactions).values({
          memberId,
          type: 'earn',
          amount: points,
          balanceAfter: acc.balance,
          bizType: 'checkin_makeup',
          remark: `补签 ${dateStr} 第 ${consecutiveDays} 天奖励`,
        });
      }

      if (experience > 0) {
        await tx.update(members).set({
          experience: sql`${members.experience} + ${experience}`,
        }).where(eq(members.id, memberId));
        // 经验值同步累加成长值并按阈值自动重定级（等级成长闭环）
        await applyGrowthDeltaInTx(tx, memberId, experience);
      }

      const totalDays = await tx.$count(memberCheckins, eq(memberCheckins.memberId, memberId));
      await awardMilestones(tx, memberId, totalDays);

      return { checkinDate: dateStr, pointsAwarded: points, experienceAwarded: experience, costPoints, consecutiveDays };
    });
  } catch (err) {
    rethrowPgUniqueViolation(err, '该日期已签到，无需补签');
    throw err;
  }
}

/** 会员自助补签（消耗积分）。*/
export async function doMyMakeupCheckin(date: string) {
  return doMakeupCheckin({ memberId: currentMemberId(), date, mode: 'self' });
}

/** 会员里程碑达成情况：列出全部启用里程碑 + 当前会员是否已达成。*/
export async function getMyMilestones() {
  const memberId = currentMemberId();
  const [totalDays, milestones, awardedRows] = await Promise.all([
    db.$count(memberCheckins, eq(memberCheckins.memberId, memberId)),
    db.query.checkinMilestones.findMany({
      where: eq(checkinMilestones.enabled, true),
      with: { coupon: { columns: { name: true } } },
      orderBy: asc(checkinMilestones.cumulativeDays),
    }),
    db.select({
      milestoneId: memberCheckinMilestoneAwards.milestoneId,
      createdAt: memberCheckinMilestoneAwards.createdAt,
    }).from(memberCheckinMilestoneAwards).where(eq(memberCheckinMilestoneAwards.memberId, memberId)),
  ]);

  const awardedMap = new Map(awardedRows.map((a) => [a.milestoneId, a.createdAt]));

  return {
    totalDays,
    milestones: milestones.map((m) => {
      const achievedAt = awardedMap.get(m.id);
      return {
        id: m.id,
        title: m.title,
        cumulativeDays: m.cumulativeDays,
        rewardType: m.rewardType,
        rewardPoints: m.rewardPoints,
        couponName: m.coupon?.name ?? null,
        achieved: awardedMap.has(m.id),
        achievedAt: achievedAt ? formatDateTime(achievedAt) : null,
      };
    }),
  };
}
