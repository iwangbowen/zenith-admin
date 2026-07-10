import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createReportAlertSchema, updateReportAlertSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { AsyncTaskDTO, ReportAlertRuleDTO } from '../../lib/openapi-dtos';
import {
  listAlerts, getAlert, createAlert, updateAlert, deleteAlert, ensureAlertExists, batchSetAlertEnabled,
} from '../../services/report/report-alert.service';
import { submitAlertEvaluateTask } from '../../services/report/report-delivery-tasks';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['报表预警'], summary: '预警规则列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:alert:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        datasetId: z.coerce.number().int().positive().optional(),
        enabled: z.coerce.boolean().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(ReportAlertRuleDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listAlerts(c.req.valid('query'))), 200),
});

const batchStatusSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(50),
  enabled: z.boolean(),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['报表预警'], summary: '预警规则详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:alert:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(ReportAlertRuleDTO, '详情'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await getAlert(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['报表预警'], summary: '创建预警规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:alert:create', audit: { description: '创建报表预警', module: '报表预警' } })] as const,
    request: { body: { content: jsonContent(createReportAlertSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportAlertRuleDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createAlert(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['报表预警'], summary: '更新预警规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:alert:update', audit: { description: '更新报表预警', module: '报表预警' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateReportAlertSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportAlertRuleDTO, '更新成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureAlertExists(id);
    setAuditBeforeData(c, before);
    return c.json(okBody(await updateAlert(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['报表预警'], summary: '删除预警规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:alert:delete', audit: { description: '删除报表预警', module: '报表预警' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureAlertExists(id);
    setAuditBeforeData(c, before);
    await deleteAlert(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchStatusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/batch-status', tags: ['报表预警'], summary: '批量启停预警',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:alert:update', audit: { description: '批量更新报表预警状态', module: '报表预警' } })] as const,
    request: { body: { content: jsonContent(batchStatusSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已更新') },
  }),
  handler: async (c) => {
    const { ids, enabled } = c.req.valid('json');
    const count = await batchSetAlertEnabled(ids, enabled);
    return c.json(okBody(null, `已更新 ${count} 条预警状态`), 200);
  },
});

const evalRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/evaluate',
    tags: ['报表预警'], summary: '手动评估预警',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:alert:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '任务已提交'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await submitAlertEvaluateTask(c.req.valid('param').id), '任务已提交，可在任务中心查看进度'), 200),
});

router.openapiRoutes([listRoute, batchStatusRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_, evalRoute] as const);

export default router;
