import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import {
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  IdParam,
  okBody,
} from '../lib/openapi-schemas';
import { RateLimitRuleDTO, RateLimitStatsDTO } from '../lib/openapi-dtos';
import {
  listRateLimitRules,
  updateRateLimitRule,
  getRateLimitStats,
  unblockRateLimit,
  resetRateLimitStats,
} from '../services/rate-limit.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const UpdateRuleBody = z.object({
  windowMs: z.number().int().min(1000).optional(),
  limit: z.number().int().min(1).optional(),
  keyType: z.enum(['ip', 'user', 'ip_path']).optional(),
  enabled: z.boolean().optional(),
  description: z.string().nullable().optional(),
  blockedMessage: z.string().nullable().optional(),
});

const UnblockBody = z.object({
  name: z.string().min(1),
  key: z.string().min(1),
});

const ResetStatsBody = z.object({
  name: z.string().min(1),
});

const listRules = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/rules',
    tags: ['RateLimit'],
    summary: '获取限流规则列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:rate-limit:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(RateLimitRuleDTO), '规则列表') },
  }),
  handler: async (c) => c.json(okBody(await listRateLimitRules()), 200),
});

const patchRule = defineOpenAPIRoute({
  route: createRoute({
    method: 'patch',
    path: '/rules/{id}',
    tags: ['RateLimit'],
    summary: '更新限流规则（保存后立即热更新）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:rate-limit:manage' })] as const,
    request: { params: IdParam, body: { content: jsonContent(UpdateRuleBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(RateLimitRuleDTO, '更新后的规则') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json');
    return c.json(okBody(await updateRateLimitRule(id, patch), '规则已更新'), 200);
  },
});

const getStats = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/stats',
    tags: ['RateLimit'],
    summary: '获取限流统计与最近拦截记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:rate-limit:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(RateLimitStatsDTO, '统计数据') },
  }),
  handler: async (c) => c.json(okBody(await getRateLimitStats()), 200),
});

const unblock = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/unblock',
    tags: ['RateLimit'],
    summary: '解封指定 key（清除 Redis 计数窗口）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:rate-limit:manage' })] as const,
    request: { body: { content: jsonContent(UnblockBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('解封成功') },
  }),
  handler: async (c) => {
    const { name, key } = c.req.valid('json');
    await unblockRateLimit(name, key);
    return c.json(okBody(null, '解封成功'), 200);
  },
});

const resetStats = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/reset-stats',
    tags: ['RateLimit'],
    summary: '清空指定规则的统计计数器',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:rate-limit:manage' })] as const,
    request: { body: { content: jsonContent(ResetStatsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('统计已清空') },
  }),
  handler: async (c) => {
    const { name } = c.req.valid('json');
    await resetRateLimitStats(name);
    return c.json(okBody(null, '统计已清空'), 200);
  },
});

router.openapiRoutes([listRules, patchRule, getStats, unblock, resetStats] as const);

export default router;
