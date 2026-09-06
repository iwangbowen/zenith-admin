import { requireRow } from '../../lib/db-assert';
import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { oauthConfigs, users, userOauthAccounts, type UserRow } from '../../db/schema';
import { getOAuthProvider, isProviderConfigured, listConfiguredProviders, type OAuthTokenResult, type OAuthUserInfo } from '../../lib/oauth';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import redis from '../../lib/redis';
import { config } from '../../config';
import { completeLoginWithMfa, type DeviceInfo } from './auth.service';
import { userHasPlatformSuperRole } from './role-grant';
import { OAUTH_PROVIDERS } from '@zenith/shared/identity';
import type { OAuthProviderType } from '@zenith/shared/identity';
import { formatDateTime } from '../../lib/datetime';

const VALID_PROVIDERS = new Set<string>(OAUTH_PROVIDERS);

/** state 有效期：覆盖用户在提供方页面完成授权所需的时间即可 */
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const OAUTH_STATE_PREFIX = `${config.redis.keyPrefix}oauth-state:`;

type OAuthIntent = 'login' | 'bind';

interface OAuthStatePayload {
  provider: OAuthProviderType;
  intent: OAuthIntent;
  /** intent=bind 时发起绑定的用户；回调时必须与当前登录用户一致 */
  userId?: number;
  createdAt: number;
}

export function isValidOAuthProvider(p: string | undefined): p is OAuthProviderType {
  return !!p && VALID_PROVIDERS.has(p);
}

export async function ensureProviderUsable(provider: string): Promise<OAuthProviderType> {
  if (!isValidOAuthProvider(provider)) throw new HTTPException(400, { message: '不支持的 OAuth 提供方' });
  if (!(await isProviderConfigured(provider))) throw new HTTPException(400, { message: '该 OAuth 提供方尚未配置，请联系管理员' });
  return provider;
}

/** 已启用且配置完整的提供方（公开接口，登录页据此决定是否渲染第三方登录入口，不含任何凭据） */
export function listEnabledOAuthProviders(): Promise<OAuthProviderType[]> {
  return listConfiguredProviders();
}

export async function listOAuthAccounts() {
  const user = currentUser();
  const accounts = await db
    .select({
      id: userOauthAccounts.id,
      provider: userOauthAccounts.provider,
      openId: userOauthAccounts.openId,
      nickname: userOauthAccounts.nickname,
      avatar: userOauthAccounts.avatar,
      createdAt: userOauthAccounts.createdAt,
    })
    .from(userOauthAccounts)
    .where(eq(userOauthAccounts.userId, user.userId));
  return accounts.map((a) => ({ ...a, createdAt: formatDateTime(a.createdAt) }));
}

// ─── state：服务端单次消费 + 前端 sessionStorage 比对，双侧共同防登录 CSRF ────────

async function issueOAuthState(payload: Omit<OAuthStatePayload, 'createdAt'>): Promise<string> {
  const state = crypto.randomBytes(24).toString('base64url');
  await redis.set(`${OAUTH_STATE_PREFIX}${state}`, JSON.stringify({ ...payload, createdAt: Date.now() } satisfies OAuthStatePayload), 'EX', OAUTH_STATE_TTL_SECONDS);
  return state;
}

/**
 * 消费 state：必须存在（未过期 / 未使用）、provider 与意图匹配；bind 还要求发起者就是当前用户。
 * 取到即删除，同一个 state 不能被重放。
 */
async function consumeOAuthState(state: string, expected: { provider: OAuthProviderType; intent: OAuthIntent; userId?: number }): Promise<void> {
  const key = `${OAUTH_STATE_PREFIX}${state}`;
  const raw = await redis.get(key);
  if (raw) await redis.del(key);
  const payload = raw ? (JSON.parse(raw) as OAuthStatePayload) : null;
  if (!payload) throw new HTTPException(400, { message: '第三方登录状态已过期或无效，请重新发起' });
  if (payload.provider !== expected.provider || payload.intent !== expected.intent) {
    throw new HTTPException(400, { message: '第三方登录状态与本次请求不匹配，请重新发起' });
  }
  if (expected.intent === 'bind' && payload.userId !== expected.userId) {
    throw new HTTPException(403, { message: '绑定请求不是由当前账号发起的，请重新发起绑定' });
  }
}

/** 登录页发起：匿名调用 */
export async function generateAuthUrl(provider: string) {
  const p = await ensureProviderUsable(provider);
  const state = await issueOAuthState({ provider: p, intent: 'login' });
  const oauthProvider = await getOAuthProvider(p);
  return { authUrl: oauthProvider.getAuthUrl(state), state };
}

/** 个人中心发起绑定：state 绑定到当前用户，回调时只能由同一用户完成 */
export async function generateBindAuthUrl(provider: string) {
  const user = currentUser();
  const p = await ensureProviderUsable(provider);
  const state = await issueOAuthState({ provider: p, intent: 'bind', userId: user.userId });
  const oauthProvider = await getOAuthProvider(p);
  return { authUrl: oauthProvider.getAuthUrl(state), state };
}

// ─── 回调：解析本地账号 ──────────────────────────────────────────────────────────

export interface OAuthResolved {
  kind: 'resolved';
  user: UserRow;
}
export interface OAuthNeedBind {
  kind: 'needBind';
  oauthInfo: { provider: string; openId: string; nickname: string; avatar?: string | null };
}
export type OAuthCallbackResult = OAuthResolved | OAuthNeedBind;

function accountValues(p: OAuthProviderType, userId: number, userInfo: OAuthUserInfo, tokenResult: OAuthTokenResult) {
  return {
    userId,
    provider: p,
    openId: userInfo.openId,
    unionId: userInfo.unionId || null,
    nickname: userInfo.nickname,
    avatar: userInfo.avatar || null,
    accessToken: tokenResult.accessToken,
    refreshToken: tokenResult.refreshToken || null,
    expiresAt: tokenResult.expiresIn ? new Date(Date.now() + tokenResult.expiresIn * 1000) : null,
    raw: JSON.stringify(userInfo),
  };
}

/**
 * 按邮箱自动关联既有本地账号，全部条件同时满足才允许：
 * - 该提供方配置显式开启 `autoLinkByEmail`（默认关闭）；
 * - 提供方断言邮箱已验证（GitHub 取 /user/emails 的 verified；企业提供方以通讯录为准）；
 * - 邮箱在全库唯一命中（邮箱唯一约束按租户，跨租户同邮箱视为歧义不关联）且账号启用；
 * - 目标账号不持有平台超管角色 —— 超管只能在已登录态下显式绑定，任何自动路径都不接管它。
 * 其余情况一律返回 needBind：用户先用密码登录，再在个人中心完成绑定。
 */
async function findAutoLinkableUser(p: OAuthProviderType, userInfo: OAuthUserInfo): Promise<UserRow | null> {
  if (!userInfo.email || !userInfo.emailVerified) return null;
  const [cfg] = await db.select({ autoLinkByEmail: oauthConfigs.autoLinkByEmail }).from(oauthConfigs).where(eq(oauthConfigs.provider, p)).limit(1);
  if (!cfg?.autoLinkByEmail) return null;
  const matches = await db.select().from(users).where(eq(users.email, userInfo.email)).limit(2);
  if (matches.length !== 1) return null;
  const [matched] = matches;
  if (matched.status !== 'enabled') return null;
  if (await userHasPlatformSuperRole(matched.id)) return null;
  return matched;
}

export async function resolveOAuthCallback(provider: string, code: string): Promise<OAuthCallbackResult> {
  const p = await ensureProviderUsable(provider);
  if (!code) throw new HTTPException(400, { message: '缺少授权码' });

  const oauthProvider = await getOAuthProvider(p);
  const tokenResult = await oauthProvider.getToken(code);
  const userInfo = await oauthProvider.getUserInfo(tokenResult);

  const [existingBind] = await db
    .select()
    .from(userOauthAccounts)
    .where(and(eq(userOauthAccounts.provider, p), eq(userOauthAccounts.openId, userInfo.openId)))
    .limit(1);

  let userId: number;
  if (existingBind) {
    userId = existingBind.userId;
    await db
      .update(userOauthAccounts)
      .set({
        accessToken: tokenResult.accessToken,
        refreshToken: tokenResult.refreshToken || null,
        expiresAt: tokenResult.expiresIn ? new Date(Date.now() + tokenResult.expiresIn * 1000) : null,
        nickname: userInfo.nickname,
        avatar: userInfo.avatar || null,
      })
      .where(eq(userOauthAccounts.id, existingBind.id));
  } else {
    const linkable = await findAutoLinkableUser(p, userInfo);
    if (!linkable) {
      return {
        kind: 'needBind',
        oauthInfo: { provider: p, openId: userInfo.openId, nickname: userInfo.nickname, avatar: userInfo.avatar },
      };
    }
    userId = linkable.id;
    await db.insert(userOauthAccounts).values(accountValues(p, userId, userInfo, tokenResult));
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.status === 'disabled') throw new HTTPException(403, { message: '账号已被禁用' });
  return { kind: 'resolved', user };
}

export async function handleOAuthCallback(
  provider: string,
  input: { code: string; state: string; deviceId?: string },
  client: { ip: string; ua: string; deviceInfo?: DeviceInfo },
) {
  const p = await ensureProviderUsable(provider);
  await consumeOAuthState(input.state, { provider: p, intent: 'login' });
  const result = await resolveOAuthCallback(p, input.code);

  if (result.kind === 'needBind') {
    return {
      data: { needBind: true as const, oauthInfo: result.oauthInfo },
      message: '未找到匹配账号，请先绑定',
    };
  }

  // 与密码登录 / 企业 SSO 共用 MFA 决策、密码过期检查、登录日志与会话登记
  const loginResult = await completeLoginWithMfa(
    result.user,
    { ip: client.ip, ua: client.ua, deviceInfo: client.deviceInfo, deviceId: input.deviceId },
    `第三方登录成功（${p}）`,
  );
  return { data: loginResult, message: 'mfaRequired' in loginResult ? '请完成多因素认证' : '登录成功' };
}

export async function bindOAuthAccount(provider: string, code: string, state: string) {
  const user = currentUser();
  if (!provider || !code) throw new HTTPException(400, { message: '缺少参数' });
  const p = await ensureProviderUsable(provider);
  await consumeOAuthState(state, { provider: p, intent: 'bind', userId: user.userId });
  const oauthProvider = await getOAuthProvider(p);
  const tokenResult = await oauthProvider.getToken(code);
  const userInfo = await oauthProvider.getUserInfo(tokenResult);

  const [existing] = await db
    .select()
    .from(userOauthAccounts)
    .where(and(eq(userOauthAccounts.provider, p), eq(userOauthAccounts.openId, userInfo.openId)))
    .limit(1);

  if (existing) {
    if (existing.userId === user.userId) throw new HTTPException(400, { message: '该账号已绑定' });
    throw new HTTPException(400, { message: '该第三方账号已被其他用户绑定' });
  }

  const [myBind] = await db
    .select()
    .from(userOauthAccounts)
    .where(and(eq(userOauthAccounts.userId, user.userId), eq(userOauthAccounts.provider, p)))
    .limit(1);
  if (myBind) throw new HTTPException(400, { message: '您已绑定该类型账号，请先解绑' });

  await db.insert(userOauthAccounts).values(accountValues(p, user.userId, userInfo, tokenResult));
}

export async function unbindOAuthAccount(provider: string) {
  const user = currentUser();
  if (!isValidOAuthProvider(provider)) throw new HTTPException(400, { message: '不支持的 OAuth 提供方' });
  const result = await db
    .delete(userOauthAccounts)
    .where(and(eq(userOauthAccounts.userId, user.userId), eq(userOauthAccounts.provider, provider)))
    .returning();
  requireRow(result[0], '未找到该绑定');
}
