import { OpenAPIHono } from '@hono/zod-openapi';
import { previewExport } from '../../lib/export-center/preview';
import { exportJobContract, exportPresetContract } from '@zenith/shared/tasks';
import { listExportPresets, createExportPreset, deleteExportPreset } from '../../services/tasks/export-presets.service';
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
exportJobsRoute.openapiRoutes([
  defineContractRoute(exportPresetContract.listPresets, { handler: async c => c.json(okBody(await listExportPresets()), 200) }),
  defineContractRoute(exportPresetContract.createPreset, { handler: async c => c.json(okBody(await createExportPreset(c.req.valid('json'))), 200) }),
  defineContractRoute(exportPresetContract.removePreset, { handler: async c => { await deleteExportPreset(c.req.valid('param').id); return c.json(okBody(null, '已删除'), 200); } }),
]);
const previewRoute = defineContractRoute(exportJobContract.preview, {
  handler: async c => c.json(okBody(await previewExport(c.req.valid('json'))), 200),
});

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
  [entitiesRoute, previewRoute, downloadRoute, downloadsRoute, cancelRoute, retryRoute],
);

export default exportJobsRoute;
