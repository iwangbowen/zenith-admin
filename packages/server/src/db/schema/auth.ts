import { timestampColumns, idColumn, timestamptz } from './common';
import { pgTable, varchar, pgEnum, integer, boolean, unique, text, uniqueIndex, index, jsonb, uuid } from 'drizzle-orm/pg-core';
import { OAUTH_PROVIDERS, IMPERSONATION_END_REASONS } from '@zenith/shared/identity';
import { auditColumns, users, tenantIdColumn } from './core';
import { managedFiles } from './files';

export const mfaFactorTypeEnum = pgEnum('mfa_factor_type', ['totp', 'passkey', 'recovery_code']);

export const mfaFactorStatusEnum = pgEnum('mfa_factor_status', ['pending', 'enabled', 'disabled']);

export const loginRiskLevelEnum = pgEnum('login_risk_level', ['low', 'medium', 'high']);

export const loginRiskActionEnum = pgEnum('login_risk_action', ['allow', 'challenge', 'block']);

// ─── OAuth 第三方账号绑定表 ────────────────────────────────────────────────────
export const oauthProviderEnum = pgEnum('oauth_provider', OAUTH_PROVIDERS);

export const userOauthAccounts = pgTable('user_oauth_accounts', {
  id: idColumn(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: oauthProviderEnum().notNull(),
  openId: varchar({ length: 128 }).notNull(),
  unionId: varchar({ length: 128 }),
  nickname: varchar({ length: 64 }),
  avatar: varchar({ length: 512 }),
  accessToken: varchar({ length: 512 }),
  refreshToken: varchar({ length: 512 }),
  expiresAt: timestamptz(),
  raw: text(),
  ...timestampColumns(),
}, (t) => [index('user_oauth_accounts_user_idx').on(t.userId), unique('uniq_provider_open_id').on(t.provider, t.openId)]);

export type UserOauthAccountRow = typeof userOauthAccounts.$inferSelect;

export type NewUserOauthAccount = typeof userOauthAccounts.$inferInsert;

// ─── OAuth 配置表 ──────────────────────────────────────────────────────────────
export const oauthConfigs = pgTable('oauth_configs', {
  id: idColumn(),
  provider: oauthProviderEnum().notNull().unique(),
  clientId: varchar({ length: 256 }).notNull().default(''),
  clientSecret: varchar({ length: 512 }).notNull().default(''),
  agentId: varchar({ length: 128 }),
  corpId: varchar({ length: 128 }),
  enabled: boolean().notNull().default(false),
  // 登录时允许按提供方断言的「已验证邮箱」自动关联既有本地账号（默认关闭；平台超管永不自动关联）
  autoLinkByEmail: boolean().notNull().default(false),
  ...auditColumns(),
  ...timestampColumns(),
});

export type OauthConfigRow = typeof oauthConfigs.$inferSelect;

export type NewOauthConfig = typeof oauthConfigs.$inferInsert;

// ─── 个人 API Token 表 ─────────────────────────────────────────────────────────
export const userApiTokens = pgTable('user_api_tokens', {
  id: idColumn(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar({ length: 64 }).notNull(),
  /**
   * SHA-256 digest of the bearer token. Nullable only so the migration can
   * invalidate legacy plaintext rows without retaining their secret value.
   */
  tokenHash: varchar({ length: 64 }).unique('user_api_tokens_token_hash_unique'),
  tokenPrefix: varchar({ length: 20 }),
  lastUsedAt: timestamptz(),
  expiresAt: timestamptz(),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('user_api_tokens_user_idx').on(t.userId)]);

export type UserApiTokenRow = typeof userApiTokens.$inferSelect;

export type NewUserApiToken = typeof userApiTokens.$inferInsert;

// ─── 密码重置 Token 表 ─────────────────────────────────────────────────────────
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: idColumn(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar({ length: 128 }).notNull().unique(),
  expiresAt: timestamptz().notNull(),
  usedAt: timestamptz(),
  createdAt: timestamptz().defaultNow().notNull(),
}, (t) => [index('password_reset_tokens_user_idx').on(t.userId)]);

export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;

export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// ─── 用户 MFA 因子 ─────────────────────────────────────────────────────────────
export const userMfaFactors = pgTable('user_mfa_factors', {
  id: idColumn(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: mfaFactorTypeEnum().notNull(),
  name: varchar({ length: 64 }).notNull(),
  secretEncrypted: text(),
  credentialJson: jsonb().$type<Record<string, unknown> | null>(),
  status: mfaFactorStatusEnum().notNull().default('pending'),
  verifiedAt: timestamptz(),
  lastUsedAt: timestamptz(),
  ...timestampColumns(),
}, (t) => [
  index('user_mfa_factors_user_idx').on(t.userId),
  index('user_mfa_factors_status_idx').on(t.status),
]);

export type UserMfaFactorRow = typeof userMfaFactors.$inferSelect;

export type NewUserMfaFactor = typeof userMfaFactors.$inferInsert;

// ─── 用户可信设备 ─────────────────────────────────────────────────────────────
export const userTrustedDevices = pgTable('user_trusted_devices', {
  id: idColumn(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  deviceIdHash: varchar({ length: 128 }).notNull(),
  deviceName: varchar({ length: 128 }),
  ip: varchar({ length: 64 }),
  userAgent: varchar({ length: 512 }),
  trustedUntil: timestamptz().notNull(),
  lastSeenAt: timestamptz().notNull().defaultNow(),
  createdAt: timestamptz().defaultNow().notNull(),
}, (t) => [
  uniqueIndex('user_trusted_devices_user_device_uq').on(t.userId, t.deviceIdHash),
  index('user_trusted_devices_user_idx').on(t.userId),
  index('user_trusted_devices_trusted_until_idx').on(t.trustedUntil),
]);

export type UserTrustedDeviceRow = typeof userTrustedDevices.$inferSelect;

export type NewUserTrustedDevice = typeof userTrustedDevices.$inferInsert;

// ─── 登录风险事件 ─────────────────────────────────────────────────────────────
export const loginRiskEvents = pgTable('login_risk_events', {
  id: idColumn(),
  userId: integer().references(() => users.id, { onDelete: 'set null' }),
  username: varchar({ length: 64 }).notNull(),
  tenantId: tenantIdColumn(),
  riskLevel: loginRiskLevelEnum().notNull().default('low'),
  reason: varchar({ length: 256 }).notNull(),
  action: loginRiskActionEnum().notNull().default('allow'),
  ip: varchar({ length: 64 }),
  location: varchar({ length: 128 }),
  userAgent: varchar({ length: 512 }),
  deviceIdHash: varchar({ length: 128 }),
  createdAt: timestamptz().defaultNow().notNull(),
}, (t) => [
  index('login_risk_events_user_idx').on(t.userId),
  index('login_risk_events_tenant_created_id_idx').on(t.tenantId, t.createdAt.desc(), t.id.desc()),
  index('login_risk_events_created_id_idx').on(t.createdAt.desc(), t.id.desc()),
]);

export type LoginRiskEventRow = typeof loginRiskEvents.$inferSelect;

export type NewLoginRiskEvent = typeof loginRiskEvents.$inferInsert;

// ─── 模拟登录会话 ─────────────────────────────────────────────────────────────
export const impersonationEndReasonEnum = pgEnum('impersonation_end_reason', IMPERSONATION_END_REASONS);

/**
 * 管理员以用户身份操作的派生会话记录：谁、模拟了谁、为什么、多久、怎么结束。
 * 会话本体仍是 Redis 里的 jti 会话（token_id），本表是审计与强制结束的依据。
 */
export const impersonationSessions = pgTable('impersonation_sessions', {
  id: idColumn(),
  impersonatorId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  impersonatorName: varchar({ length: 64 }).notNull(),
  targetUserId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetUsername: varchar({ length: 64 }).notNull(),
  tenantId: tenantIdColumn(),
  tokenId: varchar({ length: 64 }).notNull(),
  readOnly: boolean().notNull().default(true),
  reason: varchar({ length: 256 }).notNull(),
  ip: varchar({ length: 64 }),
  location: varchar({ length: 128 }),
  browser: varchar({ length: 64 }),
  os: varchar({ length: 64 }),
  startedAt: timestamptz().notNull().defaultNow(),
  expiresAt: timestamptz().notNull(),
  endedAt: timestamptz(),
  endReason: impersonationEndReasonEnum(),
  endedBy: integer().references(() => users.id, { onDelete: 'set null' }),
}, (t) => [
  uniqueIndex('impersonation_sessions_token_uq').on(t.tokenId),
  index('impersonation_sessions_impersonator_idx').on(t.impersonatorId),
  index('impersonation_sessions_target_idx').on(t.targetUserId),
  index('impersonation_sessions_tenant_started_idx').on(t.tenantId, t.startedAt.desc()),
  index('impersonation_sessions_started_idx').on(t.startedAt.desc()),
]);

export type ImpersonationSessionRow = typeof impersonationSessions.$inferSelect;

export type NewImpersonationSession = typeof impersonationSessions.$inferInsert;

// ─── 限流规则 ─────────────────────────────────────────────────────────────────
export const rateLimitKeyTypeEnum = pgEnum('rate_limit_key_type', ['ip', 'user', 'ip_path']);

/** enforce = 超限拦截；monitor = 观察模式，超限只记数不拦截（用于新规则安全调参） */
export const rateLimitModeEnum = pgEnum('rate_limit_mode', ['enforce', 'monitor']);

/** fixed_window = 固定窗口计数；sliding_window = 两桶加权滑动窗口（消除窗口边界突刺） */
export const rateLimitAlgorithmEnum = pgEnum('rate_limit_algorithm', ['fixed_window', 'sliding_window']);

export const rateLimitRules = pgTable('rate_limit_rules', {
  id: idColumn(),
  name: varchar({ length: 64 }).notNull().unique(),
  description: varchar({ length: 255 }),
  windowMs: integer().notNull(),
  limit: integer().notNull(),
  keyType: rateLimitKeyTypeEnum().default('ip').notNull(),
  enabled: boolean().default(true).notNull(),
  mode: rateLimitModeEnum().default('enforce').notNull(),
  algorithm: rateLimitAlgorithmEnum().default('fixed_window').notNull(),
  /** 豁免名单：IP、CIDR（如 10.0.0.0/8）或 `u:{userId}`，命中者跳过计数与拦截 */
  allowlist: text().array().notNull().default([]),
  /** 路径绑定优先级：多条规则的 pathPatterns 命中同一路径时取值大者，替代 Map 插入序 */
  priority: integer().default(0).notNull(),
  /** 小时拦截数告警阈值：达到即通知平台管理员；null = 不告警 */
  alertThreshold: integer(),
  blockedMessage: varchar({ length: 255 }),
  pathPatterns: text().array().notNull().default([]),
  ...auditColumns(),
  ...timestampColumns(),
});

export type RateLimitRuleRow = typeof rateLimitRules.$inferSelect;

export type NewRateLimitRule = typeof rateLimitRules.$inferInsert;

/** 每个账号在当前租户范围内的签名模板；历史签署证据由业务单据独立保存。 */
export const userSignatures = pgTable('user_signatures', {
  id: idColumn(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: tenantIdColumn(),
  fileId: uuid().notNull().references(() => managedFiles.id, { onDelete: 'restrict' }),
  version: integer().notNull().default(1),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('user_signatures_user_tenant_unique').on(t.userId, t.tenantId).nullsNotDistinct()]);
export type UserSignatureRow = typeof userSignatures.$inferSelect;
