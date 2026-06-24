import { eq, and, asc } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { mpFans, members, memberPointAccounts, memberWallets, memberLevels } from '../db/schema';
import type { MpFanRow } from '../db/schema';
import { tenantScope, currentCreateTenantId } from '../lib/tenant';
import type { DbTransaction } from '../db/types';
import { mapMpFan } from './mp-fan.service';

async function getFanScoped(fanId: number): Promise<MpFanRow> {
  const [fan] = await db.select().from(mpFans).where(and(eq(mpFans.id, fanId), tenantScope(mpFans))).limit(1);
  if (!fan) throw new HTTPException(404, { message: '粉丝不存在' });
  return fan;
}

async function defaultMemberLevelId(): Promise<number | null> {
  const [lv] = await db.select({ id: memberLevels.id }).from(memberLevels)
    .where(eq(memberLevels.status, 'enabled')).orderBy(asc(memberLevels.level)).limit(1);
  return lv?.id ?? null;
}

/** 在事务内创建会员并初始化积分/钱包账户，返回会员 id。 */
async function insertMember(tx: DbTransaction, data: { nickname: string; avatar: string | null; tenantId: number | null }): Promise<number> {
  const levelId = await defaultMemberLevelId();
  const [member] = await tx.insert(members).values({
    nickname: data.nickname || '微信用户',
    avatar: data.avatar,
    status: 'active',
    levelId,
    registerSource: 'wechat_mp',
    tenantId: data.tenantId,
  }).returning();
  await tx.insert(memberPointAccounts).values({ memberId: member.id });
  await tx.insert(memberWallets).values({ memberId: member.id });
  return member.id;
}

/** 由粉丝创建并绑定一个新会员（管理端「创建会员」）。 */
export async function createMemberForFan(fanId: number) {
  const fan = await getFanScoped(fanId);
  if (fan.memberId) throw new HTTPException(400, { message: '该粉丝已绑定会员' });
  const tenantId = currentCreateTenantId();
  const updated = await db.transaction(async (tx) => {
    const memberId = await insertMember(tx, { nickname: fan.nickname ?? '', avatar: fan.avatar ?? null, tenantId });
    const [f] = await tx.update(mpFans).set({ memberId }).where(eq(mpFans.id, fanId)).returning();
    return f;
  });
  return mapMpFan(updated);
}

/** 绑定到已有会员。 */
export async function bindFanToMember(fanId: number, memberId: number) {
  await getFanScoped(fanId);
  const [member] = await db.select({ id: members.id }).from(members).where(and(eq(members.id, memberId), tenantScope(members))).limit(1);
  if (!member) throw new HTTPException(404, { message: '会员不存在' });
  const [f] = await db.update(mpFans).set({ memberId }).where(eq(mpFans.id, fanId)).returning();
  return mapMpFan(f);
}

/** 解绑会员。 */
export async function unbindFanMember(fanId: number) {
  await getFanScoped(fanId);
  const [f] = await db.update(mpFans).set({ memberId: null }).where(eq(mpFans.id, fanId)).returning();
  return mapMpFan(f);
}

/**
 * 关注事件「自动注册会员」（公开回调调用，无登录上下文，tenantId 由账号传入）。
 * 先 upsert 粉丝，再为未绑定会员的粉丝创建并绑定会员。非阻塞、幂等。
 */
export async function autoCreateMemberOnSubscribe(
  accountId: number,
  tenantId: number | null,
  openid: string,
  info?: { nickname?: string | null; avatar?: string | null; unionid?: string | null },
): Promise<void> {
  await db.insert(mpFans).values({
    accountId,
    openid,
    nickname: info?.nickname ?? null,
    avatar: info?.avatar ?? null,
    unionid: info?.unionid ?? null,
    subscribe: 'subscribed',
    tenantId,
  }).onConflictDoNothing({ target: [mpFans.accountId, mpFans.openid] });

  const [fan] = await db.select().from(mpFans).where(and(eq(mpFans.accountId, accountId), eq(mpFans.openid, openid))).limit(1);
  if (!fan || fan.memberId) return;

  await db.transaction(async (tx) => {
    const memberId = await insertMember(tx, { nickname: fan.nickname ?? '', avatar: fan.avatar ?? null, tenantId });
    await tx.update(mpFans).set({ memberId }).where(eq(mpFans.id, fan.id));
  });
}
