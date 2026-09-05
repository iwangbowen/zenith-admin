/**
 * 数据导入中心。
 * 历史/进度/行级明细复用任务中心接口（taskType 'data-import'）。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { importJobContract } from '@zenith/shared/tasks';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { mapAsyncTask } from '../../lib/task-center/map';
import { registerImportDefinitions } from '../../lib/import-center/definitions';
import { getImportTemplate, listImportEntities, submitImportJob } from '../../services/tasks/import-jobs.service';

registerImportDefinitions();

const importJobsRoute = new OpenAPIHono({ defaultHook: validationHook });

const entitiesRoute = defineContractRoute(importJobContract.entities, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listImportEntities()), 200),
});

const templateRoute = defineContractRoute(importJobContract.template, {
  middleware: [authMiddleware],
  handler: async (c) => {
    const { entity } = c.req.valid('param');
    const { buffer, filename } = await getImportTemplate(entity);
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'X-Content-Type-Options': 'nosniff',
      },
    }) as never;
  },
});

const submitRoute = defineContractRoute(importJobContract.submit, {
  middleware: [authMiddleware, guard({ audit: { description: '提交数据导入任务', module: '导入中心' } })],
  handler: async (c) => {
    const { entity, fileId, dryRun, context } = c.req.valid('json');
    const row = await submitImportJob(entity, fileId, { dryRun, context });
    return c.json(okBody(mapAsyncTask(row), dryRun ? '预检任务已提交（不落库）' : '导入任务已提交，可在任务中心查看进度与行级明细'), 200);
  },
});

importJobsRoute.openapiRoutes([entitiesRoute, templateRoute, submitRoute] as const);

export default importJobsRoute;
