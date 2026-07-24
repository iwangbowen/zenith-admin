import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import {
  CMS_DISTRIBUTION_MODES,
  CMS_DISTRIBUTION_TASK_STATUSES,
  createCmsDistributionRuleSchema,
  updateCmsDistributionRuleSchema,
} from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import {
  commonErrorResponses,
  IdParam,
  jsonContent,
  ok,
  okBody,
  okMsg,
  okPaginated,
  PaginationQuery,
  validationHook,
} from '../../lib/openapi-schemas';
import {
  AsyncTaskDTO,
  CmsDistributionRuleDTO,
  CmsDistributionRunDetailDTO,
  CmsDistributionRunDTO,
} from '../../lib/openapi-dtos';
import {
  createCmsDistributionRule,
  deleteCmsDistributionRule,
  getCmsDistributionRule,
  getCmsDistributionRunDetail,
  listCmsDistributionRules,
  listCmsDistributionRuns,
  submitCmsDistributionRun,
  updateCmsDistributionRule,
} from '../../services/cms/cms-distributions.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const TaskStatus = z.enum(CMS_DISTRIBUTION_TASK_STATUSES);

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['CMS-内容分发'], summary: '受权分发规则分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:distribution:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().max(100).optional(),
        sourceSiteId: z.coerce.number().int().positive().optional(),
        targetSiteId: z.coerce.number().int().positive().optional(),
        mode: z.enum(CMS_DISTRIBUTION_MODES).optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsDistributionRuleDTO, '分发规则') },
  }),
  handler: async (c) => c.json(okBody(await listCmsDistributionRules(c.req.valid('query'))), 200),
});

const runsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/runs', tags: ['CMS-内容分发'], summary: '分发同步结果与日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:distribution:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        ruleId: z.coerce.number().int().positive().optional(),
        siteId: z.coerce.number().int().positive().optional(),
        status: TaskStatus.optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsDistributionRunDTO, '同步记录') },
  }),
  handler: async (c) => c.json(okBody(await listCmsDistributionRuns(c.req.valid('query'))), 200),
});

const runDetailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/runs/{id}', tags: ['CMS-内容分发'], summary: '分发同步行级结果',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:distribution:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsDistributionRunDetailDTO, '同步详情') },
  }),
  handler: async (c) => c.json(okBody(await getCmsDistributionRunDetail(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['CMS-内容分发'], summary: '创建受治理分发规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'cms:distribution:create',
      audit: { description: '创建 CMS 内容分发规则', module: 'CMS内容管理' },
    })] as const,
    request: { body: { content: jsonContent(createCmsDistributionRuleSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsDistributionRuleDTO, '创建结果') },
  }),
  handler: async (c) => {
    const result = await createCmsDistributionRule(c.req.valid('json'));
    setAuditAfterData(c, result);
    return c.json(okBody(result, '分发规则已创建'), 200);
  },
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['CMS-内容分发'], summary: '分发规则详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:distribution:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsDistributionRuleDTO, '规则详情') },
  }),
  handler: async (c) => c.json(okBody(await getCmsDistributionRule(c.req.valid('param').id)), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['CMS-内容分发'], summary: '编辑或启停分发规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'cms:distribution:update',
      audit: { description: '更新 CMS 内容分发规则', module: 'CMS内容管理' },
    })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(updateCmsDistributionRuleSchema), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(CmsDistributionRuleDTO, '更新结果') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsDistributionRule(id));
    const result = await updateCmsDistributionRule(id, c.req.valid('json'));
    setAuditAfterData(c, result);
    return c.json(okBody(result, '分发规则已更新'), 200);
  },
});

const runRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/run', tags: ['CMS-内容分发'], summary: '提交分发同步任务',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({
        permission: 'cms:distribution:run',
        audit: { description: '执行 CMS 内容分发', module: 'CMS内容管理' },
      }),
      idempotencyGuard({ ttlSeconds: 30 }),
    ] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '同步任务') },
  }),
  handler: async (c) => c.json(okBody(
    await submitCmsDistributionRun(c.req.valid('param').id),
    '分发任务已提交',
  ), 200),
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['CMS-内容分发'], summary: '删除分发规则（保留已物化内容）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'cms:distribution:delete',
      audit: { description: '删除 CMS 内容分发规则', module: 'CMS内容管理' },
    })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsDistributionRule(id));
    await deleteCmsDistributionRule(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([
  listRoute,
  runsRoute,
  runDetailRoute,
  createRoute_,
  runRoute,
  getRoute,
  updateRoute,
  deleteRoute,
] as const);

export default router;
