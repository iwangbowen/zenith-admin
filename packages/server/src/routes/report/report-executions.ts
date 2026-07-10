import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { PaginationQuery, commonErrorResponses, ok, okBody, okPaginated, validationHook } from '../../lib/openapi-schemas';
import { ReportDatasetExecutionLogDTO, ReportExecutionStatsDTO, ReportRuntimeGovernanceDTO } from '../../lib/openapi-dtos';
import { parseDateTimeInput } from '../../lib/datetime';
import { getDatasetExecutionStats, getReportRuntimeGovernance, listDatasetExecutionLogs } from '../../services/report/report-dataset.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['报表数据集'],
    summary: '数据集执行日志列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        datasetId: z.coerce.number().int().positive().optional(),
        datasourceId: z.coerce.number().int().positive().optional(),
        dashboardId: z.coerce.number().int().positive().optional(),
        scene: z.string().max(32).optional(),
        success: z.coerce.boolean().optional(),
        slow: z.coerce.boolean().optional(),
        startAt: z.string().optional(),
        endAt: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(ReportDatasetExecutionLogDTO, '执行日志列表') },
  }),
  handler: async (c) => {
    const query = c.req.valid('query');
    return c.json(okBody(await listDatasetExecutionLogs({
      ...query,
      startAt: parseDateTimeInput(query.startAt) ?? undefined,
      endAt: parseDateTimeInput(query.endAt) ?? undefined,
    })), 200);
  },
});

const statsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/stats',
    tags: ['报表数据集'],
    summary: '数据集执行日志统计',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })] as const,
    request: {
      query: z.object({
        datasetId: z.coerce.number().int().positive().optional(),
        datasourceId: z.coerce.number().int().positive().optional(),
        dashboardId: z.coerce.number().int().positive().optional(),
        scene: z.string().max(32).optional(),
        success: z.coerce.boolean().optional(),
        startAt: z.string().optional(),
        endAt: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(ReportExecutionStatsDTO, '执行统计') },
  }),
  handler: async (c) => {
    const query = c.req.valid('query');
    return c.json(okBody(await getDatasetExecutionStats({
      ...query,
      startAt: parseDateTimeInput(query.startAt) ?? undefined,
      endAt: parseDateTimeInput(query.endAt) ?? undefined,
    })), 200);
  },
});

const governanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/governance',
    tags: ['报表数据集'],
    summary: '报表运行治理配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(ReportRuntimeGovernanceDTO, '治理配置') },
  }),
  handler: async (c) => c.json(okBody(getReportRuntimeGovernance()), 200),
});

router.openapiRoutes([statsRoute, governanceRoute, listRoute] as const);

export default router;
