/**
 * 会员邀请裂变服务。
 *
 * - 邀请码懒生成（首次访问邀请页时补齐，全局唯一）
 * - 注册时携带邀请码 → 绑定 invited_by，并按 system_config `member_invite_reward_points`
 *   给邀请人发放积分（流水 bizType='invite', bizId=新会员ID，天然幂等）+ 站内通知
 */
import crypto from 'node:crypto';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { members, memberPointTransactions } from '../../db/schema';
import { getConfigNumber } from '../../lib/system-config';
import { currentMemberId } from '../../lib/member-context';
import { formatDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import { earnPoints, ensurePointAccount } from './member-points.service';
import { createMemberNotification } from './member-notifications.service';

/** 8 位大写字母数字邀请码（去掉易混淆字符）*/
function genInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return code;
}

/** 获取当前会员邀请码（无则懒生成，唯一冲突自动重试）*/
export async function ensureMyInviteCode(): Promise<string> {
  const memberId = currentMemberId();
  const [m] = await db.select({ inviteCode: members.inviteCode }).from(members).where(eq(members.id, memberId)).limit(1);
  if (m?.inviteCode) return m.inviteCode;
  for (let i = 0; i < 5; i++) {
    const code = genInviteCode();
    const updated = await db.update(members)
      .set({ inviteCode: code })
      .where(and(eq(members.id, memberId), isNull(members.inviteCode)))
      .returning({ inviteCode: members.inviteCode })
      .catch(() => []);
    if (updated.length > 0 && updated[0].inviteCode) return updated[0].inviteCode;
    // 并发已生成则回读
    const [again] = await db.select({ inviteCode: members.inviteCode }).from(members).where(eq(members.id, memberId)).limit(1);
    if (again?.inviteCode) return again.inviteCode;
  }
  throw new Error('邀请码生成失败');
}

/** 按邀请码查邀请人（未删除且启用）*/
export async function findInviterByCode(code: string): Promise<number | null> {
  const [m] = await db.select({ id: members.id }).from(members)
    .where(and(eq(members.inviteCode, code.trim().toUpperCase()), isNull(members.deletedAt), eq(members.status, 'active')))
    .limit(1);
  return m?.id ?? null;
}

/**
 * 注册成功后处理邀请关系：绑定 invited_by + 邀请人积分奖励 + 通知。
 * best-effort：任何失败只记日志，不影响注册主流程。
 */
export async function applyInviteOnRegister(newMemberId: number, inviteCode: string, newMemberNickname: string): Promise<void> {
  try {
    const inviterId = await findInviterByCode(inviteCode);
    if (!inviterId || inviterId === newMemberId) return;
    await db.update(members).set({ invitedBy: inviterId }).where(eq(members.id, newMemberId));

    const reward = await getConfigNumber('member_invite_reward_points', 0);
    if (reward > 0) {
      await ensurePointAccount(inviterId);
      await earnPoints(inviterId, reward, {
        bizType: 'invite',
        bizId: String(newMemberId),
        remark: `邀请「${newMemberNickname}」注册奖励`,
      });
    }
    await createMemberNotification({
      memberId: inviterId,
      type: 'invite_reward',
      title: '邀请成功',
      content: reward > 0
        ? `「${newMemberNickname}」通过你的邀请码注册成功，奖励 ${reward} 积分已到账。`
        : `「${newMemberNickname}」通过你的邀请码注册成功。`,
      bizId: String(newMemberId),
    });
  } catch (err) {
    logger.warn(`[MemberInvite] 邀请奖励处理失败 newMemberId=${newMemberId}: ${(err as Error).message}`);
  }
}

/** 我的邀请汇总：邀请码 + 已邀人数 + 累计奖励 + 最近邀请列表 */
export async function getMyInviteSummary() {
  const memberId = currentMemberId();
  const inviteCode = await ensureMyInviteCode();
  const [invitedCountRow, rewardRows, recentRows] = await Promise.all([
    db.select({ v: count() }).from(members)
      .where(and(eq(members.invitedBy, memberId), isNull(members.deletedAt))),
    db.select({ amount: memberPointTransactions.amount }).from(memberPointTransactions)
      .where(and(eq(memberPointTransactions.memberId, memberId), eq(memberPointTransactions.bizType, 'invite'))),
    db.select({ id: members.id, nickname: members.nickname, createdAt: members.createdAt }).from(members)
      .where(and(eq(members.invitedBy, memberId), isNull(members.deletedAt)))
      .orderBy(desc(members.id))
      .limit(20),
  ]);
  return {
    inviteCode,
    invitedCount: invitedCountRow[0]?.v ?? 0,
    totalRewardPoints: rewardRows.reduce((sum, r) => sum + Math.max(0, r.amount), 0),
    recentInvitees: recentRows.map((r) => ({ id: r.id, nickname: r.nickname, createdAt: formatDateTime(r.createdAt) })),
  };
}
