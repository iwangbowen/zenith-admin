import dayjs from 'dayjs';
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import {
  checkinRules,
  memberCheckins,
  memberPointAccounts,
  memberPointTransactions,
  members,
} from '../db/schema';
import type { MemberCheckinRow } from '../db/schema';
import { formatDateTime } from '../lib/datetime';
import { currentMemberId } from '../lib/member-context';
import { pageOffset } from '../lib/pagination';
import { escapeLike, withPagination } from '../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../lib/db-errors';

function mapMemberCheckin(row: MemberCheckinRow, memberNickname?: string | null) {
  return {
    id: row.id,
    memberId: row.memberId,
    memberNickname: memberNickname ?? null,
    checkinDate: row.checkinDate,
    consecutiveDays: row.consecutiveDays,
    pointsAwarded: row.pointsAwarded,
    experienceAwarded: row.experienceAwarded,
    createdAt: formatDateTime(row.createdAt),
  };
}

export async function listMemberCheckins(params: {
  page: number;
  pageSize: number;
  memberId?: number;
  memberKeyword?: string;
  dateStart?: string;
  dateEnd?: string;
}) {
  const conditions: SQL[] = [];
  if (params.memberId) {
    conditions.push(eq(memberCheckins.memberId, params.memberId));
  } else if (params.memberKeyword) {
    const numId = /^\d+$/.test(params.memberKeyword) ? parseInt(params.memberKeyword, 10) : null;
    if (numId) {
      conditions.push(eq(memberCheckins.memberId, numId));
    } else {
      const subq = db.select({ id: members.id }).from(members).where(ilike(members.nickname, `%${escapeLike(params.memberKeyword)}%`));
      conditions.push(inArray(memberCheckins.memberId, subq));
    }
  }
  if (params.dateStart) conditions.push(gte(memberCheckins.checkinDate, params.dateStart));
  if (params.dateEnd) conditions.push(lte(memberCheckins.checkinDate, params.dateEnd));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const baseQuery = db
    .select({
      id: memberCheckins.id,
      memberId: memberCheckins.memberId,
      memberNickname: members.nickname,
      checkinDate: memberCheckins.checkinDate,
      consecutiveDays: memberCheckins.consecutiveDays,
      pointsAwarded: memberCheckins.pointsAwarded,
      experienceAwarded: memberCheckins.experienceAwarded,
      createdAt: memberCheckins.createdAt,
    })
    .from(memberCheckins)
    .leftJoin(members, eq(memberCheckins.memberId, members.id))
    .where(where)
    .orderBy(desc(memberCheckins.createdAt));

  const [total, rows] = await Promise.all([
    db.$count(memberCheckins, where),
    withPagination(baseQuery.$dynamic(), params.page, params.pageSize),
  ]);

  return {
    list: rows.map((row) => ({
      id: row.id,
      memberId: row.memberId,
      memberNickname: row.memberNickname ?? null,
      checkinDate: row.checkinDate,
      consecutiveDays: row.consecutiveDays,
      pointsAwarded: row.pointsAwarded,
      experienceAwarded: row.experienceAwarded,
      createdAt: formatDateTime(row.createdAt),
    })),
    total,
    page: params.page,
    pageSize: params.pageSize,
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
      }
    });
  } catch (err) {
    rethrowPgUniqueViolation(err, '今天已经签到过了');
    throw err;
  }

  return { consecutiveDays, points, experience, checkinDate: todayStr };
}

export async function getMyCheckinHistory(params: { page: number; pageSize: number; dateStart?: string; dateEnd?: string }) {
  const memberId = currentMemberId();
  const conds: SQL[] = [eq(memberCheckins.memberId, memberId)];
  if (params.dateStart) conds.push(gte(memberCheckins.checkinDate, params.dateStart));
  if (params.dateEnd) conds.push(lte(memberCheckins.checkinDate, params.dateEnd));
  const where = and(...conds);
  const [total, rows] = await Promise.all([
    db.$count(memberCheckins, where),
    db.select().from(memberCheckins)
      .where(where)
      .orderBy(desc(memberCheckins.checkinDate))
      .limit(params.pageSize)
      .offset(pageOffset(params.page, params.pageSize)),
  ]);

  return {
    list: rows.map((row) => mapMemberCheckin(row)),
    total,
    page: params.page,
    pageSize: params.pageSize,
  };
}
