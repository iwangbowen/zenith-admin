import { OpenAPIHono } from '@hono/zod-openapi';
import { exportJobContract } from '@zenith/shared/tasks';
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
import { getClientIp } from '../../lib/request-helpers';
import { attachmentDisposition } from '../../lib/content-disposition';
import { mountCrud } from '../_crud';

const exportJobsRoute = new OpenAPIHono({ defaultHook: validationHook });

const entitiesRoute = defineContractRoute(exportJobContract.entities, {
  handler: async (c) => c.json(okBody(await listExportEntities()), 200),
});

const downloadRoute = defineContractRoute(exportJobContract.download, {
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
  handler: async (c) => c.json(okBody(await listExportJobDownloads(c.req.valid('param').id)), 200),
});

const cancelRoute = defineContractRoute(exportJobContract.cancel, {
  handler: async (c) => c.json(okBody(await cancelExportJob(c.req.valid('param').id), '已取消'), 200),
});

const retryRoute = defineContractRoute(exportJobContract.retry, {
  handler: async (c) => c.json(okBody(await retryExportJob(c.req.valid('param').id), '已重试'), 200),
});

mountCrud(exportJobsRoute, exportJobContract,
  { list: listExportJobs, get: getExportJob, create: createExportJob, remove: deleteExportJob },
  {
    messages: { create: '导出任务已创建', remove: '已删除' },
  },
  [entitiesRoute, downloadRoute, downloadsRoute, cancelRoute, retryRoute],
);

export default exportJobsRoute;
