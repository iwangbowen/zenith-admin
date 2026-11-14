/**
 * 数据导入中心。
 * 历史/进度/行级明细复用任务中心接口（taskType 'data-import'）。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { importJobContract } from '@zenith/shared/tasks';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { mapAsyncTask } from '../../lib/task-center/map';
import { getAsyncTask } from '../../services/tasks/async-tasks.service';
import { confirmImportPreview, getImportTemplate, inspectImportFile, listImportEntities, submitImportJob } from '../../services/tasks/import-jobs.service';
import { attachmentDisposition } from '../../lib/content-disposition';

const importJobsRoute = new OpenAPIHono({ defaultHook: validationHook });

const entitiesRoute = defineContractRoute(importJobContract.entities, {
  handler: async (c) => c.json(okBody(await listImportEntities()), 200),
});

const templateRoute = defineContractRoute(importJobContract.template, {
  handler: async (c) => {
    const { entity } = c.req.valid('param');
    const { buffer, filename } = await getImportTemplate(entity);
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': attachmentDisposition(filename),
        'X-Content-Type-Options': 'nosniff',
      },
    }) as never;
  },
});

const submitRoute = defineContractRoute(importJobContract.submit, {
  handler: async (c) => {
    const { entity, fileId, dryRun, context, fieldMapping, duplicateMode } = c.req.valid('json');
    const row = await submitImportJob(entity, fileId, { dryRun, context, fieldMapping, duplicateMode });
    return c.json(okBody(mapAsyncTask(row), dryRun ? '预检任务已提交（不落库）' : '导入任务已提交，可在任务中心查看进度与行级明细'), 200);
  },
});

const inspectRoute = defineContractRoute(importJobContract.inspect, {
  handler: async (c) => {
    const { entity, fileId, context } = c.req.valid('json');
    return c.json(okBody(await inspectImportFile(entity, fileId, context)), 200);
  },
});

const confirmRoute = defineContractRoute(importJobContract.confirm, {
  handler: async (c) => c.json(okBody(mapAsyncTask(await confirmImportPreview(c.req.valid('param').id)), '正式导入任务已提交'), 200),
});

const errorFileRoute = defineContractRoute(importJobContract.errorFile, {
  handler: async (c) => {
    const task = await getAsyncTask(c.req.valid('param').id);
    const errorFileId = typeof task.result?.errorFileId === 'string' ? task.result.errorFileId : null;
    if (!errorFileId) return new Response('错误文件不存在', { status: 404 });
    const { readGeneratedManagedFile } = await import('../../services/files/files.service');
    const stored = await readGeneratedManagedFile(errorFileId, task.tenantId);
    return new Response(stored.stream, { headers: { 'Content-Type': stored.contentType ?? 'application/octet-stream', 'Content-Disposition': attachmentDisposition(String(task.result?.errorFileName ?? '导入错误行.xlsx')), 'X-Content-Type-Options': 'nosniff' } });
  },
});

importJobsRoute.openapiRoutes([entitiesRoute, templateRoute, inspectRoute, submitRoute, confirmRoute, errorFileRoute] as const);

export default importJobsRoute;
