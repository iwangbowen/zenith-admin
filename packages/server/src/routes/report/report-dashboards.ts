import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import {
  createReportDashboardSchema,
  reportBatchStatusSchema,
  reportCloneSchema,
  reportDashboardDataBodySchema,
  reportDashboardLifecycleActionSchema,
  reportDashboardLifecycleStatusSchema,
  reportLookupQuerySchema,
  reportDashboardViewModeSchema,
  updateReportDashboardSchema,
} from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse,
  PaginationQuery,
  commonErrorResponses,
  errBody,
  IdParam,
  jsonContent,
  ok,
  okBody,
  okMsg,
  okPaginated,
  validationHook,
} from '../../lib/openapi-schemas';
import { ReportDashboardDTO, ReportDashboardDataDTO, ReportLookupOptionDTO } from '../../lib/openapi-dtos';
import {
  DashboardRevisionConflictError,
  batchSetDashboardStatus,
  cloneDashboard,
  createDashboard,
  deleteDashboard,
  getDashboard,
  getDashboardData,
  listDashboardLookup,
  listDashboards,
  resolveDashboardSnapshotForMode,
  updateDashboardDraft,
} from '../../services/report/report-dashboard.service';
import {
  ensureDashboardExists,
} from '../../services/report/report-dashboard.service';
import {
  offlineDashboard,
  publishDashboard,
} from '../../services/report/report-ops.service';
import type { ReportWidget } from '@zenith/shared';

const router = new OpenAPIHono({ defaultHook: validationHook });

const ConflictResponse = z.object({
  code: z.literal(409),
  message: z.string(),
  data: z.object({
    currentRevision: z.number().int().positive(),
    dashboard: ReportDashboardDTO,
  }),
});

const ListQuery = PaginationQuery.extend({
  keyword: z.string().optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
  lifecycleStatus: reportDashboardLifecycleStatusSchema.optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  favorited: z.coerce.boolean().optional(),
});

const ViewQuery = z.object({
  mode: reportDashboardViewModeSchema.optional(),
});

const DataQuery = z.object({
  mode: reportDashboardViewModeSchema.optional(),
});

const BatchQuerySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(50),
  mode: reportDashboardViewModeSchema.optional(),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['报表仪表盘'],
    summary: '仪表盘列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: { query: ListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(ReportDashboardDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDashboards(c.req.valid('query'))), 200),
});

const lookupRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/lookup',
    tags: ['报表仪表盘'],
    summary: '仪表盘轻量下拉',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: { query: reportLookupQuerySchema.extend({ excludeId: z.coerce.number().int().positive().optional() }) },
    responses: { ...commonErrorResponses, ...ok(z.array(ReportLookupOptionDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDashboardLookup(c.req.valid('query'))), 200),
});

const batchRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/batch',
    tags: ['报表仪表盘'],
    summary: '批量获取仪表盘详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: { body: { content: jsonContent(BatchQuerySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(z.array(ReportDashboardDTO), 'ok') },
  }),
  handler: async (c) => {
    const body = c.req.valid('json');
    const list = await Promise.all(body.ids.map((id) => getDashboard(id, {
      mode: body.mode ?? 'auto',
      allowOfflinePublished: true,
    })));
    return c.json(okBody(list), 200);
  },
});

const batchStatusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/batch-status',
    tags: ['报表仪表盘'],
    summary: '批量启停仪表盘',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '批量更新报表仪表盘状态', module: '报表仪表盘' } })] as const,
    request: { body: { content: jsonContent(reportBatchStatusSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已更新') },
  }),
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    const count = await batchSetDashboardStatus(ids, status);
    return c.json(okBody(null, `已更新 ${count} 个仪表盘状态`), 200);
  },
});

const dataRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/data',
    tags: ['报表仪表盘'],
    summary: '仪表盘批量取数',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: {
      params: IdParam,
      query: DataQuery,
      body: { content: jsonContent(reportDashboardDataBodySchema), required: false },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(ReportDashboardDataDTO, '批量取数结果'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const mode = c.req.valid('query').mode ?? 'auto';
    const dash = await ensureDashboardExists(id);
    const snapshot = await resolveDashboardSnapshotForMode(dash, mode, { allowOfflinePublished: true });
    const data = await getDashboardData(
      (snapshot.widgets ?? []) as ReportWidget[],
      (body?.filters ?? {}) as Record<string, unknown>,
      body?.limit,
      body?.widgetQueries,
      id,
    );
    return c.json(okBody(data), 200);
  },
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['报表仪表盘'],
    summary: '仪表盘详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: { params: IdParam, query: ViewQuery },
    responses: {
      ...commonErrorResponses,
      ...ok(ReportDashboardDTO, '详情'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getDashboard(c.req.valid('param').id, {
    mode: c.req.valid('query').mode ?? 'auto',
    allowOfflinePublished: true,
  })), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['报表仪表盘'],
    summary: '创建仪表盘',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:create', audit: { description: '创建报表仪表盘', module: '报表仪表盘' } })] as const,
    request: { body: { content: jsonContent(createReportDashboardSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createDashboard(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['报表仪表盘'],
    summary: '保存仪表盘草稿',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '保存仪表盘草稿', module: '报表仪表盘' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateReportDashboardSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(ReportDashboardDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
      409: { content: jsonContent(ConflictResponse), description: '版本冲突' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDashboardExists(id);
    setAuditBeforeData(c, before);
    try {
      return c.json(okBody(await updateDashboardDraft(id, c.req.valid('json')), '更新成功'), 200);
    } catch (err) {
      if (err instanceof DashboardRevisionConflictError) {
        return c.json({
          ...errBody(err.message, 409),
          data: {
            currentRevision: err.currentRevision,
            dashboard: err.currentDashboard,
          },
        }, 409);
      }
      throw err;
    }
  },
});

const publishRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/publish',
    tags: ['报表仪表盘'],
    summary: '发布仪表盘',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '发布报表仪表盘', module: '报表仪表盘' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(reportDashboardLifecycleActionSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(ReportDashboardDTO, '发布成功'),
      409: { content: jsonContent(ConflictResponse), description: '版本冲突' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDashboardExists(id);
    setAuditBeforeData(c, before);
    try {
      return c.json(okBody(await publishDashboard(id, c.req.valid('json')), '发布成功'), 200);
    } catch (err) {
      if (err instanceof DashboardRevisionConflictError) {
        return c.json({
          ...errBody(err.message, 409),
          data: { currentRevision: err.currentRevision, dashboard: err.currentDashboard },
        }, 409);
      }
      throw err;
    }
  },
});

const offlineRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/offline',
    tags: ['报表仪表盘'],
    summary: '下线仪表盘',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '下线报表仪表盘', module: '报表仪表盘' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(reportDashboardLifecycleActionSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(ReportDashboardDTO, '下线成功'),
      409: { content: jsonContent(ConflictResponse), description: '版本冲突' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDashboardExists(id);
    setAuditBeforeData(c, before);
    try {
      return c.json(okBody(await offlineDashboard(id, c.req.valid('json')), '下线成功'), 200);
    } catch (err) {
      if (err instanceof DashboardRevisionConflictError) {
        return c.json({
          ...errBody(err.message, 409),
          data: { currentRevision: err.currentRevision, dashboard: err.currentDashboard },
        }, 409);
      }
      throw err;
    }
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['报表仪表盘'],
    summary: '删除仪表盘',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:delete', audit: { description: '删除报表仪表盘', module: '报表仪表盘' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDashboardExists(id);
    setAuditBeforeData(c, before);
    await deleteDashboard(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const cloneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/clone',
    tags: ['报表仪表盘'],
    summary: '复制仪表盘',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:create', audit: { description: '复制报表仪表盘', module: '报表仪表盘' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(reportCloneSchema), required: false } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardDTO, '复制成功') },
  }),
  handler: async (c) => c.json(okBody(await cloneDashboard(c.req.valid('param').id, c.req.valid('json')), '复制成功'), 200),
});

router.openapiRoutes([
  listRoute,
  lookupRoute,
  batchRoute,
  batchStatusRoute,
  dataRoute,
  getOneRoute,
  createRoute_,
  updateRoute_,
  publishRoute,
  offlineRoute,
  deleteRoute_,
  cloneRoute,
] as const);

export default router;
