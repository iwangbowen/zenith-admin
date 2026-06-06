import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { generateCaptcha } from '../lib/captcha';
import { getConfigBoolean } from '../lib/system-config';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, okBody } from '../lib/openapi-schemas';
import { LoginResultDTO, UserProfileDTO, CaptchaDTO, RefreshTokenResultDTO as RefreshDTO, SessionDTO, TenantItemDTO, SwitchTenantResultDTO as SwitchTenantDTO, LogRowDTO, UserPreferencesDTO } from '../lib/openapi-dtos';
import {
  getClientInfo,
  login, register, refreshAccessToken, logoutSession,
  getMyProfile, updateMyProfile, changeMyPassword,
  listMyLoginLogs, listMyOperationLogs, listMySessions, deleteMyOtherSessions, deleteMySession,
  switchTenantView, listSwitchableTenants, forgotPassword, resetPassword,
  getMyPreferences, saveMyPreferences, getMyFavoriteMenus, saveMyFavoriteMenus,
} from '../services/auth.service';

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

const captchaRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/captcha', tags: ['Auth'], summary: '获取验证码', security: [],
    responses: { ...commonErrorResponses, ...ok(CaptchaDTO, 'ok') },
  }),
  handler: async (c) => {
    const enabled = await getConfigBoolean('captcha_enabled', false);
    if (!enabled) return c.json(okBody({ enabled: false, captchaId: '', svg: '' }), 200);
    const result = generateCaptcha();
    return c.json(okBody({ enabled: true, captchaId: result.captchaId, svg: result.captchaImage }), 200);
  },
});

const loginRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/login', tags: ['Auth'], summary: '登录', security: [],
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

const logoutRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/logout', tags: ['Auth'], summary: '退出登录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...okMsg('ok') },
  }),
  handler: async (c) => {
    await logoutSession();
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
    request: { query: PaginationQuery.extend({ status: z.enum(['success', 'fail']).optional(), startTime: z.string().optional(), endTime: z.string().optional() }) },
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

auth.openapiRoutes([captchaRoute, loginRoute, registerRoute, refreshRoute, logoutRoute, meRoute, profileRoute, passwordRoute, myLoginLogsRoute, myOperationLogsRoute, mySessionsRoute, deleteOtherSessionsRoute, deleteSessionRoute, switchTenantRoute, authTenantsRoute, forgotPasswordRoute, resetPasswordRoute, getPreferencesRoute, savePreferencesRoute, getFavoriteMenusRoute, saveFavoriteMenusRoute] as const);

export default auth;
