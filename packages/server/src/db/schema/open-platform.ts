import { bigint, boolean, date, index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, unique, varchar, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { statusEnum } from './common';
import { auditColumns, users } from './core';

/**
 * OAuth2 应用（客户端）注册表
 * 管理接入本系统的第三方应用（ClientID / Secret / 回调URL / 权限范围）
 */
export const oauth2Clients = pgTable('oauth2_clients', {
  id: serial('id').primaryKey(),
  /** UUID，即 client_id */
  clientId: varchar('client_id', { length: 64 }).notNull().unique(),
  /** client_secret sha256 哈希值（机密客户端），公开客户端为 null */
  clientSecretHash: varchar('client_secret_hash', { length: 128 }),
  /** client_secret 的 AES-256-GCM 密文，供开放 API HMAC 签名验签复用（clientSecret 兼作签名密钥） */
  clientSecretEncrypted: text('client_secret_encrypted'),
  /** secret 前缀，用于列表页展示（前 8 位 + ...）*/
  clientSecretPrefix: varchar('client_secret_prefix', { length: 20 }),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  logoUrl: varchar('logo_url', { length: 500 }),
  /** 允许的回调 URL 列表 */
  redirectUris: text('redirect_uris').array().notNull().default([]),
  /** 允许申请的 scope 子集，如 ['openid','profile','email'] */
  allowedScopes: text('allowed_scopes').array().notNull().default([]),
  /** 允许的授权流程，如 ['authorization_code','client_credentials'] */
  grantTypes: text('grant_types').array().notNull().default([]),
  /** 是否为公开客户端（无 secret，必须使用 PKCE）*/
  isPublic: boolean('is_public').notNull().default(false),
  /** 开放平台：绑定的限流套餐（为空表示使用默认套餐） */
  ratePlanId: integer('rate_plan_id').references((): AnyPgColumn => ratePlans.id, { onDelete: 'set null' }),
  /** 开放平台：调用开放 API 网关时是否强制 HMAC 签名验签 */
  signEnabled: boolean('sign_enabled').notNull().default(false),
  /** 来源 IP/CIDR 白名单；空数组表示不限制 */
  ipAllowlist: text('ip_allowlist').array().notNull().default([]),
  status: statusEnum('status').notNull().default('enabled'),
  /** 应用归属用户 */
  ownerId: integer('owner_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type OAuth2ClientRow = typeof oauth2Clients.$inferSelect;

export type NewOAuth2Client = typeof oauth2Clients.$inferInsert;

/**
 * OAuth2 授权码表
 * 短期有效（10 分钟），用于 authorization_code 流程
 */
export const oauth2AuthorizationCodes = pgTable('oauth2_authorization_codes', {
  id: serial('id').primaryKey(),
  /** 授权码 SHA-256 摘要；旧版明文授权码在迁移时全部失效 */
  codeHash: varchar('code_hash', { length: 64 }).unique(),
  clientId: varchar('client_id', { length: 64 }).notNull(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  scopes: text('scopes').array().notNull().default([]),
  /** PKCE code_challenge */
  codeChallenge: varchar('code_challenge', { length: 256 }),
  /** OAuth 2.1 仅允许 S256 */
  codeChallengeMethod: varchar('code_challenge_method', { length: 10 }),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type OAuth2AuthorizationCodeRow = typeof oauth2AuthorizationCodes.$inferSelect;

export type NewOAuth2AuthorizationCode = typeof oauth2AuthorizationCodes.$inferInsert;

/**
 * OAuth2 令牌表（access_token + refresh_token 共用）
 */
export const oauth2Tokens = pgTable('oauth2_tokens', {
  id: serial('id').primaryKey(),
  /** access | refresh */
  tokenType: varchar('token_type', { length: 20 }).notNull(),
  /** sha256 哈希后存储 */
  tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
  /** token 前缀（oa_ / or_），用于列表页展示 */
  tokenPrefix: varchar('token_prefix', { length: 20 }),
  clientId: varchar('client_id', { length: 64 }).notNull(),
  /** client_credentials 流程时为 null */
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  scopes: text('scopes').array().notNull().default([]),
  expiresAt: timestamp('expires_at'),
  revoked: boolean('revoked').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('oauth2_tokens_client_idx').on(t.clientId),
  index('oauth2_tokens_active_expiry_idx').on(t.revoked, t.expiresAt),
]);

export type OAuth2TokenRow = typeof oauth2Tokens.$inferSelect;

export type NewOAuth2Token = typeof oauth2Tokens.$inferInsert;

/**
 * OAuth2 用户授权记录表
 * 记录用户对某应用授权的 scope 集合，避免重复弹同意页
 */
export const oauth2UserGrants = pgTable('oauth2_user_grants', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientId: varchar('client_id', { length: 64 }).notNull(),
  scopes: text('scopes').array().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
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
  id: serial('id').primaryKey(),
  /** scope 编码（唯一），如 user:read */
  code: varchar('code', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  /** 分组（用户/订单/支付…），便于界面归类 */
  scopeGroup: varchar('scope_group', { length: 64 }).notNull().default('general'),
  status: statusEnum('status').notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ApiScopeRow = typeof apiScopes.$inferSelect;

export type NewApiScope = typeof apiScopes.$inferInsert;

/**
 * 限流套餐（Rate Plan / Tier）
 * 定义每个开发者应用的调用配额，按 AppKey 在网关处强制执行
 */
export const ratePlans = pgTable('rate_plans', {
  id: serial('id').primaryKey(),
  /** 套餐编码（唯一），如 free / pro / enterprise */
  code: varchar('code', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  /** 每秒请求数上限（QPS），0 = 不限 */
  qpsLimit: integer('qps_limit').notNull().default(10),
  /** 每日调用配额，0 = 不限 */
  dailyQuota: integer('daily_quota').notNull().default(0),
  /** 每月调用配额，0 = 不限 */
  monthlyQuota: integer('monthly_quota').notNull().default(0),
  /** 是否为默认套餐（应用未绑定套餐时回退使用） */
  isDefault: boolean('is_default').notNull().default(false),
  status: statusEnum('status').notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type RatePlanRow = typeof ratePlans.$inferSelect;

export type NewRatePlan = typeof ratePlans.$inferInsert;

/**
 * 开放 API 调用日志（追加型，无审计列）
 * 由网关计量中间件异步写入，供「调用统计」聚合分析
 */
export const openApiCallLogs = pgTable('open_api_call_logs', {
  id: serial('id').primaryKey(),
  /** 调用方 AppKey（= oauth2_clients.client_id） */
  clientId: varchar('client_id', { length: 64 }).notNull(),
  appName: varchar('app_name', { length: 100 }),
  method: varchar('method', { length: 10 }).notNull(),
  path: varchar('path', { length: 256 }).notNull(),
  statusCode: integer('status_code').notNull(),
  success: boolean('success').notNull().default(true),
  durationMs: integer('duration_ms').notNull().default(0),
  ip: varchar('ip', { length: 64 }),
  userAgent: varchar('user_agent', { length: 256 }),
  /** 命中的 scope（如有） */
  scope: varchar('scope', { length: 128 }),
  errorMessage: varchar('error_message', { length: 512 }),
  requestId: varchar('request_id', { length: 64 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('open_api_call_logs_client_idx').on(t.clientId),
  index('open_api_call_logs_created_idx').on(t.createdAt),
  index('open_api_call_logs_path_idx').on(t.path),
]);

export type OpenApiCallLogRow = typeof openApiCallLogs.$inferSelect;

export type NewOpenApiCallLog = typeof openApiCallLogs.$inferInsert;

/** 开放 API 每日聚合统计；原始日志到期清理后仍保留长期趋势 */
export const openApiCallStatsDaily = pgTable('open_api_call_stats_daily', {
  id: serial('id').primaryKey(),
  statDate: date('stat_date').notNull(),
  clientId: varchar('client_id', { length: 64 }).notNull(),
  appName: varchar('app_name', { length: 100 }),
  path: varchar('path', { length: 256 }).notNull(),
  totalCalls: bigint('total_calls', { mode: 'number' }).notNull().default(0),
  successCalls: bigint('success_calls', { mode: 'number' }).notNull().default(0),
  failedCalls: bigint('failed_calls', { mode: 'number' }).notNull().default(0),
  durationSumMs: bigint('duration_sum_ms', { mode: 'number' }).notNull().default(0),
  maxDurationMs: integer('max_duration_ms').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  unique('open_api_call_stats_daily_unique').on(t.statDate, t.clientId, t.path),
  index('open_api_call_stats_daily_date_idx').on(t.statDate),
  index('open_api_call_stats_daily_client_idx').on(t.clientId),
]);

export type OpenApiCallStatsDailyRow = typeof openApiCallStatsDaily.$inferSelect;

export const appWebhookSignModeEnum = pgEnum('app_webhook_sign_mode', ['hmacSha256', 'none']);

export const appWebhookDeliveryStatusEnum = pgEnum('app_webhook_delivery_status', ['pending', 'success', 'failed', 'retrying']);

/** 开发者应用的 Webhook 订阅 */
export const appWebhookSubscriptions = pgTable('app_webhook_subscriptions', {
  id: serial('id').primaryKey(),
  /** 所属应用 AppKey（= oauth2_clients.client_id） */
  clientId: varchar('client_id', { length: 64 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  url: varchar('url', { length: 512 }).notNull(),
  /** HMAC 签名密钥密文（AES-256-GCM）；仅创建/重置时明文返回一次 */
  secretEncrypted: text('secret_encrypted'),
  signMode: appWebhookSignModeEnum('sign_mode').notNull().default('hmacSha256'),
  /** 订阅的事件类型；空数组 = 订阅全部 */
  events: text('events').array().notNull().default([]),
  /** 自定义请求头 */
  headers: jsonb('headers').$type<Record<string, string>>(),
  status: statusEnum('status').notNull().default('enabled'),
  lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  autoDisabledAt: timestamp('auto_disabled_at', { withTimezone: true }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('app_webhook_subscriptions_client_idx').on(t.clientId)]);

export type AppWebhookSubscriptionRow = typeof appWebhookSubscriptions.$inferSelect;

export type NewAppWebhookSubscription = typeof appWebhookSubscriptions.$inferInsert;

/** Webhook 投递日志（追加型，无审计列） */
export const appWebhookDeliveries = pgTable('app_webhook_deliveries', {
  id: serial('id').primaryKey(),
  subscriptionId: integer('subscription_id').notNull().references(() => appWebhookSubscriptions.id, { onDelete: 'cascade' }),
  clientId: varchar('client_id', { length: 64 }).notNull(),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  eventId: varchar('event_id', { length: 64 }).notNull(),
  payload: jsonb('payload'),
  attempt: integer('attempt').notNull().default(0),
  status: appWebhookDeliveryStatusEnum('status').notNull().default('pending'),
  requestUrl: varchar('request_url', { length: 512 }),
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('app_webhook_deliveries_sub_idx').on(t.subscriptionId),
  index('app_webhook_deliveries_client_idx').on(t.clientId),
  index('app_webhook_deliveries_status_idx').on(t.status),
  index('app_webhook_deliveries_next_retry_idx').on(t.nextRetryAt),
  index('app_webhook_deliveries_created_idx').on(t.createdAt),
]);

export type AppWebhookDeliveryRow = typeof appWebhookDeliveries.$inferSelect;

export type NewAppWebhookDelivery = typeof appWebhookDeliveries.$inferInsert;
