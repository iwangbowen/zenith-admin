/**
 * 在线会话管理（管理端「在线用户」页）。
 *
 * 可见范围与用户管理对齐：平台管理员在平台视角看全部、切到租户视角只看该租户；
 * 租户管理员只看本租户会话；非平台超管永远看不到（也不能踢掉）平台超管的会话。
 * 目录同步 / SCIM 等系统流程使用不带范围的 forceLogoutAllUserSessions（调用方已按自身来源限定用户）。
 */
import { getOnlineSessions, forceLogout, forceLogoutAllByUser, type SessionInfo } from '../../lib/session-manager';
import { sendToToken, closeTokenConnection, sendToUser, closeUserConnections } from '../../lib/ws-manager';
import { pageOffset } from '../../lib/pagination';
import { buildListResult } from '../../lib/list-query';
import { HTTPException } from 'hono/http-exception';
import { requireRow } from '../../lib/db-assert';
import { formatDateTime } from '../../lib/datetime';
import { currentUser } from '../../lib/context';
import { getTenantScopeId, isPlatformAdmin } from '../../lib/tenant';
import { listPlatformSuperUserIds } from './role-grant';
import type { QueryOutputOf } from '@zenith/shared/core';
import type { sessionContract } from '@zenith/shared/identity';

/** 当前操作者可见（可管理）的在线会话 */
async function visibleSessions(): Promise<SessionInfo[]> {
  const user = currentUser();
  const all = await getOnlineSessions();
  const scope = getTenantScopeId(user);
  const inScope = scope === undefined ? all : all.filter((s) => (s.tenantId ?? null) === scope);
  if (isPlatformAdmin(user)) return inScope;
  const superUserIds = await listPlatformSuperUserIds();
  return inScope.filter((s) => !superUserIds.has(s.userId));
}

function toSessionDto(s: SessionInfo) {
  return {
    tokenId: s.tokenId,
    userId: s.userId,
    username: s.username,
    nickname: s.nickname,
    ip: s.ip,
    location: s.location ?? null,
    browser: s.browser,
    os: s.os,
    loginAt: formatDateTime(s.loginAt),
  };
}

export async function listSessions(q: QueryOutputOf<typeof sessionContract.list>) {
  const { page, pageSize } = q;
  const keyword = q.keyword ?? '';
  let sessions = await visibleSessions();
  if (keyword) {
    sessions = sessions.filter((s) => s.username.includes(keyword) || s.nickname.includes(keyword) || s.ip.includes(keyword));
  }
  return buildListResult({
    page,
    pageSize,
    count: async () => sessions.length,
    rows: async () => sessions.slice(pageOffset(page, pageSize), page * pageSize),
    map: toSessionDto,
  });
}

function notifyForceLogout(tokenId: string) {
  sendToToken(tokenId, { type: 'session:force-logout', payload: { reason: '您已被管理员强制下线' } });
  setTimeout(() => closeTokenConnection(tokenId, '强制下线'), 500);
}

/** 管理端：强制下线指定会话（越出可见范围按不存在处理，不泄露其它租户会话是否存在） */
export async function forceLogoutSession(tokenId: string) {
  const maybeSession = (await visibleSessions()).find((s) => s.tokenId === tokenId);
  requireRow(maybeSession, '会话不存在');
  const success = await forceLogout(tokenId);
  if (!success) throw new HTTPException(404, { message: '会话不存在' });
  notifyForceLogout(tokenId);
}

/** 系统流程（目录同步 / SCIM / 生命周期）：强制下线某用户全部会话，不做操作者范围校验 */
export async function forceLogoutAllUserSessions(userId: number) {
  const tokenIds = await forceLogoutAllByUser(userId);
  if (tokenIds.length === 0) throw new HTTPException(404, { message: '该用户暂无在线会话' });
  const msg = { type: 'session:force-logout' as const, payload: { reason: '您已被管理员强制下线' } };
  sendToUser(userId, msg);
  setTimeout(() => closeUserConnections(userId, '强制下线'), 500);
}

/** 管理端：强制下线指定用户全部会话，目标用户必须在当前操作者可见范围内 */
export async function forceLogoutVisibleUserSessions(userId: number) {
  const visible = (await visibleSessions()).some((s) => s.userId === userId);
  if (!visible) throw new HTTPException(404, { message: '该用户暂无在线会话' });
  await forceLogoutAllUserSessions(userId);
}

export async function getSessionBeforeAudit(tokenId: string) {
  const session = (await visibleSessions()).find((s) => s.tokenId === tokenId);
  return session ? toSessionDto(session) : null;
}

export async function getUserSessionsBeforeAudit(userId: number) {
  return (await visibleSessions()).filter((s) => s.userId === userId).map(toSessionDto);
}
