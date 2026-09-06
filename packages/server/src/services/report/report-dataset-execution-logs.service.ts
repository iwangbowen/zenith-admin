/**
 * 报表数据集执行日志：执行日志列表查询与执行统计（成功率 / P95 / 慢查询 Top / 成本趋势）。
 * 对外统一经 report-dataset.service.ts facade 暴露。
 */
import dayjs from 'dayjs';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db, readSnapshot } from '../../db';
import { reportDatasetExecutionLogs, reportDatasets, reportDatasources, users } from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime } from '../../lib/datetime';
import { reportTenantScope } from './report-access';
import {
  getReportQueryCapacitySnapshot,
  getReportQueryCostTrend,
} from './report-query-capacity.service';
import { getReportRuntimeGovernance } from './report-dataset-shared';
import type { ReportDatasetExecutionLog, ReportExecutionStats } from '@zenith/shared/report';
import { buildWhere } from '../../lib/where-helpers';
import { buildListResult } from '../../lib/list-query';

function mapDatasetExecutionLog(row: {
  id: number;
  datasetId: number | null;
  datasetName: string | null;
  datasourceId: number | null;
  datasourceName: string | null;
  userId: number | null;
  username: string | null;
  tenantId: number | null;
  scene: string;
  sourceRefId: string | null;
  durationMs: number;
  rowCount: number | null;
  bytes: number | null;
  truncated: boolean;
  slow: boolean;
  cacheHit: boolean;
  success: boolean;
  errorCode: number | null;
  errorMessage: string | null;
  paramKeys: string[];
  executedAt: Date;
}): ReportDatasetExecutionLog {
  return {
    id: row.id,
    datasetId: row.datasetId,
    datasetName: row.datasetName,
    datasourceId: row.datasourceId,
    datasourceName: row.datasourceName,
    userId: row.userId,
    username: row.username,
    tenantId: row.tenantId,
    scene: row.scene,
    sourceRefId: row.sourceRefId,
    durationMs: row.durationMs,
    rowCount: row.rowCount,
    bytes: row.bytes,
    truncated: row.truncated,
    slow: row.slow,
    cacheHit: row.cacheHit,
    success: row.success,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    paramKeys: row.paramKeys ?? [],
    executedAt: formatDateTime(row.executedAt),
  };
}

export async function listDatasetExecutionLogs(query: {
  page?: number;
  pageSize?: number;
  datasetId?: number;
  datasourceId?: number;
  scene?: string;
  success?: boolean;
  dashboardId?: number;
  slow?: boolean;
  startAt?: Date;
  endAt?: Date;
}) {
  const { page = 1, pageSize = 20, datasetId, datasourceId, scene, success, dashboardId, slow, startAt, endAt } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportDatasetExecutionLogs);
  if (tenantScope) conds.push(tenantScope);
  if (datasetId) conds.push(eq(reportDatasetExecutionLogs.datasetId, datasetId));
  if (datasourceId) conds.push(eq(reportDatasetExecutionLogs.datasourceId, datasourceId));
  if (scene) conds.push(eq(reportDatasetExecutionLogs.scene, scene));
  if (success !== undefined) conds.push(eq(reportDatasetExecutionLogs.success, success));
  if (dashboardId) conds.push(and(eq(reportDatasetExecutionLogs.scene, 'dashboard'), eq(reportDatasetExecutionLogs.sourceRefId, String(dashboardId))));
  if (slow !== undefined) conds.push(eq(reportDatasetExecutionLogs.slow, slow));
  if (startAt) conds.push(gte(reportDatasetExecutionLogs.executedAt, startAt));
  if (endAt) conds.push(lte(reportDatasetExecutionLogs.executedAt, endAt));
  const where = buildWhere(...conds);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(reportDatasetExecutionLogs, where),
    rows: () => db.select({
      id: reportDatasetExecutionLogs.id,
      datasetId: reportDatasetExecutionLogs.datasetId,
      datasetName: reportDatasets.name,
      datasourceId: reportDatasetExecutionLogs.datasourceId,
      datasourceName: reportDatasources.name,
      userId: reportDatasetExecutionLogs.userId,
      username: users.username,
      tenantId: reportDatasetExecutionLogs.tenantId,
      scene: reportDatasetExecutionLogs.scene,
      sourceRefId: reportDatasetExecutionLogs.sourceRefId,
      durationMs: reportDatasetExecutionLogs.durationMs,
      rowCount: reportDatasetExecutionLogs.rowCount,
      bytes: reportDatasetExecutionLogs.bytes,
      truncated: reportDatasetExecutionLogs.truncated,
      slow: reportDatasetExecutionLogs.slow,
      cacheHit: reportDatasetExecutionLogs.cacheHit,
      success: reportDatasetExecutionLogs.success,
      errorCode: reportDatasetExecutionLogs.errorCode,
      errorMessage: reportDatasetExecutionLogs.errorMessage,
      paramKeys: reportDatasetExecutionLogs.paramKeys,
      executedAt: reportDatasetExecutionLogs.executedAt,
    })
      .from(reportDatasetExecutionLogs)
      .leftJoin(reportDatasets, eq(reportDatasets.id, reportDatasetExecutionLogs.datasetId))
      .leftJoin(reportDatasources, eq(reportDatasources.id, reportDatasetExecutionLogs.datasourceId))
      .leftJoin(users, eq(users.id, reportDatasetExecutionLogs.userId))
      .where(where)
      .orderBy(desc(reportDatasetExecutionLogs.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    map: (row) => mapDatasetExecutionLog({
      ...row,
      datasourceName: row.datasourceName ?? null,
      paramKeys: (row.paramKeys ?? []) as string[],
    }),
  });
}

export async function getDatasetExecutionStats(query: {
  datasetId?: number;
  datasourceId?: number;
  dashboardId?: number;
  scene?: string;
  success?: boolean;
  startAt?: Date;
  endAt?: Date;
}): Promise<ReportExecutionStats> {
  const conds = [];
  const tenantScope = reportTenantScope(reportDatasetExecutionLogs);
  if (tenantScope) conds.push(tenantScope);
  if (query.datasetId) conds.push(eq(reportDatasetExecutionLogs.datasetId, query.datasetId));
  if (query.datasourceId) conds.push(eq(reportDatasetExecutionLogs.datasourceId, query.datasourceId));
  if (query.scene) conds.push(eq(reportDatasetExecutionLogs.scene, query.scene));
  if (query.success !== undefined) conds.push(eq(reportDatasetExecutionLogs.success, query.success));
  if (query.dashboardId) conds.push(and(eq(reportDatasetExecutionLogs.scene, 'dashboard'), eq(reportDatasetExecutionLogs.sourceRefId, String(query.dashboardId))));
  if (query.startAt) conds.push(gte(reportDatasetExecutionLogs.executedAt, query.startAt));
  if (query.endAt) conds.push(lte(reportDatasetExecutionLogs.executedAt, query.endAt));
  const where = buildWhere(...conds);
  const trendStart = query.startAt ?? dayjs().subtract(7, 'day').toDate();
  const trendEnd = query.endAt ?? new Date();
  // 汇总与慢查询 Top 来自同一张日志表，必须取同一数据快照，否则并发写入下
  // 「总数 / 成功率」与「慢查询榜单」互相矛盾；成本趋势走独立预聚合，无需入快照。
  const [aggRows, slowRows] = await readSnapshot((tx) => Promise.all([
   tx.select({
     total: sql<number>`count(*)::int`,
     successCount: sql<number>`sum(case when ${reportDatasetExecutionLogs.success} then 1 else 0 end)::int`,
     avgDurationMs: sql<number | null>`round(avg(${reportDatasetExecutionLogs.durationMs}))::int`,
     p95DurationMs: sql<number | null>`round(percentile_cont(0.95) within group (order by ${reportDatasetExecutionLogs.durationMs}))::int`,
     cacheHitCount: sql<number>`sum(case when ${reportDatasetExecutionLogs.cacheHit} then 1 else 0 end)::int`,
     slowCount: sql<number>`sum(case when ${reportDatasetExecutionLogs.slow} then 1 else 0 end)::int`,
     truncatedCount: sql<number>`sum(case when ${reportDatasetExecutionLogs.truncated} then 1 else 0 end)::int`,
   }).from(reportDatasetExecutionLogs).where(where),
   tx.select({
     datasetId: reportDatasetExecutionLogs.datasetId,
     datasetName: reportDatasets.name,
     datasourceId: reportDatasetExecutionLogs.datasourceId,
     datasourceName: reportDatasources.name,
     scene: reportDatasetExecutionLogs.scene,
     count: sql<number>`count(*)::int`,
     avgDurationMs: sql<number>`round(avg(${reportDatasetExecutionLogs.durationMs}))::int`,
     maxDurationMs: sql<number>`max(${reportDatasetExecutionLogs.durationMs})::int`,
     lastExecutedAt: sql<Date | null>`max(${reportDatasetExecutionLogs.executedAt})`,
   }).from(reportDatasetExecutionLogs)
     .leftJoin(reportDatasets, eq(reportDatasets.id, reportDatasetExecutionLogs.datasetId))
     .leftJoin(reportDatasources, eq(reportDatasources.id, reportDatasetExecutionLogs.datasourceId))
     .where(where ? and(where, eq(reportDatasetExecutionLogs.slow, true)) : eq(reportDatasetExecutionLogs.slow, true))
     .groupBy(reportDatasetExecutionLogs.datasetId, reportDatasets.name, reportDatasetExecutionLogs.datasourceId, reportDatasources.name, reportDatasetExecutionLogs.scene)
     .orderBy(desc(sql`max(${reportDatasetExecutionLogs.durationMs})`))
     .limit(10),
  ]));
  const series = await getReportQueryCostTrend({
    datasetId: query.datasetId,
    datasourceId: query.datasourceId,
    start: formatDateTime(trendStart),
    end: formatDateTime(trendEnd),
    bucket: dayjs(trendEnd).diff(trendStart, 'hour', true) <= 48 ? 'hour' : 'day',
  });
  const agg = aggRows[0] ?? {
   total: 0, successCount: 0, avgDurationMs: 0, p95DurationMs: 0, cacheHitCount: 0, slowCount: 0, truncatedCount: 0,
  };
  const total = Number(agg.total ?? 0);
  return {
   total,
   successCount: Number(agg.successCount ?? 0),
   successRate: total > 0 ? Math.round((Number(agg.successCount ?? 0) / total) * 10000) / 100 : 0,
   p95DurationMs: Number(agg.p95DurationMs ?? 0),
   avgDurationMs: Number(agg.avgDurationMs ?? 0),
   cacheHitRate: total > 0 ? Math.round((Number(agg.cacheHitCount ?? 0) / total) * 10000) / 100 : 0,
   slowCount: Number(agg.slowCount ?? 0),
   truncatedCount: Number(agg.truncatedCount ?? 0),
   governance: getReportRuntimeGovernance(),
   capacity: getReportQueryCapacitySnapshot(),
   series,
   topSlowQueries: slowRows.map((row) => ({
     datasetId: row.datasetId ?? null,
     datasetName: row.datasetName ?? null,
     datasourceId: row.datasourceId ?? null,
     datasourceName: row.datasourceName ?? null,
     scene: row.scene,
     count: Number(row.count ?? 0),
     avgDurationMs: Number(row.avgDurationMs ?? 0),
     maxDurationMs: Number(row.maxDurationMs ?? 0),
     lastExecutedAt: row.lastExecutedAt ? formatDateTime(row.lastExecutedAt) : null,
   })),
  };
}
