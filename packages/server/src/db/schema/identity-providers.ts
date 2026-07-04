import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, unique, text, index, jsonb } from 'drizzle-orm/pg-core';
import { auditColumns, tenants, users } from './core';

export const identityProviderTypeEnum = pgEnum('identity_provider_type', ['oidc', 'saml', 'ldap', 'ad']);

export const identityProviderStatusEnum = pgEnum('identity_provider_status', ['enabled', 'disabled']);

export const identityProviderSyncStatusEnum = pgEnum('identity_provider_sync_status', ['success', 'failed', 'partial']);

// ─── 租户级企业身份源配置 ──────────────────────────────────────────────────────
export const tenantIdentityProviders = pgTable('tenant_identity_providers', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  type: identityProviderTypeEnum('type').notNull(),
  status: identityProviderStatusEnum('status').notNull().default('disabled'),
  issuer: varchar('issuer', { length: 512 }),
  authorizationEndpoint: varchar('authorization_endpoint', { length: 512 }),
  tokenEndpoint: varchar('token_endpoint', { length: 512 }),
  userinfoEndpoint: varchar('userinfo_endpoint', { length: 512 }),
  jwksUri: varchar('jwks_uri', { length: 512 }),
  clientId: varchar('client_id', { length: 256 }),
  clientSecret: text('client_secret'),
  scopes: varchar('scopes', { length: 256 }).notNull().default('openid profile email'),
  samlSsoUrl: varchar('saml_sso_url', { length: 512 }),
  samlEntityId: varchar('saml_entity_id', { length: 512 }),
  samlCertificate: text('saml_certificate'),
  ldapUrl: varchar('ldap_url', { length: 512 }),
  ldapStartTls: boolean('ldap_start_tls').notNull().default(false),
  ldapSkipTlsVerify: boolean('ldap_skip_tls_verify').notNull().default(false),
  ldapBaseDn: varchar('ldap_base_dn', { length: 512 }),
  ldapBindDn: varchar('ldap_bind_dn', { length: 512 }),
  ldapBindPassword: text('ldap_bind_password'),
  ldapUserFilter: varchar('ldap_user_filter', { length: 1000 }),
  ldapUserSearchFilter: varchar('ldap_user_search_filter', { length: 1000 }),
  ldapSyncFilter: varchar('ldap_sync_filter', { length: 1000 }),
  ldapGroupBaseDn: varchar('ldap_group_base_dn', { length: 512 }),
  ldapGroupFilter: varchar('ldap_group_filter', { length: 1000 }),
  ldapTimeoutMs: integer('ldap_timeout_ms').notNull().default(5000),
  attributeMapping: jsonb('attribute_mapping').$type<Record<string, string>>().notNull().default({
    subject: 'sub',
    email: 'email',
    username: 'preferred_username',
    nickname: 'name',
  }),
  jitEnabled: boolean('jit_enabled').notNull().default(false),
  defaultRoleIds: jsonb('default_role_ids').$type<number[]>().notNull().default([]),
  remark: text('remark'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  unique('tenant_identity_providers_tenant_code_unique').on(t.tenantId, t.code),
  index('tenant_identity_providers_tenant_idx').on(t.tenantId),
  index('tenant_identity_providers_status_idx').on(t.status),
]);

export type TenantIdentityProviderRow = typeof tenantIdentityProviders.$inferSelect;

export type NewTenantIdentityProvider = typeof tenantIdentityProviders.$inferInsert;

export const userIdentityAccounts = pgTable('user_identity_accounts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  providerId: integer('provider_id').notNull().references(() => tenantIdentityProviders.id, { onDelete: 'cascade' }),
  subject: varchar('subject', { length: 256 }).notNull(),
  email: varchar('email', { length: 128 }),
  username: varchar('username', { length: 64 }),
  displayName: varchar('display_name', { length: 128 }),
  rawProfile: jsonb('raw_profile').$type<Record<string, unknown> | null>(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  unique('user_identity_accounts_provider_subject_unique').on(t.providerId, t.subject),
  unique('user_identity_accounts_user_provider_unique').on(t.userId, t.providerId),
  index('user_identity_accounts_user_idx').on(t.userId),
  index('user_identity_accounts_provider_idx').on(t.providerId),
]);

export type UserIdentityAccountRow = typeof userIdentityAccounts.$inferSelect;

export type NewUserIdentityAccount = typeof userIdentityAccounts.$inferInsert;

export const identityProviderSyncLogs = pgTable('identity_provider_sync_logs', {
  id: serial('id').primaryKey(),
  providerId: integer('provider_id').notNull().references(() => tenantIdentityProviders.id, { onDelete: 'cascade' }),
  status: identityProviderSyncStatusEnum('status').notNull(),
  triggerType: varchar('trigger_type', { length: 32 }).notNull().default('manual'),
  total: integer('total').notNull().default(0),
  created: integer('created').notNull().default(0),
  linked: integer('linked').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  message: text('message'),
  errorMessage: text('error_message'),
  details: jsonb('details').$type<Array<Record<string, unknown>> | null>(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('identity_provider_sync_logs_provider_idx').on(t.providerId),
  index('identity_provider_sync_logs_status_idx').on(t.status),
]);

export type IdentityProviderSyncLogRow = typeof identityProviderSyncLogs.$inferSelect;

export type NewIdentityProviderSyncLog = typeof identityProviderSyncLogs.$inferInsert;
