import { and, asc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import type { JobStuckItem } from '@zenith/shared/platform';
import { db, readSnapshot } from '../../db';
import { paymentReconRuns } from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import type { JobSourceRawSummary } from '../../lib/job-monitor/registry';
import { orphanRunCondition } from '../../lib/job-monitor/orphan';
import { getReconStatusGroups, reconAttentionCounts } from './payment-recon-health-summary';

export function stuckPaymentReconRunCondition(asOf = new Date()) {
  return or(orphanRunCondition({ table: paymentReconRuns, statusColumn: paymentReconRuns.status, activeStatuses: ['pending', 'running'],
    taskIdColumn: paymentReconRuns.taskId, startedAtColumn: sql`coalesce(${paymentReconRuns.startedAt}, ${paymentReconRuns.createdAt})`, asOf }),
    and(eq(paymentReconRuns.status, 'running'), lt(paymentReconRuns.startedAt, new Date(asOf.getTime() - 60 * 60_000))));
}

/** Platform-only caller; the domain's request summary keeps passing tenant and account filters independently. */
export async function getPaymentReconHealth(): Promise<JobSourceRawSummary> {
  return readSnapshot(async executor => {
    const now = new Date();
    const since = new Date(now.getTime() - 86_400_000);
    const hour = new Date(now.getTime() - 3_600_000);
    const [row] = await executor.select({
      stuck: sql<number>`count(*) filter (where ${stuckPaymentReconRunCondition(now)})::int`,
      failed24h: sql<number>`count(*) filter (where ${paymentReconRuns.status} = 'failed' and ${paymentReconRuns.finishedAt} >= ${sql.param(since, paymentReconRuns.finishedAt)})::int`,
      succeeded24h: sql<number>`count(*) filter (where ${paymentReconRuns.status} = 'completed' and ${paymentReconRuns.finishedAt} >= ${sql.param(since, paymentReconRuns.finishedAt)})::int`,
      failed1h: sql<number>`count(*) filter (where ${paymentReconRuns.status} = 'failed' and ${paymentReconRuns.finishedAt} >= ${sql.param(hour, paymentReconRuns.finishedAt)})::int`,
    }).from(paymentReconRuns).where(or(inArray(paymentReconRuns.status, ['pending', 'running']), gte(paymentReconRuns.finishedAt, since)));
    const attention = reconAttentionCounts(await getReconStatusGroups(executor, {}));
    const issues: JobSourceRawSummary['issues'] = [];
    if (attention.failedPeriods > 0) issues.push({ level: 'warn', message: `${attention.failedPeriods} 个对账账期获取失败` });
    if (attention.overdueCases > 0) issues.push({ level: 'warn', message: `${attention.overdueCases} 个未结案对账差异已超过处理时限` });
    return {
      counts: { pending: 0, running: 0, stuck: row?.stuck ?? 0, dead: null, failed24h: row?.failed24h ?? 0, succeeded24h: row?.succeeded24h ?? 0 },
      oldestPendingAgeSec: null, failed1h: row?.failed1h ?? 0, issues,
    };
  });
}

export async function listStuckPaymentReconRuns(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({ id: paymentReconRuns.id, statementId: paymentReconRuns.statementId, status: paymentReconRuns.status,
    startedAt: paymentReconRuns.startedAt, createdAt: paymentReconRuns.createdAt, updatedAt: paymentReconRuns.updatedAt, error: paymentReconRuns.error,
  }).from(paymentReconRuns).where(stuckPaymentReconRunCondition(now)).orderBy(asc(paymentReconRuns.createdAt), asc(paymentReconRuns.id)).limit(limit);
  return rows.map(row => ({
    source: 'payment-recon', refId: String(row.id), title: `账单 #${row.statementId} / 对账 #${row.id}`, status: row.status,
    startedAt: formatNullableDateTime(row.startedAt), lastSeenAt: formatDateTime(row.updatedAt),
    ageSec: Math.max(0, Math.floor((now.getTime() - (row.startedAt ?? row.createdAt).getTime()) / 1000)), nodeId: null,
    detail: row.error ?? '关联任务已结束或失联，或运行已超过 60 分钟', drillDown: { path: '/payment/recon', label: '查看支付对账' },
  }));
}
