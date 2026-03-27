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
];
