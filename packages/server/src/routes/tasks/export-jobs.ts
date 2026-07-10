import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createExportJobSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { commonErrorResponses, IdParam, jsonContent, ok, okBody, okFile, okMsg, okPaginated, PaginationQuery, validationHook } from '../../lib/openapi-schemas';
import { ExportEntityMetaDTO, ExportJobCreateResultDTO, ExportJobDTO, ExportJobDownloadDTO } from '../../lib/openapi-dtos';
import {
  cancelExportJob,
  createExportJob,
  deleteExportJob,
  getExportJob,
  getExportJobDownload,
  listExportEntities,
  listExportJobDownloads,
  listExportJobs,
  retryExportJob,
} from '../../services/tasks/export-jobs.service';
import { registerExportDefinitions } from '../../lib/export-center/definitions';
import { getClientIp } from '../../lib/request-helpers';

registerExportDefinitions();

const exportJobsRoute = new OpenAPIHono({ defaultHook: validationHook });

const ExportJobStatusQuery = z.enum(['pending', 'running', 'success', 'failed', 'cancelled', 'expired']);
const ExportJobFormatQuery = z.enum(['xlsx', 'csv', 'pdf']);

const entitiesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/entities', tags: ['ExportJobs'], summary: '可导出实体列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(ExportEntityMetaDTO), '可导出实体') },
  }),
  handler: async (c) => c.json(okBody(await listExportEntities()), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['ExportJobs'], summary: '创建导出任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ audit: { description: '创建导出任务', module: '导出中心', recordResponseBody: false } })] as const,
    request: { body: { content: jsonContent(createExportJobSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ExportJobCreateResultDTO, '导出任务创建结果') },
  }),
  handler: async (c) => c.json(okBody(await createExportJob(c.req.valid('json')), '导出任务已创建'), 200),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['ExportJobs'], summary: '导出任务列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      query: PaginationQuery.extend({
        entity: z.string().optional(),
        status: ExportJobStatusQuery.optional(),
        format: ExportJobFormatQuery.optional(),
        keyword: z.string().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(ExportJobDTO, '导出任务列表') },
  }),
  handler: async (c) => c.json(okBody(await listExportJobs(c.req.valid('query'))), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['ExportJobs'], summary: '导出任务详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(ExportJobDTO, '导出任务详情') },
  }),
  handler: async (c) => c.json(okBody(await getExportJob(c.req.valid('param').id)), 200),
});

const downloadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/download', tags: ['ExportJobs'], summary: '下载导出文件',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ audit: { description: '下载导出文件', module: '导出中心', recordResponseBody: false } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okFile('导出文件') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const file = await getExportJobDownload(id, {
      ip: getClientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
    });
    return new Response(file.stream, {
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': String(file.size),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        'X-Content-Type-Options': 'nosniff',
      },
    }) as never;
  },
});

const downloadsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/downloads', tags: ['ExportJobs'], summary: '导出任务下载日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(ExportJobDownloadDTO), '下载日志') },
  }),
  handler: async (c) => c.json(okBody(await listExportJobDownloads(c.req.valid('param').id)), 200),
});

const cancelRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/cancel', tags: ['ExportJobs'], summary: '取消导出任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ audit: { description: '取消导出任务', module: '导出中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(ExportJobDTO, '已取消') },
  }),
  handler: async (c) => c.json(okBody(await cancelExportJob(c.req.valid('param').id), '已取消'), 200),
});

const retryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/retry', tags: ['ExportJobs'], summary: '重试导出任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ audit: { description: '重试导出任务', module: '导出中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(ExportJobDTO, '已重试') },
  }),
  handler: async (c) => c.json(okBody(await retryExportJob(c.req.valid('param').id), '已重试'), 200),
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['ExportJobs'], summary: '删除导出任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ audit: { description: '删除导出任务', module: '导出中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已删除') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getExportJob(id);
    setAuditBeforeData(c, before);
    await deleteExportJob(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

exportJobsRoute.openapiRoutes([entitiesRoute, createRouteDef, listRoute, getOneRoute, downloadRoute, downloadsRoute, cancelRoute, retryRoute, deleteRoute] as const);

export default exportJobsRoute;
