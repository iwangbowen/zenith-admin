import { http, HttpResponse } from 'msw';
import { mockUsers } from '../data/users';
import { mockMenus } from '../data/menus';
import { mockRoles } from '../data/roles';

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
];
