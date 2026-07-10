import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { authRateLimit, captchaRateLimit, sensitiveRateLimit } from '../../middleware/rate-limit';
import { generateCaptcha, resolveCaptchaComplexity } from '../../lib/captcha';
import { getConfigBoolean, getConfigValue } from '../../lib/system-config';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, okBody, IdParam } from '../../lib/openapi-schemas';
import { LoginResultDTO, UserProfileDTO, CaptchaDTO, RefreshTokenResultDTO as RefreshDTO, SessionDTO, TenantItemDTO, SwitchTenantResultDTO as SwitchTenantDTO, LogRowDTO, UserPreferencesDTO } from '../../lib/openapi-dtos';
import {
  getClientInfo,
  login, register, refreshAccessToken, logoutSession,
  getMyProfile, updateMyProfile, changeMyPassword, verifyMyPassword,
  listMyLoginLogs, listMyOperationLogs, listMySessions, deleteMyOtherSessions, deleteMySession,
  switchTenantView, listSwitchableTenants, forgotPassword, resetPassword,
  getMyPreferences, saveMyPreferences, getMyFavoriteMenus, saveMyFavoriteMenus,
  verifyMfaLogin,
} from '../../services/identity/auth.service';
import {
  beginTotpSetup,
  disableMyMfaFactor,
  listMyMfaFactors,
  listMyTrustedDevices,
  removeMyTrustedDevice,
  verifyTotpSetup,
} from '../../services/identity/identity-security.service';

const auth = new OpenAPIHono({ defaultHook: validationHook });

// ─── 本地 Zod schemas ────────────────────────────────────────────────────────
const deviceInfoSchema = z.object({
  screenWidth: z.number().int().optional(),
  screenHeight: z.number().int().optional(),
  devicePixelRatio: z.string().optional(),
  gpu: z.string().max(256).optional(),
  cpuCores: z.number().int().optional(),
  memoryGb: z.string().optional(),
}).optional();

const loginSchema = z.object({
  username: z.string().min(2).max(32),
  password: z.string().min(6).max(64),
  captchaId: z.string().optional(),
  captchaCode: z.string().optional(),
  tenantCode: z.string().max(50).optional(),
  deviceInfo: deviceInfoSchema,
  deviceId: z.string().max(128).optional(),
  rememberDevice: z.boolean().optional(),
});
const registerSchema = z.object({
  username: z.string().min(2).max(32),
  nickname: z.string().min(1).max(32),
  email: z.email(),
  password: z.string().min(6).max(64),
});
const changePasswordSchema = z.object({
  oldPassword: z.string().min(6).max(64),
  newPassword: z.string().min(6).max(64),
});
const updateProfileSchema = z.object({
  nickname: z.string().min(1).max(32).optional(),
  email: z.email().optional(),
  phone: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^1[3-9]\d{9}$/, '请输入正确的手机号码').nullable().optional()),
  gender: z.string().max(20).nullable().optional(),
  avatar: z.string().max(256).nullish(),
});
const switchTenantSchema = z.object({ tenantId: z.number().int().positive().nullable() });
const forgotPasswordSchema = z.object({ email: z.email() });
const resetPasswordSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(6).max(64) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const mfaVerifySchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().min(6).max(8),
  rememberDevice: z.boolean().optional(),
});
const verifyTotpSetupSchema = z.object({
  factorId: z.number().int().positive(),
  code: z.string().min(6).max(8),
});

const captchaRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/captcha', tags: ['Auth'], summary: '获取验证码', security: [],
    middleware: [captchaRateLimit] as const,
    responses: { ...commonErrorResponses, ...ok(CaptchaDTO, 'ok') },
  }),
  handler: async (c) => {
    const enabled = await getConfigBoolean('captcha_enabled', false);
    if (!enabled) return c.json(okBody({ enabled: false, captchaId: '', svg: '' }), 200);
    const complexity = await getConfigValue('captcha_complexity', 'medium');
    const result = generateCaptcha(resolveCaptchaComplexity(complexity));
    return c.json(okBody({ enabled: true, captchaId: result.captchaId, svg: result.captchaImage }), 200);
  },
});

const loginRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/login', tags: ['Auth'], summary: '登录', security: [],
    middleware: [authRateLimit] as const,
    request: { body: { content: jsonContent(loginSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(LoginResultDTO, '登录成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '禁用/过期' },
      423: { content: jsonContent(ErrorResponse), description: '账号被锁定' },
    },
  }),
  handler: async (c) => {
    const { ip, ua } = getClientInfo(c.req.raw.headers);
    const result = await login({ ...c.req.valid('json'), ip, ua });
    return c.json(okBody(result, '登录成功'), 200);
  },
});

const registerRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/register', tags: ['Auth'], summary: '注册', security: [],
    middleware: [sensitiveRateLimit] as const,
    request: { body: { content: jsonContent(registerSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(LoginResultDTO, '注册成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '注册关闭' },
    },
  }),
  handler: async (c) => {
    const { ip, ua } = getClientInfo(c.req.raw.headers);
    const result = await register({ ...c.req.valid('json'), ip, ua });
    return c.json(okBody(result, '注册成功'), 200);
  },
});

const refreshRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/refresh', tags: ['Auth'], summary: '刷新令牌', security: [],
    request: { body: { content: jsonContent(refreshSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(RefreshDTO, 'ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      401: { content: jsonContent(ErrorResponse), description: '无效令牌' },
      403: { content: jsonContent(ErrorResponse), description: '账号禁用' },
    },
  }),
  handler: async (c) => {
    const { refreshToken } = c.req.valid('json');
    const { ip, ua } = getClientInfo(c.req.raw.headers);
    return c.json(okBody(await refreshAccessToken(refreshToken, { ip, ua })), 200);
  },
});

const mfaVerifyRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/mfa/verify', tags: ['Auth'], summary: '登录 MFA 验证', security: [],
    middleware: [authRateLimit] as const,
    request: { body: { content: jsonContent(mfaVerifySchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(LoginResultDTO, '登录成功'),
      400: { content: jsonContent(ErrorResponse), description: '验证码错误或已过期' },
    },
  }),
  handler: async (c) => {
    const { challengeId, code, rememberDevice } = c.req.valid('json');
    const result = await verifyMfaLogin(challengeId, code, rememberDevice);
    return c.json(okBody(result, '登录成功'), 200);
  },
});

const logoutRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/logout', tags: ['Auth'], summary: '退出登录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...okMsg('ok') },
  }),
  handler: async (c) => {
    const { ip, ua } = getClientInfo(c.req.raw.headers);
    await logoutSession({ ip, ua });
    return c.json(okBody(null, '已退出登录'), 200);
  },
});

const meRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/me', tags: ['Auth'], summary: '获取当前用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(UserProfileDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getMyProfile()), 200),
});

const profileRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/profile', tags: ['Auth'], summary: '修改个人资料',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(updateProfileSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(UserProfileDTO, '已更新'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const r = await updateMyProfile(c.req.valid('json'));
    return c.json(okBody(r, '资料已更新'), 200);
  },
});

const passwordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/password', tags: ['Auth'], summary: '修改密码',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(changePasswordSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('修改成功'),
      400: { content: jsonContent(ErrorResponse), description: '原密码错误' },
      404: { content: jsonContent(ErrorResponse), description: '用户不存在' },
    },
  }),
  handler: async (c) => {
    const { oldPassword, newPassword } = c.req.valid('json');
    await changeMyPassword(oldPassword, newPassword);
    return c.json(okBody(null, '密码修改成功'), 200);
  },
});

const myLoginLogsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/my-login-logs', tags: ['Auth'], summary: '我的登录记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { query: PaginationQuery.extend({ eventType: z.enum(['login', 'logout']).optional(), status: z.enum(['success', 'fail']).optional(), startTime: z.string().optional(), endTime: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(LogRowDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyLoginLogs(c.req.valid('query'))), 200),
});

const myOperationLogsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/my-operation-logs', tags: ['Auth'], summary: '我的操作记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { query: PaginationQuery.extend({ module: z.string().optional(), startTime: z.string().optional(), endTime: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(LogRowDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyOperationLogs(c.req.valid('query'))), 200),
});

const mySessionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/my-sessions', tags: ['Auth'], summary: '我的会话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(SessionDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMySessions()), 200),
});

const deleteOtherSessionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/my-sessions/others', tags: ['Auth'], summary: '退出其他设备',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.object({ count: z.number() }), 'ok') },
  }),
  handler: async (c) => {
    const count = await deleteMyOtherSessions();
    return c.json(okBody({ count }, `已退出 ${count} 个其他设备`), 200);
  },
});

const deleteSessionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/my-sessions/{tokenId}', tags: ['Auth'], summary: '退出指定设备',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: z.object({ tokenId: z.string().openapi({ param: { name: 'tokenId', in: 'path' }, example: 'abc123' }) }) },
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
      400: { content: jsonContent(ErrorResponse), description: '不能操作当前设备' },
      404: { content: jsonContent(ErrorResponse), description: '会话不存在' },
    },
  }),
  handler: async (c) => {
    const { tokenId } = c.req.valid('param');
    await deleteMySession(tokenId);
    return c.json(okBody(null, '已退出该设备'), 200);
  },
});

const switchTenantRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/switch-tenant', tags: ['Auth'], summary: '切换租户视角',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(switchTenantSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(SwitchTenantDTO, 'ok'),
      403: { content: jsonContent(ErrorResponse), description: '无权限' },
      404: { content: jsonContent(ErrorResponse), description: '租户不存在' },
    },
  }),
  handler: async (c) => {
    const { tenantId } = c.req.valid('json');
    const { ip, ua } = getClientInfo(c.req.raw.headers);
    const { message, ...data } = await switchTenantView(tenantId, ip, ua);
    return c.json(okBody(data, message), 200);
  },
});

const authTenantsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/tenants', tags: ['Auth'], summary: '可切换租户列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(TenantItemDTO), 'ok'),
      403: { content: jsonContent(ErrorResponse), description: '无权限' },
    },
  }),
  handler: async (c) => c.json(okBody(await listSwitchableTenants()), 200),
});

const forgotPasswordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/forgot-password', tags: ['Auth'], summary: '忘记密码', security: [],
    middleware: [sensitiveRateLimit] as const,
    request: { body: { content: jsonContent(forgotPasswordSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
      403: { content: jsonContent(ErrorResponse), description: '功能未开启' },
    },
  }),
  handler: async (c) => {
    await forgotPassword(c.req.valid('json').email);
    return c.json(okBody(null, '如邮箱已注册，重置链接已发送至您的邮箱'), 200);
  },
});

const resetPasswordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/reset-password', tags: ['Auth'], summary: '重置密码', security: [],
    middleware: [sensitiveRateLimit] as const,
    request: { body: { content: jsonContent(resetPasswordSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
      400: { content: jsonContent(ErrorResponse), description: '链接无效' },
    },
  }),
  handler: async (c) => {
    const { token, newPassword } = c.req.valid('json');
    await resetPassword(token, newPassword);
    return c.json(okBody(null, '密码已重置，请使用新密码登录'), 200);
  },
});

const preferencesInputSchema = z.record(z.string(), z.unknown());

const getPreferencesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/preferences', tags: ['Auth'], summary: '获取偏好设置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(UserPreferencesDTO.nullable(), 'ok'),
    },
  }),
  handler: async (c) => c.json(okBody(await getMyPreferences()), 200),
});

const savePreferencesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/preferences', tags: ['Auth'], summary: '保存偏好设置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(preferencesInputSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(UserPreferencesDTO.nullable(), '已保存'),
    },
  }),
  handler: async (c) => c.json(okBody(await saveMyPreferences(c.req.valid('json') as Record<string, unknown>)), 200),
});

const getFavoriteMenusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/favorite-menus', tags: ['Auth'], summary: '获取收藏菜单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(z.number().int()), '收藏菜单 ID 列表') },
  }),
  handler: async (c) => c.json(okBody(await getMyFavoriteMenus()), 200),
});

const saveFavoriteMenusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/favorite-menus', tags: ['Auth'], summary: '更新收藏菜单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(z.object({ menuIds: z.array(z.number().int()) })), required: true } },
    responses: { ...commonErrorResponses, ...ok(z.array(z.number().int()), '已更新') },
  }),
  handler: async (c) => {
    const { menuIds } = c.req.valid('json');
    return c.json(okBody(await saveMyFavoriteMenus(menuIds)), 200);
  },
});

const verifyPasswordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/verify-password', tags: ['Auth'], summary: '验证当前用户密码',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(z.object({ password: z.string().min(1) })), required: true } },
    responses: { ...okMsg('验证通过'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    await verifyMyPassword(c.req.valid('json').password);
    return c.json(okBody(null, '验证通过'), 200);
  },
});

const myMfaFactorsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/mfa/factors', tags: ['Auth'], summary: '我的 MFA 因子',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(z.object({
      id: z.number().int(),
      type: z.enum(['totp', 'passkey', 'recovery_code']),
      name: z.string(),
      status: z.enum(['pending', 'enabled', 'disabled']),
      verifiedAt: z.string().nullable(),
      lastUsedAt: z.string().nullable(),
      createdAt: z.string(),
    })), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyMfaFactors()), 200),
});

const beginTotpSetupRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/mfa/totp/setup', tags: ['Auth'], summary: '开始绑定 TOTP',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.object({ factorId: z.number().int(), secret: z.string(), otpauthUrl: z.string() }), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await beginTotpSetup()), 200),
});

const verifyTotpSetupRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/mfa/totp/verify', tags: ['Auth'], summary: '确认绑定 TOTP',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(verifyTotpSetupSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('绑定成功') },
  }),
  handler: async (c) => {
    const { factorId, code } = c.req.valid('json');
    await verifyTotpSetup(factorId, code);
    return c.json(okBody(null, '绑定成功'), 200);
  },
});

const disableMfaFactorRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/mfa/factors/{id}', tags: ['Auth'], summary: '停用 MFA 因子',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已停用') },
  }),
  handler: async (c) => {
    await disableMyMfaFactor(c.req.valid('param').id);
    return c.json(okBody(null, '已停用'), 200);
  },
});

const myTrustedDevicesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/trusted-devices', tags: ['Auth'], summary: '我的可信设备',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(z.object({
      id: z.number().int(),
      deviceName: z.string().nullable(),
      ip: z.string().nullable(),
      userAgent: z.string().nullable(),
      trustedUntil: z.string(),
      lastSeenAt: z.string(),
      createdAt: z.string(),
    })), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyTrustedDevices()), 200),
});

const deleteTrustedDeviceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/trusted-devices/{id}', tags: ['Auth'], summary: '移除可信设备',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已移除') },
  }),
  handler: async (c) => {
    await removeMyTrustedDevice(c.req.valid('param').id);
    return c.json(okBody(null, '已移除'), 200);
  },
});

auth.openapiRoutes([captchaRoute, loginRoute, registerRoute, refreshRoute, mfaVerifyRoute, logoutRoute, meRoute, profileRoute, passwordRoute, myLoginLogsRoute, myOperationLogsRoute, mySessionsRoute, deleteOtherSessionsRoute, deleteSessionRoute, switchTenantRoute, authTenantsRoute, forgotPasswordRoute, resetPasswordRoute, getPreferencesRoute, savePreferencesRoute, getFavoriteMenusRoute, saveFavoriteMenusRoute, verifyPasswordRoute, myMfaFactorsRoute, beginTotpSetupRoute, verifyTotpSetupRoute, disableMfaFactorRoute, myTrustedDevicesRoute, deleteTrustedDeviceRoute] as const);

export default auth;
