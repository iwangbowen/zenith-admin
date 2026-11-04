import { OpenAPIHono } from '@hono/zod-openapi';
import { taskDemoContract } from '@zenith/shared/tasks';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';

const taskDemoRoute = new OpenAPIHono({ defaultHook: validationHook });

const submitRoute = defineContractRoute(taskDemoContract.submit, {
  handler: async (c) => {
    const { taskType, idempotencyKey, ...payload } = c.req.valid('json');
    const title = taskType === 'demo-batch'
      ? `批量处理演示（${payload.totalItems ?? 100} 条）`
      : '串行阶段演示';
    const row = await submitAsyncTask({ taskType, title, payload, idempotencyKey });
    return c.json(okBody(mapAsyncTask(row), '任务已提交，可在下方列表查看进度'), 200);
  },
});

taskDemoRoute.openapiRoutes([submitRoute] as const);

export default taskDemoRoute;
