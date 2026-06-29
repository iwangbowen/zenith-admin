import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../middleware/guard';
import { idempotencyGuard } from '../middleware/idempotency';
import { approveWorkflowTaskSchema, rejectWorkflowTaskSchema, createWorkflowInstanceWithDraftSchema, updateWorkflowInstanceSchema, transferWorkflowTaskSchema, delegateWorkflowTaskSchema, addSignWorkflowTaskSchema, reduceSignWorkflowTaskSchema, returnWorkflowTaskSchema, urgeWorkflowTaskSchema, addInstanceCcSchema, batchApproveWorkflowTaskSchema, batchRejectWorkflowTaskSchema, batchWithdrawWorkflowInstanceSchema, batchUrgeWorkflowInstanceSchema, batchSkipStuckTokensSchema, forwardInstanceSchema, createWorkflowCommentSchema, jumpWorkflowInstanceSchema, reassignWorkflowTaskSchema, createWorkflowConsultSchema, replyWorkflowConsultSchema, recallWorkflowTaskSchema } from '@zenith/shared';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okMsg, okPaginated, IdParam, okBody } from '../lib/openapi-schemas';
import { WorkflowInstanceDTO, WorkflowInstanceListItemDTO, WorkflowInstanceAllDTO, WorkflowRuntimeDiagnosticsDTO, WorkflowInstanceTraceDTO, WorkflowExecutionTokenViewDTO, WorkflowDiagnosticBundleDTO, WorkflowRecoveryBatchResultDTO, WorkflowTaskDTO, WorkflowTaskUrgeDTO, WorkflowCommentDTO, WorkflowBatchActionResponseDTO, WorkflowInstanceBatchActionResponseDTO, WorkflowAnalyticsDTO, WorkflowOverdueTaskDTO, WorkflowTaskConsultDTO, WorkflowRelationOptionDTO } from '../lib/openapi-dtos';
import {
  listMyInstances, listPendingMine, listAllInstances, listMyCc, listMyHandled, getInstanceDetail,
  getInstanceRuntimeDiagnostics, getInstanceTrace, getInstanceExecutionTokens,
  skipStuckToken, replayFromToken, batchSkipStuckTokens, exportInstanceDiagnosticBundle,
  createInstance, withdrawInstance, cancelInstance, deleteInstance, getInstanceForAdminAudit,
  approveTask, rejectTask, getWorkflowInstanceBeforeAudit, getWorkflowTaskBeforeAudit, getWorkflowTaskForAdminAudit,
  transferTask, delegateTask, addSignTask, reduceSignTask, returnTask,
  urgeTask, listTaskUrges, listInstanceUrges, urgeInstance, addInstanceCc,
  updateInstanceDraft, submitDraftInstance, resubmitInstance,
  batchApproveTasks, batchRejectTasks, batchWithdrawInstances, batchUrgeInstances, jumpInstance, reassignTask, recallTask,
  countMyCcUnread, markCcRead, forwardInstance, listRelationOptions,
} from '../services/workflow-instances.service';
import { listInstanceComments, addInstanceComment } from '../services/workflow-comments.service';
import { preflightMigration, migrateInstance, batchMigrate, listMigrations } from '../services/workflow-migrations.service';
import { listCompensations, resolveCompensation } from '../services/workflow-compensations.service';
import { WorkflowMigrationPreflightDTO, WorkflowInstanceMigrationDTO, WorkflowCompensationDTO } from '../lib/openapi-dtos';
import { createConsult, replyConsult, listMyConsults, getConsultInstanceIdForAudit } from '../services/workflow-consults.service';
import { getWorkflowAnalytics, listOverdueTasks } from '../services/workflow-analytics.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const compactAuditData = <T>(items: Array<T | null | undefined>) =>
  items.filter((item): item is T => item != null);

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances', tags: ['WorkflowInstances'], summary: '我的申请列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { query: PaginationQuery.extend({ status: z.string().optional(), priority: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowInstanceDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyInstances(c.req.valid('query'))), 200),
});

const pendingMineRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/pending-mine', tags: ['WorkflowInstances'], summary: '待我审批列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), definitionId: z.coerce.number().int().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowInstanceListItemDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listPendingMine(c.req.valid('query'))), 200),
});

const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/all', tags: ['WorkflowInstances'], summary: '全局流程实例列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { query: PaginationQuery.extend({ status: z.string().optional(), keyword: z.string().optional(), categoryId: z.coerce.number().int().optional(), initiatorKeyword: z.string().optional(), priority: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...ok(WorkflowInstanceAllDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listAllInstances(c.req.valid('query'))), 200),
});

const ccMineRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/cc-mine', tags: ['WorkflowInstances'], summary: '抄送我的列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowInstanceDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyCc(c.req.valid('query'))), 200),
});

const handledMineRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/handled-mine', tags: ['WorkflowInstances'], summary: '我已办列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowInstanceDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyHandled(c.req.valid('query'))), 200),
});

const ccUnreadCountRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/cc-mine/unread-count', tags: ['WorkflowInstances'], summary: '抄送未读数',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.object({ count: z.number().int() }), 'ok') },
  }),
  handler: async (c) => c.json(okBody({ count: await countMyCcUnread() }), 200),
});

const relationOptionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/relation-options', tags: ['WorkflowInstances'], summary: '关联审批单候选',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { query: z.object({ definitionId: z.coerce.number().int().optional(), keyword: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).optional() }) },
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowRelationOptionDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listRelationOptions(c.req.valid('query'))), 200),
});

const ccReadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/cc/{ccTaskId}/read', tags: ['WorkflowInstances'], summary: '标记抄送已读',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { params: z.object({ ccTaskId: z.coerce.number().int().positive() }) },
    responses: { ...commonErrorResponses, ...okMsg('已标记已读') },
  }),
  handler: async (c) => {
    await markCcRead(c.req.valid('param').ccTaskId);
    return c.json(okBody(null, '已标记已读'), 200);
  },
});

const forwardRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/forward', tags: ['WorkflowInstances'], summary: '主动抄送 / 转发',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list', audit: { description: '转发抄送', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(forwardInstanceSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已抄送'), 403: { content: jsonContent(ErrorResponse), description: '无权操作' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { userIds, note } = c.req.valid('json');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await forwardInstance(id, userIds, note);
    const after = await getWorkflowInstanceBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, r.message), 200);
  },
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/{id}', tags: ['WorkflowInstances'], summary: '实例详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, 'ok'),
      403: { content: jsonContent(ErrorResponse), description: '无权查看' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getInstanceDetail(c.req.valid('param').id)), 200),
});

const diagnosticsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/{id}/diagnostics', tags: ['WorkflowInstances'], summary: '实例运行时技术诊断',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowRuntimeDiagnosticsDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在或无权查看' },
    },
  }),
  handler: async (c) => c.json(okBody(await getInstanceRuntimeDiagnostics(c.req.valid('param').id)), 200),
});

const traceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/{id}/trace', tags: ['WorkflowInstances'], summary: '实例运行轨迹与引擎解释',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceTraceDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在或无权查看' },
    },
  }),
  handler: async (c) => c.json(okBody(await getInstanceTrace(c.req.valid('param').id)), 200),
});

const tokensRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/{id}/tokens', tags: ['WorkflowInstances'], summary: '实例显式执行 Token（执行树/活动路径）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowExecutionTokenViewDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在或无权查看' },
    },
  }),
  handler: async (c) => c.json(okBody(await getInstanceExecutionTokens(c.req.valid('param').id)), 200),
});

const TokenOpBody = z.object({ reason: z.string().max(255).optional() });

const tokenSkipRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/tokens/{id}/skip', tags: ['WorkflowInstances'], summary: '跳过卡死的执行 Token',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor', audit: { description: '跳过卡死执行 Token', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(TokenOpBody), required: false } },
    responses: { ...commonErrorResponses, ...ok(WorkflowInstanceDTO, '已跳过'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await skipStuckToken(c.req.valid('param').id, c.req.valid('json')?.reason), '已跳过并推进'), 200),
});

const tokenReplayRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/tokens/{id}/replay', tags: ['WorkflowInstances'], summary: '从执行 Token 节点重放流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:cancel', audit: { description: '从执行 Token 重放流程', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(TokenOpBody), required: false } },
    responses: { ...commonErrorResponses, ...ok(WorkflowInstanceDTO, '已重放'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await replayFromToken(c.req.valid('param').id, c.req.valid('json')?.reason), '已从该节点重放'), 200),
});

const batchSkipStuckRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/batch-skip-stuck', tags: ['WorkflowInstances'], summary: '批量推进卡在指定节点的实例',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor', audit: { description: '批量推进卡死实例', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(batchSkipStuckTokensSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowRecoveryBatchResultDTO, '批量恢复结果') },
  }),
  handler: async (c) => {
    const body = c.req.valid('json');
    const res = await batchSkipStuckTokens(body);
    return c.json(okBody(res, `已推进 ${res.success}/${res.total} 个实例`), 200);
  },
});

const diagnosticBundleRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/{id}/diagnostic-bundle', tags: ['WorkflowInstances'], summary: '导出实例诊断包',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowDiagnosticBundleDTO, 'ok'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await exportInstanceDiagnosticBundle(c.req.valid('param').id)), 200),
});

const createInstanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances', tags: ['WorkflowInstances'], summary: '发起流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '发起流程申请', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(createWorkflowInstanceWithDraftSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '申请已提交'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '流程定义不存在' },
    },
  }),
  handler: async (c) => {
    const body = c.req.valid('json');
    const r = await createInstance(body);
    return c.json(okBody(r, body.asDraft ? '草稿已保存' : '申请已提交'), 200);
  },
});

const withdrawRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/withdraw', tags: ['WorkflowInstances'], summary: '撤回申请',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '撤回流程申请', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已撤回'),
      400: { content: jsonContent(ErrorResponse), description: '不能撤回' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await withdrawInstance(id);
    return c.json(okBody(r, '已撤回'), 200);
  },
});

const cancelInstanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/cancel', tags: ['WorkflowInstances'], summary: '取消流程（管理员强制终止）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:cancel', audit: { description: '取消流程', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已取消'),
      400: { content: jsonContent(ErrorResponse), description: '不能取消' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await cancelInstance(id);
    return c.json(okBody(r, '已取消'), 200);
  },
});

const deleteInstanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/instances/{id}', tags: ['WorkflowInstances'], summary: '删除流程实例',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:delete', audit: { description: '删除流程实例', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('已删除'),
      400: { content: jsonContent(ErrorResponse), description: '不能删除' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteInstance(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const approveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/approve', tags: ['WorkflowInstances'], summary: '审批通过',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '审批通过', module: '工作流管理' } })] as const,
    request: {
      params: z.object({ taskId: z.coerce.number().openapi({ param: { name: 'taskId', in: 'path' }, example: 1 }) }),
      body: { content: jsonContent(approveWorkflowTaskSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, 'ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
      500: { content: jsonContent(ErrorResponse), description: '数据异常' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { comment, attachments, selectedNextApprovers, signature } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const result = await approveTask(taskId, comment, attachments, selectedNextApprovers, signature);
    return c.json(okBody(result.instance, result.message), 200);
  },
});

const rejectRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/reject', tags: ['WorkflowInstances'], summary: '审批驳回',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '审批驳回', module: '工作流管理' } })] as const,
    request: {
      params: z.object({ taskId: z.coerce.number().openapi({ param: { name: 'taskId', in: 'path' }, example: 1 }) }),
      body: { content: jsonContent(rejectWorkflowTaskSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已驳回'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
      500: { content: jsonContent(ErrorResponse), description: '数据异常' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { comment } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await rejectTask(taskId, comment);
    return c.json(okBody(r.instance, r.message), 200);
  },
});

const taskIdParam = z.object({ taskId: z.coerce.number().openapi({ param: { name: 'taskId', in: 'path' }, example: 1 }) });

const transferRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/transfer', tags: ['WorkflowInstances'], summary: '转办',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '转办任务', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(transferWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowTaskDTO, '已转办'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserId, comment } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await transferTask(taskId, targetUserId, comment);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(r, '已转办'), 200);
  },
});

const delegateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/delegate', tags: ['WorkflowInstances'], summary: '委派',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '委派任务', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(delegateWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowTaskDTO, '已委派'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserId, comment } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await delegateTask(taskId, targetUserId, comment);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(r, '已委派'), 200);
  },
});

const addSignRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/add-sign', tags: ['WorkflowInstances'], summary: '加签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '加签任务', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(addSignWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('已加签'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserIds, position, comment, signMode } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await addSignTask(taskId, targetUserIds, position, comment, signMode);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, r.message), 200);
  },
});

const reduceSignRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/reduce-sign', tags: ['WorkflowInstances'], summary: '减签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '减签任务', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(reduceSignWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('已减签'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetTaskIds, comment } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await reduceSignTask(taskId, targetTaskIds, comment);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, r.message), 200);
  },
});

const returnRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/return', tags: ['WorkflowInstances'], summary: '退回',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '退回任务', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(returnWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已退回'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetNodeKeys, comment } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await returnTask(taskId, targetNodeKeys, comment);
    return c.json(okBody(r.instance, r.message), 200);
  },
});

const urgeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/urge', tags: ['WorkflowInstances'], summary: '催办',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '催办任务', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(urgeWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowTaskUrgeDTO, '已催办'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
      429: { content: jsonContent(ErrorResponse), description: '催办过于频繁' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { message } = c.req.valid('json');
    const r = await urgeTask(taskId, message);
    return c.json(okBody(r, '已催办'), 200);
  },
});

const listTaskUrgesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/tasks/{taskId}/urges', tags: ['WorkflowInstances'], summary: '查询任务催办历史',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { params: taskIdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowTaskUrgeDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listTaskUrges(c.req.valid('param').taskId)), 200),
});

const listInstanceUrgesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/{id}/urges', tags: ['WorkflowInstances'], summary: '查询实例催办历史',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowTaskUrgeDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listInstanceUrges(c.req.valid('param').id)), 200),
});

const urgeInstanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/urge', tags: ['WorkflowInstances'], summary: '实例批量催办',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '实例批量催办', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(urgeWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(WorkflowTaskUrgeDTO), '已催办'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { message } = c.req.valid('json');
    const r = await urgeInstance(id, message);
    return c.json(okBody(r.list, r.message), 200);
  },
});

const addInstanceCcRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/cc/add', tags: ['WorkflowInstances'], summary: '运行中动态补加抄送',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '动态补加抄送', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(addInstanceCcSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(WorkflowTaskDTO), '已补加抄送'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { nodeKey, userIds } = c.req.valid('json');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await addInstanceCc(id, nodeKey, userIds);
    const after = await getWorkflowInstanceBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(r.list, r.message), 200);
  },
});

const analyticsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/analytics', tags: ['WorkflowInstances'], summary: '流程数据分析',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { query: z.object({ definitionId: z.coerce.number().int().optional() }) },
    responses: { ...commonErrorResponses, ...ok(WorkflowAnalyticsDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getWorkflowAnalytics(c.req.valid('query'))), 200),
});

const overdueRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/overdue', tags: ['WorkflowInstances'], summary: '超时待办预警列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { query: PaginationQuery.extend({ definitionId: z.coerce.number().int().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowOverdueTaskDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listOverdueTasks(c.req.valid('query'))), 200),
});

const listCommentsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/{id}/comments', tags: ['WorkflowInstances'], summary: '流程评论列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowCommentDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listInstanceComments(c.req.valid('param').id)), 200),
});

const addCommentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/comments', tags: ['WorkflowInstances'], summary: '发表流程评论',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list', audit: { description: '发表流程评论', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(createWorkflowCommentSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowCommentDTO, '已评论'),
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await addInstanceComment(c.req.valid('param').id, c.req.valid('json')), '已评论'), 200),
});

const updateDraftRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/instances/{id}/draft', tags: ['WorkflowInstances'], summary: '编辑草稿',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '编辑流程草稿', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateWorkflowInstanceSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '草稿已保存'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateInstanceDraft(id, c.req.valid('json')), '草稿已保存'), 200);
  },
});

const submitDraftRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/submit', tags: ['WorkflowInstances'], summary: '提交草稿',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '提交流程草稿', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '申请已提交'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await submitDraftInstance(id), '申请已提交'), 200);
  },
});

const resubmitRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/resubmit', tags: ['WorkflowInstances'], summary: '重新提交（克隆为草稿）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '重新提交流程', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已生成草稿'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await resubmitInstance(id), '已生成草稿'), 200);
  },
});

const batchApproveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/batch-approve', tags: ['WorkflowInstances'], summary: '批量审批通过',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '批量审批通过', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(batchApproveWorkflowTaskSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowBatchActionResponseDTO, '批量处理完成') },
  }),
  handler: async (c) => {
    const { taskIds, comment } = c.req.valid('json');
    const before = compactAuditData(await Promise.all(taskIds.map((id) => getWorkflowTaskBeforeAudit(id))));
    if (before.length > 0) setAuditBeforeData(c, before);
    const results = await batchApproveTasks(taskIds, comment);
    const after = compactAuditData(await Promise.all(taskIds.map((id) => getWorkflowTaskBeforeAudit(id))));
    if (after.length > 0) setAuditAfterData(c, after);
    const succeeded = results.filter((r) => r.success).length;
    return c.json(okBody({ succeeded, failed: results.length - succeeded, results }, `成功 ${succeeded} 条，失败 ${results.length - succeeded} 条`), 200);
  },
});

const batchRejectRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/batch-reject', tags: ['WorkflowInstances'], summary: '批量审批驳回',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '批量审批驳回', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(batchRejectWorkflowTaskSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowBatchActionResponseDTO, '批量处理完成') },
  }),
  handler: async (c) => {
    const { taskIds, comment } = c.req.valid('json');
    const before = compactAuditData(await Promise.all(taskIds.map((id) => getWorkflowTaskBeforeAudit(id))));
    if (before.length > 0) setAuditBeforeData(c, before);
    const results = await batchRejectTasks(taskIds, comment);
    const after = compactAuditData(await Promise.all(taskIds.map((id) => getWorkflowTaskBeforeAudit(id))));
    if (after.length > 0) setAuditAfterData(c, after);
    const succeeded = results.filter((r) => r.success).length;
    return c.json(okBody({ succeeded, failed: results.length - succeeded, results }, `成功 ${succeeded} 条，失败 ${results.length - succeeded} 条`), 200);
  },
});

const batchWithdrawRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/batch-withdraw', tags: ['WorkflowInstances'], summary: '批量撤回',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '批量撤回流程', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(batchWithdrawWorkflowInstanceSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowInstanceBatchActionResponseDTO, '批量处理完成') },
  }),
  handler: async (c) => {
    const { instanceIds, comment } = c.req.valid('json');
    const before = compactAuditData(await Promise.all(instanceIds.map((id) => getWorkflowInstanceBeforeAudit(id))));
    if (before.length > 0) setAuditBeforeData(c, before);
    const results = await batchWithdrawInstances(instanceIds, comment);
    const after = compactAuditData(await Promise.all(instanceIds.map((id) => getWorkflowInstanceBeforeAudit(id))));
    if (after.length > 0) setAuditAfterData(c, after);
    const succeeded = results.filter((r) => r.success).length;
    return c.json(okBody({ succeeded, failed: results.length - succeeded, results }, `成功 ${succeeded} 条，失败 ${results.length - succeeded} 条`), 200);
  },
});

const batchUrgeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/batch-urge', tags: ['WorkflowInstances'], summary: '批量催办',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list', audit: { description: '批量催办流程', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(batchUrgeWorkflowInstanceSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowInstanceBatchActionResponseDTO, '批量处理完成') },
  }),
  handler: async (c) => {
    const { instanceIds, message } = c.req.valid('json');
    const results = await batchUrgeInstances(instanceIds, message);
    const succeeded = results.filter((r) => r.success).length;
    return c.json(okBody({ succeeded, failed: results.length - succeeded, results }, `成功 ${succeeded} 条，失败 ${results.length - succeeded} 条`), 200);
  },
});

const jumpInstanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/jump', tags: ['WorkflowInstances'], summary: '管理员强制跳转节点',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:cancel', audit: { description: '强制跳转流程节点', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(jumpWorkflowInstanceSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已跳转'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { targetNodeKey, comment } = c.req.valid('json');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await jumpInstance(id, targetNodeKey, comment), '已跳转'), 200);
  },
});

const reassignRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/reassign', tags: ['WorkflowInstances'], summary: '管理员改派处理人',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:cancel', audit: { description: '改派审批处理人', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(reassignWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowTaskDTO, '已改派'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserId, comment } = c.req.valid('json');
    const before = await getWorkflowTaskForAdminAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const row = await reassignTask(taskId, targetUserId, comment);
    const after = await getWorkflowTaskForAdminAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(row, '已改派'), 200);
  },
});

const recallRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/recall', tags: ['WorkflowInstances'], summary: '撤回已办',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle', audit: { description: '撤回已办', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(recallWorkflowTaskSchema), required: false } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已撤回'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const body = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await recallTask(taskId, body?.comment), '已撤回'), 200);
  },
});

const consultRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/consult', tags: ['WorkflowInstances'], summary: '发起协办',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle', audit: { description: '发起协办', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(createWorkflowConsultSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(WorkflowTaskConsultDTO), '已发起协办'),
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const result = await createConsult(taskId, c.req.valid('json'));
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(result, '已发起协办'), 200);
  },
});

const myConsultsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/consults/mine', tags: ['WorkflowInstances'], summary: '我的协办列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle' })] as const,
    request: { query: PaginationQuery.extend({ status: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowTaskConsultDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyConsults(c.req.valid('query'))), 200),
});

const replyConsultRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/consults/{id}/reply', tags: ['WorkflowInstances'], summary: '回复协办意见',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle', audit: { description: '回复协办意见', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(replyWorkflowConsultSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowTaskConsultDTO, '已回复'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const instanceId = await getConsultInstanceIdForAudit(id);
    const before = instanceId ? await getWorkflowInstanceBeforeAudit(instanceId) : null;
    if (before) setAuditBeforeData(c, before);
    const result = await replyConsult(id, c.req.valid('json'));
    const after = instanceId ? await getWorkflowInstanceBeforeAudit(instanceId) : null;
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(result, '已回复'), 200);
  },
});

router.openapiRoutes([listRoute, pendingMineRoute, allRoute, ccMineRoute, handledMineRoute, ccUnreadCountRoute, relationOptionsRoute, analyticsRoute, overdueRoute, myConsultsRoute, batchWithdrawRoute, batchUrgeRoute, ccReadRoute, diagnosticsRoute, traceRoute, tokensRoute, diagnosticBundleRoute, detailRoute, listCommentsRoute, addCommentRoute, createInstanceRoute, updateDraftRoute, submitDraftRoute, resubmitRoute] as const);
router.openapiRoutes([withdrawRoute, forwardRoute, cancelInstanceRoute, jumpInstanceRoute, tokenSkipRoute, tokenReplayRoute, batchSkipStuckRoute, deleteInstanceRoute, batchApproveRoute, batchRejectRoute, approveRoute, rejectRoute, transferRoute, reassignRoute, recallRoute, consultRoute, replyConsultRoute, delegateRoute, addSignRoute, reduceSignRoute, returnRoute, urgeRoute, listTaskUrgesRoute, listInstanceUrgesRoute, urgeInstanceRoute, addInstanceCcRoute] as const);

const migratePreflightRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/migrate/preflight', tags: ['WorkflowInstances'], summary: '实例迁移预检',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowMigrationPreflightDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await preflightMigration(c.req.valid('param').id)), 200),
});
const migrateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/migrate', tags: ['WorkflowInstances'], summary: '迁移实例到最新版本',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '迁移流程实例', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('迁移成功') },
  }),
  handler: async (c) => { await migrateInstance(c.req.valid('param').id); return c.json(okBody(null, '迁移成功'), 200); },
});
const migrationsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/migrations', tags: ['WorkflowInstances'], summary: '实例迁移记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowInstanceMigrationDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMigrations(c.req.valid('param').id)), 200),
});
const migrateBatchRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/migrate/batch/{definitionId}', tags: ['WorkflowInstances'], summary: '批量迁移定义下运行实例',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '批量迁移流程实例', module: '工作流管理' } })] as const,
    request: { params: z.object({ definitionId: z.coerce.number().int() }) },
    responses: { ...commonErrorResponses, ...okMsg('批量迁移完成') },
  }),
  handler: async (c) => { const r = await batchMigrate(c.req.valid('param').definitionId); return c.json(okBody(null, `批量迁移完成：${r.migrated}/${r.total}，失败 ${r.failed.length}`), 200); },
});

const compensationsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/compensation/list', tags: ['WorkflowInstances'], summary: '补偿/修复工单列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { query: PaginationQuery.extend({ status: z.string().optional(), instanceId: z.coerce.number().int().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowCompensationDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listCompensations(c.req.valid('query'))), 200),
});

const compensationResolveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/compensation/{id}/resolve', tags: ['WorkflowInstances'], summary: '处理补偿工单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '处理补偿工单', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(z.object({ action: z.enum(['resolve', 'terminate']), resolution: z.string().optional() })), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowCompensationDTO, '已处理') },
  }),
  handler: async (c) => { const { id } = c.req.valid('param'); const b = c.req.valid('json'); return c.json(okBody(await resolveCompensation(id, b.action, b.resolution), '已处理'), 200); },
});

router.openapiRoutes([migratePreflightRoute, migrateRoute, migrationsRoute, migrateBatchRoute, compensationsRoute, compensationResolveRoute] as const);

export default router;
