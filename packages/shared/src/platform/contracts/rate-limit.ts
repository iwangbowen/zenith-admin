import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { RATE_LIMIT_METHODS, RATE_LIMIT_FAIL_MODES } from '../rate-limit';
import { defineContract, op } from '../../core/contract';
import { RATE_LIMIT_ALGORITHMS, RATE_LIMIT_KEY_TYPES, RATE_LIMIT_MODES, RATE_LIMIT_MOUNT_SOURCES } from '../constants';
import {
  banRateLimitSchema,
  createRateLimitRuleSchema,
  resetRateLimitStatsSchema,
  unbanRateLimitSchema,
  unblockRateLimitSchema,
  updateRateLimitRuleSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const rateLimitRuleSchema = z.object({
  id: z.int(),
  name: z.string(),
  description: z.string().nullable(),
  windowMs: z.int(),
  limit: z.int(),
  keyType: z.enum(RATE_LIMIT_KEY_TYPES),
  enabled: z.boolean(),
  mode: z.enum(RATE_LIMIT_MODES).meta({ description: 'enforce=超限拦截；monitor=观察模式（只记数不拦截）' }),
  algorithm: z.enum(RATE_LIMIT_ALGORITHMS),
  allowlist: z.array(z.string()).meta({ description: '豁免名单：IP / CIDR / u:{userId}' }),
  priority: z.int().meta({ description: '路径绑定优先级，多规则命中同一路径时取大者' }),
  alertThreshold: z.int().nullable().meta({ description: '小时拦截数告警阈值，null=不告警' }),
  blockedMessage: z.string().nullable(),
  methods: z.array(z.string()).optional(),
  extraWindows: z.array(z.object({ windowMs: z.int(), limit: z.int() })).optional(),
  failMode: z.enum(RATE_LIMIT_FAIL_MODES).optional(),
  alertUserIds: z.array(z.int()).optional(),
  alertCooldownSeconds: z.int().optional(),
  policyVersion: z.string().optional(),
  loadState: z.enum(['loaded', 'pending']).optional(),
  matchedOperationCount: z.int().optional(),
  warnings: z.array(z.string()).optional(),
  pathPatterns: z.array(z.string()),
  predefined: z.boolean().meta({ description: '是否内置规则（不可删除）' }),
  mountSource: z.enum(RATE_LIMIT_MOUNT_SOURCES).meta({ description: '挂载来源：code=代码挂载；path=路径绑定；none=未生效（死规则）' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'RateLimitRule' });

export type RateLimitRule = z.infer<typeof rateLimitRuleSchema>;

export const rateLimitRecentBlockSchema = z.object({
  at: z.string(),
  key: z.string(),
  path: z.string(),
  monitored: z.boolean().meta({ description: '观察模式命中：只记数未实际拦截' }),
  banned: z.boolean().meta({ description: '手动封禁命中' }),
}).meta({ id: 'RateLimitRecentBlock' });

export type RateLimitRecentBlock = z.infer<typeof rateLimitRecentBlockSchema>;

export const rateLimitStatItemSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  windowMs: z.int(),
  limit: z.int(),
  keyType: z.enum(RATE_LIMIT_KEY_TYPES),
  enabled: z.boolean(),
  mode: z.enum(RATE_LIMIT_MODES),
  hitCount: z.int(),
  blockedCount: z.int(),
  blockRate: z.number(),
  recentBlocks: z.array(rateLimitRecentBlockSchema),
  hourlySeries: z.array(z.object({ hour: z.string(), hits: z.int(), blocked: z.int() })),
  dailySeries: z.array(z.object({ day: z.string(), hits: z.int(), blocked: z.int() })).meta({ description: '近 30 天按日序列' }),
  topSources: z.array(z.object({ key: z.string(), count: z.number() })).meta({ description: '今日 Top 拦截来源（按计数身份聚合）' }),
}).meta({ id: 'RateLimitStatItem' });

export type RateLimitStatItem = z.infer<typeof rateLimitStatItemSchema>;

export const rateLimitStatsSchema = z.object({
  items: z.array(rateLimitStatItemSchema),
}).meta({ id: 'RateLimitStats' });

export type RateLimitStats = z.infer<typeof rateLimitStatsSchema>;

export const rateLimitBanSchema = z.object({
  name: z.string().meta({ description: '规则名' }),
  key: z.string().meta({ description: '被封禁的计数身份（IP / u:{userId} / ip|path）' }),
  expiresAt: z.string().meta({ description: '封禁到期时间' }),
  reason: z.string().optional(),
  createdBy: z.number().nullable().optional(),
  remainingSeconds: z.int().meta({ description: '剩余秒数' }),
}).meta({ id: 'RateLimitBan' });

export type RateLimitBan = z.infer<typeof rateLimitBanSchema>;

export const rateLimitOperationSchema = z.object({ method: z.string(), path: z.string(), summary: z.string(), security: z.string() }).meta({ id: 'RateLimitOperation' });
export const rateLimitDiagnoseSchema = z.object({ method: z.enum(RATE_LIMIT_METHODS), path: z.string().min(1).max(1024), principal: z.enum(['anonymous', 'admin', 'member', 'app']).default('anonymous'), identity: z.string().max(128).optional(), tenantId: z.int().positive().nullable().optional() });
export const rateLimitDiagnosisSchema = z.object({ path: z.string(), method: z.string(), selected: z.array(z.string()), matches: z.array(z.object({ name: z.string(), selected: z.boolean(), stage: z.string(), reason: z.string() })), note: z.string() }).meta({ id: 'RateLimitDiagnosis' });
export type RateLimitDiagnosis = z.infer<typeof rateLimitDiagnosisSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const rateLimitContract = defineContract('/api/rate-limit', {
  operations: op.get('/operations', { access: { permission: 'system:rate-limit:view', platformOnly: 'multi-tenant' }, response: z.array(rateLimitOperationSchema), summary: '限流可绑定接口目录' }),
  diagnose: op.post('/diagnose', { access: { permission: 'system:rate-limit:view', platformOnly: 'multi-tenant' }, body: rateLimitDiagnoseSchema, response: rateLimitDiagnosisSchema, summary: '诊断规则匹配（不消耗额度）' }),
  rules: op.get('/rules', { access: { permission: 'system:rate-limit:view', platformOnly: 'multi-tenant' }, response: z.array(rateLimitRuleSchema), summary: '获取限流规则列表' }),
  createRule: op.post('/rules', { access: { permission: 'system:rate-limit:manage', platformOnly: 'multi-tenant' }, audit: '新增限流规则', body: createRateLimitRuleSchema, response: rateLimitRuleSchema, summary: '新增自定义限流规则' }),
  updateRule: op.patch('/rules/{id}', { access: { permission: 'system:rate-limit:manage', platformOnly: 'multi-tenant' }, audit: '更新限流规则', params: idParam, body: updateRateLimitRuleSchema, response: rateLimitRuleSchema, summary: '更新限流规则（保存后立即热更新）' }),
  removeRule: op.delete('/rules/{id}', { access: { permission: 'system:rate-limit:manage', platformOnly: 'multi-tenant' }, audit: '删除限流规则', params: idParam, summary: '删除自定义限流规则（内置规则不可删除）' }),
  stats: op.get('/stats', { access: { permission: 'system:rate-limit:view', platformOnly: 'multi-tenant' }, response: rateLimitStatsSchema, summary: '获取限流统计与最近拦截记录' }),
  unblock: op.post('/unblock', { access: { permission: 'system:rate-limit:manage', platformOnly: 'multi-tenant' }, audit: '解封限流 key', body: unblockRateLimitSchema, summary: '解封指定 key（清除 Redis 计数窗口）' }),
  resetStats: op.post('/reset-stats', { access: { permission: 'system:rate-limit:manage', platformOnly: 'multi-tenant' }, audit: '清空限流统计', body: resetRateLimitStatsSchema, summary: '清空指定规则的统计计数器' }),
  ban: op.post('/ban', { access: { permission: 'system:rate-limit:manage', platformOnly: 'multi-tenant' }, audit: '手动封禁限流 key', body: banRateLimitSchema, summary: '手动封禁指定 key（封禁期内一律 429，无视限额与观察模式）' }),
  unban: op.post('/unban', { access: { permission: 'system:rate-limit:manage', platformOnly: 'multi-tenant' }, audit: '解除限流封禁', body: unbanRateLimitSchema, summary: '解除手动封禁' }),
  bans: op.get('/bans', { access: { permission: 'system:rate-limit:view', platformOnly: 'multi-tenant' }, response: z.array(rateLimitBanSchema), summary: '活跃封禁列表' }),
}, { auditModule: '接口限流', tags: ['RateLimit'] });
