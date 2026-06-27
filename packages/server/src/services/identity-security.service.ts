import { and, desc, eq, gt } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db';
import { loginRiskEvents, systemConfigs, userMfaFactors, userTrustedDevices, users, type UserRow } from '../db/schema';
import { currentUser } from '../lib/context';
import { formatDateTime } from '../lib/datetime';
import { lookupIpLocation } from '../lib/ip-location';
import { decryptSecret, encryptSecret } from '../lib/secret-crypto';
import { getConfigBoolean, getConfigNumber, getConfigValue } from '../lib/system-config';
import { buildTotpUri, generateTotpSecret, verifyTotp } from '../lib/totp';

export type MfaMethod = 'totp' | 'passkey';

export interface IdentitySecurityPolicy {
  password: {
    minLength: number;
    requireUppercase: boolean;
    requireSpecialChar: boolean;
    expiryEnabled: boolean;
    expiryDays: number;
  };
  lockout: {
    maxAttempts: number;
    durationMinutes: number;
  };
  mfa: {
    enabled: boolean;
    mode: 'off' | 'optional' | 'required';
    rememberDeviceDays: number;
  };
  risk: {
    enabled: boolean;
    newDeviceAction: 'allow' | 'challenge';
  };
}

export interface MfaChallengePayload {
  userId: number;
  username: string;
  tenantId: number | null;
  ip: string;
  ua: string;
  deviceInfo?: unknown;
  deviceId?: string;
  rememberDevice?: boolean;
  createdAt: number;
  expiresAt: number;
}

const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
const MFA_CHALLENGE_PREFIX = 'mfa-challenge:';

export async function getIdentitySecurityPolicy(tenantId?: number | null): Promise<IdentitySecurityPolicy> {
  const [
    minLength,
    requireUppercase,
    requireSpecialChar,
    expiryEnabled,
    expiryDays,
    maxAttempts,
    durationMinutes,
    mfaEnabled,
    mfaModeRaw,
    rememberDeviceDays,
    riskEnabled,
    newDeviceActionRaw,
  ] = await Promise.all([
    getConfigNumber('password_min_length', 6, tenantId),
    getConfigBoolean('password_require_uppercase', false, tenantId),
    getConfigBoolean('password_require_special_char', false, tenantId),
    getConfigBoolean('password_expiry_enabled', false, tenantId),
    getConfigNumber('password_expiry_days', 90, tenantId),
    getConfigNumber('login_max_attempts', 10, tenantId),
    getConfigNumber('login_lock_duration_minutes', 30, tenantId),
    getConfigBoolean('mfa_enabled', false, tenantId),
    getConfigValue('mfa_mode', 'off', tenantId),
    getConfigNumber('mfa_remember_device_days', 30, tenantId),
    getConfigBoolean('login_risk_enabled', false, tenantId),
    getConfigValue('login_risk_new_device_action', 'allow', tenantId),
  ]);
  const mfaMode = ['off', 'optional', 'required'].includes(mfaModeRaw) ? mfaModeRaw as 'off' | 'optional' | 'required' : 'off';
  const newDeviceAction = newDeviceActionRaw === 'challenge' ? 'challenge' : 'allow';
  return {
    password: { minLength, requireUppercase, requireSpecialChar, expiryEnabled, expiryDays },
    lockout: { maxAttempts, durationMinutes },
    mfa: { enabled: mfaEnabled, mode: mfaMode, rememberDeviceDays },
    risk: { enabled: riskEnabled, newDeviceAction },
  };
}

export async function saveIdentitySecurityPolicy(input: IdentitySecurityPolicy) {
  const entries = [
    ['password_min_length', String(input.password.minLength), 'number', '密码最小长度'],
    ['password_require_uppercase', String(input.password.requireUppercase), 'boolean', '密码是否必须包含大写字母'],
    ['password_require_special_char', String(input.password.requireSpecialChar), 'boolean', '密码是否必须包含特殊字符'],
    ['password_expiry_enabled', String(input.password.expiryEnabled), 'boolean', '是否开启密码过期强制重置'],
    ['password_expiry_days', String(input.password.expiryDays), 'number', '密码过期天数'],
    ['login_max_attempts', String(input.lockout.maxAttempts), 'number', '登录失败最大次数，超出后锁定账号'],
    ['login_lock_duration_minutes', String(input.lockout.durationMinutes), 'number', '账号锁定时长（分钟）'],
    ['mfa_enabled', String(input.mfa.enabled), 'boolean', '是否启用 MFA'],
    ['mfa_mode', input.mfa.mode, 'string', 'MFA 模式：off/optional/required'],
    ['mfa_remember_device_days', String(input.mfa.rememberDeviceDays), 'number', '可信设备免 MFA 天数'],
    ['login_risk_enabled', String(input.risk.enabled), 'boolean', '是否启用登录风险策略'],
    ['login_risk_new_device_action', input.risk.newDeviceAction, 'string', '新设备登录动作：allow/challenge'],
  ] as const;

  await db.transaction(async (tx) => {
    for (const [configKey, configValue, configType, description] of entries) {
      const [existing] = await tx.select({ id: systemConfigs.id }).from(systemConfigs).where(eq(systemConfigs.configKey, configKey)).limit(1);
      if (existing) {
        await tx.update(systemConfigs).set({ configValue, configType, description }).where(eq(systemConfigs.id, existing.id));
      } else {
        await tx.insert(systemConfigs).values({ configKey, configValue, configType, description });
      }
    }
  });
  return getIdentitySecurityPolicy();
}

export async function listMyMfaFactors() {
  const userId = currentUser().userId;
  const rows = await db
    .select()
    .from(userMfaFactors)
    .where(eq(userMfaFactors.userId, userId))
    .orderBy(desc(userMfaFactors.createdAt));
  return rows.map(mapMfaFactor);
}

export async function beginTotpSetup() {
  const user = currentUser();
  const [profile] = await db.select({ username: users.username, email: users.email }).from(users).where(eq(users.id, user.userId)).limit(1);
  if (!profile) throw new HTTPException(404, { message: '用户不存在' });
  const secret = generateTotpSecret();
  const [row] = await db.insert(userMfaFactors).values({
    userId: user.userId,
    type: 'totp',
    name: '身份验证器',
    secretEncrypted: encryptSecret(secret),
    status: 'pending',
  }).returning();
  const accountName = profile.email || profile.username;
  return {
    factorId: row.id,
    secret,
    otpauthUrl: buildTotpUri({ issuer: 'Zenith Admin', accountName, secret }),
  };
}

export async function verifyTotpSetup(factorId: number, code: string) {
  const userId = currentUser().userId;
  const factor = await ensureOwnTotpFactor(userId, factorId);
  if (!factor.secretEncrypted) throw new HTTPException(400, { message: 'MFA 因子无效' });
  const secret = decryptSecret(factor.secretEncrypted);
  if (!verifyTotp(code, secret)) throw new HTTPException(400, { message: '动态验证码错误' });
  const [row] = await db
    .update(userMfaFactors)
    .set({ status: 'enabled', verifiedAt: new Date(), lastUsedAt: new Date() })
    .where(and(eq(userMfaFactors.id, factorId), eq(userMfaFactors.userId, userId)))
    .returning();
  return mapMfaFactor(row);
}

export async function disableMyMfaFactor(factorId: number) {
  const userId = currentUser().userId;
  await ensureOwnTotpFactor(userId, factorId);
  await db.update(userMfaFactors).set({ status: 'disabled' }).where(and(eq(userMfaFactors.id, factorId), eq(userMfaFactors.userId, userId)));
}

export async function hasEnabledMfa(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: userMfaFactors.id })
    .from(userMfaFactors)
    .where(and(eq(userMfaFactors.userId, userId), eq(userMfaFactors.status, 'enabled')))
    .limit(1);
  return !!row;
}

export async function shouldRequireMfa(input: {
  user: Pick<UserRow, 'id' | 'username' | 'tenantId'>;
  ip: string;
  ua: string;
  deviceId?: string;
}) {
  const policy = await getIdentitySecurityPolicy(input.user.tenantId);
  if (!policy.mfa.enabled || policy.mfa.mode === 'off') return { required: false, methods: [] as MfaMethod[], reason: null };

  const hasFactor = await hasEnabledMfa(input.user.id);
  const requiredByPolicy = policy.mfa.mode === 'required' && hasFactor;
  let requiredByRisk = false;
  let riskReason: string | null = null;

  if (policy.risk.enabled && policy.risk.newDeviceAction === 'challenge' && hasFactor) {
    const trusted = input.deviceId ? await isTrustedDevice(input.user.id, input.deviceId) : false;
    if (!trusted) {
      requiredByRisk = true;
      riskReason = '新设备登录';
      await recordLoginRiskEvent({
        userId: input.user.id,
        username: input.user.username,
        tenantId: input.user.tenantId ?? null,
        riskLevel: 'medium',
        reason: riskReason,
        action: 'challenge',
        ip: input.ip,
        ua: input.ua,
        deviceId: input.deviceId,
      });
    }
  }

  if (!requiredByPolicy && !requiredByRisk) return { required: false, methods: [] as MfaMethod[], reason: null };
  return { required: true, methods: ['totp'] as MfaMethod[], reason: riskReason ?? 'MFA 策略要求' };
}

export async function createMfaChallenge(payload: Omit<MfaChallengePayload, 'createdAt' | 'expiresAt'>) {
  const challengeId = randomBytes(24).toString('base64url');
  const now = Date.now();
  const fullPayload: MfaChallengePayload = {
    ...payload,
    createdAt: now,
    expiresAt: now + MFA_CHALLENGE_TTL_SECONDS * 1000,
  };
  const { default: redis } = await import('../lib/redis');
  await redis.set(`${MFA_CHALLENGE_PREFIX}${challengeId}`, JSON.stringify(fullPayload), 'EX', MFA_CHALLENGE_TTL_SECONDS);
  return { challengeId, expiresAt: fullPayload.expiresAt };
}

export async function getMfaChallenge(challengeId: string): Promise<MfaChallengePayload> {
  const { default: redis } = await import('../lib/redis');
  const key = `${MFA_CHALLENGE_PREFIX}${challengeId}`;
  const raw = await redis.get(key);
  if (!raw) throw new HTTPException(400, { message: 'MFA 验证已过期，请重新登录' });
  const payload = JSON.parse(raw) as MfaChallengePayload;
  if (payload.expiresAt < Date.now()) throw new HTTPException(400, { message: 'MFA 验证已过期，请重新登录' });
  return payload;
}

export async function clearMfaChallenge(challengeId: string): Promise<void> {
  const { default: redis } = await import('../lib/redis');
  await redis.del(`${MFA_CHALLENGE_PREFIX}${challengeId}`);
}

export async function verifyLoginTotp(challenge: MfaChallengePayload, code: string) {
  const rows = await db
    .select()
    .from(userMfaFactors)
    .where(and(eq(userMfaFactors.userId, challenge.userId), eq(userMfaFactors.type, 'totp'), eq(userMfaFactors.status, 'enabled')));
  for (const factor of rows) {
    if (!factor.secretEncrypted) continue;
    if (verifyTotp(code, decryptSecret(factor.secretEncrypted))) {
      await db.update(userMfaFactors).set({ lastUsedAt: new Date() }).where(eq(userMfaFactors.id, factor.id));
      if (challenge.rememberDevice && challenge.deviceId) {
        const policy = await getIdentitySecurityPolicy(challenge.tenantId);
        await trustDevice({
          userId: challenge.userId,
          deviceId: challenge.deviceId,
          ip: challenge.ip,
          ua: challenge.ua,
          days: policy.mfa.rememberDeviceDays,
        });
      }
      return;
    }
  }
  throw new HTTPException(400, { message: '动态验证码错误' });
}

export async function listMyTrustedDevices() {
  const userId = currentUser().userId;
  const now = new Date();
  const rows = await db
    .select()
    .from(userTrustedDevices)
    .where(and(eq(userTrustedDevices.userId, userId), gt(userTrustedDevices.trustedUntil, now)))
    .orderBy(desc(userTrustedDevices.lastSeenAt));
  return rows.map((row) => ({
    id: row.id,
    deviceName: row.deviceName,
    ip: row.ip,
    userAgent: row.userAgent,
    trustedUntil: formatDateTime(row.trustedUntil),
    lastSeenAt: formatDateTime(row.lastSeenAt),
    createdAt: formatDateTime(row.createdAt),
  }));
}

export async function removeMyTrustedDevice(id: number) {
  const userId = currentUser().userId;
  const [row] = await db
    .delete(userTrustedDevices)
    .where(and(eq(userTrustedDevices.id, id), eq(userTrustedDevices.userId, userId)))
    .returning();
  if (!row) throw new HTTPException(404, { message: '可信设备不存在' });
}

export async function listLoginRiskEvents(query: { page?: number; pageSize?: number; keyword?: string }) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 10;
  const rows = await db.select().from(loginRiskEvents).orderBy(desc(loginRiskEvents.createdAt));
  const keyword = query.keyword?.trim();
  const filtered = keyword
    ? rows.filter((row) => row.username.includes(keyword) || row.reason.includes(keyword) || (row.ip ?? '').includes(keyword))
    : rows;
  const start = (page - 1) * pageSize;
  return {
    list: filtered.slice(start, start + pageSize).map((row) => ({
      id: row.id,
      userId: row.userId,
      username: row.username,
      tenantId: row.tenantId,
      riskLevel: row.riskLevel,
      reason: row.reason,
      action: row.action,
      ip: row.ip,
      location: row.location,
      userAgent: row.userAgent,
      createdAt: formatDateTime(row.createdAt),
    })),
    total: filtered.length,
    page,
    pageSize,
  };
}

async function ensureOwnTotpFactor(userId: number, factorId: number) {
  const [factor] = await db
    .select()
    .from(userMfaFactors)
    .where(and(eq(userMfaFactors.id, factorId), eq(userMfaFactors.userId, userId), eq(userMfaFactors.type, 'totp')))
    .limit(1);
  if (!factor) throw new HTTPException(404, { message: 'MFA 因子不存在' });
  return factor;
}

function mapMfaFactor(row: typeof userMfaFactors.$inferSelect) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    status: row.status,
    verifiedAt: row.verifiedAt ? formatDateTime(row.verifiedAt) : null,
    lastUsedAt: row.lastUsedAt ? formatDateTime(row.lastUsedAt) : null,
    createdAt: formatDateTime(row.createdAt),
  };
}

async function recordLoginRiskEvent(input: {
  userId: number | null;
  username: string;
  tenantId: number | null;
  riskLevel: 'low' | 'medium' | 'high';
  reason: string;
  action: 'allow' | 'challenge' | 'block';
  ip: string;
  ua: string;
  deviceId?: string;
}) {
  await db.insert(loginRiskEvents).values({
    userId: input.userId,
    username: input.username,
    tenantId: input.tenantId,
    riskLevel: input.riskLevel,
    reason: input.reason,
    action: input.action,
    ip: input.ip,
    location: input.ip ? lookupIpLocation(input.ip) : null,
    userAgent: input.ua,
    deviceIdHash: input.deviceId ? hashDeviceId(input.deviceId) : null,
  });
}

async function isTrustedDevice(userId: number, deviceId: string) {
  const [row] = await db
    .select({ id: userTrustedDevices.id })
    .from(userTrustedDevices)
    .where(and(
      eq(userTrustedDevices.userId, userId),
      eq(userTrustedDevices.deviceIdHash, hashDeviceId(deviceId)),
      gt(userTrustedDevices.trustedUntil, new Date()),
    ))
    .limit(1);
  return !!row;
}

async function trustDevice(input: { userId: number; deviceId: string; ip: string; ua: string; days: number }) {
  const now = new Date();
  const trustedUntil = new Date(now.getTime() + Math.max(input.days, 1) * 24 * 60 * 60 * 1000);
  const deviceIdHash = hashDeviceId(input.deviceId);
  const [existing] = await db
    .select({ id: userTrustedDevices.id })
    .from(userTrustedDevices)
    .where(and(eq(userTrustedDevices.userId, input.userId), eq(userTrustedDevices.deviceIdHash, deviceIdHash)))
    .limit(1);
  const values = {
    deviceName: '可信设备',
    ip: input.ip,
    userAgent: input.ua,
    trustedUntil,
    lastSeenAt: now,
  };
  if (existing) {
    await db.update(userTrustedDevices).set(values).where(eq(userTrustedDevices.id, existing.id));
  } else {
    await db.insert(userTrustedDevices).values({ userId: input.userId, deviceIdHash, ...values });
  }
}

function hashDeviceId(deviceId: string) {
  return createHash('sha256').update(deviceId).digest('hex');
}
