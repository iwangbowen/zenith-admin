import { OpenAPIHono } from '@hono/zod-openapi';
import { asyncTaskContract } from '@zenith/shared/tasks';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  batchCancelTasks,
  batchDeleteTasks,
  cancelTask,
  cleanupFinishedTasks,
  deleteAsyncTask,
  getAsyncTask,
  getAsyncTaskStats,
  listAsyncTaskItems,
  listAsyncTaskTypes,
  restartTask,
  resumeTask,
  updateAsyncTaskTypePolicy,
} from '../../services/tasks/async-tasks.service';
import { listAsyncTasks, listMyAsyncTasks } from '../../services/tasks/public/queries';

const asyncTasksRoute = new OpenAPIHono({ defaultHook: validationHook });

const typesRoute = defineContractRoute(asyncTaskContract.types, {
  handler: async (c) => c.json(okBody(await listAsyncTaskTypes()), 200),
});

const updateTypePolicyRoute = defineContractRoute(asyncTaskContract.updateTypePolicy, {
  handler: async (c) => {
    const { taskType } = c.req.valid('param');
    const meta = await updateAsyncTaskTypePolicy(taskType, c.req.valid('json'));
    return c.json(okBody(meta, '策略已更新'), 200);
  },
});

const statsRoute = defineContractRoute(asyncTaskContract.stats, {
  handler: async (c) => c.json(okBody(await getAsyncTaskStats()), 200),
});

const mineRoute = defineContractRoute(asyncTaskContract.mine, {
  handler: async (c) => c.json(okBody(await listMyAsyncTasks(c.req.valid('query'))), 200),
});

const listRoute = defineContractRoute(asyncTaskContract.list, {
  handler: async (c) => c.json(okBody(await listAsyncTasks(c.req.valid('query'))), 200),
});

const getOneRoute = defineContractRoute(asyncTaskContract.detail, {
  handler: async (c) => c.json(okBody(await getAsyncTask(c.req.valid('param').id)), 200),
});

const itemsRoute = defineContractRoute(asyncTaskContract.items, {
  handler: async (c) => c.json(okBody(await listAsyncTaskItems(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const batchCancelRoute = defineContractRoute(asyncTaskContract.batchCancel, {
  handler: async (c) => {
    const result = await batchCancelTasks(c.req.valid('json').ids);
    return c.json(okBody(result, `已请求取消 ${result.affected} 个任务`), 200);
  },
});

const batchDeleteRoute = defineContractRoute(asyncTaskContract.batchDelete, {
  handler: async (c) => {
    const result = await batchDeleteTasks(c.req.valid('json').ids);
    return c.json(okBody(result, `已删除 ${result.affected} 个任务记录`), 200);
  },
});

const cancelRoute = defineContractRoute(asyncTaskContract.cancel, {
  handler: async (c) => c.json(okBody(await cancelTask(c.req.valid('param').id), '已请求取消'), 200),
});

const resumeRoute = defineContractRoute(asyncTaskContract.resume, {
  handler: async (c) => c.json(okBody(await resumeTask(c.req.valid('param').id), '已从断点恢复'), 200),
});

const restartRoute = defineContractRoute(asyncTaskContract.restart, {
  handler: async (c) => c.json(okBody(await restartTask(c.req.valid('param').id), '已重新开始'), 200),
});

const deleteRoute = defineContractRoute(asyncTaskContract.remove, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await deleteAsyncTask(id);
    setAuditBeforeData(c, before);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const cleanupRoute = defineContractRoute(asyncTaskContract.cleanup, {
  handler: async (c) => {
    const result = await cleanupFinishedTasks();
    return c.json(okBody(result, `已清理 ${result.cleaned} 条任务记录`), 200);
  },
});

asyncTasksRoute.openapiRoutes([
  typesRoute, updateTypePolicyRoute, statsRoute, mineRoute, listRoute, cleanupRoute,
  batchCancelRoute, batchDeleteRoute, getOneRoute, itemsRoute,
  cancelRoute, resumeRoute, restartRoute, deleteRoute,
] as const);

export default asyncTasksRoute;
