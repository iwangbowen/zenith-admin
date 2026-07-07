import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { memberAuthMiddleware } from '../../middleware/member-auth';
import { authRateLimit, sensitiveRateLimit } from '../../middleware/rate-limit';
import { ErrorResponse, jsonContent, validationHook, commonErrorResponses, ok, okMsg, okBody } from '../../lib/openapi-schemas';
import {
  MemberLoginResultDTO,
  MemberDTO,
  MemberRefreshResultDTO,
  MemberSmsCodeResultDTO,
} from '../../lib/openapi-dtos';
import {
  registerMember,
  loginMember,
  refreshMemberToken,
  logoutMember,
  getMyMemberProfile,
  updateMyMemberProfile,
  changeMyMemberPassword,
  resetMemberPassword,
  deactivateMyAccount,
} from '../../services/member/member-auth.service';
import { sendMemberSmsCode } from '../../services/member/member-sms.service';
import { getClientInfo } from '../../services/identity/auth.service';

const memberAuth = new OpenAPIHono({ defaultHook: validationHook });

const phoneRegex = /^1[3-9]\d{9}$/;

// ─── 本地 Zod schemas（认证路由特例，沿用 auth.ts 在路由内声明的模式）──────────
const registerSchema = z.object({
  username: z.string().min(2).max(32).optional(),
  phone: z.string().regex(phoneRegex, '请输入正确的手机号码').optional(),
  email: z.email().optional(),
  password: z.string().min(6).max(64).optional(),
  smsCode: z.string().length(6).optional(),
  nickname: z.string().min(1).max(32).optional(),
  inviteCode: z.string().min(4).max(16).optional(),
});
const loginSchema = z.object({
  loginType: z.enum(['password', 'sms']).default('password'),
  account: z.string().max(128).optional(),
  password: z.string().max(64).optional(),
  phone: z.string().regex(phoneRegex).optional(),
  smsCode: z.string().length(6).optional(),
});
const smsCodeSchema = z.object({
  phone: z.string().regex(phoneRegex, '请输入正确的手机号码'),
  scene: z.enum(['register', 'login', 'reset']).default('login'),
});
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const updateProfileSchema = z.object({
  nickname: z.string().min(1).max(32).optional(),
  avatar: z.string().max(256).nullish(),
  gender: z.string().max(20).nullable().optional(),
  birthday: z.string().max(20).nullable().optional(),
  email: z.email().nullish(),
});
const changePasswordSchema = z.object({
  oldPassword: z.string().min(6).max(64).optional(),
  newPassword: z.string().min(6).max(64),
});
const resetPasswordSchema = z.object({
  phone: z.string().regex(phoneRegex),
  smsCode: z.string().length(6),
  newPassword: z.string().min(6).max(64),
});

// ─── POST /sms-code — 发送短信验证码 ─────────────────────────────────────────
const smsCodeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/sms-code', tags: ['MemberAuth'], summary: '发送会员短信验证码', security: [],
    middleware: [sensitiveRateLimit] as const,
    request: { body: { content: jsonContent(smsCodeSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(MemberSmsCodeResultDTO, '已发送'),
      429: { content: jsonContent(ErrorResponse), description: '发送过于频繁' },
    },
  }),
  handler: async (c) => {
    const { phone, scene } = c.req.valid('json');
    const r = await sendMemberSmsCode(phone, scene);
    return c.json(okBody({ sent: true, devCode: r.devCode }), 200);
  },
});

// ─── POST /register — 会员注册 ───────────────────────────────────────────────
const registerRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/register', tags: ['MemberAuth'], summary: '会员注册', security: [],
    middleware: [sensitiveRateLimit] as const,
    request: { body: { content: jsonContent(registerSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(MemberLoginResultDTO, '注册成功'),
    },
  }),
  handler: async (c) => {
    const { ip, ua } = getClientInfo(c.req.raw.headers);
    const result = await registerMember({ ...c.req.valid('json'), ip, ua, source: 'web' });
    return c.json(okBody(result, '注册成功'), 200);
  },
});

// ─── POST /login — 会员登录 ──────────────────────────────────────────────────
const loginRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/login', tags: ['MemberAuth'], summary: '会员登录', security: [],
    middleware: [authRateLimit] as const,
    request: { body: { content: jsonContent(loginSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(MemberLoginResultDTO, '登录成功'),
      403: { content: jsonContent(ErrorResponse), description: '账号被封禁/未激活' },
    },
  }),
  handler: async (c) => {
    const { ip, ua } = getClientInfo(c.req.raw.headers);
    const result = await loginMember({ ...c.req.valid('json'), ip, ua });
    return c.json(okBody(result, '登录成功'), 200);
  },
});

// ─── POST /refresh — 刷新令牌 ────────────────────────────────────────────────
const refreshRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/refresh', tags: ['MemberAuth'], summary: '刷新会员令牌', security: [],
    request: { body: { content: jsonContent(refreshSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(MemberRefreshResultDTO, 'ok'),
      401: { content: jsonContent(ErrorResponse), description: '无效令牌' },
    },
  }),
  handler: async (c) => {
    const { refreshToken } = c.req.valid('json');
    return c.json(okBody(await refreshMemberToken(refreshToken)), 200);
  },
});

// ─── POST /reset-password — 短信验证码重置密码 ───────────────────────────────
const resetPasswordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/reset-password', tags: ['MemberAuth'], summary: '会员重置密码', security: [],
    middleware: [sensitiveRateLimit] as const,
    request: { body: { content: jsonContent(resetPasswordSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('密码已重置'),
    },
  }),
  handler: async (c) => {
    await resetMemberPassword(c.req.valid('json'));
    return c.json(okBody(null, '密码已重置'), 200);
  },
});

// ─── POST /logout — 退出登录 ─────────────────────────────────────────────────
const logoutRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/logout', tags: ['MemberAuth'], summary: '会员退出登录',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    responses: { ...commonErrorResponses, ...okMsg('ok') },
  }),
  handler: async (c) => {
    await logoutMember();
    return c.json(okBody(null, '已退出登录'), 200);
  },
});

// ─── GET /me — 当前会员资料 ──────────────────────────────────────────────────
const meRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/me', tags: ['MemberAuth'], summary: '获取当前会员',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(MemberDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getMyMemberProfile()), 200),
});

// ─── PUT /profile — 修改资料 ─────────────────────────────────────────────────
const profileRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/profile', tags: ['MemberAuth'], summary: '修改会员资料',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { body: { content: jsonContent(updateProfileSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(MemberDTO, '已更新'),
    },
  }),
  handler: async (c) => {
    const r = await updateMyMemberProfile(c.req.valid('json'));
    return c.json(okBody(r, '资料已更新'), 200);
  },
});

// ─── PUT /password — 修改密码 ────────────────────────────────────────────────
const passwordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/password', tags: ['MemberAuth'], summary: '修改会员密码',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    request: { body: { content: jsonContent(changePasswordSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('密码已修改'),
    },
  }),
  handler: async (c) => {
    await changeMyMemberPassword(c.req.valid('json'));
    return c.json(okBody(null, '密码已修改'), 200);
  },
});

// ─── POST /deactivate — 自助注销账户 ─────────────────────────────────────────
const deactivateSchema = z.object({
  password: z.string().max(64).optional(),
  smsCode: z.string().length(6).optional(),
});
const deactivateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/deactivate', tags: ['MemberAuth'], summary: '自助注销账户（软删除）',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware, sensitiveRateLimit] as const,
    request: { body: { content: jsonContent(deactivateSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已注销') },
  }),
  handler: async (c) => {
    await deactivateMyAccount(c.req.valid('json'));
    return c.json(okBody(null, '账户已注销'), 200);
  },
});

memberAuth.openapiRoutes([
  smsCodeRoute,
  registerRoute,
  loginRoute,
  refreshRoute,
  resetPasswordRoute,
  logoutRoute,
  meRoute,
  profileRoute,
  passwordRoute,
  deactivateRoute,
] as const);

export default memberAuth;
