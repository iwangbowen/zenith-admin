import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import {
  batchCmsPublishActionSchema,
  CMS_PUBLISH_ARTIFACT_STATUSES,
  CMS_PUBLISH_TARGET_TYPES,
  submitCmsPublishSchema,
} from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import {
  commonErrorResponses,
  IdParam,
  jsonContent,
  ok,
  okBody,
  okPaginated,
  PaginationQuery,
  validationHook,
} from '../../lib/openapi-schemas';
import {
  AsyncTaskDTO,
  CmsPublishingDetailDTO,
  CmsPublishingTaskDTO,
  CmsPublishArtifactDTO,
} from '../../lib/openapi-dtos';
import {
  batchCmsPublishingAction,
  cmsPublishingAction,
  getCmsPublishingDetail,
  listCmsPublishArtifacts,
  listCmsPublishingTasks,
  submitCmsPublishTask,
} from '../../services/cms/cms-publishing.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const TaskStatus = z.enum(['pending', 'running', 'success', 'failed', 'cancelled']);

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['CMS-发布中心'], summary: 'CMS 发布任务受权投影',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:publish:view' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive().optional(),
        targetType: z.enum(CMS_PUBLISH_TARGET_TYPES).optional(),
        status: z.union([TaskStatus, z.literal('active'), z.literal('terminal')]).optional(),
        taskType: z.string().max(64).optional(),
        createdBy: z.string().max(100).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        keyword: z.string().max(100).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsPublishingTaskDTO, '发布任务列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsPublishingTasks(c.req.valid('query'))), 200),
});

const artifactsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/artifacts', tags: ['CMS-发布中心'], summary: '发布产物分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:publish:view' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive().optional(),
        taskId: z.coerce.number().int().positive().optional(),
        targetType: z.enum(CMS_PUBLISH_TARGET_TYPES).optional(),
        status: z.enum(CMS_PUBLISH_ARTIFACT_STATUSES).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        keyword: z.string().max(100).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsPublishArtifactDTO, '发布产物列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsPublishArtifacts(c.req.valid('query'))), 200),
});

const submitRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/submit', tags: ['CMS-发布中心'], summary: '统一提交内容/栏目/整站/影响重建任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:publish:build', audit: { description: '提交 CMS 发布任务', module: 'CMS内容管理' } }), idempotencyGuard({ ttlSeconds: 30 })] as const,
    request: { body: { content: jsonContent(submitCmsPublishSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '发布任务') },
  }),
  handler: async (c) => c.json(okBody(await submitCmsPublishTask(c.req.valid('json')), '发布任务已提交'), 200),
});

const batchActionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/batch-action', tags: ['CMS-发布中心'], summary: '批量取消/恢复/重试/重建发布任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:publish:manage', audit: { description: '批量操作 CMS 发布任务', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(batchCmsPublishActionSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(z.object({
        affected: z.number().int(),
        errors: z.array(z.object({ id: z.number().int(), message: z.string() })),
      }), '批量操作结果'),
    },
  }),
  handler: async (c) => {
    const { ids, action } = c.req.valid('json');
    return c.json(okBody(await batchCmsPublishingAction(ids, action), '批量操作完成'), 200);
  },
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['CMS-发布中心'], summary: '发布任务、明细与产物详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:publish:view' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsPublishingDetailDTO, '发布详情') },
  }),
  handler: async (c) => c.json(okBody(await getCmsPublishingDetail(c.req.valid('param').id)), 200),
});

const actionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/{action}', tags: ['CMS-发布中心'], summary: '取消/恢复/重试/重建发布任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:publish:manage', audit: { description: '操作 CMS 发布任务', module: 'CMS内容管理' } })] as const,
    request: {
      params: z.object({
        id: z.coerce.number().int().positive().openapi({ param: { name: 'id', in: 'path' } }),
        action: z.enum(['cancel', 'resume', 'restart', 'rebuild']).openapi({ param: { name: 'action', in: 'path' } }),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '任务状态') },
  }),
  handler: async (c) => {
    const { id, action } = c.req.valid('param');
    return c.json(okBody(await cmsPublishingAction(id, action), '操作已提交'), 200);
  },
});

router.openapiRoutes([
  listRoute, artifactsRoute, submitRoute, batchActionRoute, detailRoute, actionRoute,
] as const);

export default router;
