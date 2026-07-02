import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  commonErrorResponses, IdParam, ok, okMsg, okPaginated,
  okBody, PaginationQuery, validationHook,
} from '../lib/openapi-schemas';
import { AsyncTaskCleanupResultDTO, AsyncTaskDTO, AsyncTaskTypeMetaDTO } from '../lib/openapi-dtos';
import {
  cancelTask,
  cleanupFinishedTasks,
  deleteAsyncTask,
  getAsyncTask,
  listAsyncTasks,
  listAsyncTaskTypes,
  listMyAsyncTasks,
  restartTask,
  resumeTask,
} from '../services/async-tasks.service';

const asyncTasksRoute = new OpenAPIHono({ defaultHook: validationHook });

const AsyncTaskStatusQuery = z.enum(['pending', 'running', 'success', 'failed', 'cancelled']);

const ListQuery = PaginationQuery.extend({
  taskType: z.string().optional(),
  status: AsyncTaskStatusQuery.optional(),
  keyword: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

const typesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/types', tags: ['AsyncTasks'], summary: '已注册的任务类型',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(AsyncTaskTypeMetaDTO), '任务类型列表') },
  }),
  handler: (c) => c.json(okBody(listAsyncTaskTypes()), 200),
});

const mineRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/mine', tags: ['AsyncTasks'], summary: '我的任务列表（业务页面进度展示）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { query: ListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(AsyncTaskDTO, '我的任务列表') },
  }),
  handler: async (c) => c.json(okBody(await listMyAsyncTasks(c.req.valid('query'))), 200),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['AsyncTasks'], summary: '全局任务列表（任务中心）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:async-task:list' })] as const,
    request: { query: ListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(AsyncTaskDTO, '任务列表') },
  }),
  handler: async (c) => c.json(okBody(await listAsyncTasks(c.req.valid('query'))), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['AsyncTasks'], summary: '任务详情（创建者本人或管理员）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '任务详情') },
  }),
  handler: async (c) => c.json(okBody(await getAsyncTask(c.req.valid('param').id)), 200),
});

const cancelRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/cancel', tags: ['AsyncTasks'], summary: '取消任务（执行中为协作式取消）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ audit: { description: '取消异步任务', module: '任务中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '已请求取消') },
  }),
  handler: async (c) => c.json(okBody(await cancelTask(c.req.valid('param').id), '已请求取消'), 200),
});

const resumeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/resume', tags: ['AsyncTasks'], summary: '断点恢复（保留进度从中断处继续）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ audit: { description: '断点恢复异步任务', module: '任务中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '已重新入队') },
  }),
  handler: async (c) => c.json(okBody(await resumeTask(c.req.valid('param').id), '已从断点恢复'), 200),
});

const restartRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/restart', tags: ['AsyncTasks'], summary: '重新开始（清空进度从头执行）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ audit: { description: '重新开始异步任务', module: '任务中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '已重新开始') },
  }),
  handler: async (c) => c.json(okBody(await restartTask(c.req.valid('param').id), '已重新开始'), 200),
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['AsyncTasks'], summary: '删除任务记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:async-task:manage', audit: { description: '删除异步任务', module: '任务中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已删除') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await deleteAsyncTask(id);
    setAuditBeforeData(c, before);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const cleanupRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/cleanup', tags: ['AsyncTasks'], summary: '立即清理超过保留期的已结束任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:async-task:cleanup', audit: { description: '清理异步任务记录', module: '任务中心' } })] as const,
    responses: { ...commonErrorResponses, ...ok(AsyncTaskCleanupResultDTO, '清理结果') },
  }),
  handler: async (c) => {
    const result = await cleanupFinishedTasks();
    return c.json(okBody(result, `已清理 ${result.cleaned} 条任务记录`), 200);
  },
});

asyncTasksRoute.openapiRoutes([
  typesRoute, mineRoute, listRoute, cleanupRoute, getOneRoute,
  cancelRoute, resumeRoute, restartRoute, deleteRoute,
] as const);

export default asyncTasksRoute;
