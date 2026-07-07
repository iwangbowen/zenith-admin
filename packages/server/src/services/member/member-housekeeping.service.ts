/**
 * 会员数据例行维护（系统周期任务 member-housekeeping 调用）。
 *
 * - 券过期：复用 coupons.service 的 expireCoupons()，修正统计口径
 * - expireInactivePoints()：按 system_config `member_point_expire_days`（0=关闭）
 *   清零长期无积分变动账户的余额，走 changePoints(type='expire') 记流水，可审计可对账
 * - grantBirthdayGifts()：生日当天自动发放积分/优惠券（system_configs 控制，按年幂等防重发）
 * - cleanupMemberLoginLogs()：按 system_config `member_login_log_retention_days`（0=不清理）
 *   删除超期登录日志，防止无限增长
 */
import dayjs from 'dayjs';
import { and, eq, gt, isNull, like, lt, lte } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { memberCoupons, memberLoginLogs, memberPointAccounts, memberPointTransactions, members } from '../../db/schema';
import { getConfigNumber } from '../../lib/system-config';
import logger from '../../lib/logger';
import { changePoints, earnPoints, ensurePointAccount } from './member-points.service';
import { expireCoupons, grantCouponInTx } from './coupons.service';

/** 未使用且已过实际过期时间的券批量置为 expired，返回处理数量 */
export async function expireMemberCoupons(): Promise<number> {
  return expireCoupons();
}

/**
 * 积分不活跃过期：清零「余额 > 0 且超过 N 天无任何积分变动」账户的全部余额。
 * 以 member_point_accounts.updatedAt 为最后变动时间（任何记账都会刷新）。
 * 逐账户走 changePoints 统一记账（乐观锁 + expire 流水），单账户失败不影响其余账户。
 */
export async function expireInactivePoints(): Promise<{ expired: number; skipped: number }> {
  const days = await getConfigNumber('member_point_expire_days', 0);
  if (days <= 0) return { expired: 0, skipped: 0 };

  const cutoff = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({ memberId: memberPointAccounts.memberId, balance: memberPointAccounts.balance })
    .from(memberPointAccounts)
    .innerJoin(members, eq(members.id, memberPointAccounts.memberId))
    .where(and(
      gt(memberPointAccounts.balance, 0),
      lte(memberPointAccounts.updatedAt, cutoff),
      isNull(members.deletedAt),
    ));

  let expired = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      await changePoints({
        memberId: row.memberId,
        type: 'expire',
        amount: -row.balance,
        bizType: 'points_inactive_expire',
        remark: `超过 ${days} 天无积分变动，余额自动过期`,
      });
      expired += 1;
    } catch (err) {
      // 窗口期内发生并发变动（余额变化/乐观锁重试耗尽）则跳过，下个周期重新评估
      skipped += 1;
      logger.warn(`[MemberHousekeeping] 积分过期跳过 memberId=${row.memberId}: ${(err as Error).message}`);
    }
  }
  return { expired, skipped };
}

/** 删除超过保留期的会员登录日志，返回删除数量 */
export async function cleanupMemberLoginLogs(): Promise<number> {
  const days = await getConfigNumber('member_login_log_retention_days', 180);
  if (days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  // 每日增量清理，returning 行数可控
  const deleted = await db.delete(memberLoginLogs)
    .where(lt(memberLoginLogs.createdAt, cutoff))
    .returning({ id: memberLoginLogs.id });
  return deleted.length;
}

/**
 * 生日礼自动发放：生日为今天（MM-DD 匹配）的启用会员，
 * 发放 `member_birthday_points` 积分与/或 `member_birthday_coupon_id` 优惠券。
 * 幂等：积分以流水 (bizType='birthday', bizId=年份) 查重；券以 member_coupons 同标记查重，每年最多一次。
 */
export async function grantBirthdayGifts(): Promise<{ points: number; coupons: number; skipped: number }> {
  const [giftPoints, giftCouponId] = await Promise.all([
    getConfigNumber('member_birthday_points', 0),
    getConfigNumber('member_birthday_coupon_id', 0),
  ]);
  if (giftPoints <= 0 && giftCouponId <= 0) return { points: 0, coupons: 0, skipped: 0 };

  const monthDay = dayjs().format('MM-DD');
  const year = String(dayjs().year());
  // birthday 存储为 YYYY-MM-DD，按后 5 位匹配今天
  const birthdayMembers = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.status, 'active'), isNull(members.deletedAt), like(members.birthday, `%-${monthDay}`)));

  let pointsGranted = 0;
  let couponsGranted = 0;
  let skipped = 0;
  for (const m of birthdayMembers) {
    try {
      if (giftPoints > 0) {
        const [exist] = await db.select({ id: memberPointTransactions.id }).from(memberPointTransactions)
          .where(and(
            eq(memberPointTransactions.memberId, m.id),
            eq(memberPointTransactions.bizType, 'birthday'),
            eq(memberPointTransactions.bizId, year),
          )).limit(1);
        if (!exist) {
          await ensurePointAccount(m.id);
          await earnPoints(m.id, giftPoints, { bizType: 'birthday', bizId: year, remark: `${year} 年生日礼积分` });
          pointsGranted += 1;
        }
      }
      if (giftCouponId > 0) {
        const [exist] = await db.select({ id: memberCoupons.id }).from(memberCoupons)
          .where(and(
            eq(memberCoupons.memberId, m.id),
            eq(memberCoupons.bizType, 'birthday'),
            eq(memberCoupons.bizId, year),
          )).limit(1);
        if (!exist) {
          await db.transaction((tx) => grantCouponInTx(tx, giftCouponId, m.id, { bizType: 'birthday', bizId: year }));
          couponsGranted += 1;
        }
      }
    } catch (err) {
      // 库存不足/限领等业务异常跳过该会员，不阻断整体发放
      skipped += 1;
      const msg = err instanceof HTTPException ? err.message : (err as Error).message;
      logger.warn(`[MemberHousekeeping] 生日礼发放跳过 memberId=${m.id}: ${msg}`);
    }
  }
  return { points: pointsGranted, coupons: couponsGranted, skipped };
}

/** 每日例行维护入口（券过期 → 积分不活跃过期 → 生日礼发放 → 登录日志清理）*/
export async function runMemberHousekeeping(): Promise<string> {
  const coupons = await expireMemberCoupons();
  const points = await expireInactivePoints();
  const birthday = await grantBirthdayGifts();
  const logs = await cleanupMemberLoginLogs();
  return `券过期 ${coupons} 张；积分过期 ${points.expired} 户（跳过 ${points.skipped}）；生日礼积分 ${birthday.points} 人/发券 ${birthday.coupons} 人（跳过 ${birthday.skipped}）；清理登录日志 ${logs} 条`;
}
