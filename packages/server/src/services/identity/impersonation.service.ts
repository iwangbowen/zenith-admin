/**
 * 模拟登录（管理员以用户身份操作）。
 *
 * 会话本体复用 Redis jti 会话：以目标用户的 userId / roles / tenantId 签发**短时 access token**，
 * 令牌上带 `impersonation` 声明记录实际操作人；不签发 refresh token、不可续签，到期自然失效。
 * `impersonation_sessions` 记录审计事实（谁 / 模拟了谁 / 原因 / 模式 / 起止 / 结束方式），
 * 并作为鉴权中间件的权威兜底（已结束 / 已到期的记录让令牌立即失效，不依赖 Redis 黑名单存活）。
 */
import { and, desc, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { QueryOutputOf } from '@zenith/shared/core';
import { impersonationContract, impersonationSessionSchema, type ImpersonationState, type SessionClientKind, type StartImpersonationInput } from '@zenith/shared/identity';
import { db } from '../../db';
import { impersonationSessions, users, type ImpersonationSessionRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { formatDateTime } from '../../lib/datetime';
import { pickEntity } from '../../lib/entity-map';
import { lookupIpLocation } from '../../lib/ip-location';
import { signToken } from '../../lib/jwt';
import { buildListResult } from '../../lib/list-query';
import logger from '../../lib/logger';
import { verifyPassword } from '../../lib/password';
import { resolveReportedClient } from '../../lib/request-helpers';
import { forceLogout, generateTokenId, registerSession, removeSession } from '../../lib/session-manager';
import { getSettings } from '../../lib/settings';
import { checkSubjectLiveness, loadSubjectRow } from '../../lib/subject-liveness';
import { tenantCondition, tenantScope } from '../../lib/tenant';
import { resolveUserNames } from '../../lib/user-nicknames';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { closeTokenConnection, sendToToken } from '../../lib/ws-manager';
import { invalidateImpersonationSubject, type JwtPayload } from '../../middleware/auth';
import { notify } from '../messaging/notification-outbox.service';
import { getUserRoles, recordLoginLog } from './auth.service';
import { userHasPlatformSuperRole } from './role-grant';

interface ClientInfo {
  ip: string;
  ua: string;
  /** 发起模拟的终端；缺省 web */
  client?: SessionClientKind;
}

function isActive(row: Pick<ImpersonationSessionRow, 'endedAt' | 'expiresAt'>, now = new Date()): boolean {
  return row.endedAt === null && row.expiresAt > now;
}

function toState(row: ImpersonationSessionRow): ImpersonationState {
  return {
    id: row.id,
    impersonatorId: row.impersonatorId,
    impersonatorName: row.impersonatorName,
    readOnly: row.readOnly,
    reason: row.reason,
    startedAt: formatDateTime(row.startedAt),
    expiresAt: formatDateTime(row.expiresAt),
  };
}

/** `/api/auth/me`：当前令牌带模拟声明时返回记录态；记录缺失（不应发生）按 null 处理而不是让个人资料接口失败 */
export async function getImpersonationState(id: number): Promise<ImpersonationState | null> {
  // 当前用户即被模拟用户，记录归属其租户：租户条件与 id 同时成立才返回
  const [row] = await db.select().from(impersonationSessions)
    .where(and(eq(impersonationSessions.id, id), tenantCondition(impersonationSessions, currentUser())))
    .limit(1);
  return row ? toState(row) : null;
}

export async function startImpersonation(input: StartImpersonationInput, client: ClientInfo) {
  const operator = currentUser();
  if (operator.impersonation) throw new HTTPException(403, { message: '模拟会话中不能再次发起模拟' });
  if (operator.authType === 'apiToken') throw new HTTPException(403, { message: '请使用登录会话发起模拟登录' });

  const { impersonation: policy } = await getSettings('identitySecurity', { tenantId: operator.tenantId });
  if (!policy.enabled) throw new HTTPException(403, { message: '模拟登录功能已关闭' });
  if (!input.readOnly && !policy.allowWrite) throw new HTTPException(400, { message: '当前安全策略只允许只读模拟' });
  const minutes = Math.min(input.durationMinutes ?? policy.maxMinutes, policy.maxMinutes);

  // 二次验证：操作者本人密码（返回 400 而非 401，避免前端把它当作登录态失效）
  const [operatorRow] = await db.select({ password: users.password }).from(users).where(eq(users.id, operator.userId)).limit(1);
  requireRow(operatorRow, '用户不存在');
  if (!(await verifyPassword(input.password, operatorRow.password))) {
    throw new HTTPException(400, { message: '当前账号密码错误，无法发起模拟登录' });
  }

  // 目标必须在操作者租户可见范围内（平台管理员可跨租户），且不能是自己 / 平台超管 / 不可用账号
  const [target] = await db.select({ id: users.id, username: users.username, nickname: users.nickname, tenantId: users.tenantId, status: users.status })
    .from(users)
    .where(buildWhere(eq(users.id, input.userId), tenantScope(users)))
    .limit(1);
  requireRow(target, '目标用户不存在', 404);
  if (target.id === operator.userId) throw new HTTPException(400, { message: '不能模拟自己' });
  if (await userHasPlatformSuperRole(target.id)) throw new HTTPException(403, { message: '不能模拟平台超级管理员' });
  const liveness = checkSubjectLiveness(await loadSubjectRow(target.id));
  if (!liveness.ok) throw new HTTPException(400, { message: `目标用户当前不可登录：${liveness.message}` });

  const readOnly = input.readOnly;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + minutes * 60_000);
  const tokenId = generateTokenId();
  // 发起端自报优先（精确到 Win11 等 UA 冻结的系统），缺项回退 UA 解析；仅展示，不参与鉴权
  const { browser, os } = resolveReportedClient(input, client.ua);
  const location = lookupIpLocation(client.ip);

  const [record] = await db.insert(impersonationSessions).values({
    impersonatorId: operator.userId,
    impersonatorName: operator.username,
    targetUserId: target.id,
    targetUsername: target.username,
    tenantId: target.tenantId ?? null,
    tokenId,
    readOnly,
    reason: input.reason,
    ip: client.ip,
    location,
    browser,
    os,
    startedAt: now,
    expiresAt,
  }).returning();

  const roleCodes = (await getUserRoles(target.id)).map((r) => r.code);
  const accessToken = await signToken<JwtPayload>({
    userId: target.id,
    username: target.username,
    roles: roleCodes,
    tenantId: target.tenantId ?? null,
    impersonation: { id: record.id, byUserId: operator.userId, byUsername: operator.username, readOnly },
    jti: tokenId,
  }, minutes * 60);

  await Promise.all([
    // 只注册在线会话，不签发 refresh 授权：模拟会话不可续签
    registerSession({
      tokenId,
      userId: target.id,
      username: target.username,
      nickname: target.nickname,
      tenantId: target.tenantId ?? null,
      client: client.client ?? 'web',
      ip: client.ip,
      location,
      browser,
      os,
      loginAt: now,
      impersonatorId: operator.userId,
      impersonatorName: operator.username,
    }),
    recordLoginLog({
      eventType: 'impersonate',
      status: 'success',
      message: `由 ${operator.username} 模拟登录（${readOnly ? '只读' : '可操作'}）：${input.reason}`,
      userId: target.id,
      username: target.username,
      tenantId: target.tenantId ?? null,
      ip: client.ip,
      ua: client.ua,
    }),
  ]);

  if (policy.notifyTarget) {
    try {
      await notify('identity.impersonation.started', {
        recipients: [{ type: 'user', id: target.id }],
        vars: {
          impersonatorName: operator.username,
          reason: input.reason,
          mode: readOnly ? '只读模式' : '可操作模式',
          expiresAt: formatDateTime(expiresAt),
        },
        tenantId: target.tenantId ?? null,
        link: '/profile?tab=security',
        dedupeKey: `impersonation:${record.id}`,
      });
    } catch (err) {
      logger.warn('[Impersonation] 通知被模拟用户失败', { id: record.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    accessToken,
    impersonation: toState(record),
    target: { id: target.id, username: target.username, nickname: target.nickname },
  };
}

/** 模拟会话自行结束：吊销当前 jti、关闭记录 */
export async function endImpersonation(client: ClientInfo) {
  const user = currentUser();
  const claim = user.impersonation;
  if (!claim) throw new HTTPException(400, { message: '当前不是模拟会话' });
  const now = new Date();
  const [row] = await db.update(impersonationSessions)
    .set({ endedAt: now, endReason: 'manual' })
    .where(and(eq(impersonationSessions.id, claim.id), isNull(impersonationSessions.endedAt)))
    .returning();
  invalidateImpersonationSubject(claim.id);
  await Promise.all([
    user.jti ? removeSession(user.jti) : Promise.resolve(),
    recordLoginLog({
      eventType: 'impersonate_end',
      status: 'success',
      message: `${claim.byUsername} 结束模拟登录`,
      userId: user.userId,
      username: user.username,
      tenantId: user.tenantId ?? null,
      ip: client.ip,
      ua: client.ua,
    }),
  ]);
  return row ?? null;
}

/** 到期未主动结束的记录补写结束态（列表读取前的轻量归档，只触碰当前可见范围） */
async function settleExpired(now: Date) {
  await db.update(impersonationSessions)
    .set({ endedAt: impersonationSessions.expiresAt, endReason: 'expired' })
    .where(buildWhere(
      isNull(impersonationSessions.endedAt),
      lte(impersonationSessions.expiresAt, now),
      tenantCondition(impersonationSessions, currentUser()),
    ));
}

export async function listImpersonationSessions(q: QueryOutputOf<typeof impersonationContract.list>) {
  const { page, pageSize } = q;
  const now = new Date();
  await settleExpired(now);
  const where = buildWhere(
    keywordCondition(q.keyword, [impersonationSessions.impersonatorName, impersonationSessions.targetUsername, impersonationSessions.reason]),
    q.status === 'active' ? and(isNull(impersonationSessions.endedAt), gt(impersonationSessions.expiresAt, now)) : undefined,
    q.status === 'ended' ? or(isNotNull(impersonationSessions.endedAt), lte(impersonationSessions.expiresAt, now)) : undefined,
    ...dateRangeConditions(impersonationSessions.startedAt, q.startTime, q.endTime),
    tenantCondition(impersonationSessions, currentUser()),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(impersonationSessions, where),
    rows: async () => {
      const rows = await withPagination(
        db.select().from(impersonationSessions).where(where).orderBy(desc(impersonationSessions.startedAt), desc(impersonationSessions.id)).$dynamic(),
        page,
        pageSize,
      );
      const names = await resolveUserNames(rows.flatMap((r) => [r.impersonatorId, r.targetUserId]));
      return rows.map((row) => pickEntity(impersonationSessionSchema, row, {
        status: isActive(row, now) ? 'active' as const : 'ended' as const,
        impersonatorNickname: names.get(row.impersonatorId) ?? null,
        targetNickname: names.get(row.targetUserId) ?? null,
      }));
    },
  });
}

/** 管理端强制结束进行中的模拟会话：吊销 jti 并通知该标签页回到操作者身份 */
export async function forceEndImpersonation(id: number, client: ClientInfo) {
  const operator = currentUser();
  const [row] = await db.select().from(impersonationSessions)
    .where(and(eq(impersonationSessions.id, id), tenantCondition(impersonationSessions, operator)))
    .limit(1);
  const record = requireRow(row, '模拟会话不存在', 404);
  if (!isActive(record)) throw new HTTPException(400, { message: '该模拟会话已结束' });
  const now = new Date();
  await db.update(impersonationSessions)
    .set({ endedAt: now, endReason: 'forced', endedBy: operator.userId })
    .where(and(eq(impersonationSessions.id, id), tenantCondition(impersonationSessions, operator)));
  invalidateImpersonationSubject(id);
  await Promise.all([
    forceLogout(record.tokenId),
    recordLoginLog({
      eventType: 'impersonate_end',
      status: 'success',
      message: `${operator.username} 强制结束了 ${record.impersonatorName} 的模拟登录`,
      userId: record.targetUserId,
      username: record.targetUsername,
      tenantId: record.tenantId ?? null,
      ip: client.ip,
      ua: client.ua,
    }),
  ]);
  sendToToken(record.tokenId, { type: 'session:force-logout', payload: { reason: '模拟会话已被管理员强制结束' } });
  setTimeout(() => closeTokenConnection(record.tokenId, '模拟会话已强制结束'), 500);
}
