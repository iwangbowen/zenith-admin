/**
 * 接口限流（rate limit）相关 DTO
 */
import { z } from '@hono/zod-openapi';

export const RateLimitRuleDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    windowMs: z.number().int(),
    limit: z.number().int(),
    keyType: z.enum(['ip', 'user', 'ip_path']),
    enabled: z.boolean(),
    blockedMessage: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('RateLimitRule');

export const RateLimitStatItemDTO = z
  .object({
    name: z.string(),
    description: z.string().nullable(),
    windowMs: z.number().int(),
    limit: z.number().int(),
    keyType: z.string(),
    enabled: z.boolean(),
    hitCount: z.number().int(),
    blockedCount: z.number().int(),
    blockRate: z.number(),
    recentBlocks: z.array(z.object({
      at: z.string(),
      key: z.string(),
      path: z.string(),
    })),
  })
  .openapi('RateLimitStatItem');

export const RateLimitStatsDTO = z
  .object({
    items: z.array(RateLimitStatItemDTO),
  })
  .openapi('RateLimitStats');
