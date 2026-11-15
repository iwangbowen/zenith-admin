import * as z from 'zod';
import { partialForUpdate } from '../core/validation';
import { RATE_LIMIT_METHODS, RATE_LIMIT_FAIL_MODES } from './rate-limit';
import { RATE_LIMIT_ALGORITHMS, RATE_LIMIT_KEY_TYPES, RATE_LIMIT_MODES } from './constants';

// ─── 接口限流 Schema ──────────────────────────────────────────────────────────

/** Managed bindings support API routes and the explicitly mounted short-link surface. */
const rateLimitPathPatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (p) =>
      (p.startsWith('/api/') || p.startsWith('/s/')) &&
      !p.includes('?') &&
      !p.includes('#') &&
      Array.from(p).every((char) => char.trim().length > 0),
    '路径必须以 /api/ 或 /s/ 开头，不能包含查询参数或空白',
  );

/** 白名单条目：IP / CIDR / u:{userId}；合法性在中间件运行期宽容处理，这里只做长度约束 */
const rateLimitAllowlistSchema = z.array(z.string().min(1).max(128)).max(100);

export const createRateLimitRuleSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_-]*$/, '规则名称只能包含小写字母、数字、下划线和连字符'),
  description: z.string().max(255).nullable().optional(),
  windowMs: z.number().int().min(1000).max(86_400_000),
  limit: z.number().int().min(1).max(1_000_000),
  keyType: z.enum(RATE_LIMIT_KEY_TYPES),
  enabled: z.boolean(),
  mode: z.enum(RATE_LIMIT_MODES).optional(),
  algorithm: z.enum(RATE_LIMIT_ALGORITHMS).optional(),
  allowlist: rateLimitAllowlistSchema.optional(),
  priority: z.number().int().min(0).max(9999).optional(),
  alertThreshold: z.number().int().min(1).max(1_000_000).nullable().optional(),
  blockedMessage: z.string().max(255).nullable().optional(),
  methods: z.array(z.enum(RATE_LIMIT_METHODS)).max(7).optional(),
  extraWindows: z
    .array(z.object({ windowMs: z.int().min(1000).max(86_400_000), limit: z.int().min(1).max(1_000_000) }))
    .max(2)
    .optional(),
  failMode: z.enum(RATE_LIMIT_FAIL_MODES).optional(),
  alertUserIds: z.array(z.int().positive()).max(20).optional(),
  alertCooldownSeconds: z.int().min(60).max(86400).optional(),
  pathPatterns: z.array(rateLimitPathPatternSchema).max(50).optional(),
});

/** Updates preserve omitted values and share create-time bounds. */
export const updateRateLimitRuleSchema = partialForUpdate(createRateLimitRuleSchema.omit({ name: true }));

export const unblockRateLimitSchema = z.object({
  name: z.string().min(1),
  key: z.string().min(1),
});

export const resetRateLimitStatsSchema = z.object({
  name: z.string().min(1),
});

export const banRateLimitSchema = z.object({
  name: z.string().min(1),
  key: z.string().min(1).max(256),
  durationSeconds: z
    .number()
    .int()
    .min(60)
    .max(30 * 24 * 3600),
  reason: z.string().trim().min(1).max(255).optional(),
});

export const unbanRateLimitSchema = z.object({
  name: z.string().min(1),
  key: z.string().min(1).max(256),
});

export type CreateRateLimitRuleInput = z.infer<typeof createRateLimitRuleSchema>;

export type UpdateRateLimitRuleInput = z.infer<typeof updateRateLimitRuleSchema>;

export type BanRateLimitInput = z.infer<typeof banRateLimitSchema>;
