import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, unique, text, uniqueIndex, index, jsonb } from 'drizzle-orm/pg-core';
import { auditColumns, tenants, users } from './core';

export const mfaFactorTypeEnum = pgEnum('mfa_factor_type', ['totp', 'passkey', 'recovery_code']);

export const mfaFactorStatusEnum = pgEnum('mfa_factor_status', ['pending', 'enabled', 'disabled']);

export const loginRiskLevelEnum = pgEnum('login_risk_level', ['low', 'medium', 'high']);

export const loginRiskActionEnum = pgEnum('login_risk_action', ['allow', 'challenge', 'block']);

// ─── OAuth 第三方账号绑定表 ────────────────────────────────────────────────────
export const oauthProviderEnum = pgEnum('oauth_provider', ['github', 'dingtalk', 'wechat_work']);

export const userOauthAccounts = pgTable('user_oauth_accounts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: oauthProviderEnum('provider').notNull(),
  openId: varchar('open_id', { length: 128 }).notNull(),
  unionId: varchar('union_id', { length: 128 }),
  nickname: varchar('nickname', { length: 64 }),
  avatar: varchar('avatar', { length: 512 }),
  accessToken: varchar('access_token', { length: 512 }),
  refreshToken: varchar('refresh_token', { length: 512 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  raw: text('raw'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('uniq_provider_open_id').on(t.provider, t.openId)]);

export type UserOauthAccountRow = typeof userOauthAccounts.$inferSelect;

export type NewUserOauthAccount = typeof userOauthAccounts.$inferInsert;

// ─── OAuth 配置表 ──────────────────────────────────────────────────────────────
export const oauthConfigs = pgTable('oauth_configs', {
  id: serial('id').primaryKey(),
  provider: oauthProviderEnum('provider').notNull().unique(),
  clientId: varchar('client_id', { length: 256 }).notNull().default(''),
  clientSecret: varchar('client_secret', { length: 512 }).notNull().default(''),
  agentId: varchar('agent_id', { length: 128 }),
  corpId: varchar('corp_id', { length: 128 }),
  enabled: boolean('enabled').notNull().default(false),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type OauthConfigRow = typeof oauthConfigs.$inferSelect;

export type NewOauthConfig = typeof oauthConfigs.$inferInsert;

// ─── 个人 API Token 表 ─────────────────────────────────────────────────────────
export const userApiTokens = pgTable('user_api_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 64 }).notNull(),
  token: varchar('token', { length: 128 }).notNull().unique(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type UserApiTokenRow = typeof userApiTokens.$inferSelect;

export type NewUserApiToken = typeof userApiTokens.$inferInsert;

// ─── 密码重置 Token 表 ─────────────────────────────────────────────────────────
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 128 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;

export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// ─── 用户 MFA 因子 ─────────────────────────────────────────────────────────────
export const userMfaFactors = pgTable('user_mfa_factors', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: mfaFactorTypeEnum('type').notNull(),
  name: varchar('name', { length: 64 }).notNull(),
  secretEncrypted: text('secret_encrypted'),
  credentialJson: jsonb('credential_json').$type<Record<string, unknown> | null>(),
  status: mfaFactorStatusEnum('status').notNull().default('pending'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('user_mfa_factors_user_idx').on(t.userId),
  index('user_mfa_factors_status_idx').on(t.status),
]);

export type UserMfaFactorRow = typeof userMfaFactors.$inferSelect;

export type NewUserMfaFactor = typeof userMfaFactors.$inferInsert;

// ─── 用户可信设备 ─────────────────────────────────────────────────────────────
export const userTrustedDevices = pgTable('user_trusted_devices', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deviceIdHash: varchar('device_id_hash', { length: 128 }).notNull(),
  deviceName: varchar('device_name', { length: 128 }),
  ip: varchar('ip', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  trustedUntil: timestamp('trusted_until', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('user_trusted_devices_user_device_uq').on(t.userId, t.deviceIdHash),
  index('user_trusted_devices_user_idx').on(t.userId),
  index('user_trusted_devices_trusted_until_idx').on(t.trustedUntil),
]);

export type UserTrustedDeviceRow = typeof userTrustedDevices.$inferSelect;

export type NewUserTrustedDevice = typeof userTrustedDevices.$inferInsert;

// ─── 登录风险事件 ─────────────────────────────────────────────────────────────
export const loginRiskEvents = pgTable('login_risk_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  username: varchar('username', { length: 64 }).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  riskLevel: loginRiskLevelEnum('risk_level').notNull().default('low'),
  reason: varchar('reason', { length: 256 }).notNull(),
  action: loginRiskActionEnum('action').notNull().default('allow'),
  ip: varchar('ip', { length: 64 }),
  location: varchar('location', { length: 128 }),
  userAgent: varchar('user_agent', { length: 512 }),
  deviceIdHash: varchar('device_id_hash', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('login_risk_events_user_idx').on(t.userId),
  index('login_risk_events_tenant_idx').on(t.tenantId),
  index('login_risk_events_created_idx').on(t.createdAt),
]);

export type LoginRiskEventRow = typeof loginRiskEvents.$inferSelect;

export type NewLoginRiskEvent = typeof loginRiskEvents.$inferInsert;

// ─── 限流规则 ─────────────────────────────────────────────────────────────────
export const rateLimitKeyTypeEnum = pgEnum('rate_limit_key_type', ['ip', 'user', 'ip_path']);

export const rateLimitRules = pgTable('rate_limit_rules', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  description: varchar('description', { length: 255 }),
  windowMs: integer('window_ms').notNull(),
  limit: integer('limit').notNull(),
  keyType: rateLimitKeyTypeEnum('key_type').default('ip').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  blockedMessage: varchar('blocked_message', { length: 255 }),
  pathPatterns: text('path_patterns').array().notNull().default([]),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type RateLimitRuleRow = typeof rateLimitRules.$inferSelect;

export type NewRateLimitRule = typeof rateLimitRules.$inferInsert;
