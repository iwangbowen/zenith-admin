import { getOnlineSessions, forceLogout, forceLogoutAllByUser } from '../lib/session-manager';
import { sendToToken, closeTokenConnection, sendToUser, closeUserConnections } from '../lib/ws-manager';
import { pageOffset } from '../lib/pagination';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime } from '../lib/datetime';

export async function listSessions(q: { page?: number; pageSize?: number; keyword?: string }) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const keyword = q.keyword ?? '';
  let sessions = await getOnlineSessions();
  if (keyword) {
    sessions = sessions.filter((s) => s.username.includes(keyword) || s.nickname.includes(keyword) || s.ip.includes(keyword));
  }
  const total = sessions.length;
  const list = sessions.slice(pageOffset(page, pageSize), page * pageSize);
  return {
    list: list.map((s) => ({
      tokenId: s.tokenId,
      userId: s.userId,
      username: s.username,
      nickname: s.nickname,
      ip: s.ip,
      location: s.location ?? null,
      browser: s.browser,
      os: s.os,
      loginAt: formatDateTime(s.loginAt),
    })),
    total,
    page,
    pageSize,
  };
}

export async function forceLogoutSession(tokenId: string) {
  const allSessions = await getOnlineSessions();
  const session = allSessions.find((s) => s.tokenId === tokenId);
  const success = await forceLogout(tokenId);
  if (!success) throw new HTTPException(404, { message: '会话不存在' });
  if (session) {
    sendToToken(tokenId, { type: 'session:force-logout', payload: { reason: '您已被管理员强制下线' } });
    setTimeout(() => closeTokenConnection(tokenId, '强制下线'), 500);
  }
}

export async function forceLogoutAllUserSessions(userId: number) {
  const tokenIds = await forceLogoutAllByUser(userId);
  if (tokenIds.length === 0) throw new HTTPException(404, { message: '该用户暂无在线会话' });
  const msg = { type: 'session:force-logout' as const, payload: { reason: '您已被管理员强制下线' } };
  sendToUser(userId, msg);
  setTimeout(() => closeUserConnections(userId, '强制下线'), 500);
}

export async function getSessionBeforeAudit(tokenId: string) {
  const allSessions = await getOnlineSessions();
  const session = allSessions.find((s) => s.tokenId === tokenId);
  if (!session) return null;
  return {
    tokenId: session.tokenId,
    userId: session.userId,
    username: session.username,
    nickname: session.nickname,
    ip: session.ip,
    location: session.location ?? null,
    browser: session.browser,
    os: session.os,
    loginAt: formatDateTime(session.loginAt),
  };
}

export async function getUserSessionsBeforeAudit(userId: number) {
  const allSessions = await getOnlineSessions();
  return allSessions
    .filter((s) => s.userId === userId)
    .map((session) => ({
      tokenId: session.tokenId,
      userId: session.userId,
      username: session.username,
      nickname: session.nickname,
      ip: session.ip,
      location: session.location ?? null,
      browser: session.browser,
      os: session.os,
      loginAt: formatDateTime(session.loginAt),
    }));
}
