import { http, HttpResponse } from 'msw';
import { mockUsers } from '@/mocks/data/users';
import { mockMenus } from '@/mocks/data/menus';
import { mockRoles } from '@/mocks/data/roles';
import { mockLoginLogs, mockOperationLogs } from '@/mocks/data/logs';

const MOCK_TOKEN = 'mock-access-token-demo';
const MOCK_REFRESH_TOKEN = 'mock-refresh-token-demo';

/** 获取所有叶子菜单权限 */
function getAllPermissions(): string[] {
  return mockMenus
    .filter((m): m is typeof m & { permission: string } => !!m.permission)
    .map((m) => m.permission);
}

export const authHandlers = [
  // 验证码（演示模式永远禁用）
  http.get('/api/auth/captcha', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: { enabled: false, captchaId: '', svg: '' } });
  }),

  // 登录
  http.post('/api/auth/login', async ({ request }) => {
    const body = await request.json() as { username: string; password: string };
    const user = mockUsers.find((u) => u.username === body.username);
    if (!user || body.password !== user.password) {
      return HttpResponse.json({ code: 401, message: '用户名或密码错误', data: null });
    }
    const { password: _, ...userWithoutPassword } = user;
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        user: userWithoutPassword,
        token: { accessToken: MOCK_TOKEN, refreshToken: MOCK_REFRESH_TOKEN },
      },
    });
  }),

  // 当前用户信息（含权限）
  http.get('/api/auth/me', () => {
    const { password: _, ...userWithoutPassword } = mockUsers[0];
    const role = mockRoles.find((r) => r.code === 'super_admin');
    const permissions = role ? getAllPermissions() : [];
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: { ...userWithoutPassword, permissions },
    });
  }),

  // token 刷新
  http.post('/api/auth/refresh', () => {
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: { accessToken: MOCK_TOKEN, refreshToken: MOCK_REFRESH_TOKEN },
    });
  }),

  // 退出登录
  http.post('/api/auth/logout', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 修改个人资料
  http.put('/api/auth/profile', async ({ request }) => {
    const body = await request.json() as Partial<typeof mockUsers[0]>;
    const user = mockUsers[0];
    Object.assign(user, body, { updatedAt: new Date().toISOString() });
    const { password: _, ...userWithoutPassword } = user;
    return HttpResponse.json({ code: 0, message: '保存成功', data: userWithoutPassword });
  }),

  // 修改密码
  http.put('/api/auth/password', async ({ request }) => {
    const body = await request.json() as { oldPassword: string; newPassword: string };
    const user = mockUsers[0];
    if (body.oldPassword !== user.password) {
      return HttpResponse.json({ code: 400, message: '原密码错误', data: null });
    }
    user.password = body.newPassword;
    return HttpResponse.json({ code: 0, message: '密码修改成功', data: null });
  }),

  // 我的登录记录（仅返回当前 mock 用户的记录）
  http.get('/api/auth/my-login-logs', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const userId = mockUsers[0].id;
    const list = mockLoginLogs
      .filter((l) => l.userId === userId)
      .map((l) => ({ ...l, createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt }));
    const total = list.length;
    const paged = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list: paged, total, page, pageSize } });
  }),

  // 我的操作记录（仅返回当前 mock 用户的记录）
  http.get('/api/auth/my-operation-logs', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const userId = mockUsers[0].id;
    const list = mockOperationLogs.filter((l) => l.userId === userId);
    const total = list.length;
    const paged = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list: paged, total, page, pageSize } });
  }),

  // 我的在线设备列表
  http.get('/api/auth/my-sessions', () => {
    return HttpResponse.json({
      code: 0, message: 'ok',
      data: mockMySessionStore,
    });
  }),

  // 退出其他所有设备（必须在 /:tokenId 之前注册，否则 MSW 会把 "others" 当作 tokenId）
  http.delete('/api/auth/my-sessions/others', () => {
    const before = mockMySessionStore.length;
    mockMySessionStore.splice(
      0,
      mockMySessionStore.length,
      ...mockMySessionStore.filter((s) => s.isCurrent),
    );
    const count = before - mockMySessionStore.length;
    return HttpResponse.json({ code: 0, message: `已退出其他 ${count} 台设备`, data: { count } });
  }),

  // 退出指定设备
  http.delete('/api/auth/my-sessions/:tokenId', ({ params }) => {
    const idx = mockMySessionStore.findIndex((s) => s.tokenId === params.tokenId);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '会话不存在', data: null });
    if (mockMySessionStore[idx].isCurrent)
      return HttpResponse.json({ code: 400, message: '不能退出当前设备', data: null });
    mockMySessionStore.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '已退出该设备', data: null });
  }),

  // OAuth 账号绑定列表（demo 模式默认未绑定任何账号）
  http.get('/api/auth/oauth/accounts', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: [] });
  }),

  // 忘记密码（演示模式始终返回成功，不真正发送邮件）
  http.post('/api/auth/forgot-password', () => {
    return HttpResponse.json({ code: 0, message: '如邮箱已注册，重置链接已发送至您的邮箱', data: null });
  }),

  // 重置密码（仅 mock-reset-token 有效）
  http.post('/api/auth/reset-password', async ({ request }) => {
    const body = await request.json() as { token: string; newPassword: string };
    if (body.token !== 'mock-reset-token') {
      return HttpResponse.json({ code: 400, message: '重置链接无效或已过期', data: null });
    }
    return HttpResponse.json({ code: 0, message: '密码已重置，请使用新密码登录', data: null });
  }),
];

// ─── 我的设备 mock 状态（模块级可变，支持踢人操作）────────────────────────────
const mockMySessionStore: import('@zenith/shared').UserSession[] = [
  {
    tokenId: 'current-session-mock',
    ip: '127.0.0.1',
    browser: 'Chrome 124',
    os: 'Windows 11',
    loginAt: new Date(Date.now() - 1800 * 1000).toISOString(),
    lastActiveAt: new Date().toISOString(),
    isCurrent: true,
  },
  {
    tokenId: 'other-session-001',
    ip: '192.168.1.42',
    browser: 'Safari 17',
    os: 'macOS Sonoma',
    loginAt: new Date(Date.now() - 86400 * 1000).toISOString(),
    lastActiveAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    isCurrent: false,
  },
  {
    tokenId: 'other-session-002',
    ip: '10.0.0.5',
    browser: 'Firefox 125',
    os: 'Ubuntu 22.04',
    loginAt: new Date(Date.now() - 3 * 86400 * 1000).toISOString(),
    lastActiveAt: new Date(Date.now() - 2 * 86400 * 1000).toISOString(),
    isCurrent: false,
  },
];
