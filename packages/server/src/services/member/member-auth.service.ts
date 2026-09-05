/**
 * 会员认证服务（前台用户体系，与管理员 auth.service 隔离）。
 *
 * - 密码经 lib/password 统一入口 hash(10)（优先 @node-rs/bcrypt 原生实现）
 * - Token 复用 lib/jwt 的 signToken/verifyToken（仅 payload 不同：带 type='member'）
 * - 注册时在事务内初始化积分账户 + 钱包账户
 */
import { hashPassword, verifyPassword } from '../../lib/password';
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { members, memberLevels, memberPointAccounts, memberWallets, memberLoginLogs, tenants } from '../../db/schema';
import type { MemberRow } from '../../db/schema';
import { signToken, verifyToken } from '../../lib/jwt';
import { pageOffset } from '../../lib/pagination';
import {
  generateMemberTokenId,
  registerMemberSession,
  removeMemberSession,
  forceLogoutAllByMember,
  grantMemberRefresh,
  consumeMemberRefreshGrant,
  isMemberTokenBlacklisted,
  getMemberSession,
  checkMemberLoginLock,
  recordMemberLoginFailure,
  clearMemberLoginAttempts,
} from '../../lib/member-session-manager';
import type { MemberJwtPayload } from '../../middleware/member-auth';
import { currentMember } from '../../lib/member-context';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { parseUserAgent } from '../../lib/request-helpers';
import { lookupIpLocation } from '../../lib/ip-location';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { truncateVarchar } from '../../lib/sanitize';
import logger from '../../lib/logger';
import { verifyMemberSmsCode } from './member-sms.service';
import { trackServerEvent } from '../analytics/analytics-server-events.service';
import { decide } from '../platform/rules-runtime.service';
import type { MemberRegisterInput, MemberLoginInput, MemberUpdateProfileInput, MemberChangePasswordInput, MemberResetPasswordInput, MemberLoginResult } from '@zenith/shared/member';
import { ANALYTICS_EVENT_NAMES } from '@zenith/shared/analytics';
import { isTenantActive } from '../../lib/tenant';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapMember(
  row: MemberRow,
  extra?: {
    levelName?: string | null;
    pointBalance?: number;
    walletBalance?: number;
    tags?: { id: number; name: string; color: string | null }[];
  },
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
    vipExpireAt: formatNullableDateTime(row.vipExpireAt),
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
    tags: extra?.tags,
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
  // 各列按 schema 长度截断兜底；写入失败只告警，不影响调用方（fire-and-forget 不产生 unhandledRejection）
  db.insert(memberLoginLogs).values({
    memberId: params.memberId ?? null,
    ip: truncateVarchar(params.ip, 64),
    location: params.ip ? truncateVarchar(lookupIpLocation(params.ip), 128) : null,
    browser: truncateVarchar(browser, 64),
    os: truncateVarchar(os, 64),
    userAgent: truncateVarchar(params.ua, 512),
    status: params.status,
    message: truncateVarchar(params.message, 256),
  }).catch((err: unknown) => {
    logger.warn('会员登录日志写入失败', { memberId: params.memberId, status: params.status, error: err instanceof Error ? err.message : String(err) });
  });
}

/** 会员端：我的登录历史（本人可见，不附加昵称列） */
export async function listMyLoginLogs(q: { page: number; pageSize: number }) {
  const { memberId } = currentMember();
  const [rows, total] = await Promise.all([
    db.select().from(memberLoginLogs)
      .where(eq(memberLoginLogs.memberId, memberId))
      .orderBy(desc(memberLoginLogs.createdAt))
      .limit(q.pageSize)
      .offset(pageOffset(q.page, q.pageSize)),
    db.$count(memberLoginLogs, eq(memberLoginLogs.memberId, memberId)),
  ]);
  return {
    list: rows.map((r) => ({
      id: r.id,
      memberId: r.memberId,
      ip: r.ip,
      location: r.location,
      browser: r.browser,
      os: r.os,
      userAgent: r.userAgent,
      status: r.status,
      message: r.message,
      createdAt: formatDateTime(r.createdAt),
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

// ─── 注册 ─────────────────────────────────────────────────────────────────────
export interface MemberRegisterServiceInput extends MemberRegisterInput {
  ip: string;
  ua: string;
  source?: string;
}

/**
 * 入口反滥用：手机号 / IP 命中规则中心 risk_blacklist 名单即拒绝。
 * 名单不存在/禁用/求值异常按未命中放行（optional 语义），不阻断正常注册登录；
 * 命中由 decide() 统一留痕（caller=member.auth），可在规则中心执行记录追溯。
 */
async function ensureNotBlacklisted(subjects: Array<string | null | undefined>, entry: '注册' | '登录', meta: { ip: string; ua: string }): Promise<void> {
  const values = subjects.filter((s): s is string => !!s?.trim());
  if (values.length === 0) return;
  const decision = await decide({ kind: 'list', key: 'risk_blacklist' }, {}, { caller: 'member.auth', tenantId: null, subjects: values, bizRef: `member:${values[0]}`.slice(0, 128) });
  if (!decision.matched) return;
  recordMemberLoginLog({ ip: meta.ip, ua: meta.ua, status: 'fail', message: `${entry}被风控名单拦截` });
  throw new HTTPException(403, { message: '当前账号或网络环境存在风险，暂无法完成操作，请联系客服' });
}

export async function registerMember(input: MemberRegisterServiceInput): Promise<MemberLoginResult> {
  const { username, phone, email, password, smsCode, nickname } = input;

  await ensureNotBlacklisted([phone, input.ip], '注册', input);

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

  const hashed = password ? await hashPassword(password) : null;
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

  // 服务端权威事件（best-effort，事务已提交后触发；不传 phone/email 原值/密码，仅传布尔标志）
  trackServerEvent({
    eventName: ANALYTICS_EVENT_NAMES.memberRegistered,
    memberId: member.id,
    tenantId: member.tenantId ?? null,
    properties: {
      memberId: member.id,
      source: input.source ?? 'web',
      hasPhone: !!member.phone,
      hasEmail: !!member.email,
    },
  });

  // 邀请关系绑定 + 邀请人奖励（best-effort，不阻断注册；动态导入避免模块环）
  if (input.inviteCode) {
    const { applyInviteOnRegister } = await import('./member-invite.service');
    await applyInviteOnRegister(member.id, input.inviteCode, member.nickname);
  }

  return finalizeAuth(member, input.ip, input.ua);
}

// ─── 登录 ─────────────────────────────────────────────────────────────────────
export interface MemberLoginServiceInput extends MemberLoginInput {
  ip: string;
  ua: string;
}

export async function loginMember(input: MemberLoginServiceInput): Promise<MemberLoginResult> {
  let member: MemberRow | undefined;

  await ensureNotBlacklisted([input.phone, input.ip], '登录', input);

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

    // 账号级登录失败锁定（与后台隔离，见 member-session-manager；沿用系统配置的次数/时长）
    const account = input.account.trim().toLowerCase();
    const remainingLockSeconds = await checkMemberLoginLock(account);
    if (remainingLockSeconds > 0) {
      const remainingMinutes = Math.ceil(remainingLockSeconds / 60);
      recordMemberLoginLog({ ip: input.ip, ua: input.ua, status: 'fail', message: '账号已被锁定' });
      throw new HTTPException(423, { message: `账号已被锁定，请 ${remainingMinutes} 分钟后重试` });
    }

    member = await findMemberByAccount(input.account);
    if (!member?.password) {
      recordMemberLoginLog({ ip: input.ip, ua: input.ua, status: 'fail', message: '账号或密码错误' });
      await recordMemberLoginFailure(account);
      throw new HTTPException(400, { message: '账号或密码错误' });
    }
    const valid = await verifyPassword(input.password, member.password);
    if (!valid) {
      recordMemberLoginLog({ memberId: member.id, ip: input.ip, ua: input.ua, status: 'fail', message: '账号或密码错误' });
      await recordMemberLoginFailure(account);
      throw new HTTPException(400, { message: '账号或密码错误' });
    }
    await clearMemberLoginAttempts(account);
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
    grantMemberRefresh(tokenId),
    db.update(members).set({ lastLoginAt: new Date(), lastLoginIp: truncateVarchar(ip, 64) }).where(eq(members.id, member.id)),
  ]);
  recordMemberLoginLog({ memberId: member.id, ip, ua, status: 'success', message: '登录成功' });
  return { member: mapMember(member), token: { accessToken, refreshToken } };
}

// ─── 刷新 Token ───────────────────────────────────────────────────────────────
interface MemberRefreshPayload {
  memberId: number;
  identifier: string;
  type: string;
  tenantId?: number | null;
  jti?: string;
}

/**
 * 会员 refresh 轮换：一次性消费 Redis 中的 refresh 授权（登出 / 封禁 / 改密后即失效），
 * 签发新 jti 并吊销旧 jti，被盗 refresh token 最多只能用一次。
 */
export async function refreshMemberToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  let payload: MemberRefreshPayload;
  try {
    payload = await verifyToken<MemberRefreshPayload>(refreshToken);
  } catch {
    throw new HTTPException(401, { message: '无效的刷新令牌' });
  }
  if (payload.type !== 'member-refresh' || !Number.isInteger(payload.memberId) || payload.memberId <= 0 || !payload.jti) {
    throw new HTTPException(401, { message: '无效的刷新令牌' });
  }
  const previousTokenId = payload.jti;
  if (await isMemberTokenBlacklisted(previousTokenId) || !(await consumeMemberRefreshGrant(previousTokenId))) {
    throw new HTTPException(401, { message: '登录状态已失效，请重新登录' });
  }
  const revokePrevious = async () => { try { await removeMemberSession(previousTokenId); } catch { /* best-effort */ } };
  const [member] = await db.select().from(members)
    .where(and(eq(members.id, payload.memberId), isNull(members.deletedAt))).limit(1);
  if (!member) { await revokePrevious(); throw new HTTPException(401, { message: '会员不存在' }); }
  if (member.status !== 'active') { await revokePrevious(); throw new HTTPException(403, { message: '账号不可用' }); }
  const dbTenantId = member.tenantId ?? null;
  if ((payload.tenantId ?? null) !== dbTenantId) {
    await revokePrevious();
    throw new HTTPException(401, { message: '登录状态已失效，请重新登录' });
  }
  if (dbTenantId !== null) {
    const [tenant] = await db.select({ status: tenants.status, expireAt: tenants.expireAt })
      .from(tenants)
      .where(eq(tenants.id, dbTenantId))
      .limit(1);
    if (!tenant) { await revokePrevious(); throw new HTTPException(403, { message: '租户不存在' }); }
    if (!isTenantActive(tenant)) {
      await revokePrevious();
      throw new HTTPException(403, { message: '租户已被禁用或过期' });
    }
  }

  const identifier = memberIdentifier(member);
  const tokens = await issueMemberTokens({ id: member.id, identifier, tenantId: dbTenantId });
  const existing = await getMemberSession(previousTokenId);
  await Promise.all([
    registerMemberSession({
      tokenId: tokens.tokenId,
      memberId: member.id,
      identifier,
      nickname: member.nickname,
      tenantId: dbTenantId,
      ip: existing?.ip ?? '',
      browser: existing?.browser ?? '',
      os: existing?.os ?? '',
      location: existing?.location ?? null,
      loginAt: existing?.loginAt ?? new Date(),
    }),
    grantMemberRefresh(tokens.tokenId),
    removeMemberSession(previousTokenId),
  ]);
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
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
  const { memberId, tenantId } = currentMember();
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
    // 服务端权威事件（best-effort；只传变更字段名，不传具体值，避免落 PII）
    trackServerEvent({
      eventName: ANALYTICS_EVENT_NAMES.memberProfileUpdated,
      memberId,
      tenantId: tenantId ?? null,
      properties: { memberId, changedFields: Object.keys(patch) },
    });
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
    const valid = await verifyPassword(input.oldPassword, member.password);
    if (!valid) throw new HTTPException(400, { message: '原密码错误' });
  }
  const hashed = await hashPassword(input.newPassword);
  await db.update(members).set({ password: hashed }).where(eq(members.id, memberId));
}

// ─── 短信验证码重置密码 ───────────────────────────────────────────────────────
export async function resetMemberPassword(input: MemberResetPasswordInput): Promise<void> {
  const ok = await verifyMemberSmsCode(input.phone, 'reset', input.smsCode);
  if (!ok) throw new HTTPException(400, { message: '验证码错误或已过期' });
  const [member] = await db.select().from(members)
    .where(and(eq(members.phone, input.phone), isNull(members.deletedAt))).limit(1);
  if (!member) throw new HTTPException(400, { message: '该手机号未注册' });
  const hashed = await hashPassword(input.newPassword);
  await db.update(members).set({ password: hashed }).where(eq(members.id, member.id));
  // 重置密码后踢下线所有会话
  await forceLogoutAllByMember(member.id);
}

// ─── 账户自助注销 ─────────────────────────────────────────────────────────────
/**
 * 会员自助注销：验证身份（已设密码验密码；否则手机号 + 短信验证码）后软删除并踢下线。
 * 数据保留（积分/钱包流水、券码、签到），标识符因部分唯一索引立即可再次注册。
 */
export async function deactivateMyAccount(input: { password?: string; smsCode?: string }): Promise<void> {
  const { memberId } = currentMember();
  const [member] = await db.select().from(members)
    .where(and(eq(members.id, memberId), isNull(members.deletedAt))).limit(1);
  if (!member) throw new HTTPException(404, { message: '会员不存在' });

  if (member.password) {
    if (!input.password) throw new HTTPException(400, { message: '请输入登录密码确认注销' });
    const valid = await verifyPassword(input.password, member.password);
    if (!valid) throw new HTTPException(400, { message: '密码错误' });
  } else {
    if (!member.phone) throw new HTTPException(400, { message: '账户未绑定手机号，请联系客服注销' });
    if (!input.smsCode) throw new HTTPException(400, { message: '请输入短信验证码确认注销' });
    const ok = await verifyMemberSmsCode(member.phone, 'reset', input.smsCode);
    if (!ok) throw new HTTPException(400, { message: '验证码错误或已过期' });
  }

  await forceLogoutAllByMember(memberId);
  await db.update(members).set({ deletedAt: new Date() }).where(eq(members.id, memberId));
}
