import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { count, countDistinct, eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { workflowDefinitions, workflowInstances, workflowTasks, users } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { advanceFlow, getInitialTasks, validateFlowData } from '../lib/workflow-engine';
import { createWorkflowInstanceSchema, approveWorkflowTaskSchema, rejectWorkflowTaskSchema } from '@zenith/shared';
import type { WorkflowFlowData } from '@zenith/shared';
import { apiResponse, ErrorResponse, PaginationQuery, paginatedResponse, jsonContent, validationHook, commonErrorResponses } from '../lib/openapi-schemas';
import { WorkflowInstanceDTO, WorkflowInstanceListItemDTO, WorkflowInstanceAllDTO } from '../lib/openapi-dtos';

const router = new OpenAPIHono({ defaultHook: validationHook });

function toTask(row: typeof workflowTasks.$inferSelect, assigneeName?: string | null, assigneeAvatar?: string | null) {
  return {
    id: row.id,
    instanceId: row.instanceId,
    nodeKey: row.nodeKey,
    nodeName: row.nodeName,
    nodeType: row.nodeType ?? null,
    assigneeId: row.assigneeId,
    assigneeName: assigneeName ?? null,
    assigneeAvatar: assigneeAvatar ?? null,
    status: row.status,
    comment: row.comment,
    actionAt: row.actionAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toInstance(
  row: typeof workflowInstances.$inferSelect,
  extras: {
    definitionName?: string | null;
    initiatorName?: string | null;
    initiatorAvatar?: string | null;
    tasks?: ReturnType<typeof toTask>[];
  } = {},
) {
  return {
    id: row.id,
    definitionId: row.definitionId,
    definitionName: extras.definitionName ?? null,
    title: row.title,
    formData: row.formData,
    status: row.status,
    currentNodeKey: row.currentNodeKey,
    initiatorId: row.initiatorId,
    initiatorName: extras.initiatorName ?? null,
    initiatorAvatar: extras.initiatorAvatar ?? null,
    tenantId: row.tenantId,
    tasks: extras.tasks ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /instances
const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/instances',
    tags: ['WorkflowInstances'],
    summary: '我的申请列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { query: PaginationQuery.extend({ status: z.string().optional() }) },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(paginatedResponse(WorkflowInstanceDTO)), description: 'ok' },
    },
  }),
  handler: async (c) => {
    const user = c.get('user');
    const { page = 1, pageSize = 20, status } = c.req.valid('query');
    const tc = tenantCondition(workflowInstances, user);
    const conditions = [eq(workflowInstances.initiatorId, user.userId)];
    if (tc) conditions.push(tc);
    if (status) conditions.push(eq(workflowInstances.status, status as 'draft' | 'running' | 'approved' | 'rejected' | 'withdrawn'));
    const where = and(...conditions);
    const total = await db.$count(workflowInstances, where);
    const rows = await db
      .select({ inst: workflowInstances, definitionName: workflowDefinitions.name, initiatorName: users.nickname, initiatorAvatar: users.avatar })
      .from(workflowInstances)
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(where)
      .orderBy(desc(workflowInstances.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return c.json({
      code: 0 as const,
      message: 'ok',
      data: { list: rows.map((r) => toInstance(r.inst, r)), total, page, pageSize },
    }, 200);
  },
});

// GET /instances/pending-mine
const pendingMineRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/instances/pending-mine',
    tags: ['WorkflowInstances'],
    summary: '待我审批列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle' })] as const,
    request: { query: PaginationQuery },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(paginatedResponse(WorkflowInstanceListItemDTO)), description: 'ok' },
    },
  }),
  handler: async (c) => {
    const user = c.get('user');
    const { page = 1, pageSize = 20 } = c.req.valid('query');
    const [{ total }] = await db
      .select({ total: countDistinct(workflowInstances.id) })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .where(and(eq(workflowTasks.assigneeId, user.userId), eq(workflowTasks.status, 'pending'), eq(workflowInstances.status, 'running')));
    const rows = await db
      .select({ inst: workflowInstances, definitionName: workflowDefinitions.name, initiatorName: users.nickname, initiatorAvatar: users.avatar, task: workflowTasks })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(and(eq(workflowTasks.assigneeId, user.userId), eq(workflowTasks.status, 'pending'), eq(workflowInstances.status, 'running')))
      .orderBy(desc(workflowTasks.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return c.json({
      code: 0 as const,
      message: 'ok',
      data: {
        list: rows.map((r) => ({ ...toInstance(r.inst, r), pendingTaskId: r.task.id })),
        total: Number(total),
        page,
        pageSize,
      },
    }, 200);
  },
});

// GET /instances/all
const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/instances/all',
    tags: ['WorkflowInstances'],
    summary: '全局流程实例列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { query: PaginationQuery.extend({ status: z.string().optional(), keyword: z.string().optional() }) },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(WorkflowInstanceAllDTO)), description: 'ok' },
    },
  }),
  handler: async (c) => {
    const { page = 1, pageSize = 20, status, keyword } = c.req.valid('query');
    const conditions = [];
    if (status) conditions.push(eq(workflowInstances.status, status as 'draft' | 'running' | 'approved' | 'rejected' | 'withdrawn'));
    if (keyword) {
      const like = `%${keyword}%`;
      conditions.push(sql`(${workflowInstances.title} ilike ${like} or ${workflowDefinitions.name} ilike ${like})`);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const statRows = await db.select({ status: workflowInstances.status, cnt: count() }).from(workflowInstances).groupBy(workflowInstances.status);
    const stats: Record<string, number> = { total: 0, running: 0, approved: 0, rejected: 0, withdrawn: 0 };
    for (const r of statRows) {
      stats[r.status] = r.cnt;
      stats.total += r.cnt;
    }
    const [{ total }] = await db
      .select({ total: count() })
      .from(workflowInstances)
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .where(where);
    const rows = await db
      .select({ inst: workflowInstances, definitionName: workflowDefinitions.name, initiatorName: users.nickname, initiatorAvatar: users.avatar })
      .from(workflowInstances)
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(where)
      .orderBy(desc(workflowInstances.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return c.json({
      code: 0 as const,
      message: 'ok',
      data: { stats, list: rows.map((r) => toInstance(r.inst, r)), total, page, pageSize },
    }, 200);
  },
});

// GET /instances/{id}
const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/instances/{id}',
    tags: ['WorkflowInstances'],
    summary: '实例详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { params: z.object({ id: z.coerce.number() }) },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(WorkflowInstanceDTO)), description: 'ok' },
      403: { content: jsonContent(ErrorResponse), description: '无权查看' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const tc = tenantCondition(workflowInstances, user);
    const conditions = [eq(workflowInstances.id, id)];
    if (tc) conditions.push(tc);
    const rows = await db
      .select({ inst: workflowInstances, definitionName: workflowDefinitions.name, initiatorName: users.nickname, initiatorAvatar: users.avatar })
      .from(workflowInstances)
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(and(...conditions))
      .limit(1);
    if (!rows.length) return c.json({ code: 404, message: '流程实例不存在', data: null }, 404);
    const inst = rows[0].inst;
    const myTasks = await db.select().from(workflowTasks).where(and(eq(workflowTasks.instanceId, id), eq(workflowTasks.assigneeId, user.userId))).limit(1);
    const isInitiator = inst.initiatorId === user.userId;
    const isAssignee = myTasks.length > 0;
    if (!isInitiator && !isAssignee) return c.json({ code: 403, message: '无权查看', data: null }, 403);
    const taskRows = await db
      .select({ task: workflowTasks, assigneeName: users.nickname, assigneeAvatar: users.avatar })
      .from(workflowTasks)
      .leftJoin(users, eq(workflowTasks.assigneeId, users.id))
      .where(eq(workflowTasks.instanceId, id))
      .orderBy(workflowTasks.id);
    const tasks = taskRows.map((r) => toTask(r.task, r.assigneeName, r.assigneeAvatar));
    return c.json({
      code: 0 as const,
      message: 'ok',
      data: toInstance(rows[0].inst, { ...rows[0], tasks }),
    }, 200);
  },
});

// POST /instances
const createInstanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/instances',
    tags: ['WorkflowInstances'],
    summary: '发起流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '发起流程申请', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(createWorkflowInstanceSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(WorkflowInstanceDTO)), description: '申请已提交' },
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '流程定义不存在' },
    },
  }),
  handler: async (c) => {
    const user = c.get('user');
    const data = c.req.valid('json');
    const [def] = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, data.definitionId), eq(workflowDefinitions.status, 'published'))).limit(1);
    if (!def) return c.json({ code: 404, message: '流程定义不存在或未发布', data: null }, 404);
    const flowData = def.flowData as WorkflowFlowData;
    if (!flowData?.nodes?.length) return c.json({ code: 400, message: '流程定义无效', data: null }, 400);
    const validation = validateFlowData(flowData);
    if (!validation.valid) return c.json({ code: 400, message: validation.errors[0], data: null }, 400);
    const formData: Record<string, unknown> = data.formData ?? {};
    const initialResult = getInitialTasks(flowData, formData);
    if (initialResult.tasksToCreate.length === 0 && !initialResult.finished) {
      return c.json({ code: 400, message: '流程定义中无可执行节点', data: null }, 400);
    }
    const instance = await db.transaction(async (tx) => {
      const [createdInstance] = await tx.insert(workflowInstances).values({
        definitionId: def.id,
        definitionSnapshot: def as unknown as Record<string, unknown>,
        title: data.title,
        formData,
        status: initialResult.finished ? 'approved' : 'running',
        currentNodeKey: initialResult.currentNodeKeys[0] ?? null,
        initiatorId: user.userId,
        tenantId: getCreateTenantId(user),
      }).returning();
      if (initialResult.tasksToCreate.length > 0) {
        await tx.insert(workflowTasks).values(
          initialResult.tasksToCreate.map((t) => ({
            instanceId: createdInstance.id,
            nodeKey: t.nodeKey,
            nodeName: t.nodeName,
            nodeType: t.nodeType,
            assigneeId: t.assigneeId,
            status: t.nodeType === 'ccNode' ? 'skipped' as const : 'pending' as const,
          })),
        );
      }
      return createdInstance;
    });
    return c.json({ code: 0 as const, message: '申请已提交', data: toInstance(instance) }, 200);
  },
});

// POST /instances/{id}/withdraw
const withdrawRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/instances/{id}/withdraw',
    tags: ['WorkflowInstances'],
    summary: '撤回申请',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '撤回流程申请', module: '工作流管理' } })] as const,
    request: { params: z.object({ id: z.coerce.number() }) },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(WorkflowInstanceDTO)), description: '已撤回' },
      400: { content: jsonContent(ErrorResponse), description: '不能撤回' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const tc = tenantCondition(workflowInstances, user);
    const conditions = [eq(workflowInstances.id, id)];
    if (tc) conditions.push(tc);
    const [inst] = await db.select().from(workflowInstances).where(and(...conditions)).limit(1);
    if (!inst) return c.json({ code: 404, message: '流程实例不存在', data: null }, 404);
    if (inst.initiatorId !== user.userId) return c.json({ code: 403, message: '只有发起人可以撤回', data: null }, 403);
    if (inst.status !== 'running') return c.json({ code: 400, message: '只能撤回进行中的申请', data: null }, 400);
    const updated = await db.transaction(async (tx) => {
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
        .where(and(eq(workflowTasks.instanceId, id), eq(workflowTasks.status, 'pending')));
      const [row] = await tx.update(workflowInstances).set({ status: 'withdrawn' }).where(and(...conditions)).returning();
      return row;
    });
    return c.json({ code: 0 as const, message: '已撤回', data: toInstance(updated) }, 200);
  },
});

// POST /tasks/{taskId}/approve
const approveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/tasks/{taskId}/approve',
    tags: ['WorkflowInstances'],
    summary: '审批通过',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle', audit: { description: '审批通过', module: '工作流管理' } })] as const,
    request: {
      params: z.object({ taskId: z.coerce.number() }),
      body: { content: jsonContent(approveWorkflowTaskSchema), required: false },
    },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(WorkflowInstanceDTO)), description: 'ok' },
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
      500: { content: jsonContent(ErrorResponse), description: '数据异常' },
    },
  }),
  handler: async (c) => {
    const user = c.get('user');
    const { taskId } = c.req.valid('param');
    const body = await c.req.json().catch(() => ({}));
    const result = approveWorkflowTaskSchema.safeParse(body);
    if (!result.success) return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);

    const [task] = await db.select().from(workflowTasks).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId))).limit(1);
    if (!task) return c.json({ code: 404, message: '任务不存在或无权操作', data: null }, 404);
    if (task.status !== 'pending') return c.json({ code: 400, message: '任务已处理', data: null }, 400);
    const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
    if (!inst) return c.json({ code: 500, message: '流程数据异常', data: null }, 500);
    if (inst.status !== 'running') return c.json({ code: 400, message: '流程实例不在进行中', data: null }, 400);

    const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData };
    const flowData = snapshot?.flowData;
    if (!flowData) return c.json({ code: 500, message: '流程快照数据异常', data: null }, 500);
    const updated = await db.transaction(async (tx) => {
      await tx.update(workflowTasks).set({
        status: 'approved',
        comment: result.data.comment ?? null,
        actionAt: new Date(),
      }).where(eq(workflowTasks.id, taskId));

      const allTasks = await tx.select().from(workflowTasks).where(and(eq(workflowTasks.instanceId, inst.id), eq(workflowTasks.status, 'approved')));
      const completedKeys = new Set(allTasks.map((t) => t.nodeKey));
      completedKeys.add('start');
      const formData = (inst.formData ?? {}) as Record<string, unknown>;
      const advanceResult = advanceFlow(flowData, task.nodeKey, formData, completedKeys);

      if (advanceResult.finished && advanceResult.tasksToCreate.length === 0) {
        const [row] = await tx.update(workflowInstances).set({ status: 'approved', currentNodeKey: null }).where(eq(workflowInstances.id, inst.id)).returning();
        return { row, finished: true };
      }

      if (advanceResult.tasksToCreate.length > 0) {
        await tx.insert(workflowTasks).values(
          advanceResult.tasksToCreate.map((t) => ({
            instanceId: inst.id,
            nodeKey: t.nodeKey,
            nodeName: t.nodeName,
            nodeType: t.nodeType,
            assigneeId: t.assigneeId,
            status: t.nodeType === 'ccNode' ? 'skipped' as const : 'pending' as const,
          })),
        );
      }

      if (advanceResult.finished) {
        const [row] = await tx.update(workflowInstances).set({ status: 'approved', currentNodeKey: null }).where(eq(workflowInstances.id, inst.id)).returning();
        return { row, finished: true };
      }

      const [row] = await tx.update(workflowInstances)
        .set({ currentNodeKey: advanceResult.currentNodeKeys[0] ?? null })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, finished: false };
    });

    if (updated.finished) {
      return c.json({ code: 0 as const, message: '审批通过，流程已完成', data: toInstance(updated.row) }, 200);
    }
    return c.json({ code: 0 as const, message: '审批通过，流程已推进', data: toInstance(updated.row) }, 200);
  },
});

// POST /tasks/{taskId}/reject
const rejectRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/tasks/{taskId}/reject',
    tags: ['WorkflowInstances'],
    summary: '审批驳回',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle', audit: { description: '审批驳回', module: '工作流管理' } })] as const,
    request: {
      params: z.object({ taskId: z.coerce.number() }),
      body: { content: jsonContent(rejectWorkflowTaskSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(WorkflowInstanceDTO)), description: '已驳回' },
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
      500: { content: jsonContent(ErrorResponse), description: '数据异常' },
    },
  }),
  handler: async (c) => {
    const user = c.get('user');
    const { taskId } = c.req.valid('param');
    const body = await c.req.json().catch(() => ({}));
    const result = rejectWorkflowTaskSchema.safeParse(body);
    if (!result.success) return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
    const [task] = await db.select().from(workflowTasks).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId))).limit(1);
    if (!task) return c.json({ code: 404, message: '任务不存在或无权操作', data: null }, 404);
    if (task.status !== 'pending') return c.json({ code: 400, message: '任务已处理', data: null }, 400);
    const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
    if (!inst) return c.json({ code: 500, message: '流程数据异常', data: null }, 500);
    if (inst.status !== 'running') return c.json({ code: 400, message: '流程实例不在进行中', data: null }, 400);
    const updated = await db.transaction(async (tx) => {
      await tx.update(workflowTasks)
        .set({ status: 'rejected', comment: result.data.comment, actionAt: new Date() })
        .where(eq(workflowTasks.id, taskId));
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'rejected', currentNodeKey: null })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return row;
    });
    return c.json({ code: 0 as const, message: '已驳回', data: toInstance(updated) }, 200);
  },
});

router.openapiRoutes([listRoute, pendingMineRoute, allRoute, detailRoute, createInstanceRoute, withdrawRoute, approveRoute, rejectRoute] as const);

export default router;
