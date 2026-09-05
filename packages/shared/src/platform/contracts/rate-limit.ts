import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
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
  remainingSeconds: z.int().meta({ description: '剩余秒数' }),
}).meta({ id: 'RateLimitBan' });

export type RateLimitBan = z.infer<typeof rateLimitBanSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const rateLimitContract = defineContract('/api/rate-limit', {
  rules: op.get('/rules', { response: z.array(rateLimitRuleSchema), summary: '获取限流规则列表' }),
  createRule: op.post('/rules', { body: createRateLimitRuleSchema, response: rateLimitRuleSchema, summary: '新增自定义限流规则' }),
  updateRule: op.patch('/rules/{id}', { params: idParam, body: updateRateLimitRuleSchema, response: rateLimitRuleSchema, summary: '更新限流规则（保存后立即热更新）' }),
  removeRule: op.delete('/rules/{id}', { params: idParam, summary: '删除自定义限流规则（内置规则不可删除）' }),
  stats: op.get('/stats', { response: rateLimitStatsSchema, summary: '获取限流统计与最近拦截记录' }),
  unblock: op.post('/unblock', { body: unblockRateLimitSchema, summary: '解封指定 key（清除 Redis 计数窗口）' }),
  resetStats: op.post('/reset-stats', { body: resetRateLimitStatsSchema, summary: '清空指定规则的统计计数器' }),
  ban: op.post('/ban', { body: banRateLimitSchema, summary: '手动封禁指定 key（封禁期内一律 429，无视限额与观察模式）' }),
  unban: op.post('/unban', { body: unbanRateLimitSchema, summary: '解除手动封禁' }),
  bans: op.get('/bans', { response: z.array(rateLimitBanSchema), summary: '活跃封禁列表' }),
}, { tags: ['RateLimit'] });
