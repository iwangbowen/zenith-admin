import { getOnlineSessions, forceLogout } from '../lib/session-manager';
import { sendToUser, closeUserConnections } from '../lib/ws-manager';
import { pageOffset } from '../lib/pagination';
import { AppError } from '../lib/errors';
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
  if (!success) throw new AppError('会话不存在', 404);
  if (session) {
    sendToUser(session.userId, { type: 'session:force-logout', payload: { reason: '您已被管理员强制下线' } });
    setTimeout(() => closeUserConnections(session.userId, '强制下线'), 500);
  }
}
