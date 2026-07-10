import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import {
  createReportDatasetSchema,
  updateReportDatasetSchema,
  reportBatchStatusSchema,
  reportCloneSchema,
  reportDatasetPreviewSchema,
  reportDatasetDataBodySchema,
  reportDatasourceTypeSchema,
  reportLookupQuerySchema,
} from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody, errBody,
} from '../../lib/openapi-schemas';
import { AsyncTaskDTO, ReportDatasetDTO, ReportDataResultDTO, ReportDatasetRefsDTO, ReportLookupOptionDTO } from '../../lib/openapi-dtos';
import {
  listDatasets, getDataset, createDataset, updateDataset, deleteDataset,
  ensureDatasetExists, previewDataset, getDatasetData, collectDatasetRefs,
  batchSetDatasetStatus, cloneDataset, listDatasetLookup,
} from '../../services/report/report-dataset.service';
import { submitDatasetMaterializeTask } from '../../services/report/report-dataset-tasks';
import { parseDataFile } from '../../lib/report-file-parse';

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
        type: reportDatasourceTypeSchema.optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(ReportDatasetDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDatasets(c.req.valid('query'))), 200),
});

const lookupRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/lookup',
    tags: ['报表数据集'], summary: '数据集轻量下拉',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })] as const,
    request: { query: reportLookupQuerySchema },
    responses: { ...commonErrorResponses, ...ok(z.array(ReportLookupOptionDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDatasetLookup(c.req.valid('query'))), 200),
});

// 试跑预览（不落库）—— 放在 /{id} 之前
const previewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/preview',
    tags: ['报表数据集'], summary: '试跑预览（不落库）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: ['report:dataset:create', 'report:dataset:update'] })] as const,
    request: { body: { content: jsonContent(reportDatasetPreviewSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDataResultDTO, '取数结果') },
  }),
  handler: async (c) => c.json(okBody(await previewDataset(c.req.valid('json'))), 200),
});

const dataRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/data',
    tags: ['报表数据集'], summary: '取数据集数据（带参数）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })] as const,
    request: { params: IdParam, body: { content: jsonContent(reportDatasetDataBodySchema), required: false } },
    responses: { ...commonErrorResponses, ...ok(ReportDataResultDTO, '取数结果'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await getDatasetData(id, body?.params, body ?? undefined, { scene: 'dataset', sourceRefId: id })), 200);
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

const batchStatusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/batch-status',
    tags: ['报表数据集'], summary: '批量启停数据集',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:update', audit: { description: '批量更新报表数据集状态', module: '报表数据集' } })] as const,
    request: { body: { content: jsonContent(reportBatchStatusSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已更新') },
  }),
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    const count = await batchSetDatasetStatus(ids, status);
    return c.json(okBody(null, `已更新 ${count} 个数据集状态`), 200);
  },
});

const materializeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/materialize',
    tags: ['报表数据集'], summary: '手动刷新物化快照',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:update' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '任务已提交'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await submitDatasetMaterializeTask(id), '任务已提交，可在任务中心查看进度'), 200);
  },
});

const refsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/refs',
    tags: ['报表数据集'], summary: '数据集下游引用（血缘）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(ReportDatasetRefsDTO, '引用明细'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await ensureDatasetExists(id);
    return c.json(okBody(await collectDatasetRefs(id)), 200);
  },
});

const cloneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/clone',
    tags: ['报表数据集'], summary: '复制数据集',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:create', audit: { description: '复制报表数据集', module: '报表数据集' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(reportCloneSchema), required: false } },
    responses: { ...commonErrorResponses, ...ok(ReportDatasetDTO, '复制成功') },
  }),
  handler: async (c) => c.json(okBody(await cloneDataset(c.req.valid('param').id, c.req.valid('json')), '复制成功'), 200),
});

router.openapiRoutes([
  listRoute, lookupRoute, previewRoute, dataRoute, batchStatusRoute, materializeRoute, refsRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_, cloneRoute,
] as const);

// 文件数据集解析（Excel/CSV 上传 → {columns,rows}）—— multipart，使用原生路由
router.post('/parse-file', authMiddleware, guard({ permission: 'report:dataset:create' }), async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json(errBody('请上传文件（字段名 file）', 400), 400);
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await parseDataFile(buffer, file.name);
  return c.json(okBody(result), 200);
});

export default router;
