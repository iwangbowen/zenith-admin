import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { acknowledgeReportDeliveryRunSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  PaginationQuery, commonErrorResponses, jsonContent, ok, okBody, okPaginated, validationHook, IdParam, ErrorResponse,
} from '../../lib/openapi-schemas';
import { ReportDeliveryRunDTO } from '../../lib/openapi-dtos';
import { parseDateTimeInput } from '../../lib/datetime';
import { acknowledgeAlertDeliveryRun, listAccessibleDeliveryRuns } from '../../services/report/report-delivery.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['报表投递'],
    summary: '投递执行历史列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: ['report:alert:list', 'report:subscription:list'] })] as const,
    request: {
      query: PaginationQuery.extend({
        targetType: z.enum(['subscription', 'alert']).optional(),
        subscriptionId: z.coerce.number().int().positive().optional(),
        alertRuleId: z.coerce.number().int().positive().optional(),
        status: z.enum(['pending', 'running', 'success', 'partial', 'failed', 'cancelled']).optional(),
        triggerType: z.enum(['trigger', 'recover', 'manual', 'scheduled']).optional(),
        startAt: z.string().optional(),
        endAt: z.string().optional(),
        includeAttempts: z.coerce.boolean().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(ReportDeliveryRunDTO, '投递执行历史') },
  }),
  handler: async (c) => {
    const query = c.req.valid('query');
    return c.json(okBody(await listAccessibleDeliveryRuns({
      ...query,
      startAt: parseDateTimeInput(query.startAt) ?? undefined,
      endAt: parseDateTimeInput(query.endAt) ?? undefined,
    })), 200);
  },
});

const ackRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/acknowledge',
    tags: ['报表投递'],
    summary: '确认告警投递记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:alert:update' })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(acknowledgeReportDeliveryRunSchema), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(ReportDeliveryRunDTO, '确认成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await acknowledgeAlertDeliveryRun(c.req.valid('param').id, c.req.valid('json').note), '确认成功'), 200),
});

router.openapiRoutes([listRoute, ackRoute] as const);

export default router;
