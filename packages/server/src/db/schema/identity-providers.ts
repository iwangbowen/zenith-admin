import { timestampColumns } from './common';
import { pgTable, varchar, timestamp, pgEnum, integer, boolean, unique, text, index, jsonb } from 'drizzle-orm/pg-core';
import { auditColumns, tenants, users } from './core';

export const identityProviderTypeEnum = pgEnum('identity_provider_type', ['oidc', 'saml', 'ldap', 'ad']);

export const identityProviderStatusEnum = pgEnum('identity_provider_status', ['enabled', 'disabled']);

export const identityProviderSyncStatusEnum = pgEnum('identity_provider_sync_status', ['success', 'failed', 'partial']);

// ─── 租户级企业身份源配置 ──────────────────────────────────────────────────────
export const tenantIdentityProviders = pgTable('tenant_identity_providers', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar({ length: 100 }).notNull(),
  code: varchar({ length: 64 }).notNull(),
  type: identityProviderTypeEnum().notNull(),
  status: identityProviderStatusEnum().notNull().default('disabled'),
  issuer: varchar({ length: 512 }),
  authorizationEndpoint: varchar({ length: 512 }),
  tokenEndpoint: varchar({ length: 512 }),
  userinfoEndpoint: varchar({ length: 512 }),
  jwksUri: varchar({ length: 512 }),
  clientId: varchar({ length: 256 }),
  clientSecret: text(),
  scopes: varchar({ length: 256 }).notNull().default('openid profile email'),
  samlSsoUrl: varchar({ length: 512 }),
  samlEntityId: varchar({ length: 512 }),
  samlCertificate: text(),
  ldapUrl: varchar({ length: 512 }),
  ldapStartTls: boolean().notNull().default(false),
  ldapSkipTlsVerify: boolean().notNull().default(false),
  ldapBaseDn: varchar({ length: 512 }),
  ldapBindDn: varchar({ length: 512 }),
  ldapBindPassword: text(),
  ldapUserFilter: varchar({ length: 1000 }),
  ldapUserSearchFilter: varchar({ length: 1000 }),
  ldapSyncFilter: varchar({ length: 1000 }),
  ldapGroupBaseDn: varchar({ length: 512 }),
  ldapGroupFilter: varchar({ length: 1000 }),
  ldapTimeoutMs: integer().notNull().default(5000),
  attributeMapping: jsonb().$type<Record<string, string>>().notNull().default({
    subject: 'sub',
    email: 'email',
    username: 'preferred_username',
    nickname: 'name',
  }),
  jitEnabled: boolean().notNull().default(false),
  // 登录时允许按「已验证邮箱」自动关联既有本地账号（默认关闭；平台超管永不自动关联）
  autoLinkByEmail: boolean().notNull().default(false),
  defaultRoleIds: jsonb().$type<number[]>().notNull().default([]),
  remark: text(),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  unique('tenant_identity_providers_tenant_code_unique').on(t.tenantId, t.code),
  index('tenant_identity_providers_tenant_idx').on(t.tenantId),
  index('tenant_identity_providers_status_idx').on(t.status),
]);

export type TenantIdentityProviderRow = typeof tenantIdentityProviders.$inferSelect;

export type NewTenantIdentityProvider = typeof tenantIdentityProviders.$inferInsert;

export const userIdentityAccounts = pgTable('user_identity_accounts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  providerId: integer().notNull().references(() => tenantIdentityProviders.id, { onDelete: 'cascade' }),
  subject: varchar({ length: 256 }).notNull(),
  email: varchar({ length: 128 }),
  username: varchar({ length: 64 }),
  displayName: varchar({ length: 128 }),
  rawProfile: jsonb().$type<Record<string, unknown> | null>(),
  lastLoginAt: timestamp({ withTimezone: true }),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  unique('user_identity_accounts_provider_subject_unique').on(t.providerId, t.subject),
  unique('user_identity_accounts_user_provider_unique').on(t.userId, t.providerId),
  index('user_identity_accounts_user_idx').on(t.userId),
  index('user_identity_accounts_provider_idx').on(t.providerId),
]);

export type UserIdentityAccountRow = typeof userIdentityAccounts.$inferSelect;

export type NewUserIdentityAccount = typeof userIdentityAccounts.$inferInsert;

export const identityProviderSyncLogs = pgTable('identity_provider_sync_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  providerId: integer().notNull().references(() => tenantIdentityProviders.id, { onDelete: 'cascade' }),
  status: identityProviderSyncStatusEnum().notNull(),
  triggerType: varchar({ length: 32 }).notNull().default('manual'),
  total: integer().notNull().default(0),
  created: integer().notNull().default(0),
  linked: integer().notNull().default(0),
  updated: integer().notNull().default(0),
  skipped: integer().notNull().default(0),
  failed: integer().notNull().default(0),
  message: text(),
  errorMessage: text(),
  details: jsonb().$type<Array<Record<string, unknown>> | null>(),
  startedAt: timestamp({ withTimezone: true }).notNull(),
  completedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('identity_provider_sync_logs_provider_idx').on(t.providerId),
  index('identity_provider_sync_logs_status_idx').on(t.status),
]);

export type IdentityProviderSyncLogRow = typeof identityProviderSyncLogs.$inferSelect;

export type NewIdentityProviderSyncLog = typeof identityProviderSyncLogs.$inferInsert;
