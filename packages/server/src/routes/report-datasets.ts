import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createReportDatasetSchema, updateReportDatasetSchema, reportDatasetPreviewSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { ReportDatasetDTO, ReportDataResultDTO } from '../lib/openapi-dtos';
import {
  listDatasets, getDataset, createDataset, updateDataset, deleteDataset,
  ensureDatasetExists, previewDataset, getDatasetData,
} from '../services/report-dataset.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['报表数据集'], summary: '数据集列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        datasourceId: z.coerce.number().int().positive().optional(),
        type: z.enum(['api', 'sql']).optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(ReportDatasetDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDatasets(c.req.valid('query'))), 200),
});

// 试跑预览（不落库）—— 放在 /{id} 之前
const previewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/preview',
    tags: ['报表数据集'], summary: '试跑预览（不落库）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })] as const,
    request: { body: { content: jsonContent(reportDatasetPreviewSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDataResultDTO, '取数结果') },
  }),
  handler: async (c) => c.json(okBody(await previewDataset(c.req.valid('json'))), 200),
});

const dataRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/data',
    tags: ['报表数据集'], summary: '取数据集数据',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })] as const,
    request: { params: IdParam, query: z.object({ limit: z.coerce.number().int().min(1).max(5000).optional() }) },
    responses: { ...commonErrorResponses, ...ok(ReportDataResultDTO, '取数结果'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { limit } = c.req.valid('query');
    return c.json(okBody(await getDatasetData(id, limit)), 200);
  },
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['报表数据集'], summary: '数据集详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(ReportDatasetDTO, '详情'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await getDataset(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['报表数据集'], summary: '创建数据集',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:create', audit: { description: '创建报表数据集', module: '报表数据集' } })] as const,
    request: { body: { content: jsonContent(createReportDatasetSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDatasetDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createDataset(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['报表数据集'], summary: '更新数据集',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:update', audit: { description: '更新报表数据集', module: '报表数据集' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateReportDatasetSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDatasetDTO, '更新成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDatasetExists(id);
    setAuditBeforeData(c, before);
    return c.json(okBody(await updateDataset(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['报表数据集'], summary: '删除数据集',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:delete', audit: { description: '删除报表数据集', module: '报表数据集' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDatasetExists(id);
    setAuditBeforeData(c, before);
    await deleteDataset(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([
  listRoute, previewRoute, dataRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_,
] as const);

export default router;
