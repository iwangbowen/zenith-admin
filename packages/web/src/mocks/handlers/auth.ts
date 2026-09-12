import { authContract, type MfaFactor, type TotpSetupResult, type UserSession } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { removeByIds, requireItem } from '@/mocks/utils/crud';
import { badRequest, unauthorized, forbidden, notFound, nextIdFrom } from '@/mocks/utils/handlers';
import { mockUsers } from '@/mocks/data/users';
import { mockMenus } from '@/mocks/data/menus';
import { mockLoginLogs, mockOperationLogs } from '@/mocks/data/logs';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import { currentMockSession, isMockPlatformAdmin, mockAccessToken, mockRefreshToken, mockUserPermissions, resolveMockSession, MOCK_REFRESH_TOKEN_PREFIX } from '@/mocks/utils/auth';
import { matchesFilter } from '@/mocks/utils/filter';

function currentMockUser(request: Request) {
  return currentMockSession(request)?.user ?? mockUsers[0];
}

// 偏好设置 & 收藏菜单 mock 状态（模块级可变，模拟服务端持久化）
let mockPreferencesStore: Record<string, unknown> | null = null;
let mockFavoriteMenusStore: number[] = [];
const mockMfaFactors: MfaFactor[] = [];

// ─── 我的设备 mock 状态（模块级可变，支持踢人操作）────────────────────────────
const mockMySessionStore: UserSession[] = [
  {
    tokenId: 'current-session-mock',
    ip: '127.0.0.1',
    location: '本地网络',
    browser: 'Chrome 124',
    os: 'Windows 11',
    loginAt: mockDateTimeOffset(-1800 * 1000),
    lastActiveAt: mockDateTime(),
    isCurrent: true,
  },
  {
    tokenId: 'other-session-001',
    ip: '119.29.xx.xx',
    location: '广东省 深圳市 电信',
    browser: 'Safari 17',
    os: 'macOS Sonoma',
    loginAt: mockDateTimeOffset(-86400 * 1000),
    lastActiveAt: mockDateTimeOffset(-3600 * 1000),
    isCurrent: false,
  },
  {
    tokenId: 'other-session-002',
    ip: '101.22.xx.xx',
    location: '上海市 联通',
    browser: 'Firefox 125',
    os: 'Ubuntu 22.04',
    loginAt: mockDateTimeOffset(-3 * 86400 * 1000),
    lastActiveAt: mockDateTimeOffset(-2 * 86400 * 1000),
    isCurrent: false,
  },
];

/** 获取所有叶子菜单权限 */
function getAllPermissions(): string[] {
  return mockMenus
    .filter((m): m is typeof m & { permission: string } => !!m.permission)
    .map((m) => m.permission);
}

export const authHandlers = [
  // 验证码（演示模式永远禁用）
  mock(authContract.captcha, ({ ok }) => {
    return ok({ enabled: false, captchaId: '', svg: '' });
  }),

  // 登录
  mock(authContract.login, ({ body, ok }) => {
    const user = mockUsers.find((u) => u.username === body.username || (u.phone && u.phone === body.username));
    if (!user || body.password !== user.password) {
      return unauthorized('用户名或密码错误', { status: 401 });
    }
    const { password: _, ...userWithoutPassword } = user;
    return ok({
      user: userWithoutPassword,
      token: { accessToken: mockAccessToken(user.username), refreshToken: mockRefreshToken(user.username) },
    });
  }),

  mock(authContract.mfaVerify, ({ ok }) => {
    const { password: _, ...userWithoutPassword } = mockUsers[0];
    return ok({
      user: userWithoutPassword,
      token: { accessToken: mockAccessToken(mockUsers[0].username), refreshToken: mockRefreshToken(mockUsers[0].username) },
    }, '登录成功');
  }),

  // 当前用户信息（含权限）
  mock(authContract.me, ({ request, ok }) => {
    const current = currentMockUser(request);
    const { password: _, ...userWithoutPassword } = current;
    const granted = mockUserPermissions(current);
    const permissions = granted.includes('*') ? getAllPermissions() : granted;
    // 取最近第 2 条成功登录记录模拟上次登录
    const myLogs = mockLoginLogs.filter((l) => l.userId === current.id && (l.eventType ?? 'login') === 'login' && l.status === 'success');
    const prevLogin = myLogs[1] ?? null;
    return ok({
      ...userWithoutPassword,
      permissions,
      lastLoginAt: prevLogin?.createdAt ?? null,
      lastLoginIp: prevLogin?.ip ?? null,
      lastLoginLocation: prevLogin ? '广东省 深圳市 电信（Mock）' : null,
    });
  }),

  // token 刷新（按 refreshToken 归属的用户签发，支持账号切换器换发）
  mock(authContract.refresh, ({ body, ok }) => {
    const session = resolveMockSession(body.refreshToken, MOCK_REFRESH_TOKEN_PREFIX);
    if (!session) return unauthorized('登录已过期', { status: 401 });
    return ok({ accessToken: mockAccessToken(session.user.username, session.viewingTenantId), refreshToken: mockRefreshToken(session.user.username, session.viewingTenantId) });
  }),

  // 按 refresh token 注销停靠账号（账号切换器）
  mock(authContract.logoutByRefresh, ({ ok }) => {
    return ok(null, '已退出登录');
  }),

  // 退出登录
  mock(authContract.logout, ({ ok }) => {
    const user = mockUsers[0];
    mockLoginLogs.unshift({
      id: nextIdFrom(mockLoginLogs),
      userId: user.id,
      username: user.username,
      ip: '127.0.0.1',
      location: '内网地址',
      browser: 'Chrome 124',
      os: 'Windows 11',
      userAgent: 'Mozilla/5.0 Chrome/124',
      eventType: 'logout',
      status: 'success',
      message: '退出登录成功',
      createdAt: mockDateTime(),
    });
    return ok(null);
  }),

  // 切换租户视角（平台超管）
  mock(authContract.switchTenant, ({ body, request, ok }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('未登录', { status: 401 });
    if (!isMockPlatformAdmin(session.user)) return forbidden('仅平台管理员可切换租户', { status: 403 });
    return ok({
      accessToken: mockAccessToken(session.user.username, body.tenantId),
      refreshToken: mockRefreshToken(session.user.username, body.tenantId),
      viewingTenantId: body.tenantId,
    });
  }),

  // 修改个人资料
  mock(authContract.updateProfile, ({ body, ok }) => {
    const user = mockUsers[0];
    Object.assign(user, body, { updatedAt: mockDateTime() });
    const { password: _, ...userWithoutPassword } = user;
    return ok(userWithoutPassword, '保存成功');
  }),

  // 修改密码
  mock(authContract.changePassword, ({ body, ok }) => {
    const user = mockUsers[0];
    if (body.oldPassword !== user.password) {
      return badRequest('原密码错误', { status: 400 });
    }
    user.password = body.newPassword;
    return ok(null, '密码修改成功');
  }),

  // 我的登录记录（仅返回当前 mock 用户的记录）
  mock(authContract.myLoginLogs, ({ query, ok, paginate }) => {
    const userId = mockUsers[0].id;
    const list = mockLoginLogs.filter((l) =>
      l.userId === userId
      && (!query.eventType || (l.eventType ?? 'login') === query.eventType)
      && matchesFilter(l.status, query.status));
    return ok(paginate(list));
  }),

  // 我的操作记录（仅返回当前 mock 用户的记录）
  mock(authContract.myOperationLogs, ({ query, ok, paginate }) => {
    const userId = mockUsers[0].id;
    const list = mockOperationLogs.filter((l) => l.userId === userId && matchesFilter(l.module, query.module));
    return ok(paginate(list));
  }),

  // 我的在线设备列表
  mock(authContract.mySessions, ({ ok }) => {
    return ok(mockMySessionStore);
  }),

  // 退出其他所有设备（必须在 /{tokenId} 之前注册，否则 MSW 会把 "others" 当作 tokenId）
  mock(authContract.deleteOtherSessions, ({ ok }) => {
    const before = mockMySessionStore.length;
    mockMySessionStore.splice(
      0,
      mockMySessionStore.length,
      ...mockMySessionStore.filter((s) => s.isCurrent),
    );
    const count = before - mockMySessionStore.length;
    return ok({ count }, `已退出其他 ${count} 台设备`);
  }),

  // 退出指定设备
  mock(authContract.deleteSession, ({ params, ok }) => {
    const idx = mockMySessionStore.findIndex((s) => s.tokenId === params.tokenId);
    if (idx === -1) return notFound('会话不存在', { status: 404 });
    if (mockMySessionStore[idx].isCurrent) {
      return badRequest('不能退出当前设备', { status: 400 });
    }
    mockMySessionStore.splice(idx, 1);
    return ok(null, '已退出该设备');
  }),

  mock(authContract.mfaFactors, ({ ok }) => {
    return ok(mockMfaFactors);
  }),

  mock(authContract.beginTotpSetup, ({ ok }) => {
    // 重新发起绑定时清理遗留的待验证因子
    for (let i = mockMfaFactors.length - 1; i >= 0; i -= 1) {
      if (mockMfaFactors[i].type === 'totp' && mockMfaFactors[i].status === 'pending') mockMfaFactors.splice(i, 1);
    }
    const result: TotpSetupResult = {
      factorId: nextIdFrom(mockMfaFactors),
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUrl: 'otpauth://totp/Zenith%20Admin:admin?secret=JBSWY3DPEHPK3PXP&issuer=Zenith%20Admin',
    };
    mockMfaFactors.unshift({
      id: result.factorId,
      type: 'totp',
      name: '身份验证器',
      status: 'pending',
      verifiedAt: null,
      lastUsedAt: null,
      createdAt: mockDateTime(),
    });
    return ok(result);
  }),

  mock(authContract.verifyTotpSetup, ({ body, ok }) => {
    const factor = requireItem(mockMfaFactors, body.factorId, 'MFA 因子不存在', { status: 404 });
    factor.status = 'enabled';
    factor.verifiedAt = mockDateTime();
    factor.lastUsedAt = mockDateTime();
    return ok(null, '绑定成功');
  }),

  mock(authContract.disableMfaFactor, ({ params, ok }) => {
    const factor = requireItem(mockMfaFactors, params.id, 'MFA 因子不存在', { status: 404 });
    factor.status = 'disabled';
    return ok(null, '已停用');
  }),

  mock(authContract.deleteMfaFactor, ({ params, ok }) => {
    const item = requireItem(mockMfaFactors, params.id, 'MFA 因子不存在', { status: 404 });
    if (item.status === 'enabled') return badRequest('已启用的 MFA 因子请先停用后再删除', { status: 400 });
    removeByIds(mockMfaFactors, [params.id]);
    return ok(null, '已删除');
  }),

  mock(authContract.trustedDevices, ({ ok }) => {
    return ok([]);
  }),

  // 忘记密码（演示模式始终返回成功，不真正发送邮件）
  mock(authContract.forgotPassword, ({ ok }) => {
    return ok(null, '如邮箱已注册，重置链接已发送至您的邮箱');
  }),

  // 重置密码（仅 mock-reset-token 有效）
  mock(authContract.resetPassword, ({ body, ok }) => {
    if (body.token !== 'mock-reset-token') {
      return badRequest('重置链接无效或已过期', { status: 400 });
    }
    return ok(null, '密码已重置，请使用新密码登录');
  }),

  // 验证当前用户密码
  mock(authContract.verifyPassword, ({ body, ok }) => {
    const user = mockUsers[0];
    if (body.password !== user.password) {
      return unauthorized('密码错误', { status: 401 });
    }
    return ok(null, '验证通过');
  }),

  // 获取偏好设置
  mock(authContract.preferences, ({ ok }) => {
    return ok(mockPreferencesStore);
  }),

  // 保存偏好设置（整体替换，与服务端行为一致）
  mock(authContract.savePreferences, ({ body, ok }) => {
    mockPreferencesStore = body;
    return ok(mockPreferencesStore, '已保存');
  }),

  // 获取收藏菜单
  mock(authContract.favoriteMenus, ({ ok }) => {
    return ok(mockFavoriteMenusStore);
  }),

  // 更新收藏菜单
  mock(authContract.saveFavoriteMenus, ({ body, ok }) => {
    mockFavoriteMenusStore = body.menuIds;
    return ok(mockFavoriteMenusStore, '已更新');
  }),
];
