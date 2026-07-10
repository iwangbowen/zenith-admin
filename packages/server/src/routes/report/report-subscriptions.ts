import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createReportSubscriptionSchema, updateReportSubscriptionSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { AsyncTaskDTO, ReportDashboardSubscriptionDTO } from '../../lib/openapi-dtos';
import {
  listSubscriptions, createSubscription, updateSubscription, deleteSubscription,
  ensureSubscriptionExists, mapSubscription, batchSetSubscriptionEnabled,
} from '../../services/report/report-subscription.service';
import { submitSubscriptionDeliveryTask } from '../../services/report/report-delivery-tasks';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['报表订阅'], summary: '订阅列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:subscription:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), dashboardId: z.coerce.number().int().positive().optional(), enabled: z.coerce.boolean().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(ReportDashboardSubscriptionDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listSubscriptions(c.req.valid('query'))), 200),
});

const batchStatusSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(50),
  enabled: z.boolean(),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['报表订阅'], summary: '创建订阅',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:subscription:create', audit: { description: '创建报表订阅', module: '报表订阅' } })] as const,
    request: { body: { content: jsonContent(createReportSubscriptionSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardSubscriptionDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createSubscription(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['报表订阅'], summary: '更新订阅',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:subscription:update', audit: { description: '更新报表订阅', module: '报表订阅' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateReportSubscriptionSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardSubscriptionDTO, '更新成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapSubscription(await ensureSubscriptionExists(id)));
    return c.json(okBody(await updateSubscription(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['报表订阅'], summary: '删除订阅',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:subscription:delete', audit: { description: '删除报表订阅', module: '报表订阅' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapSubscription(await ensureSubscriptionExists(id)));
    await deleteSubscription(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchStatusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/batch-status', tags: ['报表订阅'], summary: '批量启停订阅',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:subscription:update', audit: { description: '批量更新报表订阅状态', module: '报表订阅' } })] as const,
    request: { body: { content: jsonContent(batchStatusSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已更新') },
  }),
  handler: async (c) => {
    const { ids, enabled } = c.req.valid('json');
    const count = await batchSetSubscriptionEnabled(ids, enabled);
    return c.json(okBody(null, `已更新 ${count} 条订阅状态`), 200);
  },
});

const runRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/run', tags: ['报表订阅'], summary: '立即推送',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:subscription:update', audit: { description: '手动推送报表订阅', module: '报表订阅' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '任务已提交'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    return c.json(okBody(await submitSubscriptionDeliveryTask(c.req.valid('param').id), '任务已提交，可在任务中心查看进度'), 200);
  },
});

router.openapiRoutes([listRoute, batchStatusRoute, createRoute_, updateRoute_, deleteRoute_, runRoute] as const);

export default router;
