/**
 * 会员后台管理服务：会员 CRUD / 启禁 / 重置密码 / 导出。
 * 复用 member-auth.service 的 mapMember / ensureMemberExists。
 */
import bcrypt from 'bcryptjs';
import { and, desc, eq, inArray, ilike, or, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { members, memberPointAccounts, memberWallets, memberPointTransactions, memberWalletTransactions, memberCoupons, memberLoginLogs } from '../db/schema';
import type { MemberRow } from '../db/schema';
import { mapMember, ensureMemberExists } from './member-auth.service';
import { forceLogoutAllByMember } from '../lib/member-session-manager';
import { escapeLike } from '../lib/where-helpers';
import { pageOffset } from '../lib/pagination';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { streamToExcel, formatDateTimeForExcel, type ExcelColumn } from '../lib/excel-export';
import { formatDateTime } from '../lib/datetime';
import { mapPointAccount, mapPointTransaction, ensurePointAccount } from './member-points.service';
import { mapWallet, mapWalletTransaction, ensureWallet } from './member-wallet.service';
import { MEMBER_STATUS_LABELS, type MemberStatus } from '@zenith/shared';

export interface ListMembersQuery {
  keyword?: string;
  status?: MemberStatus;
  levelId?: number;
  page: number;
  pageSize: number;
}

function buildMemberWhere(q: { keyword?: string; status?: MemberStatus; levelId?: number }): SQL | undefined {
  const conds: SQL[] = [];
  if (q.keyword) {
    const kw = `%${escapeLike(q.keyword)}%`;
    const orCond = or(ilike(members.nickname, kw), ilike(members.phone, kw), ilike(members.username, kw), ilike(members.email, kw));
    if (orCond) conds.push(orCond);
  }
  if (q.status) conds.push(eq(members.status, q.status));
  if (q.levelId) conds.push(eq(members.levelId, q.levelId));
  return conds.length ? and(...conds) : undefined;
}

// ─── 列表 / 详情 ──────────────────────────────────────────────────────────────
export async function listMembers(q: ListMembersQuery) {
  const where = buildMemberWhere(q);
  const [total, rows] = await Promise.all([
    db.$count(members, where),
    db.query.members.findMany({
      where,
      with: {
        level: { columns: { name: true } },
        pointAccount: { columns: { balance: true } },
        wallet: { columns: { balance: true } },
      },
      orderBy: desc(members.id),
      limit: q.pageSize,
      offset: pageOffset(q.page, q.pageSize),
    }),
  ]);
  return {
    list: rows.map((r) =>
      mapMember(r, {
        levelName: r.level?.name ?? null,
        pointBalance: r.pointAccount?.balance ?? 0,
        walletBalance: r.wallet?.balance ?? 0,
      }),
    ),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function getMemberDetail(id: number) {
  const row = await db.query.members.findFirst({
    where: eq(members.id, id),
    with: {
      level: { columns: { name: true } },
      pointAccount: { columns: { balance: true } },
      wallet: { columns: { balance: true } },
    },
  });
  if (!row) throw new HTTPException(404, { message: '会员不存在' });
  return mapMember(row, {
    levelName: row.level?.name ?? null,
    pointBalance: row.pointAccount?.balance ?? 0,
    walletBalance: row.wallet?.balance ?? 0,
  });
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
}

export async function createMember(input: AdminCreateMemberInput) {
  const hashed = input.password ? await bcrypt.hash(input.password, 10) : null;
  const member = await db.transaction(async (tx) => {
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
          levelId: input.levelId ?? null,
          remark: input.remark ?? null,
          registerSource: 'admin',
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

export async function updateMember(id: number, input: AdminUpdateMemberInput) {
  await ensureMemberExists(id);
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
  // 积分账户/钱包/流水/券码均为 ON DELETE CASCADE，随会员一并删除
  await db.delete(members).where(eq(members.id, id));
}

export async function resetMemberPasswordByAdmin(id: number, newPassword: string) {
  await ensureMemberExists(id);
  const hashed = await bcrypt.hash(newPassword, 10);
  await db.update(members).set({ password: hashed }).where(eq(members.id, id));
  await forceLogoutAllByMember(id);
}

// ─── 批量操作 ─────────────────────────────────────────────────────────────────
export async function batchSetMemberStatus(ids: number[], status: MemberStatus): Promise<number> {
  if (ids.length === 0) return 0;
  await db.update(members).set({ status }).where(inArray(members.id, ids));
  if (status !== 'active') {
    await Promise.all(ids.map((id) => forceLogoutAllByMember(id)));
  }
  return ids.length;
}

export async function batchSetMemberLevel(ids: number[], levelId: number | null): Promise<number> {
  if (ids.length === 0) return 0;
  await db.update(members).set({ levelId }).where(inArray(members.id, ids));
  return ids.length;
}

// ─── 会员概览（后台详情侧滑）──────────────────────────────────────────────────
export async function getMemberOverview(id: number) {
  const row = await db.query.members.findFirst({
    where: eq(members.id, id),
    with: {
      level: { columns: { name: true } },
      pointAccount: { columns: { balance: true } },
      wallet: { columns: { balance: true } },
    },
  });
  if (!row) throw new HTTPException(404, { message: '会员不存在' });

  const [pointAcc, wallet, recentPointRows, recentWalletRows, activeCouponCount, loginLogCount] =
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
      db.$count(memberCoupons, and(eq(memberCoupons.memberId, id), eq(memberCoupons.status, 'unused'))),
      db.$count(memberLoginLogs, eq(memberLoginLogs.memberId, id)),
    ]);

  return {
    member: mapMember(row, {
      levelName: row.level?.name ?? null,
      pointBalance: row.pointAccount?.balance ?? 0,
      walletBalance: row.wallet?.balance ?? 0,
    }),
    points: mapPointAccount(pointAcc),
    wallet: mapWallet(wallet),
    recentPointTxs: recentPointRows.map((r) => mapPointTransaction(r)),
    recentWalletTxs: recentWalletRows.map((r) => mapWalletTransaction(r)),
    activeCouponCount,
    loginLogCount,
  };
}

// ─── 导出 ─────────────────────────────────────────────────────────────────────
export async function exportMembers(q: { keyword?: string; status?: MemberStatus; levelId?: number }) {
  const where = buildMemberWhere(q);
  const rows = await db.query.members.findMany({
    where,
    with: {
      level: { columns: { name: true } },
      pointAccount: { columns: { balance: true } },
      wallet: { columns: { balance: true } },
    },
    orderBy: desc(members.id),
  });
  const data = rows.map((r) => ({
    id: r.id,
    username: r.username ?? '',
    phone: r.phone ?? '',
    email: r.email ?? '',
    nickname: r.nickname,
    levelName: r.level?.name ?? '',
    status: MEMBER_STATUS_LABELS[r.status],
    growthValue: r.growthValue,
    pointBalance: r.pointAccount?.balance ?? 0,
    walletBalance: ((r.wallet?.balance ?? 0) / 100).toFixed(2),
    registerSource: r.registerSource,
    lastLoginAt: r.lastLoginAt,
    createdAt: r.createdAt,
  }));
  const columns: ExcelColumn[] = [
    { header: 'ID', key: 'id', width: 8 },
    { header: '用户名', key: 'username', width: 16 },
    { header: '手机号', key: 'phone', width: 16 },
    { header: '邮箱', key: 'email', width: 22 },
    { header: '昵称', key: 'nickname', width: 16 },
    { header: '等级', key: 'levelName', width: 12 },
    { header: '状态', key: 'status', width: 10 },
    { header: '成长值', key: 'growthValue', width: 10 },
    { header: '积分', key: 'pointBalance', width: 10 },
    { header: '余额(元)', key: 'walletBalance', width: 12 },
    { header: '注册来源', key: 'registerSource', width: 10 },
    { header: '最后登录', key: 'lastLoginAt', width: 20, transform: (v) => (v ? formatDateTimeForExcel(v as Date) : '') },
    { header: '注册时间', key: 'createdAt', width: 20, transform: (v) => formatDateTimeForExcel(v as Date) },
  ];
  const stream = await streamToExcel(columns, data);
  return { stream, filename: 'members.xlsx' };
}
