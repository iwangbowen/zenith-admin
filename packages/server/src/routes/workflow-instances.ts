import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { workflowDefinitions, workflowInstances, workflowTasks, users } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import {
  createWorkflowInstanceSchema,
  approveWorkflowTaskSchema,
  rejectWorkflowTaskSchema,
} from '@zenith/shared';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { advanceFlow, getInitialTasks, validateFlowData } from '../lib/workflow-engine';
import type { JwtPayload } from '../middleware/auth';
import type { WorkflowFlowData } from '@zenith/shared';

type Env = { Variables: { user: JwtPayload } };
const router = new Hono<Env>();
router.use('*', authMiddleware);

// ─── 内部工具函数 ─────────────────────────────────────────────────────────────

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
    tasks: extras.tasks,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── 流程实例 API ──────────────────────────────────────────────────────────────

/** GET /instances — 我的申请列表 */
router.get('/instances', guard({ permission: 'workflow:instance:list' }), async (c) => {
  const user = c.get('user');
  const page = Number(c.req.query('page') ?? 1);
  const pageSize = Number(c.req.query('pageSize') ?? 20);
  const status = c.req.query('status');
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.initiatorId, user.userId)];
  if (tc) conditions.push(tc);
  if (status) conditions.push(eq(workflowInstances.status, status as 'draft' | 'running' | 'approved' | 'rejected' | 'withdrawn'));

  const where = and(...conditions);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(workflowInstances)
    .where(where);

  const rows = await db
    .select({
      inst: workflowInstances,
      definitionName: workflowDefinitions.name,
      initiatorName: users.nickname,
      initiatorAvatar: users.avatar,
    })
    .from(workflowInstances)
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
    .where(where)
    .orderBy(desc(workflowInstances.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: rows.map(r => toInstance(r.inst, {
        definitionName: r.definitionName,
        initiatorName: r.initiatorName,
        initiatorAvatar: r.initiatorAvatar,
      })),
      total,
      page,
      pageSize,
    },
  });
});

/** GET /instances/pending-mine — 待我审批列表 */
router.get('/instances/pending-mine', guard({ permission: 'workflow:task:handle' }), async (c) => {
  const user = c.get('user');
  const page = Number(c.req.query('page') ?? 1);
  const pageSize = Number(c.req.query('pageSize') ?? 20);

  // 找出分配给我且待处理的任务
  const [{ total }] = await db
    .select({ total: sql<number>`count(distinct ${workflowInstances.id})::int` })
    .from(workflowTasks)
    .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
    .where(and(
      eq(workflowTasks.assigneeId, user.userId),
      eq(workflowTasks.status, 'pending'),
      eq(workflowInstances.status, 'running'),
    ));

  const rows = await db
    .select({
      inst: workflowInstances,
      definitionName: workflowDefinitions.name,
      initiatorName: users.nickname,
      initiatorAvatar: users.avatar,
      task: workflowTasks,
    })
    .from(workflowTasks)
    .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
    .where(and(
      eq(workflowTasks.assigneeId, user.userId),
      eq(workflowTasks.status, 'pending'),
      eq(workflowInstances.status, 'running'),
    ))
    .orderBy(desc(workflowTasks.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: rows.map(r => ({
        ...toInstance(r.inst, {
          definitionName: r.definitionName,
          initiatorName: r.initiatorName,
          initiatorAvatar: r.initiatorAvatar,
        }),
        pendingTaskId: r.task.id,
      })),
      total,
      page,
      pageSize,
    },
  });
});

/** GET /instances/all — 管理员：全局流程实例列表（含筛选、统计），必须在 /:id 之前注册 */
router.get('/instances/all', guard({ permission: 'workflow:instance:monitor' }), async (c) => {
  const page = Number(c.req.query('page') ?? 1);
  const pageSize = Number(c.req.query('pageSize') ?? 20);
  const status = c.req.query('status');
  const keyword = c.req.query('keyword');

  const conditions = [];
  if (status) conditions.push(eq(workflowInstances.status, status as 'draft' | 'running' | 'approved' | 'rejected' | 'withdrawn'));
  if (keyword) {
    const like = `%${keyword}%`;
    conditions.push(sql`(${workflowInstances.title} ilike ${like} or ${workflowDefinitions.name} ilike ${like})`);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const statRows = await db
    .select({ status: workflowInstances.status, cnt: sql<number>`count(*)::int` })
    .from(workflowInstances)
    .groupBy(workflowInstances.status);

  const stats: Record<string, number> = { total: 0, running: 0, approved: 0, rejected: 0, withdrawn: 0 };
  for (const r of statRows) {
    stats[r.status] = r.cnt;
    stats.total += r.cnt;
  }

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(workflowInstances)
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .where(where);

  const rows = await db
    .select({
      inst: workflowInstances,
      definitionName: workflowDefinitions.name,
      initiatorName: users.nickname,
      initiatorAvatar: users.avatar,
    })
    .from(workflowInstances)
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
    .where(where)
    .orderBy(desc(workflowInstances.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      stats,
      list: rows.map(r => toInstance(r.inst, {
        definitionName: r.definitionName,
        initiatorName: r.initiatorName,
        initiatorAvatar: r.initiatorAvatar,
      })),
      total,
      page,
      pageSize,
    },
  });
});

/** GET /instances/:id — 实例详情（含任务列表） */
router.get('/instances/:id', guard({ permission: 'workflow:instance:list' }), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));

  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);

  const rows = await db
    .select({
      inst: workflowInstances,
      definitionName: workflowDefinitions.name,
      initiatorName: users.nickname,
      initiatorAvatar: users.avatar,
    })
    .from(workflowInstances)
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
    .where(and(...conditions))
    .limit(1);

  if (!rows.length) return c.json({ code: 404, message: '流程实例不存在', data: null }, 404);

  // 权限检查：只有发起人或审批人可以查看
  const inst = rows[0].inst;
  const myTasks = await db
    .select()
    .from(workflowTasks)
    .where(and(
      eq(workflowTasks.instanceId, id),
      eq(workflowTasks.assigneeId, user.userId),
    ))
    .limit(1);
  const isInitiator = inst.initiatorId === user.userId;
  const isAssignee = myTasks.length > 0;
  if (!isInitiator && !isAssignee) {
    return c.json({ code: 403, message: '无权查看', data: null }, 403);
  }

  // 获取所有任务
  const taskRows = await db
    .select({ task: workflowTasks, assigneeName: users.nickname, assigneeAvatar: users.avatar })
    .from(workflowTasks)
    .leftJoin(users, eq(workflowTasks.assigneeId, users.id))
    .where(eq(workflowTasks.instanceId, id))
    .orderBy(workflowTasks.id);

  const tasks = taskRows.map(r => toTask(r.task, r.assigneeName, r.assigneeAvatar));

  return c.json({
    code: 0,
    message: 'ok',
    data: toInstance(rows[0].inst, {
      definitionName: rows[0].definitionName,
      initiatorName: rows[0].initiatorName,
      initiatorAvatar: rows[0].initiatorAvatar,
      tasks,
    }),
  });
});

/** POST /instances — 发起流程 */
router.post('/instances', guard({ permission: 'workflow:instance:create', audit: { description: '发起流程申请', module: '工作流管理' } }), async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const result = createWorkflowInstanceSchema.safeParse(body);
  if (!result.success) return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);

  // 获取流程定义
  const [def] = await db
    .select()
    .from(workflowDefinitions)
    .where(and(
      eq(workflowDefinitions.id, result.data.definitionId),
      eq(workflowDefinitions.status, 'published'),
    ))
    .limit(1);

  if (!def) return c.json({ code: 404, message: '流程定义不存在或未发布', data: null }, 404);

  const flowData = def.flowData as WorkflowFlowData;
  if (!flowData?.nodes?.length) return c.json({ code: 400, message: '流程定义无效', data: null }, 400);

  // 使用新引擎校验流程定义
  const validation = validateFlowData(flowData);
  if (!validation.valid) return c.json({ code: 400, message: validation.errors[0], data: null }, 400);

  const formData: Record<string, unknown> = result.data.formData ?? {};
  const initialResult = getInitialTasks(flowData, formData);
  if (initialResult.tasksToCreate.length === 0 && !initialResult.finished) {
    return c.json({ code: 400, message: '流程定义中无可执行节点', data: null }, 400);
  }

  // 创建实例
  const [instance] = await db.insert(workflowInstances).values({
    definitionId: def.id,
    definitionSnapshot: def as unknown as Record<string, unknown>,
    title: result.data.title,
    formData,
    status: initialResult.finished ? 'approved' : 'running',
    currentNodeKey: initialResult.currentNodeKeys[0] ?? null,
    initiatorId: user.userId,
    tenantId: getCreateTenantId(user),
  }).returning();

  // 创建初始任务
  if (initialResult.tasksToCreate.length > 0) {
    await db.insert(workflowTasks).values(
      initialResult.tasksToCreate.map(t => ({
        instanceId: instance.id,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: t.nodeType,
        assigneeId: t.assigneeId,
        status: t.nodeType === 'ccNode' ? 'skipped' as const : 'pending' as const,
      })),
    );
  }

  return c.json({ code: 0, message: '申请已提交', data: toInstance(instance) });
});

/** POST /instances/:id/withdraw — 撤回（发起人，仅 running 状态）*/
router.post('/instances/:id/withdraw', guard({ permission: 'workflow:instance:create', audit: { description: '撤回流程申请', module: '工作流管理' } }), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);

  const [inst] = await db.select().from(workflowInstances).where(and(...conditions)).limit(1);
  if (!inst) return c.json({ code: 404, message: '流程实例不存在', data: null }, 404);
  if (inst.initiatorId !== user.userId) return c.json({ code: 403, message: '只有发起人可以撤回', data: null }, 403);
  if (inst.status !== 'running') return c.json({ code: 400, message: '只能撤回进行中的申请', data: null }, 400);

  // 将所有待处理任务标记为跳过
  await db
    .update(workflowTasks)
    .set({ status: 'skipped', actionAt: new Date() })
    .where(and(eq(workflowTasks.instanceId, id), eq(workflowTasks.status, 'pending')));

  const [updated] = await db
    .update(workflowInstances)
    .set({ status: 'withdrawn', updatedAt: new Date() })
    .where(and(...conditions))
    .returning();

  return c.json({ code: 0, message: '已撤回', data: toInstance(updated) });
});

// ─── 审批任务 API ──────────────────────────────────────────────────────────────

/** POST /tasks/:taskId/approve — 审批通过 */
router.post('/tasks/:taskId/approve', guard({ permission: 'workflow:task:handle', audit: { description: '审批通过', module: '工作流管理' } }), async (c) => {
  const user = c.get('user');
  const taskId = Number(c.req.param('taskId'));
  const body = await c.req.json().catch(() => ({}));
  const result = approveWorkflowTaskSchema.safeParse(body);
  if (!result.success) return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);

  const [task] = await db
    .select()
    .from(workflowTasks)
    .where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId)))
    .limit(1);

  if (!task) return c.json({ code: 404, message: '任务不存在或无权操作', data: null }, 404);
  if (task.status !== 'pending') return c.json({ code: 400, message: '任务已处理', data: null }, 400);

  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) return c.json({ code: 500, message: '流程数据异常', data: null }, 500);
  if (inst.status !== 'running') return c.json({ code: 400, message: '流程实例不在进行中', data: null }, 400);

  // 更新任务状态
  await db.update(workflowTasks).set({
    status: 'approved',
    comment: result.data.comment ?? null,
    actionAt: new Date(),
  }).where(eq(workflowTasks.id, taskId));

  // 获取流程定义以确定下一步
  const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData };
  const flowData = snapshot?.flowData;
  if (!flowData) return c.json({ code: 500, message: '流程快照数据异常', data: null }, 500);

  // 收集所有已完成节点
  const allTasks = await db.select().from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, inst.id), eq(workflowTasks.status, 'approved')));
  const completedKeys = new Set(allTasks.map(t => t.nodeKey));
  // 也把 start 加入已完成集合
  completedKeys.add('start');

  const formData = (inst.formData ?? {}) as Record<string, unknown>;
  const advanceResult = advanceFlow(flowData, task.nodeKey, formData, completedKeys);

  if (advanceResult.finished && advanceResult.tasksToCreate.length === 0) {
    // 流程结束
    const [updated] = await db.update(workflowInstances)
      .set({ status: 'approved', currentNodeKey: null, updatedAt: new Date() })
      .where(eq(workflowInstances.id, inst.id))
      .returning();
    return c.json({ code: 0, message: '审批通过，流程已完成', data: toInstance(updated) });
  }

  // 创建后续任务
  if (advanceResult.tasksToCreate.length > 0) {
    await db.insert(workflowTasks).values(
      advanceResult.tasksToCreate.map(t => ({
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
    // 创建了抄送任务但流程已结束
    const [updated] = await db.update(workflowInstances)
      .set({ status: 'approved', currentNodeKey: null, updatedAt: new Date() })
      .where(eq(workflowInstances.id, inst.id))
      .returning();
    return c.json({ code: 0, message: '审批通过，流程已完成', data: toInstance(updated) });
  }

  // 流程推进到新节点
  const [updated] = await db.update(workflowInstances)
    .set({ currentNodeKey: advanceResult.currentNodeKeys[0] ?? null, updatedAt: new Date() })
    .where(eq(workflowInstances.id, inst.id))
    .returning();
  return c.json({ code: 0, message: '审批通过，流程已推进', data: toInstance(updated) });
});

/** POST /tasks/:taskId/reject — 审批驳回 */
router.post('/tasks/:taskId/reject', guard({ permission: 'workflow:task:handle', audit: { description: '审批驳回', module: '工作流管理' } }), async (c) => {
  const user = c.get('user');
  const taskId = Number(c.req.param('taskId'));
  const body = await c.req.json().catch(() => ({}));
  const result = rejectWorkflowTaskSchema.safeParse(body);
  if (!result.success) return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);

  const [task] = await db
    .select()
    .from(workflowTasks)
    .where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId)))
    .limit(1);

  if (!task) return c.json({ code: 404, message: '任务不存在或无权操作', data: null }, 404);
  if (task.status !== 'pending') return c.json({ code: 400, message: '任务已处理', data: null }, 400);

  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) return c.json({ code: 500, message: '流程数据异常', data: null }, 500);
  if (inst.status !== 'running') return c.json({ code: 400, message: '流程实例不在进行中', data: null }, 400);

  await db.update(workflowTasks).set({
    status: 'rejected',
    comment: result.data.comment,
    actionAt: new Date(),
  }).where(eq(workflowTasks.id, taskId));

  const [updated] = await db.update(workflowInstances)
    .set({ status: 'rejected', currentNodeKey: null, updatedAt: new Date() })
    .where(eq(workflowInstances.id, inst.id))
    .returning();

  return c.json({ code: 0, message: '已驳回', data: toInstance(updated) });
});

export default router;
