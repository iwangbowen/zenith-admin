import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { validationHook, commonErrorResponses, ok, okBody } from '../lib/openapi-schemas';
import { MpStatsDTO, MpDatacubeDTO } from '../lib/openapi-dtos';
import { getMpStats, getMpDatacube } from '../services/mp-stats.service';

const mpStatsRouter = new OpenAPIHono({ defaultHook: validationHook });

const statsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['公众号统计'], summary: '数据统计',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:statistics:view' })] as const,
    request: { query: z.object({ accountId: z.coerce.number().int().positive() }) },
    responses: { ...commonErrorResponses, ...ok(MpStatsDTO, '数据统计') },
  }),
  handler: async (c) => c.json(okBody(await getMpStats(c.req.valid('query').accountId)), 200),
});

const datacubeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/datacube', tags: ['公众号统计'], summary: '微信数据立方（真实接口）',
    description: '对接微信数据立方接口（用户增减/累计、消息概况、图文阅读），查询跨度不超过 7 天。',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:statistics:view' })] as const,
    request: {
      query: z.object({
        accountId: z.coerce.number().int().positive(),
        beginDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需为 YYYY-MM-DD'),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需为 YYYY-MM-DD'),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(MpDatacubeDTO, '数据立方') },
  }),
  handler: async (c) => {
    const { accountId, beginDate, endDate } = c.req.valid('query');
    return c.json(okBody(await getMpDatacube(accountId, beginDate, endDate)), 200);
  },
});

mpStatsRouter.openapiRoutes([statsRoute, datacubeRoute] as const);

export default mpStatsRouter;
