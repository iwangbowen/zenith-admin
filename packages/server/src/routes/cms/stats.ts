import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { validationHook, commonErrorResponses, ok, okBody } from '../../lib/openapi-schemas';
import { CmsVisitStatsDTO, CmsSearchAnalyticsDTO } from '../../lib/openapi-dtos';
import { getCmsVisitStats, getCmsSearchAnalytics } from '../../services/cms/cms-stats.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const statsQuery = z.object({
  siteId: z.coerce.number().int().positive(),
  days: z.coerce.number().int().min(1).max(90).default(30),
});

const visitsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/visits',
    tags: ['CMS-访问统计'], summary: '访问统计总览（今日/昨日卡片 + PV/UV 趋势 + 内容TOP + 来源/设备/通道分布）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:stat:view' })] as const,
    request: { query: statsQuery },
    responses: { ...commonErrorResponses, ...ok(CmsVisitStatsDTO, '访问统计') },
  }),
  handler: async (c) => {
    const { siteId, days } = c.req.valid('query');
    return c.json(okBody(await getCmsVisitStats(siteId, days)), 200);
  },
});

const searchRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/search',
    tags: ['CMS-访问统计'], summary: '搜索分析（搜索量趋势 + 热搜词榜 + 无结果词榜）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:stat:view' })] as const,
    request: { query: statsQuery },
    responses: { ...commonErrorResponses, ...ok(CmsSearchAnalyticsDTO, '搜索分析') },
  }),
  handler: async (c) => {
    const { siteId, days } = c.req.valid('query');
    return c.json(okBody(await getCmsSearchAnalytics(siteId, days)), 200);
  },
});

router.openapiRoutes([visitsRoute, searchRoute] as const);

export default router;
