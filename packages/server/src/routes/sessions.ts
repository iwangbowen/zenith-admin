import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { getOnlineSessions, forceLogout } from '../lib/session-manager';
import { sendToUser, closeUserConnections } from '../lib/ws-manager';

const sessionsRoute = new Hono();

sessionsRoute.use('/*', authMiddleware);

sessionsRoute.get('/', guard({ permission: 'system:session:list' }), async (c) => {
  const sessions = getOnlineSessions();
  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: sessions.map((s) => ({
        tokenId: s.tokenId,
        userId: s.userId,
        username: s.username,
        nickname: s.nickname,
        ip: s.ip,
        browser: s.browser,
        os: s.os,
        loginAt: s.loginAt.toISOString(),
      })),
      total: sessions.length,
    },
  });
});

sessionsRoute.delete('/:tokenId', guard({ permission: 'system:session:forceLogout', audit: { module: '会话管理', description: '强制下线' } }), async (c) => {
  const tokenId = c.req.param('tokenId');
  // Find the session to get userId before force-logout
  const session = getOnlineSessions().find((s) => s.tokenId === tokenId);
  const success = forceLogout(tokenId);
  if (!success) {
    return c.json({ code: 404, message: '会话不存在', data: null }, 404);
  }
  // Notify the user via WebSocket and close their connections
  if (session) {
    sendToUser(session.userId, { type: 'session:force-logout', payload: { reason: '您已被管理员强制下线' } });
    // Give a brief delay for the message to be delivered, then close connections
    setTimeout(() => closeUserConnections(session.userId, '强制下线'), 500);
  }
  return c.json({ code: 0, message: '已强制下线', data: null });
});

export default sessionsRoute;
