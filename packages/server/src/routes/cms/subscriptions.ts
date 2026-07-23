import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { CmsMemberSubscriptionDTO, CmsSubscriptionAggregateDTO } from '../../lib/openapi-dtos';
import {
  commonErrorResponses,
  ok,
  okBody,
  okPaginated,
  PaginationQuery,
  validationHook,
} from '../../lib/openapi-schemas';
import {
  listCmsSubscriptionAggregates,
  listCmsSubscriptions,
} from '../../services/cms/cms-subscriptions.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const filters = {
  siteId: z.coerce.number().int().positive(),
  subjectType: z.enum(['site', 'channel', 'author']).optional(),
  subjectKeyword: z.string().max(255).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
};

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-会员订阅'], summary: '会员订阅明细（隐私脱敏）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:subscription:list' })] as const,
    request: { query: PaginationQuery.extend(filters) },
    responses: { ...commonErrorResponses, ...okPaginated(CmsMemberSubscriptionDTO, '订阅明细') },
  }),
  handler: async (c) => c.json(okBody(await listCmsSubscriptions(c.req.valid('query'))), 200),
});

const aggregateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/aggregates',
    tags: ['CMS-会员订阅'], summary: '会员订阅聚合',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:subscription:list' })] as const,
    request: { query: z.object(filters) },
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(CmsSubscriptionAggregateDTO), '订阅聚合'),
    },
  }),
  handler: async (c) => c.json(okBody(await listCmsSubscriptionAggregates(c.req.valid('query'))), 200),
});

router.openapiRoutes([listRoute, aggregateRoute] as const);

export default router;
