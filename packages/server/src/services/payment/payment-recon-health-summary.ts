import { sql, type SQL } from 'drizzle-orm';
import { paymentReconCases, paymentStatementPeriods } from '../../db/schema';
import type { DbExecutor } from '../../db/types';

/** Both the request summary and platform monitor pass their own authorized scope to the same grouped counts. */
export async function getReconStatusGroups(executor: DbExecutor, scope: { periodWhere?: SQL; caseWhere?: SQL }) {
  const periods = await executor.select({ status: paymentStatementPeriods.status, count: sql<number>`count(*)::int` })
    .from(paymentStatementPeriods).where(scope.periodWhere).groupBy(paymentStatementPeriods.status);
  const cases = await executor.select({ status: paymentReconCases.status, count: sql<number>`count(*)::int`,
    overdue: sql<number>`count(*) filter (where ${paymentReconCases.dueAt} < now())::int`,
  }).from(paymentReconCases).where(scope.caseWhere).groupBy(paymentReconCases.status);
  return { periods, cases };
}

export function reconAttentionCounts(groups: Awaited<ReturnType<typeof getReconStatusGroups>>) {
  return {
    failedPeriods: groups.periods.find(row => row.status === 'failed')?.count ?? 0,
    overdueCases: groups.cases.filter(row => ['open', 'investigating', 'suspended'].includes(row.status))
      .reduce((total, row) => total + row.overdue, 0),
  };
}
