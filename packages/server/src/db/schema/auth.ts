import { timestampColumns } from './common';
import { pgTable, varchar, timestamp, pgEnum, integer, boolean, unique, text, uniqueIndex, index, jsonb } from 'drizzle-orm/pg-core';
import { OAUTH_PROVIDERS } from '@zenith/shared/identity';
import { auditColumns, tenants, users } from './core';

export const mfaFactorTypeEnum = pgEnum('mfa_factor_type', ['totp', 'passkey', 'recovery_code']);

export const mfaFactorStatusEnum = pgEnum('mfa_factor_status', ['pending', 'enabled', 'disabled']);

export const loginRiskLevelEnum = pgEnum('login_risk_level', ['low', 'medium', 'high']);

export const loginRiskActionEnum = pgEnum('login_risk_action', ['allow', 'challenge', 'block']);

// ─── OAuth 第三方账号绑定表 ────────────────────────────────────────────────────
export const oauthProviderEnum = pgEnum('oauth_provider', OAUTH_PROVIDERS);

export const userOauthAccounts = pgTable('user_oauth_accounts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: oauthProviderEnum().notNull(),
  openId: varchar({ length: 128 }).notNull(),
  unionId: varchar({ length: 128 }),
  nickname: varchar({ length: 64 }),
  avatar: varchar({ length: 512 }),
  accessToken: varchar({ length: 512 }),
  refreshToken: varchar({ length: 512 }),
  expiresAt: timestamp({ withTimezone: true }),
  raw: text(),
  ...timestampColumns(),
}, (t) => [index('user_oauth_accounts_user_idx').on(t.userId), unique('uniq_provider_open_id').on(t.provider, t.openId)]);

export type UserOauthAccountRow = typeof userOauthAccounts.$inferSelect;

export type NewUserOauthAccount = typeof userOauthAccounts.$inferInsert;

// ─── OAuth 配置表 ──────────────────────────────────────────────────────────────
export const oauthConfigs = pgTable('oauth_configs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
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
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar({ length: 64 }).notNull(),
  /**
   * SHA-256 digest of the bearer token. Nullable only so the migration can
   * invalidate legacy plaintext rows without retaining their secret value.
   */
  tokenHash: varchar({ length: 64 }).unique('user_api_tokens_token_hash_unique'),
  tokenPrefix: varchar({ length: 20 }),
  lastUsedAt: timestamp({ withTimezone: true }),
  expiresAt: timestamp({ withTimezone: true }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('user_api_tokens_user_idx').on(t.userId)]);

export type UserApiTokenRow = typeof userApiTokens.$inferSelect;

export type NewUserApiToken = typeof userApiTokens.$inferInsert;

// ─── 密码重置 Token 表 ─────────────────────────────────────────────────────────
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar({ length: 128 }).notNull().unique(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  usedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('password_reset_tokens_user_idx').on(t.userId)]);

export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;

export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// ─── 用户 MFA 因子 ─────────────────────────────────────────────────────────────
export const userMfaFactors = pgTable('user_mfa_factors', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: mfaFactorTypeEnum().notNull(),
  name: varchar({ length: 64 }).notNull(),
  secretEncrypted: text(),
  credentialJson: jsonb().$type<Record<string, unknown> | null>(),
  status: mfaFactorStatusEnum().notNull().default('pending'),
  verifiedAt: timestamp({ withTimezone: true }),
  lastUsedAt: timestamp({ withTimezone: true }),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  index('user_mfa_factors_user_idx').on(t.userId),
  index('user_mfa_factors_status_idx').on(t.status),
]);

export type UserMfaFactorRow = typeof userMfaFactors.$inferSelect;

export type NewUserMfaFactor = typeof userMfaFactors.$inferInsert;

// ─── 用户可信设备 ─────────────────────────────────────────────────────────────
export const userTrustedDevices = pgTable('user_trusted_devices', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  deviceIdHash: varchar({ length: 128 }).notNull(),
  deviceName: varchar({ length: 128 }),
  ip: varchar({ length: 64 }),
  userAgent: varchar({ length: 512 }),
  trustedUntil: timestamp({ withTimezone: true }).notNull(),
  lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('user_trusted_devices_user_device_uq').on(t.userId, t.deviceIdHash),
  index('user_trusted_devices_user_idx').on(t.userId),
  index('user_trusted_devices_trusted_until_idx').on(t.trustedUntil),
]);

export type UserTrustedDeviceRow = typeof userTrustedDevices.$inferSelect;

export type NewUserTrustedDevice = typeof userTrustedDevices.$inferInsert;

// ─── 登录风险事件 ─────────────────────────────────────────────────────────────
export const loginRiskEvents = pgTable('login_risk_events', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().references(() => users.id, { onDelete: 'set null' }),
  username: varchar({ length: 64 }).notNull(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  riskLevel: loginRiskLevelEnum().notNull().default('low'),
  reason: varchar({ length: 256 }).notNull(),
  action: loginRiskActionEnum().notNull().default('allow'),
  ip: varchar({ length: 64 }),
  location: varchar({ length: 128 }),
  userAgent: varchar({ length: 512 }),
  deviceIdHash: varchar({ length: 128 }),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('login_risk_events_user_idx').on(t.userId),
  index('login_risk_events_tenant_created_id_idx').on(t.tenantId, t.createdAt.desc(), t.id.desc()),
  index('login_risk_events_created_id_idx').on(t.createdAt.desc(), t.id.desc()),
]);

export type LoginRiskEventRow = typeof loginRiskEvents.$inferSelect;

export type NewLoginRiskEvent = typeof loginRiskEvents.$inferInsert;

// ─── 限流规则 ─────────────────────────────────────────────────────────────────
export const rateLimitKeyTypeEnum = pgEnum('rate_limit_key_type', ['ip', 'user', 'ip_path']);

/** enforce = 超限拦截；monitor = 观察模式，超限只记数不拦截（用于新规则安全调参） */
export const rateLimitModeEnum = pgEnum('rate_limit_mode', ['enforce', 'monitor']);

/** fixed_window = 固定窗口计数；sliding_window = 两桶加权滑动窗口（消除窗口边界突刺） */
export const rateLimitAlgorithmEnum = pgEnum('rate_limit_algorithm', ['fixed_window', 'sliding_window']);

export const rateLimitRules = pgTable('rate_limit_rules', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
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
