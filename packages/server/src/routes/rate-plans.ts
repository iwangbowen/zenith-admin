import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  okPaginated,
  IdParam,
  PaginationQuery,
  okBody,
} from '../lib/openapi-schemas';
import { RatePlanDTO } from '../lib/openapi-dtos';
import { createRatePlanSchema, updateRatePlanSchema } from '@zenith/shared';
import {
  listRatePlans,
  listEnabledRatePlans,
  getRatePlan,
  getRatePlanBeforeAudit,
  createRatePlan,
  updateRatePlan,
  deleteRatePlan,
} from '../services/rate-plans.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const ListQuery = PaginationQuery.extend({
  keyword: z.string().optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
});

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['RatePlans'],
    summary: '获取限流套餐列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:rate-plan:view' })] as const,
    request: { query: ListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(RatePlanDTO, '限流套餐列表') },
  }),
  handler: async (c) => {
    const { page, pageSize, keyword, status } = c.req.valid('query');
    return c.json(okBody(await listRatePlans({ page, pageSize, keyword, status })), 200);
  },
});

const options = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/options',
    tags: ['RatePlans'],
    summary: '获取全部启用的套餐（供应用配置下拉）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(RatePlanDTO), '启用的套餐列表') },
  }),
  handler: async (c) => c.json(okBody(await listEnabledRatePlans()), 200),
});

const detail = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['RatePlans'],
    summary: '获取限流套餐详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:rate-plan:view' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(RatePlanDTO, '限流套餐详情') },
  }),
  handler: async (c) => c.json(okBody(await getRatePlan(c.req.valid('param').id)), 200),
});

const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['RatePlans'],
    summary: '创建限流套餐',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'open:rate-plan:manage',
      audit: { description: '创建限流套餐', module: '开放平台-限流套餐' },
    })] as const,
    request: { body: { content: jsonContent(createRatePlanSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(RatePlanDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createRatePlan(c.req.valid('json')), '创建成功'), 200),
});

const update = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['RatePlans'],
    summary: '更新限流套餐',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'open:rate-plan:manage',
      audit: { description: '更新限流套餐', module: '开放平台-限流套餐' },
    })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateRatePlanSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(RatePlanDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getRatePlanBeforeAudit(id));
    return c.json(okBody(await updateRatePlan(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['RatePlans'],
    summary: '删除限流套餐',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'open:rate-plan:manage',
      audit: { description: '删除限流套餐', module: '开放平台-限流套餐' },
    })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getRatePlanBeforeAudit(id));
    await deleteRatePlan(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([list, options, detail, create, update, remove] as const);

export default router;
