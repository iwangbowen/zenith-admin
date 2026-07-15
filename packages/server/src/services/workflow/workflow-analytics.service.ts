import { and, asc, eq, gte, desc, ilike, or, inArray, sql, type SQL } from 'drizzle-orm';
import dayjs from 'dayjs';
import { db } from '../../db';
import { workflowInstances, workflowTasks, workflowDefinitions, workflowCategories, workflowJobs, users } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import type {
  WorkflowAnalytics,
  WorkflowInstanceStatus,
  WorkflowAnalyticsTrendPoint,
  WorkflowOverdueTask,
} from '@zenith/shared';
import { WORKFLOW_INSTANCE_STATUS_LABELS } from '@zenith/shared';

const FINISHED: WorkflowInstanceStatus[] = ['approved', 'rejected', 'withdrawn', 'cancelled'];

export async function getWorkflowAnalytics(query: { definitionId?: number } = {}): Promise<WorkflowAnalytics> {
  const user = currentUser();
  const instTenant = tenantCondition(workflowInstances, user);

  // 实例级筛选（监控可按流程定义过滤）
  const instConds: SQL[] = [];
  if (instTenant) instConds.push(instTenant);
  if (query.definitionId) instConds.push(eq(workflowInstances.definitionId, query.definitionId));
  const instWhere = instConds.length ? and(...instConds) : undefined;

  const since14 = dayjs().subtract(13, 'day').startOf('day').toDate();
  const since7 = dayjs().subtract(7, 'day').toDate();

  const durationExpr = sql<number | null>`avg(extract(epoch from (${workflowInstances.updatedAt} - ${workflowInstances.createdAt})))`;

  const [
    statusRows,
    avgRow,
    pendingRow,
    recentRow,
    definitionRows,
    nodeRows,
    approverRows,
    createdTrend,
    completedTrend,
    overdueRow,
    dueSoonRow,
    jobRows,
    webhookRows,
    subRows,
  ] = await Promise.all([
    // 1. 各状态计数
    db.select({ status: workflowInstances.status, count: sql<number>`count(*)::int` })
      .from(workflowInstances).where(instWhere).groupBy(workflowInstances.status),
    // 2. 已完结实例平均耗时
    db.select({ avg: durationExpr })
      .from(workflowInstances)
      .where(and(...instConds, inArray(workflowInstances.status, FINISHED))),
    // 3. 当前挂起任务总数
    db.select({ count: sql<number>`count(*)::int` })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .where(and(...instConds, eq(workflowTasks.status, 'pending'))),
    // 4. 近 7 天发起数
    db.select({ count: sql<number>`count(*)::int` })
      .from(workflowInstances)
      .where(and(...instConds, gte(workflowInstances.createdAt, since7))),
    // 5. 各流程定义统计
    db.select({
      definitionId: workflowInstances.definitionId,
      definitionName: workflowDefinitions.name,
      total: sql<number>`count(*)::int`,
      running: sql<number>`count(*) filter (where ${workflowInstances.status}::text = 'running')::int`,
      approved: sql<number>`count(*) filter (where ${workflowInstances.status}::text = 'approved')::int`,
      rejected: sql<number>`count(*) filter (where ${workflowInstances.status}::text = 'rejected')::int`,
      avgDurationSec: sql<number | null>`avg(extract(epoch from (${workflowInstances.updatedAt} - ${workflowInstances.createdAt}))) filter (where ${workflowInstances.status}::text in ('approved','rejected','withdrawn','cancelled'))`,
    })
      .from(workflowInstances)
      .innerJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .where(instWhere)
      .groupBy(workflowInstances.definitionId, workflowDefinitions.name)
      .orderBy(desc(sql`count(*)`))
      .limit(12),
    // 6. 节点瓶颈：人工节点的平均处理时长 / 挂起数
    db.select({
      definitionId: workflowInstances.definitionId,
      definitionName: workflowDefinitions.name,
      nodeKey: workflowTasks.nodeKey,
      nodeName: workflowTasks.nodeName,
      avgHandleSec: sql<number | null>`avg(extract(epoch from (${workflowTasks.actionAt} - ${workflowTasks.createdAt}))) filter (where ${workflowTasks.actionAt} is not null)`,
      pendingCount: sql<number>`count(*) filter (where ${workflowTasks.status}::text = 'pending')::int`,
      doneCount: sql<number>`count(*) filter (where ${workflowTasks.status}::text in ('approved','rejected'))::int`,
    })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .innerJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .where(and(...instConds, inArray(workflowTasks.nodeType, ['approve', 'handler'])))
      .groupBy(workflowInstances.definitionId, workflowDefinitions.name, workflowTasks.nodeKey, workflowTasks.nodeName)
      .orderBy(desc(sql`count(*) filter (where ${workflowTasks.status}::text = 'pending')`), desc(sql`avg(extract(epoch from (${workflowTasks.actionAt} - ${workflowTasks.createdAt})))`))
      .limit(10),
    // 7. 审批人工作量（待办 + 已处理）
    db.select({
      userId: workflowTasks.assigneeId,
      userName: sql<string>`coalesce(${users.nickname}, ${users.username})`,
      pendingCount: sql<number>`count(*) filter (where ${workflowTasks.status}::text = 'pending')::int`,
      handledCount: sql<number>`count(*) filter (where ${workflowTasks.status}::text in ('approved','rejected'))::int`,
      oldestPendingSec: sql<number | null>`extract(epoch from (now() - min(${workflowTasks.createdAt}) filter (where ${workflowTasks.status}::text = 'pending')))`,
    })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .innerJoin(users, eq(workflowTasks.assigneeId, users.id))
      .where(and(...instConds, inArray(workflowTasks.status, ['pending', 'approved', 'rejected'])))
      .groupBy(workflowTasks.assigneeId, users.nickname, users.username)
      .orderBy(desc(sql`count(*) filter (where ${workflowTasks.status}::text = 'pending')`), desc(sql`count(*)`))
      .limit(10),
    // 8a. 近 14 天发起趋势
    db.select({ d: sql<string>`to_char(${workflowInstances.createdAt}, 'YYYY-MM-DD')`, c: sql<number>`count(*)::int` })
      .from(workflowInstances)
      .where(and(...instConds, gte(workflowInstances.createdAt, since14)))
      .groupBy(sql`to_char(${workflowInstances.createdAt}, 'YYYY-MM-DD')`),
    // 8b. 近 14 天完结趋势
    db.select({ d: sql<string>`to_char(${workflowInstances.updatedAt}, 'YYYY-MM-DD')`, c: sql<number>`count(*)::int` })
      .from(workflowInstances)
      .where(and(...instConds, inArray(workflowInstances.status, FINISHED), gte(workflowInstances.updatedAt, since14)))
      .groupBy(sql`to_char(${workflowInstances.updatedAt}, 'YYYY-MM-DD')`),
    // 9. 已超时挂起任务数
    // TODO(workflow-jobs P5): timeout/due-soon counts now use pending task_timeout jobs; jobs may slightly lag task state.
    db.select({ count: sql<number>`count(*)::int` })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .innerJoin(workflowJobs, eq(workflowJobs.taskId, workflowTasks.id))
      .where(and(...instConds, eq(workflowTasks.status, 'pending'), eq(workflowJobs.jobType, 'task_timeout'), eq(workflowJobs.status, 'pending'), sql`${workflowJobs.runAt} <= now()`)),
    // 10. 24h 内即将超时的挂起任务数
    db.select({ count: sql<number>`count(*)::int` })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .innerJoin(workflowJobs, eq(workflowJobs.taskId, workflowTasks.id))
      .where(and(...instConds, eq(workflowTasks.status, 'pending'), eq(workflowJobs.jobType, 'task_timeout'), eq(workflowJobs.status, 'pending'), sql`${workflowJobs.runAt} > now() and ${workflowJobs.runAt} < now() + interval '24 hours'`)),
    // 11. 作业健康（按状态计数）
    db.select({ status: workflowJobs.status, count: sql<number>`count(*)::int` }).from(workflowJobs).groupBy(workflowJobs.status),
    // 12. Webhook 投递（按状态计数）
    db.select({ status: workflowJobs.status, count: sql<number>`count(*)::int` }).from(workflowJobs).where(eq(workflowJobs.jobType, 'webhook_delivery')).groupBy(workflowJobs.status),
    // 13. 子流程实例（按状态计数）
    db.select({ status: workflowInstances.status, count: sql<number>`count(*)::int` }).from(workflowInstances).where(sql`${workflowInstances.parentInstanceId} is not null`).groupBy(workflowInstances.status),
  ]);
  const sumc = (rows: Array<{ status: string; count: number }>, ...st: string[]) => rows.filter((r) => st.includes(r.status)).reduce((s, r) => s + r.count, 0);
  const jobsTotal = sumc(jobRows, 'pending', 'running', 'succeeded', 'failed', 'dead', 'canceled');
  const jobsFailed = sumc(jobRows, 'failed'), jobsDead = sumc(jobRows, 'dead');
  const whTotal = sumc(webhookRows, 'succeeded', 'failed', 'dead'), whOk = sumc(webhookRows, 'succeeded');
  const subTotal = subRows.reduce((s, r) => s + r.count, 0), subRej = sumc(subRows, 'rejected');
  const automation = {
    jobsTotal, jobsFailed, jobsDead, jobFailRate: jobsTotal > 0 ? (jobsFailed + jobsDead) / jobsTotal : null,
    webhookTotal: whTotal, webhookSuccessRate: whTotal > 0 ? whOk / whTotal : null,
    subprocessTotal: subTotal, subprocessFailRate: subTotal > 0 ? subRej / subTotal : null,
  };

  const statusCounts = statusRows.map((r) => ({ status: r.status, count: r.count }));
  const total = statusCounts.reduce((sum, s) => sum + s.count, 0);
  const round = (v: number | null | undefined) => (v == null ? null : Math.round(Number(v)));

  // 驳回率 / 超时率
  const approvedCount = statusCounts.find((s) => s.status === 'approved')?.count ?? 0;
  const rejectedCount = statusCounts.find((s) => s.status === 'rejected')?.count ?? 0;
  const decidedCount = approvedCount + rejectedCount;
  const rejectionRate = decidedCount > 0 ? rejectedCount / decidedCount : null;
  const pendingTaskCount = pendingRow[0]?.count ?? 0;
  const overdueTaskCount = overdueRow[0]?.count ?? 0;
  const timeoutRate = pendingTaskCount > 0 ? overdueTaskCount / pendingTaskCount : null;

  // 趋势序列补齐 14 天
  const createdMap = new Map(createdTrend.map((r) => [r.d, r.c]));
  const completedMap = new Map(completedTrend.map((r) => [r.d, r.c]));
  const trend: WorkflowAnalyticsTrendPoint[] = [];
  const runningNow = statusCounts.find((s) => s.status === 'running')?.count ?? 0;
  let net = 0; for (let i = 13; i >= 0; i--) { const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD'); net += (createdMap.get(d) ?? 0) - (completedMap.get(d) ?? 0); }
  let backlog = runningNow - net; // 14 天前的积压基线
  for (let i = 13; i >= 0; i--) {
    const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
    backlog += (createdMap.get(d) ?? 0) - (completedMap.get(d) ?? 0);
    trend.push({ date: d, created: createdMap.get(d) ?? 0, completed: completedMap.get(d) ?? 0, pending: Math.max(0, backlog) });
  }

  return {
    statusCounts,
    total,
    avgDurationSec: round(avgRow[0]?.avg),
    pendingTaskCount,
    overdueTaskCount,
    dueSoonTaskCount: dueSoonRow[0]?.count ?? 0,
    recentCreated: recentRow[0]?.count ?? 0,
    rejectionRate,
    timeoutRate,
    definitionStats: definitionRows.map((r) => ({
      definitionId: r.definitionId,
      definitionName: r.definitionName,
      total: r.total,
      running: r.running,
      approved: r.approved,
      rejected: r.rejected,
      avgDurationSec: round(r.avgDurationSec),
    })),
    nodeBottlenecks: nodeRows.map((r) => ({
      definitionId: r.definitionId,
      definitionName: r.definitionName,
      nodeKey: r.nodeKey,
      nodeName: r.nodeName,
      avgHandleSec: round(r.avgHandleSec),
      pendingCount: r.pendingCount,
      doneCount: r.doneCount,
    })),
    approverWorkloads: approverRows
      .filter((r) => r.userId != null)
      .map((r) => ({
        userId: r.userId as number,
        userName: r.userName,
        pendingCount: r.pendingCount,
        handledCount: r.handledCount,
        oldestPendingSec: round(r.oldestPendingSec),
      })),
    automation,
    trend,
  };
}

/** 超时待办预警列表（已超时仍 pending 的任务，按到期时间正序） */
export async function listOverdueTasks(query: { page?: number; pageSize?: number; definitionId?: number } = {}): Promise<{ list: WorkflowOverdueTask[]; total: number; page: number; pageSize: number }> {
  const user = currentUser();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const instTenant = tenantCondition(workflowInstances, user);
  const conds: SQL[] = [
    eq(workflowTasks.status, 'pending'),
    eq(workflowJobs.jobType, 'task_timeout'),
    eq(workflowJobs.status, 'pending'),
    sql`${workflowJobs.runAt} <= now()`,
  ];
  if (instTenant) conds.push(instTenant);
  if (query.definitionId) conds.push(eq(workflowInstances.definitionId, query.definitionId));
  const where = and(...conds);
  const assignee = users;
  const [countRows, rows] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .innerJoin(workflowJobs, eq(workflowJobs.taskId, workflowTasks.id))
      .where(where),
    db.select({
      taskId: workflowTasks.id,
      instanceId: workflowInstances.id,
      instanceTitle: workflowInstances.title,
      serialNo: workflowInstances.serialNo,
      definitionName: workflowDefinitions.name,
      nodeName: workflowTasks.nodeName,
      assigneeId: workflowTasks.assigneeId,
      assigneeName: assignee.nickname,
      timeoutAt: workflowJobs.runAt,
    })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .innerJoin(workflowJobs, eq(workflowJobs.taskId, workflowTasks.id))
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .leftJoin(assignee, eq(workflowTasks.assigneeId, assignee.id))
      .where(where)
      .orderBy(asc(workflowJobs.runAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);
  const now = Date.now();
  const list: WorkflowOverdueTask[] = rows.map((r) => ({
    taskId: r.taskId,
    instanceId: r.instanceId,
    instanceTitle: r.instanceTitle,
    serialNo: r.serialNo ?? null,
    definitionName: r.definitionName ?? '—',
    nodeName: r.nodeName,
    assigneeId: r.assigneeId ?? null,
    assigneeName: r.assigneeName ?? null,
    timeoutAt: r.timeoutAt ? formatDateTime(r.timeoutAt) : '',
    overdueSec: r.timeoutAt ? Math.round((now - r.timeoutAt.getTime()) / 1000) : 0,
  }));
  return { list, total: countRows[0]?.c ?? 0, page, pageSize };
}

const INSTANCE_STATUS_TEXT: Record<string, string> = WORKFLOW_INSTANCE_STATUS_LABELS;

/** 流程实例导出查询条件（与监控筛选一致） */
export interface WorkflowInstanceExportQuery {
  status?: string;
  keyword?: string;
  categoryId?: number;
  definitionId?: number;
  initiatorKeyword?: string;
}

function buildInstancesExportWhere(query: WorkflowInstanceExportQuery) {
  const user = currentUser();
  const conds: SQL[] = [];
  const tc = tenantCondition(workflowInstances, user);
  if (tc) conds.push(tc);
  if (query.status) conds.push(eq(workflowInstances.status, query.status as WorkflowInstanceStatus));
  if (query.keyword) {
    const lk = `%${escapeLike(query.keyword)}%`;
    conds.push(or(ilike(workflowInstances.title, lk), ilike(workflowDefinitions.name, lk))!);
  }
  if (query.categoryId) conds.push(eq(workflowDefinitions.categoryId, query.categoryId));
  if (query.definitionId) conds.push(eq(workflowInstances.definitionId, query.definitionId));
  if (query.initiatorKeyword) conds.push(ilike(users.nickname, `%${escapeLike(query.initiatorKeyword)}%`));
  return conds.length ? and(...conds) : undefined;
}

/** 导出流程实例列表（与监控筛选一致，最多 10000 行），返回展示就绪的行 */
export async function getWorkflowInstancesForExport(query: WorkflowInstanceExportQuery = {}) {
  const where = buildInstancesExportWhere(query);
  const rows = await db.select({
    serialNo: workflowInstances.serialNo,
    title: workflowInstances.title,
    definitionName: workflowDefinitions.name,
    categoryName: workflowCategories.name,
    initiatorName: users.nickname,
    status: workflowInstances.status,
    createdAt: workflowInstances.createdAt,
    updatedAt: workflowInstances.updatedAt,
  })
    .from(workflowInstances)
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .leftJoin(workflowCategories, eq(workflowDefinitions.categoryId, workflowCategories.id))
    .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
    .where(where)
    .orderBy(desc(workflowInstances.id))
    .limit(10000);
  return rows.map((r) => ({
    serialNo: r.serialNo ?? '',
    title: r.title,
    definitionName: r.definitionName ?? '',
    categoryName: r.categoryName ?? '',
    initiatorName: r.initiatorName ?? '',
    status: INSTANCE_STATUS_TEXT[r.status] ?? r.status,
    createdAt: formatDateTime(r.createdAt),
    updatedAt: formatDateTime(r.updatedAt),
  }));
}

/** 统计流程实例导出行数（与导出筛选一致，封顶 10000） */
export async function countWorkflowInstancesForExport(query: WorkflowInstanceExportQuery = {}): Promise<number> {
  const where = buildInstancesExportWhere(query);
  const [row] = await db.select({ value: sql<number>`count(*)` })
    .from(workflowInstances)
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
    .where(where);
  return Math.min(Number(row?.value ?? 0), 10000);
}
