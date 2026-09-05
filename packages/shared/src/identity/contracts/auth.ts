import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { operationLogSchema } from '../../platform/contracts/operation-logs';
import { LOGIN_EVENT_TYPES, LOGIN_STATUSES, MFA_FACTOR_STATUSES, MFA_FACTOR_TYPES, MFA_METHODS } from '../constants';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaVerifySchema,
  refreshTokenSchema,
  registerSchema,
  resetPasswordSchema,
  saveFavoriteMenusSchema,
  switchTenantSchema,
  updateProfileSchema,
  userPreferencesInputSchema,
  verifyPasswordSchema,
  verifyTotpSetupSchema,
} from '../validation';
import { loginLogSchema } from './login-logs';
import { tenantOptionSchema } from './tenants';
import { userSchema } from './users';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const captchaSchema = z.object({
  enabled: z.boolean().meta({ example: true }),
  captchaId: z.string().meta({ example: 'uuid-xxx' }),
  svg: z.string().meta({ example: '<svg>...</svg>' }),
}).meta({ id: 'Captcha' });

export type Captcha = z.infer<typeof captchaSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string().meta({ example: '******' }),
  refreshToken: z.string().meta({ example: '******' }),
}).meta({ id: 'AuthTokens' });

export type AuthTokens = z.infer<typeof authTokensSchema>;

export const loginResponseSchema = z.object({
  user: userSchema,
  token: authTokensSchema,
  requirePasswordChange: z.boolean().optional(),
}).meta({ id: 'LoginResponse' });

export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** 策略要求或新设备风控命中时返回挑战，前端转入 MFA 验证 */
export const mfaLoginChallengeSchema = z.object({
  mfaRequired: z.literal(true),
  challengeId: z.string(),
  methods: z.array(z.enum(MFA_METHODS)),
  expiresAt: z.number(),
  reason: z.string().nullable().optional(),
}).meta({ id: 'MfaLoginChallenge' });

export type MfaLoginChallenge = z.infer<typeof mfaLoginChallengeSchema>;

export const loginResultSchema = z.union([loginResponseSchema, mfaLoginChallengeSchema]).meta({ id: 'LoginResult' });

export type LoginResult = z.infer<typeof loginResultSchema>;

export const refreshTokenResultSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().meta({ description: '续签同时轮换 refresh token：客户端必须以新值替换本地保存的 refresh token' }),
}).meta({ id: 'RefreshTokenResult' });

export type RefreshTokenResult = z.infer<typeof refreshTokenResultSchema>;

export const userProfileSchema = userSchema.extend({
  permissions: z.array(z.string()).optional(),
}).meta({ id: 'UserProfile' });

export type UserProfile = z.infer<typeof userProfileSchema>;

export const switchTenantResultSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  viewingTenantId: z.int().nullable(),
}).meta({ id: 'SwitchTenantResult' });

export type SwitchTenantResult = z.infer<typeof switchTenantResultSchema>;

/** 当前用户自己的登录会话 */
export const userSessionSchema = z.object({
  tokenId: z.string().meta({ example: 'abcdef123456' }),
  ip: z.string().meta({ example: '127.0.0.1' }),
  location: z.string().nullable().meta({ example: '广东省 深圳市' }),
  browser: z.string().meta({ example: 'Chrome 120.0' }),
  os: z.string().meta({ example: 'macOS 14.0' }),
  loginAt: z.string(),
  lastActiveAt: z.string(),
  isCurrent: z.boolean(),
}).meta({ id: 'UserSession' });

export type UserSession = z.infer<typeof userSessionSchema>;

export const userPreferencesSchema = z.record(z.string(), z.unknown()).meta({ id: 'UserPreferences' });

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const mfaFactorSchema = z.object({
  id: z.int(),
  type: z.enum(MFA_FACTOR_TYPES),
  name: z.string(),
  status: z.enum(MFA_FACTOR_STATUSES),
  verifiedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'MfaFactor' });

export type MfaFactor = z.infer<typeof mfaFactorSchema>;

export const totpSetupResultSchema = z.object({
  factorId: z.int(),
  secret: z.string(),
  otpauthUrl: z.string(),
}).meta({ id: 'TotpSetupResult' });

export type TotpSetupResult = z.infer<typeof totpSetupResultSchema>;

export const trustedDeviceSchema = z.object({
  id: z.int(),
  deviceName: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  trustedUntil: z.string(),
  lastSeenAt: z.string(),
  createdAt: z.string(),
}).meta({ id: 'TrustedDevice' });

export type TrustedDevice = z.infer<typeof trustedDeviceSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const tokenIdParam = z.object({
  tokenId: z.string().meta({ description: '会话 Token ID', example: 'abc123' }),
});

export const myLoginLogsQuery = paginationQuery.extend({
  eventType: z.enum(LOGIN_EVENT_TYPES).optional(),
  status: z.enum(LOGIN_STATUSES).optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

export const myOperationLogsQuery = paginationQuery.extend({
  module: z.string().optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

export const authContract = defineContract('/api/auth', {
  captcha: op.get('/captcha', { response: captchaSchema, summary: '获取验证码', public: true }),
  login: op.post('/login', { body: loginSchema, response: loginResultSchema, summary: '登录', public: true }),
  register: op.post('/register', { body: registerSchema, response: loginResponseSchema, summary: '注册', public: true }),
  refresh: op.post('/refresh', { body: refreshTokenSchema, response: refreshTokenResultSchema, summary: '刷新令牌', public: true }),
  mfaVerify: op.post('/mfa/verify', { body: mfaVerifySchema, response: loginResponseSchema, summary: '登录 MFA 验证', public: true }),
  logout: op.post('/logout', { summary: '退出登录' }),
  logoutByRefresh: op.post('/logout-by-refresh', { body: refreshTokenSchema, summary: '按 refresh token 退出会话（账号切换器注销停靠账号）', public: true }),
  me: op.get('/me', { response: userProfileSchema, summary: '获取当前用户' }),
  updateProfile: op.put('/profile', { body: updateProfileSchema, response: userProfileSchema, summary: '修改个人资料' }),
  changePassword: op.put('/password', { body: changePasswordSchema, summary: '修改密码' }),
  myLoginLogs: op.get('/my-login-logs', { query: myLoginLogsQuery, response: paginated(loginLogSchema), summary: '我的登录记录' }),
  myOperationLogs: op.get('/my-operation-logs', { query: myOperationLogsQuery, response: paginated(operationLogSchema), summary: '我的操作记录' }),
  mySessions: op.get('/my-sessions', { response: z.array(userSessionSchema), summary: '我的会话' }),
  deleteOtherSessions: op.delete('/my-sessions/others', { response: z.object({ count: z.number() }), summary: '退出其他设备' }),
  deleteSession: op.delete('/my-sessions/{tokenId}', { params: tokenIdParam, summary: '退出指定设备' }),
  switchTenant: op.post('/switch-tenant', { body: switchTenantSchema, response: switchTenantResultSchema, summary: '切换租户视角' }),
  tenants: op.get('/tenants', { response: z.array(tenantOptionSchema), summary: '可切换租户列表' }),
  forgotPassword: op.post('/forgot-password', { body: forgotPasswordSchema, summary: '忘记密码', public: true }),
  resetPassword: op.post('/reset-password', { body: resetPasswordSchema, summary: '重置密码', public: true }),
  preferences: op.get('/preferences', { response: userPreferencesSchema.nullable(), summary: '获取偏好设置' }),
  savePreferences: op.put('/preferences', { body: userPreferencesInputSchema, response: userPreferencesSchema.nullable(), summary: '保存偏好设置' }),
  favoriteMenus: op.get('/favorite-menus', { response: z.array(z.int()), summary: '获取收藏菜单' }),
  saveFavoriteMenus: op.put('/favorite-menus', { body: saveFavoriteMenusSchema, response: z.array(z.int()), summary: '更新收藏菜单' }),
  verifyPassword: op.post('/verify-password', { body: verifyPasswordSchema, summary: '验证当前用户密码' }),
  mfaFactors: op.get('/mfa/factors', { response: z.array(mfaFactorSchema), summary: '我的 MFA 因子' }),
  beginTotpSetup: op.post('/mfa/totp/setup', { response: totpSetupResultSchema, summary: '开始绑定 TOTP' }),
  verifyTotpSetup: op.post('/mfa/totp/verify', { body: verifyTotpSetupSchema, summary: '确认绑定 TOTP' }),
  disableMfaFactor: op.post('/mfa/factors/{id}/disable', { params: idParam, summary: '停用 MFA 因子' }),
  deleteMfaFactor: op.delete('/mfa/factors/{id}', { params: idParam, summary: '删除 MFA 因子（仅待验证 / 已停用）' }),
  trustedDevices: op.get('/trusted-devices', { response: z.array(trustedDeviceSchema), summary: '我的可信设备' }),
  removeTrustedDevice: op.delete('/trusted-devices/{id}', { params: idParam, summary: '移除可信设备' }),
}, { tags: ['Auth'] });
