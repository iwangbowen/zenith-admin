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
import type { JwtPayload } from '../middleware/auth';
import type { WorkflowFlowData, WorkflowNodeConfig } from '@zenith/shared';

type Env = { Variables: { user: JwtPayload } };
const router = new Hono<Env>();
router.use('*', authMiddleware);

// ─── 内部工具函数 ─────────────────────────────────────────────────────────────

/** 按拓扑顺序遍历节点（线性流程）*/
function getNodeOrder(flowData: WorkflowFlowData): WorkflowNodeConfig[] {
  const nodeMap = new Map(flowData.nodes.map(n => [n.id, n]));
  const adjacency = new Map<string, string>();
  for (const edge of flowData.edges) {
    adjacency.set(edge.source, edge.target);
  }

  const startNode = flowData.nodes.find(n => n.data.type === 'start');
  if (!startNode) return [];

  const result: WorkflowNodeConfig[] = [];
  let currentId: string | undefined = startNode.id;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodeMap.get(currentId);
    if (!node) break;
    result.push(node.data);
    currentId = adjacency.get(currentId);
  }

  return result;
}

/** 获取指定节点后的下一个节点 */
function getNextNode(flowData: WorkflowFlowData, currentNodeKey: string): WorkflowNodeConfig | null {
  const ordered = getNodeOrder(flowData);
  const idx = ordered.findIndex(n => n.key === currentNodeKey);
  if (idx === -1 || idx + 1 >= ordered.length) return null;
  return ordered[idx + 1];
}

function toTask(row: typeof workflowTasks.$inferSelect, assigneeName?: string | null, assigneeAvatar?: string | null) {
  return {
    id: row.id,
    instanceId: row.instanceId,
    nodeKey: row.nodeKey,
    nodeName: row.nodeName,
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

  const ordered = getNodeOrder(flowData);
  const firstApprove = ordered.find(n => n.type === 'approve');
  if (!firstApprove) return c.json({ code: 400, message: '流程定义中无审批节点', data: null }, 400);

  // 创建实例（事务）
  const [instance] = await db.insert(workflowInstances).values({
    definitionId: def.id,
    definitionSnapshot: def as unknown as Record<string, unknown>,
    title: result.data.title,
    formData: (result.data.formData ?? null) as Record<string, unknown>,
    status: 'running',
    currentNodeKey: firstApprove.key,
    initiatorId: user.userId,
    tenantId: getCreateTenantId(user),
  }).returning();

  // 创建第一个审批任务
  await db.insert(workflowTasks).values({
    instanceId: instance.id,
    nodeKey: firstApprove.key,
    nodeName: firstApprove.label,
    assigneeId: firstApprove.assigneeId ?? null,
    status: 'pending',
  });

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

  const nextNode = getNextNode(flowData, task.nodeKey);

  if (!nextNode || nextNode.type === 'end') {
    // 流程结束
    const [updated] = await db.update(workflowInstances)
      .set({ status: 'approved', currentNodeKey: null, updatedAt: new Date() })
      .where(eq(workflowInstances.id, inst.id))
      .returning();
    return c.json({ code: 0, message: '审批通过，流程已完成', data: toInstance(updated) });
  }

  if (nextNode.type === 'approve') {
    // 推进到下一个审批节点
    await db.insert(workflowTasks).values({
      instanceId: inst.id,
      nodeKey: nextNode.key,
      nodeName: nextNode.label,
      assigneeId: nextNode.assigneeId ?? null,
      status: 'pending',
    });

    const [updated] = await db.update(workflowInstances)
      .set({ currentNodeKey: nextNode.key, updatedAt: new Date() })
      .where(eq(workflowInstances.id, inst.id))
      .returning();
    return c.json({ code: 0, message: '审批通过，流程已推进', data: toInstance(updated) });
  }

  return c.json({ code: 0, message: '审批通过', data: null });
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
