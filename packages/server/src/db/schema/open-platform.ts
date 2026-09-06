import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, varchar, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { statusEnum, timestampColumns } from './common';
import { auditColumns, tenants, users } from './core';
import { cmsSites } from './cms';

export const openAppEnvironmentEnum = pgEnum('open_app_environment', ['production', 'sandbox']);
export const openAppReviewStatusEnum = pgEnum('open_app_review_status', ['draft', 'pending', 'approved', 'rejected']);

/**
 * OAuth2 应用（客户端）注册表
 * 管理接入本系统的第三方应用（ClientID / Secret / 回调URL / 权限范围）
 */
export const oauth2Clients = pgTable('oauth2_clients', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** UUID，即 client_id */
  clientId: varchar({ length: 64 }).notNull().unique('oauth2_clients_client_id_unique'),
  /** client_secret sha256 哈希值（机密客户端），公开客户端为 null */
  clientSecretHash: varchar({ length: 128 }),
  /** client_secret 的 AES-256-GCM 密文，供开放 API HMAC 签名验签复用（clientSecret 兼作签名密钥） */
  clientSecretEncrypted: text(),
  previousClientSecretHash: varchar({ length: 128 }),
  previousClientSecretEncrypted: text(),
  previousSecretExpiresAt: timestamp({ withTimezone: true }),
  /** secret 前缀，用于列表页展示（前 8 位 + ...）*/
  clientSecretPrefix: varchar({ length: 20 }),
  name: varchar({ length: 100 }).notNull(),
  description: text(),
  logoUrl: varchar({ length: 500 }),
  /** 允许的回调 URL 列表 */
  redirectUris: text().array().notNull().default([]),
  /** 允许申请的 scope 子集，如 ['openid','profile','email'] */
  allowedScopes: text().array().notNull().default([]),
  /** 允许的授权流程，如 ['authorization_code','client_credentials'] */
  grantTypes: text().array().notNull().default([]),
  /** 是否为公开客户端（无 secret，必须使用 PKCE）*/
  isPublic: boolean().notNull().default(false),
  /** 开放平台：绑定的限流套餐（为空表示使用默认套餐） */
  ratePlanId: integer().references((): AnyPgColumn => ratePlans.id, { onDelete: 'set null' }),
  /** 开放平台：调用开放 API 网关时是否强制 HMAC 签名验签 */
  signEnabled: boolean().notNull().default(false),
  /** 来源 IP/CIDR 白名单；空数组表示不限制 */
  ipAllowlist: text().array().notNull().default([]),
  environment: openAppEnvironmentEnum().notNull().default('production'),
  reviewStatus: openAppReviewStatusEnum().notNull().default('approved'),
  reviewComment: text(),
  submittedAt: timestamp({ withTimezone: true }),
  reviewedAt: timestamp({ withTimezone: true }),
  reviewedBy: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  status: statusEnum().notNull().default('enabled'),
  /** 应用归属用户 */
  ownerId: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  /** 外部调用的租户权威来源，不接受请求参数覆盖。 */
  tenantId: integer().references((): AnyPgColumn => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('oauth2_clients_tenant_idx').on(t.tenantId)]);

export type OAuth2ClientRow = typeof oauth2Clients.$inferSelect;

export type NewOAuth2Client = typeof oauth2Clients.$inferInsert;

/**
 * OAuth2 授权码表
 * 短期有效（10 分钟），用于 authorization_code 流程
 */
export const oauth2AuthorizationCodes = pgTable('oauth2_authorization_codes', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 授权码 SHA-256 摘要；旧版明文授权码在迁移时全部失效 */
  codeHash: varchar({ length: 64 }).unique('oauth2_authorization_codes_code_hash_unique'),
  clientId: varchar({ length: 64 }).notNull().references(() => oauth2Clients.clientId, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  redirectUri: text().notNull(),
  scopes: text().array().notNull().default([]),
  /** PKCE code_challenge */
  codeChallenge: varchar({ length: 256 }),
  /** OAuth 2.1 仅允许 S256 */
  codeChallengeMethod: varchar({ length: 10 }),
  expiresAt: timestamp().notNull(),
  used: boolean().notNull().default(false),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('oauth2_authorization_codes_user_idx').on(t.userId)]);

export type OAuth2AuthorizationCodeRow = typeof oauth2AuthorizationCodes.$inferSelect;

export type NewOAuth2AuthorizationCode = typeof oauth2AuthorizationCodes.$inferInsert;

/** OAuth2 令牌族：串行化 refresh rotation，并持久化重放/撤销状态 */
export const oauth2TokenFamilies = pgTable('oauth2_token_families', {
  id: varchar({ length: 64 }).primaryKey(),
  clientId: varchar({ length: 64 }).notNull(),
  userId: integer().references(() => users.id, { onDelete: 'cascade' }),
  compromised: boolean().notNull().default(false),
  revoked: boolean().notNull().default(false),
  ...timestampColumns(),
}, (t) => [
  index('oauth2_token_families_client_idx').on(t.clientId),
  index('oauth2_token_families_user_idx').on(t.userId),
]);

export type OAuth2TokenFamilyRow = typeof oauth2TokenFamilies.$inferSelect;

/**
 * OAuth2 令牌表（access_token + refresh_token 共用）
 */
export const oauth2Tokens = pgTable('oauth2_tokens', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** access | refresh */
  tokenType: varchar({ length: 20 }).notNull(),
  /** sha256 哈希后存储 */
  tokenHash: varchar({ length: 128 }).notNull().unique('oauth2_tokens_token_hash_unique'),
  /** token 前缀（oa_ / or_），用于列表页展示 */
  tokenPrefix: varchar({ length: 20 }),
  /** 同一授权会话的 access/refresh token 族，用于检测 refresh token 重放 */
  familyId: varchar({ length: 64 }).references(() => oauth2TokenFamilies.id, { onDelete: 'cascade' }),
  clientId: varchar({ length: 64 }).notNull(),
  /** client_credentials 流程时为 null */
  userId: integer().references(() => users.id, { onDelete: 'cascade' }),
  scopes: text().array().notNull().default([]),
  expiresAt: timestamp(),
  revoked: boolean().notNull().default(false),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('oauth2_tokens_user_idx').on(t.userId), 
  index('oauth2_tokens_client_idx').on(t.clientId),
  index('oauth2_tokens_family_idx').on(t.familyId),
  index('oauth2_tokens_active_expiry_idx').on(t.revoked, t.expiresAt),
]);

export type OAuth2TokenRow = typeof oauth2Tokens.$inferSelect;

export type NewOAuth2Token = typeof oauth2Tokens.$inferInsert;

/**
 * OAuth2 用户授权记录表
 * 记录用户对某应用授权的 scope 集合，避免重复弹同意页
 */
export const oauth2UserGrants = pgTable('oauth2_user_grants', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientId: varchar({ length: 64 }).notNull(),
  scopes: text().array().notNull().default([]),
  ...timestampColumns(),
}, (t) => [
  unique('oauth2_user_grants_user_client_unique').on(t.userId, t.clientId),
  index('oauth2_user_grants_client_idx').on(t.clientId),
]);

export type OAuth2UserGrantRow = typeof oauth2UserGrants.$inferSelect;

export type NewOAuth2UserGrant = typeof oauth2UserGrants.$inferInsert;

/**
 * API Scope 注册表
 * 资源级权限作用域（如 user:read / order:write），供开发者应用申请、网关鉴权使用
 */
export const apiScopes = pgTable('api_scopes', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** scope 编码（唯一），如 user:read */
  code: varchar({ length: 64 }).notNull().unique(),
  name: varchar({ length: 100 }).notNull(),
  description: text(),
  /** 分组（用户/订单/支付…），便于界面归类 */
  scopeGroup: varchar({ length: 64 }).notNull().default('general'),
  status: statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  ...timestampColumns(),
});

export type ApiScopeRow = typeof apiScopes.$inferSelect;

export type NewApiScope = typeof apiScopes.$inferInsert;

/**
 * 限流套餐（Rate Plan / Tier）
 * 定义每个开发者应用的调用配额，按 AppKey 在网关处强制执行
 */
export const ratePlans = pgTable('rate_plans', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 套餐编码（唯一），如 free / pro / enterprise */
  code: varchar({ length: 64 }).notNull().unique(),
  name: varchar({ length: 100 }).notNull(),
  description: text(),
  /** 每秒请求数上限（QPS），0 = 不限 */
  qpsLimit: integer().notNull().default(10),
  /** 每日调用配额，0 = 不限 */
  dailyQuota: integer().notNull().default(0),
  /** 每月调用配额，0 = 不限 */
  monthlyQuota: integer().notNull().default(0),
  /** 是否为默认套餐（应用未绑定套餐时回退使用） */
  isDefault: boolean().notNull().default(false),
  status: statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  ...timestampColumns(),
});

export type RatePlanRow = typeof ratePlans.$inferSelect;

export type NewRatePlan = typeof ratePlans.$inferInsert;

/**
 * 开放 API 调用日志（追加型，无审计列）
 * 由网关计量中间件异步写入，供「调用统计」聚合分析
 */
export const openApiCallLogs = pgTable('open_api_call_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 调用方 AppKey（= oauth2_clients.client_id） */
  clientId: varchar({ length: 64 }).notNull(),
  appName: varchar({ length: 100 }),
  method: varchar({ length: 10 }).notNull(),
  path: varchar({ length: 256 }).notNull(),
  statusCode: integer().notNull(),
  success: boolean().notNull().default(true),
  durationMs: integer().notNull().default(0),
  ip: varchar({ length: 64 }),
  userAgent: varchar({ length: 256 }),
  /** 命中的 scope（如有） */
  scope: varchar({ length: 128 }),
  /** 鉴权通道：bearer = OAuth2 令牌；signature = AppKey + HMAC */
  authChannel: varchar({ length: 16 }),
  /** 用户授权令牌对应的用户；client_credentials 与签名通道为空 */
  userId: integer(),
  errorMessage: varchar({ length: 512 }),
  requestId: varchar({ length: 64 }),
  environment: openAppEnvironmentEnum().notNull().default('production'),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('open_api_call_logs_client_idx').on(t.clientId),
  index('open_api_call_logs_created_idx').on(t.createdAt),
  index('open_api_call_logs_path_idx').on(t.path),
]);

export type OpenApiCallLogRow = typeof openApiCallLogs.$inferSelect;

export type NewOpenApiCallLog = typeof openApiCallLogs.$inferInsert;

/** 开放 API 每日聚合统计；原始日志到期清理后仍保留长期趋势 */
export const openApiCallStatsDaily = pgTable('open_api_call_stats_daily', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  statDate: date().notNull(),
  clientId: varchar({ length: 64 }).notNull(),
  appName: varchar({ length: 100 }),
  path: varchar({ length: 256 }).notNull(),
  environment: openAppEnvironmentEnum().notNull().default('production'),
  totalCalls: bigint({ mode: 'number' }).notNull().default(0),
  successCalls: bigint({ mode: 'number' }).notNull().default(0),
  failedCalls: bigint({ mode: 'number' }).notNull().default(0),
  durationSumMs: bigint({ mode: 'number' }).notNull().default(0),
  maxDurationMs: integer().notNull().default(0),
  ...timestampColumns(),
}, (t) => [
  unique('open_api_call_stats_daily_unique').on(t.statDate, t.clientId, t.path, t.environment),
  index('open_api_call_stats_daily_date_idx').on(t.statDate),
  index('open_api_call_stats_daily_client_idx').on(t.clientId),
]);

export type OpenApiCallStatsDailyRow = typeof openApiCallStatsDaily.$inferSelect;

export const appWebhookSignModeEnum = pgEnum('app_webhook_sign_mode', ['hmacSha256', 'none']);

export const appWebhookDeliveryStatusEnum = pgEnum('app_webhook_delivery_status', ['pending', 'success', 'failed', 'retrying']);

/** 开发者应用的 Webhook 订阅 */
export const appWebhookSubscriptions = pgTable('app_webhook_subscriptions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 所属应用 AppKey；内部 CMS 订阅为 null，外部订阅必须引用 OAuth2 客户端。 */
  clientId: varchar({ length: 64 }).references(() => oauth2Clients.clientId, { onDelete: 'cascade' }),
  name: varchar({ length: 100 }).notNull(),
  url: varchar({ length: 512 }).notNull(),
  /** HMAC 签名密钥密文（AES-256-GCM）；仅创建/重置时明文返回一次 */
  secretEncrypted: text(),
  signMode: appWebhookSignModeEnum().notNull().default('hmacSha256'),
  /** 订阅的事件类型；空数组 = 订阅全部 */
  events: text().array().notNull().default([]),
  /**
   * CMS 站点域事件的过滤条件：非空表示只投递该站点的事件。
   *
   * 应用域事件（app.*）由 clientId 定向投递，与本列无关；
   * CMS 事件没有天然的 clientId，改为「广播给已授权该站点的应用」，本列进一步收窄范围。
   */
  cmsSiteId: integer().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 内部订阅：由 CMS 站点 Webhook 配置托管，不在开放平台订阅列表中暴露给开发者 */
  internal: boolean().notNull().default(false),
  /** 自定义请求头 */
  headers: jsonb().$type<Record<string, string>>(),
  status: statusEnum().notNull().default('enabled'),
  lastDeliveryAt: timestamp({ withTimezone: true }),
  consecutiveFailures: integer().notNull().default(0),
  autoDisabledAt: timestamp({ withTimezone: true }),
  /** 外部订阅与 OAuth2 客户端保持同一租户；内部 CMS 订阅为平台级 null。 */
  tenantId: integer().references((): AnyPgColumn => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('app_webhook_subscriptions_tenant_client_idx').on(t.tenantId, t.clientId),
  index('app_webhook_subscriptions_cms_site_idx').on(t.cmsSiteId),
  check(
    'app_webhook_subscriptions_identity_check',
    sql`((${t.internal} = true and ${t.clientId} is null) or (${t.internal} = false and ${t.clientId} is not null))`,
  ),
]);

export type AppWebhookSubscriptionRow = typeof appWebhookSubscriptions.$inferSelect;

export type NewAppWebhookSubscription = typeof appWebhookSubscriptions.$inferInsert;

/** Webhook 投递日志（追加型，无审计列） */
export const appWebhookDeliveries = pgTable('app_webhook_deliveries', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  subscriptionId: integer().notNull().references(() => appWebhookSubscriptions.id, { onDelete: 'cascade' }),
  /** 外部投递的 OAuth2 client_id；内部 CMS 投递为 null。 */
  clientId: varchar({ length: 64 }),
  tenantId: integer().references((): AnyPgColumn => tenants.id, { onDelete: 'cascade' }),
  eventType: varchar({ length: 64 }).notNull(),
  eventId: varchar({ length: 64 }).notNull(),
  payload: jsonb(),
  attempt: integer().notNull().default(0),
  status: appWebhookDeliveryStatusEnum().notNull().default('pending'),
  requestUrl: varchar({ length: 512 }),
  responseStatus: integer(),
  responseBody: text(),
  errorMessage: text(),
  durationMs: integer(),
  nextRetryAt: timestamp({ withTimezone: true }),
  startedAt: timestamp({ withTimezone: true }),
  finishedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  unique('app_webhook_deliveries_subscription_event_unique').on(t.subscriptionId, t.eventId),
  index('app_webhook_deliveries_sub_idx').on(t.subscriptionId),
  index('app_webhook_deliveries_tenant_client_idx').on(t.tenantId, t.clientId),
  index('app_webhook_deliveries_status_idx').on(t.status),
  index('app_webhook_deliveries_next_retry_idx').on(t.nextRetryAt),
  index('app_webhook_deliveries_created_idx').on(t.createdAt),
]);

export type AppWebhookDeliveryRow = typeof appWebhookDeliveries.$inferSelect;

export type NewAppWebhookDelivery = typeof appWebhookDeliveries.$inferInsert;

/** 配额告警持久化 outbox，确保进程崩溃后可恢复投递 */
export const openQuotaAlerts = pgTable('open_quota_alerts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar({ length: 64 }).notNull(),
  dimension: varchar({ length: 20 }).notNull(),
  period: varchar({ length: 16 }).notNull(),
  threshold: integer().notNull(),
  used: bigint({ mode: 'number' }).notNull(),
  quotaLimit: bigint({ mode: 'number' }).notNull(),
  planCode: varchar({ length: 64 }).notNull(),
  eventId: varchar({ length: 64 }).notNull(),
  status: varchar({ length: 20 }).notNull().default('pending'),
  attempt: integer().notNull().default(0),
  startedAt: timestamp({ withTimezone: true }),
  sentAt: timestamp({ withTimezone: true }),
  lastError: text(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  unique('open_quota_alerts_dedupe_unique').on(t.clientId, t.dimension, t.period, t.threshold),
  index('open_quota_alerts_status_idx').on(t.status, t.startedAt),
]);

export type OpenQuotaAlertRow = typeof openQuotaAlerts.$inferSelect;
