/**
 * 会员认证服务（前台用户体系，与管理员 auth.service 隔离）。
 *
 * - 密码使用 bcryptjs hash(10)
 * - Token 复用 lib/jwt 的 signToken/verifyToken（仅 payload 不同：带 type='member'）
 * - 注册时在事务内初始化积分账户 + 钱包账户
 */
import bcrypt from 'bcryptjs';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { members, memberLevels, memberPointAccounts, memberWallets, memberLoginLogs } from '../../db/schema';
import type { MemberRow } from '../../db/schema';
import { signToken, verifyToken } from '../../lib/jwt';
import {
  generateMemberTokenId,
  registerMemberSession,
  removeMemberSession,
  forceLogoutAllByMember,
} from '../../lib/member-session-manager';
import type { MemberJwtPayload } from '../../middleware/member-auth';
import { currentMember } from '../../lib/member-context';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { parseUserAgent } from '../../lib/request-helpers';
import { lookupIpLocation } from '../../lib/ip-location';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { verifyMemberSmsCode } from './member-sms.service';
import type {
  MemberRegisterInput,
  MemberLoginInput,
  MemberUpdateProfileInput,
  MemberChangePasswordInput,
  MemberResetPasswordInput,
  MemberLoginResult,
} from '@zenith/shared';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapMember(
  row: MemberRow,
  extra?: { levelName?: string | null; pointBalance?: number; walletBalance?: number },
) {
  return {
    id: row.id,
    username: row.username ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    nickname: row.nickname,
    avatar: row.avatar ?? null,
    gender: row.gender ?? null,
    birthday: row.birthday ?? null,
    status: row.status,
    levelId: row.levelId ?? null,
    levelName: extra?.levelName ?? null,
    growthValue: row.growthValue,
    experience: row.experience,
    registerSource: row.registerSource,
    registerIp: row.registerIp ?? null,
    lastLoginAt: formatNullableDateTime(row.lastLoginAt),
    lastLoginIp: row.lastLoginIp ?? null,
    remark: row.remark ?? null,
    hasPassword: !!row.password,
    pointBalance: extra?.pointBalance,
    walletBalance: extra?.walletBalance,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── Token 签发 ───────────────────────────────────────────────────────────────
export async function issueMemberTokens(member: { id: number; identifier: string; tenantId?: number | null }) {
  const tokenId = generateMemberTokenId();
  const tenantId = member.tenantId ?? null;
  const accessToken = await signToken<MemberJwtPayload>(
    { memberId: member.id, identifier: member.identifier, type: 'member', tenantId, jti: tokenId },
    '2h',
  );
  const refreshToken = await signToken(
    { memberId: member.id, identifier: member.identifier, type: 'member-refresh', tenantId, jti: tokenId },
    '30d',
  );
  return { accessToken, refreshToken, tokenId };
}

function memberIdentifier(m: { id: number; phone?: string | null; username?: string | null; email?: string | null }): string {
  return m.phone || m.username || m.email || `member-${m.id}`;
}

// ─── 辅助校验 ─────────────────────────────────────────────────────────────────
async function getDefaultLevelId(): Promise<number | null> {
  const [lvl] = await db
    .select({ id: memberLevels.id })
    .from(memberLevels)
    .where(eq(memberLevels.status, 'enabled'))
    .orderBy(asc(memberLevels.level))
    .limit(1);
  return lvl?.id ?? null;
}

async function ensureIdentifiersAvailable(ids: { username?: string; phone?: string; email?: string }): Promise<void> {
  // 仅检查未删除会员：软删除后释放的标识符允许再次注册（与部分唯一索引一致）
  if (ids.username) {
    const [e] = await db.select({ id: members.id }).from(members)
      .where(and(eq(members.username, ids.username), isNull(members.deletedAt))).limit(1);
    if (e) throw new HTTPException(400, { message: '用户名已被注册' });
  }
  if (ids.phone) {
    const [e] = await db.select({ id: members.id }).from(members)
      .where(and(eq(members.phone, ids.phone), isNull(members.deletedAt))).limit(1);
    if (e) throw new HTTPException(400, { message: '手机号已被注册' });
  }
  if (ids.email) {
    const [e] = await db.select({ id: members.id }).from(members)
      .where(and(eq(members.email, ids.email), isNull(members.deletedAt))).limit(1);
    if (e) throw new HTTPException(400, { message: '邮箱已被注册' });
  }
}

async function findMemberByAccount(account: string): Promise<MemberRow | undefined> {
  const [m] = await db
    .select()
    .from(members)
    .where(and(
      or(eq(members.username, account), eq(members.phone, account), eq(members.email, account)),
      isNull(members.deletedAt),
    ))
    .limit(1);
  return m;
}

export async function ensureMemberExists(id: number): Promise<MemberRow> {
  const [row] = await db.select().from(members)
    .where(and(eq(members.id, id), isNull(members.deletedAt))).limit(1);
  if (!row) throw new HTTPException(404, { message: '会员不存在' });
  return row;
}

// ─── 登录日志 ─────────────────────────────────────────────────────────────────
interface MemberLoginLogParams {
  memberId?: number | null;
  ip: string;
  ua: string;
  status: 'success' | 'fail';
  message?: string;
}

export function recordMemberLoginLog(params: MemberLoginLogParams): void {
  const { browser, os } = parseUserAgent(params.ua);
  void db.insert(memberLoginLogs).values({
    memberId: params.memberId ?? null,
    ip: params.ip || null,
    location: params.ip ? lookupIpLocation(params.ip) : null,
    browser,
    os,
    userAgent: params.ua || null,
    status: params.status,
    message: params.message ?? null,
  });
}

// ─── 注册 ─────────────────────────────────────────────────────────────────────
export interface MemberRegisterServiceInput extends MemberRegisterInput {
  ip: string;
  ua: string;
  source?: string;
}

export async function registerMember(input: MemberRegisterServiceInput): Promise<MemberLoginResult> {
  const { username, phone, email, password, smsCode, nickname } = input;

  // 手机号注册：校验短信验证码
  if (phone && smsCode) {
    const ok = await verifyMemberSmsCode(phone, 'register', smsCode);
    if (!ok) throw new HTTPException(400, { message: '验证码错误或已过期' });
  }
  // 必须有密码，或通过（手机号 + 验证码）方式
  if (!password && !(phone && smsCode)) {
    throw new HTTPException(400, { message: '请设置密码，或使用手机验证码注册' });
  }

  await ensureIdentifiersAvailable({ username, phone, email });

  const hashed = password ? await bcrypt.hash(password, 10) : null;
  const finalNickname = nickname || phone || username || email?.split('@')[0] || '会员';
  const levelId = await getDefaultLevelId();

  const member = await db.transaction(async (tx) => {
    let created: MemberRow;
    try {
      [created] = await tx
        .insert(members)
        .values({
          username: username ?? null,
          phone: phone ?? null,
          email: email ?? null,
          password: hashed,
          nickname: finalNickname,
          status: 'active',
          levelId,
          registerSource: input.source ?? 'web',
          registerIp: input.ip,
        })
        .returning();
    } catch (err) {
      rethrowPgUniqueViolation(err, '用户名、手机号或邮箱已被注册');
      throw err;
    }
    // 初始化积分账户 + 钱包账户
    await tx.insert(memberPointAccounts).values({ memberId: created.id });
    await tx.insert(memberWallets).values({ memberId: created.id });
    return created;
  });

  return finalizeAuth(member, input.ip, input.ua);
}

// ─── 登录 ─────────────────────────────────────────────────────────────────────
export interface MemberLoginServiceInput extends MemberLoginInput {
  ip: string;
  ua: string;
}

export async function loginMember(input: MemberLoginServiceInput): Promise<MemberLoginResult> {
  let member: MemberRow | undefined;

  if (input.loginType === 'sms') {
    if (!input.phone || !input.smsCode) throw new HTTPException(400, { message: '请输入手机号和验证码' });
    const ok = await verifyMemberSmsCode(input.phone, 'login', input.smsCode);
    if (!ok) {
      recordMemberLoginLog({ ip: input.ip, ua: input.ua, status: 'fail', message: '验证码错误或已过期' });
      throw new HTTPException(400, { message: '验证码错误或已过期' });
    }
    [member] = await db.select().from(members)
      .where(and(eq(members.phone, input.phone), isNull(members.deletedAt))).limit(1);
    if (!member) {
      recordMemberLoginLog({ ip: input.ip, ua: input.ua, status: 'fail', message: '该手机号未注册' });
      throw new HTTPException(400, { message: '该手机号未注册' });
    }
  } else {
    if (!input.account || !input.password) throw new HTTPException(400, { message: '请输入账号和密码' });
    member = await findMemberByAccount(input.account);
    if (!member?.password) {
      recordMemberLoginLog({ ip: input.ip, ua: input.ua, status: 'fail', message: '账号或密码错误' });
      throw new HTTPException(400, { message: '账号或密码错误' });
    }
    const valid = await bcrypt.compare(input.password, member.password);
    if (!valid) {
      recordMemberLoginLog({ memberId: member.id, ip: input.ip, ua: input.ua, status: 'fail', message: '账号或密码错误' });
      throw new HTTPException(400, { message: '账号或密码错误' });
    }
  }

  if (member.status === 'banned') {
    recordMemberLoginLog({ memberId: member.id, ip: input.ip, ua: input.ua, status: 'fail', message: '账号已被封禁' });
    throw new HTTPException(403, { message: '账号已被封禁' });
  }
  if (member.status === 'inactive') {
    recordMemberLoginLog({ memberId: member.id, ip: input.ip, ua: input.ua, status: 'fail', message: '账号未激活' });
    throw new HTTPException(403, { message: '账号未激活，请联系客服' });
  }

  return finalizeAuth(member, input.ip, input.ua);
}

/** 登录/注册成功后：签发 token、注册会话、更新最后登录信息、记录日志 */
async function finalizeAuth(member: MemberRow, ip: string, ua: string): Promise<MemberLoginResult> {
  const identifier = memberIdentifier(member);
  const { accessToken, refreshToken, tokenId } = await issueMemberTokens({
    id: member.id,
    identifier,
    tenantId: member.tenantId,
  });
  const { browser, os } = parseUserAgent(ua);
  await Promise.all([
    registerMemberSession({
      tokenId,
      memberId: member.id,
      identifier,
      nickname: member.nickname,
      tenantId: member.tenantId ?? null,
      ip,
      browser,
      os,
      location: null,
      loginAt: new Date(),
    }),
    db.update(members).set({ lastLoginAt: new Date(), lastLoginIp: ip }).where(eq(members.id, member.id)),
    db.insert(memberLoginLogs).values({
      memberId: member.id,
      ip: ip || null,
      location: ip ? lookupIpLocation(ip) : null,
      browser,
      os,
      userAgent: ua || null,
      status: 'success',
      message: '登录成功',
    }),
  ]);
  return { member: mapMember(member), token: { accessToken, refreshToken } };
}

// ─── 刷新 Token ───────────────────────────────────────────────────────────────
interface MemberRefreshPayload {
  memberId: number;
  identifier: string;
  type: string;
  tenantId: number | null;
  jti?: string;
}

export async function refreshMemberToken(refreshToken: string): Promise<{ accessToken: string }> {
  let payload: MemberRefreshPayload;
  try {
    payload = await verifyToken<MemberRefreshPayload>(refreshToken);
  } catch {
    throw new HTTPException(401, { message: '无效的刷新令牌' });
  }
  if (payload.type !== 'member-refresh' || !payload.memberId) {
    throw new HTTPException(401, { message: '无效的刷新令牌' });
  }
  const [member] = await db.select().from(members)
    .where(and(eq(members.id, payload.memberId), isNull(members.deletedAt))).limit(1);
  if (!member) throw new HTTPException(401, { message: '会员不存在' });
  if (member.status !== 'active') throw new HTTPException(403, { message: '账号不可用' });

  const accessToken = await signToken<MemberJwtPayload>(
    {
      memberId: member.id,
      identifier: memberIdentifier(member),
      type: 'member',
      tenantId: member.tenantId ?? null,
      jti: payload.jti,
    },
    '2h',
  );
  return { accessToken };
}

// ─── 登出 ─────────────────────────────────────────────────────────────────────
export async function logoutMember(): Promise<void> {
  const m = currentMember();
  if (m.jti) await removeMemberSession(m.jti);
}

// ─── 个人资料 ─────────────────────────────────────────────────────────────────
export async function getMyMemberProfile() {
  const { memberId } = currentMember();
  const row = await db.query.members.findFirst({
    where: and(eq(members.id, memberId), isNull(members.deletedAt)),
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

export async function updateMyMemberProfile(input: MemberUpdateProfileInput) {
  const { memberId } = currentMember();
  const patch: Record<string, unknown> = {};
  if (input.nickname !== undefined) patch.nickname = input.nickname;
  if (input.avatar !== undefined) patch.avatar = input.avatar;
  if (input.gender !== undefined) patch.gender = input.gender;
  if (input.birthday !== undefined) patch.birthday = input.birthday;
  if (input.email !== undefined) patch.email = input.email;
  if (Object.keys(patch).length > 0) {
    try {
      await db.update(members).set(patch).where(eq(members.id, memberId));
    } catch (err) {
      rethrowPgUniqueViolation(err, '邮箱已被占用');
      throw err;
    }
  }
  return getMyMemberProfile();
}

export async function changeMyMemberPassword(input: MemberChangePasswordInput): Promise<void> {
  const { memberId } = currentMember();
  const [member] = await db.select().from(members)
    .where(and(eq(members.id, memberId), isNull(members.deletedAt))).limit(1);
  if (!member) throw new HTTPException(404, { message: '会员不存在' });
  // 已设密码时需校验原密码
  if (member.password) {
    if (!input.oldPassword) throw new HTTPException(400, { message: '请输入原密码' });
    const valid = await bcrypt.compare(input.oldPassword, member.password);
    if (!valid) throw new HTTPException(400, { message: '原密码错误' });
  }
  const hashed = await bcrypt.hash(input.newPassword, 10);
  await db.update(members).set({ password: hashed }).where(eq(members.id, memberId));
}

// ─── 短信验证码重置密码 ───────────────────────────────────────────────────────
export async function resetMemberPassword(input: MemberResetPasswordInput): Promise<void> {
  const ok = await verifyMemberSmsCode(input.phone, 'reset', input.smsCode);
  if (!ok) throw new HTTPException(400, { message: '验证码错误或已过期' });
  const [member] = await db.select().from(members)
    .where(and(eq(members.phone, input.phone), isNull(members.deletedAt))).limit(1);
  if (!member) throw new HTTPException(400, { message: '该手机号未注册' });
  const hashed = await bcrypt.hash(input.newPassword, 10);
  await db.update(members).set({ password: hashed }).where(eq(members.id, member.id));
  // 重置密码后踢下线所有会话
  await forceLogoutAllByMember(member.id);
}
