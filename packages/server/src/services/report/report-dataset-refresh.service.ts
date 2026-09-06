/**
 * 报表数据集物化快照刷新：手动/任务强制刷新与 Cron 到期分发。
 * 对外统一经 report-dataset.service.ts facade 暴露。
 */
import { requireRow } from '../../lib/db-assert';
import { HTTPException } from 'hono/http-exception';
import { CronExpressionParser } from 'cron-parser';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { reportDatasets, roles, userRoles, users } from '../../db/schema';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { formatDateTime } from '../../lib/datetime';
import { currentUserOrNull, runWithCurrentUser } from '../../lib/context';
import { submitAsyncTask } from '../../lib/task-center';
import { ensureDatasourceEnabled } from './report-datasource.service';
import { reportScopedWhere } from './report-access';
import { ensureReportResourceAccess } from './report-resource-acl.service';
import {
  beginMaterializationSnapshot,
  completeMaterializationSnapshot,
  failMaterializationSnapshot,
  filterIncrementalDelta,
  loadCurrentMaterializationSnapshot,
  mergeIncrementalSnapshot,
  resumeMaterializationSnapshot,
  resolveSnapshotWatermark,
} from './report-materialization.service';
import {
  acquireReportQueryCapacity,
  calculateQueryCost,
  newReportQueryRequestId,
  persistReportQueryCost,
  reserveReportQueryQuota,
  resolveReportQueryIdentity,
  settleReportQueryQuota,
} from './report-query-capacity.service';
import {
  applyRowRulesToSql,
  buildSystemParams,
  resolveDatasetParams,
  resolveEffectiveRowRules,
} from './report-dataset-params';
import {
  MATVIEW_TTL_SECONDS,
  MAX_LIMIT,
  assertMaterializable,
  estimateRowsBytes,
  materializedCacheKey,
  recordDatasetExecutionLog,
  toExecutionError,
} from './report-dataset-shared';
import { runReportData } from './report-dataset-execution.service';
import { isSqlLikeType } from '@zenith/shared/report';
import type { ReportDataResult, ReportField, ReportDatasetContent, ReportDatasetParam, ReportDatasourceConfig, ReportComputedField, ReportDatasetMaterialize, ReportRowRule, ReportSqlDatasetContent } from '@zenith/shared/report';

// ─── 物化快照（定时刷新 + 手动刷新）────────────────────────────────────────────

/** 强制刷新某数据集的物化快照（手动按钮 / 到期 Cron 调用）*/
export async function refreshMaterialization(
  id: number,
  options?: {
    strategy?: 'full' | 'incremental';
    keyField?: string | null;
    deltaWindowMinutes?: number | null;
    expiresAt?: string | null;
    snapshotId?: number;
    isCancelRequested?: () => Promise<boolean>;
    onSnapshotStarted?: (snapshotId: number) => Promise<void>;
  },
): Promise<{ rows: number; snapshotId?: number; cancelled?: boolean }> {
  if (await options?.isCancelRequested?.()) return { rows: 0, cancelled: true };
  const startedAt = Date.now();
  const rowOrUndefined = await db.query.reportDatasets.findFirst({
    where: reportScopedWhere(reportDatasets, eq(reportDatasets.id, id)),
    with: { datasource: { columns: { config: true, status: true, updatedAt: true, id: true, name: true } } },
  });
  const row = requireRow(rowOrUndefined, '数据集不存在');
  if (currentUserOrNull()) await ensureReportResourceAccess('dataset', id, 'editor');
  if (!row.datasource) throw new HTTPException(400, { message: '数据源不存在' });
  ensureDatasourceEnabled(row.datasource);
  const config = (row.datasource?.config ?? {}) as ReportDatasourceConfig;
  const content = (row.content ?? {}) as ReportDatasetContent;
  const declaredFields = (row.fields ?? []) as ReportField[];
  const computed = (row.computedFields ?? []) as ReportComputedField[];
  const materialize = (row.materialize ?? {}) as ReportDatasetMaterialize;
  const strategy = options?.strategy ?? materialize.strategy ?? 'full';
  const keyField = options?.keyField ?? materialize.keyField ?? null;
  const deltaWindowMinutes = options?.deltaWindowMinutes ?? materialize.deltaWindowMinutes ?? null;
  assertMaterializable(
    { ...materialize, enabled: materialize.enabled ?? true, strategy, keyField, deltaWindowMinutes },
    row.type,
    content,
    (row.params ?? []) as ReportDatasetParam[],
    (row.rowRules ?? []) as ReportRowRule[],
  );
  if (strategy === 'incremental') {
    const requiredKeyField = requireRow(keyField, '增量物化必须指定增量键', 400);
    if (declaredFields.length && !declaredFields.some((field) => field.name === requiredKeyField)) {
      throw new HTTPException(400, { message: `增量键不存在：${requiredKeyField}` });
    }
  }
  const previous = strategy === 'incremental' ? await loadCurrentMaterializationSnapshot(id) : null;
  const building = options?.snapshotId
    ? await resumeMaterializationSnapshot(options.snapshotId, id)
    : await beginMaterializationSnapshot({
      datasetId: id,
      tenantId: row.tenantId,
      strategy,
      keyField,
      deltaWindowMinutes,
      expiresAt: options?.expiresAt,
    });
  if (building.status === 'ready') return { rows: building.rowCount, snapshotId: building.id };
  await options?.onSnapshotStarted?.(building.id);
  try {
    const identity = resolveReportQueryIdentity(row.tenantId);
    const requestId = newReportQueryRequestId();
    const queryStartedAt = Date.now();
    let quotaLease: Awaited<ReturnType<typeof reserveReportQueryQuota>> | null = null;
    let capacityLease: Awaited<ReturnType<typeof acquireReportQueryCapacity>> | null = null;
    let result: ReportDataResult;
    try {
      quotaLease = await reserveReportQueryQuota(identity);
      capacityLease = await acquireReportQueryCapacity(row.datasource.id);
      const isSqlLike = isSqlLikeType(row.type);
      const rules = isSqlLike ? resolveEffectiveRowRules(row.rowRules as ReportRowRule[] | null) : [];
      const rawSqlText = isSqlLike ? ((content as ReportSqlDatasetContent).sql ?? '') : '';
      const sqlText = rules.length ? applyRowRulesToSql(rawSqlText, rules) : rawSqlText;
      const governedContent: ReportDatasetContent = rules.length
        ? { ...(content as ReportSqlDatasetContent), sql: sqlText }
        : content;
      const resolvedParams = {
        ...resolveDatasetParams((row.params ?? []) as ReportDatasetParam[], {}),
        ...await buildSystemParams(sqlText),
      };
      result = await runReportData(row.type, config, governedContent, resolvedParams, MAX_LIMIT, declaredFields, computed);
      const durationMs = Date.now() - queryStartedAt;
      const bytes = result.bytes ?? estimateRowsBytes(result.rows);
      const costUnits = calculateQueryCost({
        durationMs,
        rows: result.rows.length,
        bytes,
        cacheHit: false,
      });
      try {
        await settleReportQueryQuota(quotaLease, { rows: result.rows.length, bytes, costUnits });
      } catch (settleError) {
        logger.warn('结算物化查询配额失败', {
          datasetId: id,
          err: settleError instanceof Error ? settleError.message : String(settleError),
        });
      }
      try {
        await persistReportQueryCost({
          identity,
          datasetId: id,
          datasourceId: row.datasource.id,
          scene: 'materialize',
          requestId,
          queuedMs: capacityLease.queuedMs,
          durationMs,
          rowCount: result.rows.length,
          byteSize: bytes,
          costUnits,
          cacheHit: false,
          success: true,
        });
      } catch (costLogError) {
        logger.warn('记录物化查询成本失败', {
          datasetId: id,
          err: costLogError instanceof Error ? costLogError.message : String(costLogError),
        });
      }
    } catch (queryError) {
      const durationMs = Date.now() - queryStartedAt;
      const costUnits = calculateQueryCost({ durationMs, rows: 0, bytes: 0, cacheHit: false });
      if (quotaLease) {
        try {
          await settleReportQueryQuota(quotaLease, { rows: 0, bytes: 0, costUnits });
        } catch (settleError) {
          logger.warn('结算失败物化查询配额失败', {
            datasetId: id,
            err: settleError instanceof Error ? settleError.message : String(settleError),
          });
        }
      }
      try {
        await persistReportQueryCost({
          identity,
          datasetId: id,
          datasourceId: row.datasource.id,
          scene: 'materialize',
          requestId,
          queuedMs: capacityLease?.queuedMs ?? 0,
          durationMs,
          rowCount: 0,
          byteSize: 0,
          costUnits,
          cacheHit: false,
          success: false,
          errorCode: queryError instanceof HTTPException
            ? String(queryError.status)
            : queryError instanceof Error ? queryError.name : 'QUERY_ERROR',
        });
      } catch (costLogError) {
        logger.warn('记录失败物化查询成本失败', {
          datasetId: id,
          err: costLogError instanceof Error ? costLogError.message : String(costLogError),
        });
      }
      throw queryError;
    } finally {
      capacityLease?.release();
    }
    if (await options?.isCancelRequested?.()) {
      await failMaterializationSnapshot(building.id, new Error('物化任务已取消'));
      return { rows: result.rows.length, snapshotId: building.id, cancelled: true };
    }
    if (strategy === 'incremental' && result.truncated) {
      throw new HTTPException(409, { message: '增量窗口返回数据超过安全上限，请缩短增量窗口或改用全量物化' });
    }
    const delta = strategy === 'incremental' && keyField
      ? filterIncrementalDelta(result, keyField, previous?.snapshot.watermark ?? null, deltaWindowMinutes)
      : result;
    const snapshot = strategy === 'incremental' && keyField
      ? mergeIncrementalSnapshot(previous?.data ?? null, delta, keyField)
      : { ...result, total: result.rows.length };
    const watermark = strategy === 'incremental' && keyField
      ? resolveSnapshotWatermark(snapshot.rows, keyField)
      : null;
    await completeMaterializationSnapshot(building.id, snapshot, watermark);
    const now = new Date();
    const [updatedRow] = await db.update(reportDatasets)
      .set({ materialize: {
        ...materialize,
        enabled: materialize.enabled ?? true,
        strategy,
        keyField,
        deltaWindowMinutes,
        refreshedAt: formatDateTime(now),
        refreshedAtMs: now.getTime(),
      } })
      .where(eq(reportDatasets.id, id))
      .returning({ updatedAt: reportDatasets.updatedAt });
    try {
      await redis.set(
        materializedCacheKey(id, `${updatedRow?.updatedAt?.getTime?.() ?? row.updatedAt.getTime()}:${row.datasource.updatedAt?.getTime?.() ?? 0}`),
        JSON.stringify(snapshot),
        'EX',
        MATVIEW_TTL_SECONDS,
      );
    } catch (err) {
      logger.warn('写入报表物化快照失败', { datasetId: id, err: err instanceof Error ? err.message : String(err) });
    }
    await recordDatasetExecutionLog({
      row,
      durationMs: Date.now() - startedAt,
      rowCount: snapshot.rows.length,
      bytes: snapshot.bytes ?? null,
      truncated: snapshot.truncated ?? false,
      cacheHit: false,
      success: true,
      runtime: { scene: 'materialize', sourceRefId: id },
    });
    return { rows: snapshot.rows.length, snapshotId: building.id };
  } catch (error) {
    await failMaterializationSnapshot(building.id, error);
    await recordDatasetExecutionLog({
      row,
      durationMs: Date.now() - startedAt,
      rowCount: null,
      cacheHit: false,
      success: false,
      error: toExecutionError(error),
      runtime: { scene: 'materialize', sourceRefId: id },
    });
    throw error;
  }
}

/** Cron 分发：扫描启用物化的数据集，按各自 cron 判断到期后刷新（pg-boss 每分钟调用）*/
export async function dispatchDueMaterializations(): Promise<{ checked: number; refreshed: number }> {
  const rows = await db.select({
    id: reportDatasets.id,
    name: reportDatasets.name,
    materialize: reportDatasets.materialize,
    status: reportDatasets.status,
    ownerId: reportDatasets.ownerId,
    createdBy: reportDatasets.createdBy,
    updatedAt: reportDatasets.updatedAt,
  }).from(reportDatasets);
  const now = new Date();
  let refreshed = 0;
  let checked = 0;
  for (const r of rows) {
    const m = (r.materialize ?? {}) as ReportDatasetMaterialize;
    if (r.status !== 'enabled' || !m.enabled || !m.cron) continue;
    checked++;
    try {
      const prev = CronExpressionParser.parse(m.cron, { currentDate: now }).prev().toDate();
      const last = m.refreshedAtMs ?? 0;
      if (prev.getTime() > last) {
        const creatorId = r.ownerId ?? r.createdBy;
        if (!creatorId) continue;
        const [creator] = await db.select({ id: users.id, username: users.username, tenantId: users.tenantId })
          .from(users).where(eq(users.id, creatorId)).limit(1);
        if (!creator) continue;
        const roleRows = await db.select({ code: roles.code }).from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(eq(userRoles.userId, creator.id));
        await runWithCurrentUser({
          userId: creator.id,
          username: creator.username,
          tenantId: creator.tenantId,
          roles: roleRows.map((role) => role.code),
        }, async () => {
          await submitAsyncTask({
            taskType: 'report-dataset-materialize',
            title: `定时刷新物化快照 · ${r.name}`,
            payload: {
              datasetId: r.id,
              strategy: m.strategy ?? 'full',
              keyField: m.keyField ?? null,
              deltaWindowMinutes: m.deltaWindowMinutes ?? null,
            },
            idempotencyKey: `report-dataset-materialize:${r.id}:scheduled:${prev.getTime()}`,
          });
        });
        refreshed++;
      }
    } catch (e) {
      logger.warn('报表物化刷新失败', { id: r.id, err: e instanceof Error ? e.message : String(e) });
    }
  }
  return { checked, refreshed };
}
