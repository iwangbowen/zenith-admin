import * as z from 'zod';
import { signatureDataUrlSchema } from '../../core/signatures';
import { dateRangeQuery, idParam, keywordQuery, paginated, paginationQuery, queryBool, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { userPreferencesDocumentSchema } from '../../preferences';
import { operationLogSchema } from '../../platform/contracts/operation-logs';
import { OPERATION_LOG_RESULTS } from '../../platform/constants';
import { LOGIN_EVENT_TYPES, LOGIN_STATUSES, MFA_FACTOR_STATUSES, MFA_FACTOR_TYPES, MFA_METHODS, SESSION_CLIENT_KINDS } from '../constants';
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
  saveMySignatureSchema,
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

/** 占用同时在线名额的既有会话（拒绝模式下展示给正在登录的用户本人） */
export const conflictingSessionSchema = z.object({
  client: z.enum(SESSION_CLIENT_KINDS),
  ip: z.string(),
  location: z.string().nullable(),
  browser: z.string(),
  os: z.string(),
  loginAt: z.string(),
  lastActiveAt: z.string(),
}).meta({ id: 'ConflictingSession' });

export type ConflictingSession = z.infer<typeof conflictingSessionSchema>;

/**
 * 会话并发「拒绝新登录」命中：凭据已通过但名额已满，返回冲突票据与占用者。
 * 用户确认「下线其它设备并登录」后凭票据兑换，不必重输密码；票据 5 分钟有效、一次性。
 */
export const sessionConflictSchema = z.object({
  sessionConflict: z.literal(true),
  ticket: z.string(),
  maxSessions: z.int(),
  sessions: z.array(conflictingSessionSchema),
  expiresAt: z.number(),
}).meta({ id: 'SessionConflict' });

export type SessionConflict = z.infer<typeof sessionConflictSchema>;

export const resolveSessionConflictSchema = z.object({
  ticket: z.string().min(1),
}).meta({ id: 'ResolveSessionConflictInput' });

export const loginResultSchema = z.union([loginResponseSchema, mfaLoginChallengeSchema, sessionConflictSchema]).meta({ id: 'LoginResult' });

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
  client: z.enum(SESSION_CLIENT_KINDS).meta({ description: '登录终端：web 网页 / mobile 移动审批 / desktop 桌面端' }),
  ip: z.string().meta({ example: '127.0.0.1' }),
  location: z.string().nullable().meta({ example: '广东省 深圳市' }),
  browser: z.string().meta({ example: 'Chrome 120.0' }),
  os: z.string().meta({ example: 'macOS 14.0' }),
  loginAt: z.string(),
  lastActiveAt: z.string(),
  isCurrent: z.boolean(),
}).meta({ id: 'UserSession' });

export type UserSession = z.infer<typeof userSessionSchema>;

export const mySignatureSchema = z.object({
  id: z.int(), version: z.int(), dataUrl: signatureDataUrlSchema, updatedAt: z.string(),
}).meta({ id: 'MySignature' });
export type MySignature = z.infer<typeof mySignatureSchema>;

export const userPreferencesSchema = userPreferencesDocumentSchema.meta({ id: 'UserPreferences' });

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
  eventType: queryEnum(LOGIN_EVENT_TYPES),
  status: queryEnum(LOGIN_STATUSES),
  ...dateRangeQuery(),
});

export const myOperationLogsQuery = paginationQuery.extend({
  module: z.string().optional(),
  description: keywordQuery('操作描述'),
  method: keywordQuery('请求方法'),
  path: keywordQuery('请求路径'),
  ip: keywordQuery('IP'),
  status: queryEnum(OPERATION_LOG_RESULTS),
  content: keywordQuery('内容', { description: '内容关键字（匹配请求体与操作前后快照）' }),
  impersonated: queryBool('仅模拟登录期间的操作', { labels: ['仅模拟操作', '仅本人操作'] }),
  ...dateRangeQuery(),
});

export const authContract = defineContract('/api/auth', {
  captcha: op.get('/captcha', { response: captchaSchema, summary: '获取验证码', public: true }),
  login: op.post('/login', { body: loginSchema, response: loginResultSchema, summary: '登录', public: true }),
  register: op.post('/register', { body: registerSchema, response: loginResponseSchema, summary: '注册', public: true }),
  refresh: op.post('/refresh', { body: refreshTokenSchema, response: refreshTokenResultSchema, summary: '刷新令牌', public: true }),
  mfaVerify: op.post('/mfa/verify', { body: mfaVerifySchema, response: loginResponseSchema, summary: '登录 MFA 验证', public: true }),
  resolveSessionConflict: op.post('/session-conflict/resolve', { body: resolveSessionConflictSchema, response: loginResultSchema, summary: '下线其它设备并继续登录（会话并发拒绝模式）', public: true }),
  logout: op.post('/logout', { access: 'authenticated', summary: '退出登录' }),
  logoutByRefresh: op.post('/logout-by-refresh', { body: refreshTokenSchema, summary: '按 refresh token 退出会话（账号切换器注销停靠账号）', public: true }),
  me: op.get('/me', { access: 'authenticated', response: userProfileSchema, summary: '获取当前用户', unmasked: true }),
  mySignature: op.get('/signature', { access: 'authenticated', response: mySignatureSchema.nullable(), summary: '我的手写签名' }),
  saveMySignature: op.put('/signature', { access: 'authenticated', body: saveMySignatureSchema, response: mySignatureSchema, audit: { description: '保存我的手写签名', module: '个人中心', recordBody: false, recordResponseBody: false }, summary: '保存我的手写签名' }),
  deleteMySignature: op.delete('/signature', { access: 'authenticated', audit: { description: '删除我的手写签名', module: '个人中心', recordBody: false, recordResponseBody: false }, summary: '删除我的手写签名' }),
  updateProfile: op.put('/profile', { access: 'authenticated', body: updateProfileSchema, response: userProfileSchema, summary: '修改个人资料', unmasked: true }),
  changePassword: op.put('/password', { access: 'authenticated', body: changePasswordSchema, summary: '修改密码' }),
  myLoginLogs: op.get('/my-login-logs', { access: 'authenticated', query: myLoginLogsQuery, response: paginated(loginLogSchema), summary: '我的登录记录' }),
  myOperationLogs: op.get('/my-operation-logs', { access: 'authenticated', query: myOperationLogsQuery, response: paginated(operationLogSchema), summary: '我的操作记录' }),
  mySessions: op.get('/my-sessions', { access: 'authenticated', response: z.array(userSessionSchema), summary: '我的会话' }),
  deleteOtherSessions: op.delete('/my-sessions/others', { access: 'authenticated', response: z.object({ count: z.number() }), summary: '退出其他设备' }),
  deleteSession: op.delete('/my-sessions/{tokenId}', { access: 'authenticated', params: tokenIdParam, summary: '退出指定设备' }),
  switchTenant: op.post('/switch-tenant', { access: 'authenticated', body: switchTenantSchema, response: switchTenantResultSchema, summary: '切换租户视角' }),
  tenants: op.get('/tenants', { access: 'authenticated', response: z.array(tenantOptionSchema), summary: '可切换租户列表' }),
  forgotPassword: op.post('/forgot-password', { body: forgotPasswordSchema, summary: '忘记密码', public: true }),
  resetPassword: op.post('/reset-password', { body: resetPasswordSchema, summary: '重置密码', public: true }),
  preferences: op.get('/preferences', { access: 'authenticated', response: userPreferencesSchema, summary: '获取个人偏好覆盖' }),
  savePreferences: op.put('/preferences', { access: 'authenticated', body: userPreferencesInputSchema, response: userPreferencesSchema, summary: '保存个人偏好覆盖' }),
  favoriteMenus: op.get('/favorite-menus', { access: 'authenticated', response: z.array(z.int()), summary: '获取收藏菜单' }),
  saveFavoriteMenus: op.put('/favorite-menus', { access: 'authenticated', body: saveFavoriteMenusSchema, response: z.array(z.int()), summary: '更新收藏菜单' }),
  verifyPassword: op.post('/verify-password', { access: 'authenticated', body: verifyPasswordSchema, summary: '验证当前用户密码' }),
  mfaFactors: op.get('/mfa/factors', { access: 'authenticated', response: z.array(mfaFactorSchema), summary: '我的 MFA 因子' }),
  beginTotpSetup: op.post('/mfa/totp/setup', { access: 'authenticated', response: totpSetupResultSchema, summary: '开始绑定 TOTP' }),
  verifyTotpSetup: op.post('/mfa/totp/verify', { access: 'authenticated', body: verifyTotpSetupSchema, summary: '确认绑定 TOTP' }),
  disableMfaFactor: op.post('/mfa/factors/{id}/disable', { access: 'authenticated', params: idParam, summary: '停用 MFA 因子' }),
  deleteMfaFactor: op.delete('/mfa/factors/{id}', { access: 'authenticated', params: idParam, summary: '删除 MFA 因子（仅待验证 / 已停用）' }),
  trustedDevices: op.get('/trusted-devices', { access: 'authenticated', response: z.array(trustedDeviceSchema), summary: '我的可信设备' }),
  removeTrustedDevice: op.delete('/trusted-devices/{id}', { access: 'authenticated', params: idParam, summary: '移除可信设备' }),
}, { tags: ['Auth'] });
