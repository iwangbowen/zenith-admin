/**
 * 会员后台管理服务：会员 CRUD / 启禁 / 重置密码 / 导出。
 * 复用 member-auth.service 的 mapMember / ensureMemberExists。
 */
import { hashPassword } from '../../lib/password';
import { and, asc, desc, eq, gte, lte, inArray, isNull, or, count, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { members, memberLevels, memberPointAccounts, memberWallets, memberPointTransactions, memberWalletTransactions, memberCoupons, memberLoginLogs, memberTagBindings, memberCheckins, mpFans } from '../../db/schema';
import type { MemberRow } from '../../db/schema';
import { mapMember, ensureMemberExists } from './member-auth.service';
import { forceLogoutAllByMember } from '../../lib/member-session-manager';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { formatDateTime, parseDateRangeStart, parseDateRangeEnd } from '../../lib/datetime';
import { registerRevealSource } from '../../lib/data-mask/reveal';
import { mapPointAccount, mapPointTransaction, ensurePointAccount } from './member-points.service';
import { mapWallet, mapWalletTransaction, ensureWallet } from './member-wallet.service';
import type { MemberStatus } from '@zenith/shared/member';

export interface ListMembersQuery {
  keyword?: string;
  status?: MemberStatus;
  levelId?: number;
  tagId?: number;
  page: number;
  pageSize: number;
}

export function buildMemberWhere(q: { keyword?: string; status?: MemberStatus; levelId?: number; tagId?: number }): SQL | undefined {
  // 软删除的会员对列表/下拉/导出一律不可见
  const conds: (SQL | undefined)[] = [
    isNull(members.deletedAt),
    keywordCondition(q.keyword, [members.nickname, members.phone, members.username, members.email], 'ilike'),
  ];
  if (q.status) conds.push(eq(members.status, q.status));
  if (q.levelId) conds.push(eq(members.levelId, q.levelId));
  if (q.tagId) {
    conds.push(inArray(
      members.id,
      db.select({ id: memberTagBindings.memberId }).from(memberTagBindings).where(eq(memberTagBindings.tagId, q.tagId)),
    ));
  }
  return and(...conds);
}

// ─── 列表 / 详情 ──────────────────────────────────────────────────────────────
type TagBindingWithTag = { tag: { id: number; name: string; color: string | null } | null };

function mapBoundTags(bindings?: TagBindingWithTag[]) {
  return (bindings ?? [])
    .filter((b): b is TagBindingWithTag & { tag: NonNullable<TagBindingWithTag['tag']> } => !!b.tag)
    .map((b) => ({ id: b.tag.id, name: b.tag.name, color: b.tag.color ?? null }));
}

const memberRelationSelect = {
  level: { columns: { name: true } },
  pointAccount: { columns: { balance: true } },
  wallet: { columns: { balance: true } },
  tagBindings: { with: { tag: { columns: { id: true, name: true, color: true } } } },
} as const;

export async function listMembers(q: ListMembersQuery) {
  const where = buildMemberWhere(q);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(members, where),
    rows: () => db.query.members.findMany({
      where,
      with: memberRelationSelect,
      orderBy: desc(members.id),
      limit: q.pageSize,
      offset: pageOffset(q.page, q.pageSize),
    }),
    map: (r) =>
      mapMember(r, {
        levelName: r.level?.name ?? null,
        pointBalance: r.pointAccount?.balance ?? 0,
        walletBalance: r.wallet?.balance ?? 0,
        tags: mapBoundTags(r.tagBindings),
      }),
  });
}

// ─── 轻量搜索下拉（积分/钱包调整、发券选择会员）───────────────────────────────
export async function getMemberOptions(keyword?: string) {
  const where = buildMemberWhere({ keyword });
  const rows = await db.query.members.findMany({
    where,
    columns: { id: true, nickname: true, phone: true, username: true },
    with: { level: { columns: { name: true } } },
    orderBy: desc(members.id),
    limit: 20,
  });
  return rows.map((r) => ({
    id: r.id,
    nickname: r.nickname,
    phone: r.phone ?? null,
    username: r.username ?? null,
    levelName: r.level?.name ?? null,
  }));
}

export async function getMemberDetail(id: number) {
  const row = await db.query.members.findFirst({
    where: and(eq(members.id, id), isNull(members.deletedAt)),
    with: memberRelationSelect,
  });
  const member = requireRow(row, '会员不存在');
  return mapMember(member, {
    levelName: member.level?.name ?? null,
    pointBalance: member.pointAccount?.balance ?? 0,
    walletBalance: member.wallet?.balance ?? 0,
    tags: mapBoundTags(member.tagBindings),
  });
}

// 按需查看明文（手机号 / 邮箱）：复用后台详情的可见性口径
registerRevealSource('Member', (id) => getMemberDetail(id) as Promise<Record<string, unknown>>);

export async function getMemberBeforeAudit(id: number) {
  return getMemberDetail(id);
}

export async function getMembersBeforeAudit(ids: number[]) {
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) return [];
  const rows = await db.query.members.findMany({
    where: and(inArray(members.id, validIds), isNull(members.deletedAt)),
    with: {
      level: { columns: { name: true } },
      pointAccount: { columns: { balance: true } },
      wallet: { columns: { balance: true } },
    },
    orderBy: asc(members.id),
  });
  return rows.map((r) =>
    mapMember(r, {
      levelName: r.level?.name ?? null,
      pointBalance: r.pointAccount?.balance ?? 0,
      walletBalance: r.wallet?.balance ?? 0,
    }),
  );
}

// ─── 写操作 ───────────────────────────────────────────────────────────────────
export interface AdminCreateMemberInput {
  username?: string;
  phone?: string;
  email?: string;
  password?: string;
  nickname: string;
  gender?: string | null;
  status?: MemberStatus;
  levelId?: number | null;
  remark?: string | null;
  /** 注册来源：后台创建 admin（默认）/ 批量导入 import */
  registerSource?: 'admin' | 'import';
}

export async function createMember(input: AdminCreateMemberInput) {
  const hashed = input.password ? await hashPassword(input.password) : null;
  const member = await db.transaction(async (tx) => {
    // 未显式指定等级时按成长值 0 匹配初始等级（阈值 ≤0 的最高档），
    // 避免新会员出现"无等级"空档；与 applyGrowthDeltaInTx 的定级口径一致
    let levelId = input.levelId ?? null;
    if (levelId == null) {
      const [initial] = await tx
        .select({ id: memberLevels.id })
        .from(memberLevels)
        .where(and(eq(memberLevels.status, 'enabled'), lte(memberLevels.growthThreshold, 0)))
        .orderBy(desc(memberLevels.growthThreshold))
        .limit(1);
      levelId = initial?.id ?? null;
    }
    let created: MemberRow;
    try {
      [created] = await tx
        .insert(members)
        .values({
          username: input.username ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          password: hashed,
          nickname: input.nickname,
          gender: input.gender ?? null,
          status: input.status ?? 'active',
          levelId,
          remark: input.remark ?? null,
          registerSource: input.registerSource ?? 'admin',
        })
        .returning();
    } catch (err) {
      rethrowPgUniqueViolation(err, '用户名、手机号或邮箱已被占用');
      throw err;
    }
    await tx.insert(memberPointAccounts).values({ memberId: created.id });
    await tx.insert(memberWallets).values({ memberId: created.id });
    return created;
  });
  return mapMember(member);
}

export interface AdminUpdateMemberInput {
  nickname?: string;
  phone?: string | null;
  email?: string | null;
  gender?: string | null;
  avatar?: string | null;
  status?: MemberStatus;
  levelId?: number | null;
  remark?: string | null;
}

/** 手动指定等级时抬升成长值至该等级门槛，避免下一次成长值变动触发自动定级时被回退 */
async function raiseGrowthToLevelThreshold(ids: number[], levelId: number): Promise<void> {
  const [lvl] = await db.select({ growthThreshold: memberLevels.growthThreshold })
    .from(memberLevels).where(eq(memberLevels.id, levelId)).limit(1);
  if (!lvl || lvl.growthThreshold <= 0) return;
  await db.update(members)
    .set({ growthValue: sql`GREATEST(${members.growthValue}, ${lvl.growthThreshold})` })
    .where(and(inArray(members.id, ids), isNull(members.deletedAt)));
}

export async function updateMember(id: number, input: AdminUpdateMemberInput) {
  const current = await ensureMemberExists(id);
  // 禁止把最后一个登录凭证清空（与创建时「至少一个凭证」同一条规则）
  const nextPhone = input.phone !== undefined ? input.phone : current.phone;
  const nextEmail = input.email !== undefined ? input.email : current.email;
  if (!current.username && !nextPhone && !nextEmail) {
    throw new HTTPException(400, { message: '用户名、手机号、邮箱至少保留一个，否则该会员将无法登录' });
  }
  const patch: Record<string, unknown> = {};
  if (input.nickname !== undefined) patch.nickname = input.nickname;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.email !== undefined) patch.email = input.email;
  if (input.gender !== undefined) patch.gender = input.gender;
  if (input.avatar !== undefined) patch.avatar = input.avatar;
  if (input.status !== undefined) patch.status = input.status;
  if (input.levelId !== undefined) patch.levelId = input.levelId;
  if (input.remark !== undefined) patch.remark = input.remark;
  if (Object.keys(patch).length > 0) {
    try {
      await db.update(members).set(patch).where(eq(members.id, id));
    } catch (err) {
      rethrowPgUniqueViolation(err, '手机号或邮箱已被占用');
      throw err;
    }
  }
  if (typeof input.levelId === 'number') await raiseGrowthToLevelThreshold([id], input.levelId);
  // 状态被改为非 active 时强制下线
  if (input.status && input.status !== 'active') await forceLogoutAllByMember(id);
  return getMemberDetail(id);
}

export async function setMemberStatus(id: number, status: MemberStatus) {
  await ensureMemberExists(id);
  await db.update(members).set({ status }).where(eq(members.id, id));
  if (status !== 'active') await forceLogoutAllByMember(id);
  return getMemberDetail(id);
}

export async function deleteMember(id: number) {
  await ensureMemberExists(id);
  await forceLogoutAllByMember(id);
  // 软删除：保留积分/钱包流水、券码、签到等历史数据用于审计与对账；
  // 唯一索引为部分索引（deleted_at IS NULL），删除后手机号/邮箱/用户名可再次注册
  await db.update(members).set({ deletedAt: new Date() }).where(eq(members.id, id));
}

export async function resetMemberPasswordByAdmin(id: number, newPassword: string) {
  await ensureMemberExists(id);
  const hashed = await hashPassword(newPassword);
  await db.update(members).set({ password: hashed }).where(eq(members.id, id));
  await forceLogoutAllByMember(id);
}

// ─── 批量操作 ─────────────────────────────────────────────────────────────────
export async function batchSetMemberStatus(ids: number[], status: MemberStatus): Promise<number> {
  if (ids.length === 0) return 0;
  const updated = await db.update(members).set({ status })
    .where(and(inArray(members.id, ids), isNull(members.deletedAt)))
    .returning({ id: members.id });
  if (status !== 'active') {
    await Promise.all(updated.map((r) => forceLogoutAllByMember(r.id)));
  }
  return updated.length;
}

export async function batchSetMemberLevel(ids: number[], levelId: number | null): Promise<number> {
  if (ids.length === 0) return 0;
  const updated = await db.update(members).set({ levelId })
    .where(and(inArray(members.id, ids), isNull(members.deletedAt)))
    .returning({ id: members.id });
  if (typeof levelId === 'number' && updated.length > 0) {
    await raiseGrowthToLevelThreshold(updated.map((r) => r.id), levelId);
  }
  return updated.length;
}

// ─── 会员概览（后台详情侧滑）──────────────────────────────────────────────────
export async function getMemberOverview(id: number) {
  const row = await db.query.members.findFirst({
    where: and(eq(members.id, id), isNull(members.deletedAt)),
    with: memberRelationSelect,
  });
  const member = requireRow(row, '会员不存在');

  const [pointAcc, wallet, recentPointRows, recentWalletRows, recentLoginRows, activeCouponCount, loginLogCount, checkinTotal, mpFanRows, inviterRow, invitedCount] =
    await Promise.all([
      ensurePointAccount(id),
      ensureWallet(id),
      db.select().from(memberPointTransactions)
        .where(eq(memberPointTransactions.memberId, id))
        .orderBy(desc(memberPointTransactions.id))
        .limit(5),
      db.select().from(memberWalletTransactions)
        .where(eq(memberWalletTransactions.memberId, id))
        .orderBy(desc(memberWalletTransactions.id))
        .limit(5),
      db.select().from(memberLoginLogs)
        .where(eq(memberLoginLogs.memberId, id))
        .orderBy(desc(memberLoginLogs.createdAt))
        .limit(5),
      db.$count(memberCoupons, and(eq(memberCoupons.memberId, id), eq(memberCoupons.status, 'unused'))),
      db.$count(memberLoginLogs, eq(memberLoginLogs.memberId, id)),
      db.$count(memberCheckins, eq(memberCheckins.memberId, id)),
      db.select({ id: mpFans.id, nickname: mpFans.nickname, openid: mpFans.openid })
        .from(mpFans).where(eq(mpFans.memberId, id)).limit(5),
      member.invitedBy
        ? db.select({ id: members.id, nickname: members.nickname }).from(members).where(eq(members.id, member.invitedBy)).limit(1)
        : Promise.resolve([]),
      db.$count(members, and(eq(members.invitedBy, id), isNull(members.deletedAt))),
    ]);

  return {
    member: mapMember(member, {
      levelName: member.level?.name ?? null,
      pointBalance: member.pointAccount?.balance ?? 0,
      walletBalance: member.wallet?.balance ?? 0,
      tags: mapBoundTags(member.tagBindings),
    }),
    points: mapPointAccount(pointAcc),
    wallet: mapWallet(wallet),
    recentPointTxs: recentPointRows.map((r) => mapPointTransaction(r)),
    recentWalletTxs: recentWalletRows.map((r) => mapWalletTransaction(r)),
    recentLoginLogs: recentLoginRows.map((r) => mapMemberLoginLog({ ...r, memberNickname: member.nickname })),
    activeCouponCount,
    loginLogCount,
    checkinTotal,
    inviteCode: member.inviteCode ?? null,
    inviter: inviterRow[0] ? { id: inviterRow[0].id, nickname: inviterRow[0].nickname } : null,
    invitedCount,
    mpFans: mpFanRows.map((f) => ({ id: f.id, nickname: f.nickname ?? null, openid: f.openid })),
  };
}

// ─── 会员登录日志（后台跨会员查询）──────────────────────────────────────────────
export interface MemberLoginLogQuery {
  keyword?: string;
  status?: 'success' | 'fail';
  dateStart?: string;
  dateEnd?: string;
  page: number;
  pageSize: number;
}

interface LoginLogRowWithNickname {
  id: number;
  memberId: number | null;
  memberNickname: string | null;
  ip: string | null;
  location: string | null;
  browser: string | null;
  os: string | null;
  userAgent: string | null;
  status: 'success' | 'fail';
  message: string | null;
  createdAt: Date;
}

function mapMemberLoginLog(r: LoginLogRowWithNickname) {
  return {
    id: r.id,
    memberId: r.memberId,
    memberNickname: r.memberNickname,
    ip: r.ip,
    location: r.location,
    browser: r.browser,
    os: r.os,
    userAgent: r.userAgent,
    status: r.status,
    message: r.message,
    createdAt: formatDateTime(r.createdAt),
  };
}

export function buildLoginLogWhere(q: Omit<MemberLoginLogQuery, 'page' | 'pageSize'>): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  if (q.keyword) {
    const parts = [keywordCondition(q.keyword, [members.nickname, members.phone, members.username], 'ilike')];
    // 与积分/钱包等流水的 memberKeyword 口径对齐：纯数字额外按会员 ID 精确匹配（会员详情深链使用）
    if (/^\d+$/.test(q.keyword)) parts.push(eq(memberLoginLogs.memberId, parseInt(q.keyword, 10)));
    conds.push(or(...parts));
  }
  if (q.status) conds.push(eq(memberLoginLogs.status, q.status));
  const start = parseDateRangeStart(q.dateStart);
  if (start) conds.push(gte(memberLoginLogs.createdAt, start));
  const end = parseDateRangeEnd(q.dateEnd);
  if (end) conds.push(lte(memberLoginLogs.createdAt, end));
  return buildWhere(...conds);
}

export async function listMemberLoginLogs(q: MemberLoginLogQuery) {
  const where = buildLoginLogWhere(q);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.select({ value: count() })
      .from(memberLoginLogs)
      .leftJoin(members, eq(members.id, memberLoginLogs.memberId))
      .where(where)
      .then((r) => r[0]?.value ?? 0),
    rows: () => db.select({
      id: memberLoginLogs.id,
      memberId: memberLoginLogs.memberId,
      memberNickname: members.nickname,
      ip: memberLoginLogs.ip,
      location: memberLoginLogs.location,
      browser: memberLoginLogs.browser,
      os: memberLoginLogs.os,
      userAgent: memberLoginLogs.userAgent,
      status: memberLoginLogs.status,
      message: memberLoginLogs.message,
      createdAt: memberLoginLogs.createdAt,
    })
      .from(memberLoginLogs)
      .leftJoin(members, eq(members.id, memberLoginLogs.memberId))
      .where(where)
      .orderBy(desc(memberLoginLogs.createdAt))
      .limit(q.pageSize)
      .offset(pageOffset(q.page, q.pageSize)),
    map: mapMemberLoginLog,
  });
}
