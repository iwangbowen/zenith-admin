import { workflowInstanceContract } from '@zenith/shared/workflow';
import type { QueryOutputOf } from '@zenith/shared/core';
import { asc, eq, gte, desc, exists, inArray, sql, and, isNotNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { workflowMonitorScope } from './workflow-access';
import { db, readSnapshot } from '../../db';
import { workflowInstances, workflowTasks, workflowDefinitions, workflowCategories, workflowJobs, workflowJobExecutions, users, workflowNodeActivations } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { getDataScopeCondition } from '../../lib/data-scope';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { buildDateAxis, formatDateTime, formatTimestamps, startOfRecentDays, APP_TIME_ZONE } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';
import type { WorkflowAnalytics, WorkflowInstanceStatus, WorkflowAnalyticsTrendPoint, WorkflowOverdueTask } from '@zenith/shared/workflow';
import { WORKFLOW_INSTANCE_STATUS_LABELS } from '@zenith/shared/workflow';
import { localDate } from "../../lib/datetime-sql";

const FINISHED: WorkflowInstanceStatus[] = ['approved', 'rejected', 'withdrawn', 'cancelled'];

export async function getWorkflowAnalytics(query: QueryOutputOf<typeof workflowInstanceContract.analytics> = {}): Promise<WorkflowAnalytics> {
  const user = currentUser();
  const scope = await getDataScopeCondition({ currentUserId: user.userId, deptColumn: users.departmentId, ownerColumn: workflowInstances.initiatorId });
  return readSnapshot(async tx => {
    const instScope = scope ? exists(tx.select({ id: users.id }).from(users).where(buildWhere(eq(users.id, workflowInstances.initiatorId), scope))) : undefined;
    const instTenant = buildWhere(tenantCondition(workflowInstances, user), instScope);
    const instDefinition = query.definitionId ? eq(workflowInstances.definitionId, query.definitionId) : undefined;
    // 实例级筛选（监控可按流程定义过滤）；各统计项在 instConds 之上叠加自身条件
    const days = query.days ?? 14;
    const asOf = new Date();
    const since14 = startOfRecentDays(days);
    const timeAxis = query.timeAxis ?? 'created';
    const axisColumn = timeAxis === 'created' ? workflowInstances.createdAt : timeAxis === 'completed' ? workflowInstances.completedAt : workflowInstances.submittedAt;
    const instWhere = buildWhere(instTenant, instDefinition, gte(axisColumn, since14));
    const actionable = and(eq(workflowTasks.status, 'pending'), eq(workflowTasks.taskKind, 'approval'), eq(workflowInstances.status, 'running'));
    const child = alias(workflowInstances, 'analytics_child');
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60_000);

    const durationExpr = sql<number | null>`avg(extract(epoch from (${workflowInstances.completedAt} - ${workflowInstances.submittedAt})))`;

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
    ] = [
      // 1. 各状态计数
      await tx.select({ status: workflowInstances.status, count: sql<number>`count(*)::int` })
        .from(workflowInstances).where(instWhere).groupBy(workflowInstances.status),
      // 2. 已完结实例平均耗时
      await tx.select({ avg: durationExpr })
        .from(workflowInstances)
        .where(buildWhere(instWhere, inArray(workflowInstances.status, FINISHED), isNotNull(workflowInstances.submittedAt))),
      // 3. 当前挂起任务总数
      await tx.select({ count: sql<number>`count(*)::int` })
        .from(workflowTasks)
        .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
        .where(buildWhere(instTenant, instDefinition, actionable)),
      // 4. 近 7 天发起数
      await tx.select({ count: sql<number>`count(*)::int` })
        .from(workflowInstances)
        .where(buildWhere(instTenant, instDefinition, gte(workflowInstances.submittedAt, since7))),
      // 5. 各流程定义统计
      await tx.select({
        definitionId: workflowInstances.definitionId,
        definitionName: workflowDefinitions.name,
        total: sql<number>`count(*)::int`,
        running: sql<number>`count(*) filter (where ${workflowInstances.status}::text = 'running')::int`,
        approved: sql<number>`count(*) filter (where ${workflowInstances.status}::text = 'approved')::int`,
        rejected: sql<number>`count(*) filter (where ${workflowInstances.status}::text = 'rejected')::int`,
        avgDurationSec: sql<number | null>`avg(extract(epoch from (${workflowInstances.completedAt} - ${workflowInstances.submittedAt}))) filter (where ${workflowInstances.status}::text in ('approved','rejected','withdrawn','cancelled'))`,
      })
        .from(workflowInstances)
        .innerJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
        .where(instWhere)
        .groupBy(workflowInstances.definitionId, workflowDefinitions.name)
        .orderBy(desc(sql`count(*)`))
        .limit(12),
      // 6. 节点瓶颈：人工节点的平均处理时长 / 挂起数
      await tx.select({
        definitionId: workflowInstances.definitionId,
        definitionName: workflowDefinitions.name,
        nodeKey: workflowTasks.nodeKey,
        nodeName: workflowTasks.nodeName,
        avgHandleSec: sql<number | null>`avg(extract(epoch from (${workflowTasks.actionAt} - coalesce(${workflowTasks.activatedAt}, ${workflowTasks.createdAt})))) filter (where ${workflowTasks.status} in ('approved','rejected') and ${workflowTasks.taskKind}='approval')`,
        pendingCount: sql<number>`count(*) filter (where ${actionable})::int`,
        doneCount: sql<number>`count(*) filter (where ${workflowTasks.status}::text in ('approved','rejected'))::int`,
      })
        .from(workflowTasks)
        .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
        .innerJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
        .innerJoin(workflowNodeActivations, eq(workflowTasks.activationId, workflowNodeActivations.id))
        .where(buildWhere(instTenant, instDefinition, eq(workflowTasks.taskKind, 'approval'), inArray(workflowTasks.nodeType, ['approve', 'handler']), eq(workflowNodeActivations.includeInEfficiencyStats, true)))
        .groupBy(workflowInstances.definitionId, workflowDefinitions.name, workflowTasks.nodeKey, workflowTasks.nodeName)
        .orderBy(desc(sql`count(*) filter (where ${actionable})`), desc(sql`avg(extract(epoch from (${workflowTasks.actionAt} - coalesce(${workflowTasks.activatedAt}, ${workflowTasks.createdAt}))))`))
        .limit(10),
      // 7. 审批人工作量（待办 + 已处理）
      await tx.select({
        userId: workflowTasks.assigneeId,
        userName: sql<string>`coalesce(${users.nickname}, ${users.username})`,
        pendingCount: sql<number>`count(*) filter (where ${actionable})::int`,
        handledCount: sql<number>`count(*) filter (where ${workflowTasks.status}::text in ('approved','rejected'))::int`,
        oldestPendingSec: sql<number | null>`extract(epoch from (now() - min(${workflowTasks.createdAt}) filter (where ${actionable})))`,
      })
        .from(workflowTasks)
        .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
        .innerJoin(users, eq(workflowTasks.assigneeId, users.id))
        .where(buildWhere(instTenant, instDefinition, eq(workflowTasks.taskKind, 'approval'), inArray(workflowTasks.status, ['pending', 'approved', 'rejected'])))
        .groupBy(workflowTasks.assigneeId, users.nickname, users.username)
        .orderBy(desc(sql`count(*) filter (where ${actionable})`), desc(sql`count(*)`))
        .limit(10),
      // 8a. 近 14 天发起趋势
      await tx.select({ d: localDate(workflowInstances.submittedAt), c: sql<number>`count(*)::int` })
        .from(workflowInstances)
        .where(buildWhere(instTenant, instDefinition, gte(workflowInstances.submittedAt, since14)))
        .groupBy(localDate(workflowInstances.submittedAt)),
      // 8b. 近 14 天完结趋势
      await tx.select({ d: localDate(workflowInstances.completedAt), c: sql<number>`count(*)::int` })
        .from(workflowInstances)
        .where(buildWhere(instTenant, instDefinition, inArray(workflowInstances.status, FINISHED), gte(workflowInstances.completedAt, since14)))
        .groupBy(localDate(workflowInstances.completedAt)),
      // 9. 已超时挂起任务数：仍 pending 且其 task_timeout 作业已到期未执行
      await tx.select({ count: sql<number>`count(*)::int` })
        .from(workflowTasks)
        .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
        .where(buildWhere(instTenant, instDefinition, actionable, sql`${workflowTasks.slaDeadline} <= now()`)),
      // 10. 24h 内即将超时的挂起任务数
      await tx.select({ count: sql<number>`count(*)::int` })
        .from(workflowTasks)
        .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
        .where(buildWhere(instTenant, instDefinition, actionable, sql`${workflowTasks.slaDeadline} > now() and ${workflowTasks.slaDeadline} <= now() + interval '24 hours'`)),
      // 11. 作业健康（按状态计数）
      await tx.select({ status: workflowJobs.status, count: sql<number>`count(*)::int` }).from(workflowJobs).leftJoin(workflowInstances, eq(workflowJobs.instanceId, workflowInstances.id)).where(instWhere).groupBy(workflowJobs.status),
      // 12. Webhook 投递（按状态计数）
      await tx.select({ status: workflowJobs.status, count: sql<number>`count(*)::int` }).from(workflowJobs).leftJoin(workflowInstances, eq(workflowJobs.instanceId, workflowInstances.id)).where(buildWhere(instWhere, eq(workflowJobs.jobType, 'webhook_delivery'))).groupBy(workflowJobs.status),
      // 13. 子流程实例（按状态计数）
      await tx.select({ status: child.status, count: sql<number>`count(*)::int` }).from(child).innerJoin(workflowInstances, eq(child.parentInstanceId, workflowInstances.id)).where(buildWhere(instTenant, instDefinition)).groupBy(child.status),
    ];
    const sumc = (rows: Array<{ status: string; count: number }>, ...st: string[]) => rows.filter((r) => st.includes(r.status)).reduce((s, r) => s + r.count, 0);
    const jobsTotal = jobRows.reduce((sum, row) => sum + row.count, 0);
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
    const [decisions] = await tx.select({ rejected: sql<number>`count(*) filter(where ${workflowInstances.outcomeReason}='business_rejected')::int` }).from(workflowInstances).where(instWhere);
    const rejectedCount = Number(decisions?.rejected ?? 0);
    const decidedCount = approvedCount + rejectedCount;
    const rejectionRate = decidedCount > 0 ? rejectedCount / decidedCount : null;
    const pendingTaskCount = pendingRow[0]?.count ?? 0;
    const overdueTaskCount = overdueRow[0]?.count ?? 0;
    const timeoutRate = pendingTaskCount > 0 ? overdueTaskCount / pendingTaskCount : null;

    // 趋势序列补齐 14 天
    const createdMap = new Map(createdTrend.map((r) => [r.d, r.c]));
    const completedMap = new Map(completedTrend.map((r) => [r.d, r.c]));
    const trend: WorkflowAnalyticsTrendPoint[] = [];
    const dates = buildDateAxis(since14, days);
    const backlogRows = await tx.execute<{ date: string; pending: number | null }>(sql`
      select to_char(d, 'YYYY-MM-DD') as date, case when exists (select 1 from workflow_instances where ${instTenant ?? sql`true`} and ${instDefinition ?? sql`true`} and created_at <= (d + interval '1 day') at time zone ${APP_TIME_ZONE} and not exists (select 1 from workflow_instance_transitions h where h.instance_id=workflow_instances.id)) then null else
      (select count(*)::int from workflow_instances where ${instTenant ?? sql`true`} and ${instDefinition ?? sql`true`} and (select h.to_status from workflow_instance_transitions h where h.instance_id=workflow_instances.id and h.occurred_at < (d + interval '1 day') at time zone ${APP_TIME_ZONE} order by h.occurred_at desc,h.id desc limit 1)='running') end as pending
      from generate_series(${since14.toISOString()}::timestamptz at time zone ${APP_TIME_ZONE}, ${asOf.toISOString()}::timestamptz at time zone ${APP_TIME_ZONE}, interval '1 day') d
    `);
    const backlogByDay = new Map(backlogRows.map(r => [r.date, r.pending]));
    for (const d of dates) {
      trend.push({ date: d, created: createdMap.get(d) ?? 0, completed: completedMap.get(d) ?? 0, pending: backlogByDay.get(d) ?? null });
    }
    const durationSeconds = sql`extract(epoch from (${workflowInstances.completedAt} - ${workflowInstances.submittedAt}))`;
    const [duration] = await tx.select({ samples: sql<number>`count(${workflowInstances.submittedAt})::int`, medianSec: sql<number | null>`percentile_cont(0.5) within group (order by ${durationSeconds})`, p90Sec: sql<number | null>`percentile_cont(0.9) within group (order by ${durationSeconds})`, unsupportedInstances: sql<number>`count(*) filter (where ${workflowInstances.submittedAt} is null)::int` }).from(workflowInstances).where(buildWhere(instWhere, inArray(workflowInstances.status, FINISHED)));
    const [waits] = await tx.select({ waiting: sql<number>`count(*) filter(where ${workflowTasks.status}='waiting')::int`, suspended: sql<number>`count(*) filter(where ${workflowTasks.status}='pending' and ${workflowInstances.status}='suspended')::int` }).from(workflowTasks).innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id)).where(buildWhere(instTenant, instDefinition));
    const [attempts] = await tx.select({ failed: sql<number>`count(*) filter(where ${workflowJobExecutions.status}='failed')::int`, success: sql<number>`count(*) filter(where ${workflowJobExecutions.status}='succeeded')::int` }).from(workflowJobExecutions).innerJoin(workflowJobs, eq(workflowJobExecutions.jobId, workflowJobs.id)).innerJoin(workflowInstances, eq(workflowJobs.instanceId, workflowInstances.id)).where(buildWhere(instTenant, instDefinition, gte(workflowJobExecutions.createdAt, since14)));
    automation.jobFailRate = attempts && attempts.failed + attempts.success > 0 ? attempts.failed / (attempts.failed + attempts.success) : null;

    return {
      asOf: formatDateTime(asOf), metricVersion: 'workflow-metrics-v2',
      window: { start: formatDateTime(since14), end: formatDateTime(asOf), timezone: APP_TIME_ZONE, days, timeAxis },
      duration: { samples: Number(duration?.samples ?? 0), medianSec: round(duration?.medianSec), p90Sec: round(duration?.p90Sec), unsupportedInstances: Number(duration?.unsupportedInstances ?? 0) },
      waitingTaskCount: Number(waits?.waiting ?? 0), suspendedTaskCount: Number(waits?.suspended ?? 0),
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
  });
}

/** 超时待办预警列表（已超时仍 pending 的任务，按到期时间正序） */
export async function listOverdueTasks(query: QueryOutputOf<typeof workflowInstanceContract.overdue>): Promise<{ list: WorkflowOverdueTask[]; total: number; page: number; pageSize: number }> {
  const user = currentUser();
  const scope = await getDataScopeCondition({ currentUserId: user.userId, deptColumn: users.departmentId, ownerColumn: workflowInstances.initiatorId });
  const instScope = scope ? exists(db.select({ id: users.id }).from(users).where(buildWhere(eq(users.id, workflowInstances.initiatorId), scope))) : undefined;
  const { page, pageSize } = query;
  const where = buildWhere(
    eq(workflowTasks.status, 'pending'),
    eq(workflowTasks.taskKind, 'approval'),
    eq(workflowInstances.status, 'running'),
    sql`${workflowTasks.slaDeadline} <= now()`,
    tenantCondition(workflowInstances, user),
    instScope,
    query.definitionId ? eq(workflowInstances.definitionId, query.definitionId) : undefined,
  );
  const assignee = users;
  const now = Date.now();
  return buildListResult({
    page,
    pageSize,
    count: () => db.select({ c: sql<number>`count(*)::int` })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .where(where)
      .then((r) => r[0]?.c ?? 0),
    rows: () => withPagination(db.select({
      taskId: workflowTasks.id,
      instanceId: workflowInstances.id,
      instanceTitle: workflowInstances.title,
      serialNo: workflowInstances.serialNo,
      definitionName: workflowDefinitions.name,
      nodeName: workflowTasks.nodeName,
      assigneeId: workflowTasks.assigneeId,
      assigneeName: assignee.nickname,
      timeoutAt: workflowTasks.slaDeadline,
    })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .leftJoin(assignee, eq(workflowTasks.assigneeId, assignee.id))
      .where(where)
      .orderBy(asc(workflowTasks.slaDeadline)).$dynamic(), page, pageSize),
    map: (r): WorkflowOverdueTask => ({
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
    }),
  });
}

const INSTANCE_STATUS_TEXT: Record<string, string> = WORKFLOW_INSTANCE_STATUS_LABELS;

/** 流程实例导出查询条件（与监控筛选一致） */
export type WorkflowInstanceExportQuery = Omit<QueryOutputOf<typeof workflowInstanceContract.monitor>, 'page' | 'pageSize' | 'priority'>;

async function buildInstancesExportWhere(query: WorkflowInstanceExportQuery) {
  const user = currentUser();
  return buildWhere(
    tenantCondition(workflowInstances, user),
    await workflowMonitorScope(),
    query.status ? eq(workflowInstances.status, query.status) : undefined,
    keywordCondition(query.keyword, [workflowInstances.title, workflowDefinitions.name], 'ilike'),
    query.categoryId ? eq(workflowDefinitions.categoryId, query.categoryId) : undefined,
    query.definitionId ? eq(workflowInstances.definitionId, query.definitionId) : undefined,
    keywordCondition(query.initiatorKeyword, [users.nickname], 'ilike'),
  );
}

/** 导出流程实例列表（与监控筛选一致，最多 10000 行），返回展示就绪的行 */
export async function getWorkflowInstancesForExport(query: WorkflowInstanceExportQuery = {}) {
  const where = await buildInstancesExportWhere(query);
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
    ...formatTimestamps(r),
  }));
}

/** 统计流程实例导出行数（与导出筛选一致，封顶 10000） */
export async function countWorkflowInstancesForExport(query: WorkflowInstanceExportQuery = {}): Promise<number> {
  const where = await buildInstancesExportWhere(query);
  const [row] = await db.select({ value: sql<number>`count(*)` })
    .from(workflowInstances)
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
    .where(where);
  return Math.min(Number(row?.value ?? 0), 10000);
}
