import { OpenAPIHono } from '@hono/zod-openapi';
import { exportJobContract } from '@zenith/shared/tasks';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
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
import { attachmentDisposition } from '../../lib/content-disposition';

registerExportDefinitions();

const exportJobsRoute = new OpenAPIHono({ defaultHook: validationHook });

const entitiesRoute = defineContractRoute(exportJobContract.entities, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listExportEntities()), 200),
});

const createRouteDef = defineContractRoute(exportJobContract.create, {
  middleware: [authMiddleware, guard({ audit: { description: '创建导出任务', module: '导出中心', recordResponseBody: false } })],
  handler: async (c) => c.json(okBody(await createExportJob(c.req.valid('json')), '导出任务已创建'), 200),
});

const listRoute = defineContractRoute(exportJobContract.list, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listExportJobs(c.req.valid('query'))), 200),
});

const getOneRoute = defineContractRoute(exportJobContract.detail, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await getExportJob(c.req.valid('param').id)), 200),
});

const downloadRoute = defineContractRoute(exportJobContract.download, {
  middleware: [authMiddleware, guard({ audit: { description: '下载导出文件', module: '导出中心', recordResponseBody: false } })],
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
        'Content-Disposition': attachmentDisposition(file.filename),
        'X-Content-Type-Options': 'nosniff',
      },
    }) as never;
  },
});

const downloadsRoute = defineContractRoute(exportJobContract.downloads, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listExportJobDownloads(c.req.valid('param').id)), 200),
});

const cancelRoute = defineContractRoute(exportJobContract.cancel, {
  middleware: [authMiddleware, guard({ audit: { description: '取消导出任务', module: '导出中心' } })],
  handler: async (c) => c.json(okBody(await cancelExportJob(c.req.valid('param').id), '已取消'), 200),
});

const retryRoute = defineContractRoute(exportJobContract.retry, {
  middleware: [authMiddleware, guard({ audit: { description: '重试导出任务', module: '导出中心' } })],
  handler: async (c) => c.json(okBody(await retryExportJob(c.req.valid('param').id), '已重试'), 200),
});

const deleteRoute = defineContractRoute(exportJobContract.remove, {
  middleware: [authMiddleware, guard({ audit: { description: '删除导出任务', module: '导出中心' } })],
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
