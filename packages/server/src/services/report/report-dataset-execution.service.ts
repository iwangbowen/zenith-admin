/**
 * 报表数据集取数执行：runReportData 取数核心、preview 试跑、ChatBI 受治理执行、
 * 已保存数据集取数（缓存 / 物化快照 / 行级权限 / 配额容量）与缓存清理。
 * 对外统一经 report-dataset.service.ts facade 暴露。
 */
import { requireRow } from '../../lib/db-assert';
import { HTTPException } from 'hono/http-exception';
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import { reportDatasetExecutionLogs, reportDatasets } from '../../db/schema';
import { config as appConfig } from '../../config';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { pageOffset } from '../../lib/pagination';
import { httpRequest } from '../../lib/http-client';
import { applyComputedFields } from '../../lib/report-formula';
import { runExternalQuery } from '../../lib/report-external-db';
import { applyReadonlyTransactionGuards } from '../../lib/db-readonly-role';
import { normalizeReadonlyReportSql } from '../../lib/report-sql-safety';
import {
  ensureDatasourceEnabled,
  ensureDatasourceExists,
  resolveApiHeaders,
} from './report-datasource.service';
import { reportScopedWhere } from './report-access';
import { ensureReportResourceAccess } from './report-resource-acl.service';
import { loadCurrentMaterializationSnapshot } from './report-materialization.service';
import {
  acquireReportQueryCapacity,
  calculateQueryCost,
  newReportQueryRequestId,
  persistReportQueryCost,
  reserveReportQueryQuota,
  resolveReportQueryIdentity,
  settleReportQueryQuota,
} from './report-query-capacity.service';
import { recordReportAssetUsage } from './report-asset-usage.service';
import {
  applyRowRulesToSql,
  buildExternalParamSql,
  buildParamSql,
  buildSystemParams,
  resolveDatasetParams,
  resolveEffectiveRowRules,
} from './report-dataset-params';
import {
  CACHE_PREFIX,
  MATVIEW_PREFIX,
  MATVIEW_TTL_SECONDS,
  MAX_LIMIT,
  PREVIEW_LIMIT,
  QUERY_TIMEOUT,
  estimateRowsBytes,
  getReportRuntimeGovernance,
  materializedCacheKey,
  normalizeDatasetContent,
  normalizeIdentifier,
  recordDatasetExecutionLog,
  toExecutionError,
} from './report-dataset-shared';
import { isSqlLikeType, isExternalDbType } from '@zenith/shared/report';
import type { DatasetExecutionContext, DatasetExecutionResult } from './report-dataset-shared';
import type { ReportDataResult, ReportField, ReportFieldType, ReportDatasetContent, ReportDatasetParam, ReportDatasourceType, ReportDatasourceConfig, ReportComputedField, ReportExternalDbConfig, ReportApiDatasourceConfig, ReportApiDatasetContent, ReportSqlDatasetContent, ReportStaticDatasetContent, ReportDatasetMaterialize, ReportRowRule, ReportDatasetQueryOptions, ReportResultField, ReportDatasetPreviewInput, ReportSortOrder } from '@zenith/shared/report';

type DatasetQueryArg = number | ReportDatasetQueryOptions | undefined;

interface NormalizedQueryOptions {
  limit?: number;
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: ReportSortOrder;
}

function applyDatasetGovernance(result: ReportDataResult): ReportDataResult {
  const governance = getReportRuntimeGovernance();
  const maxRows = Math.max(1, governance.datasetMaxRows);
  const maxBytes = Math.max(1024, governance.datasetMaxBytes);
  let rows = result.rows;
  let truncated = false;
  let truncatedReason: string | null = null;

  if (rows.length > maxRows) {
    rows = rows.slice(0, maxRows);
    truncated = true;
    truncatedReason = `结果行数超过上限（${maxRows} 行）`;
  }

  let bytes = estimateRowsBytes(rows);
  if (bytes > maxBytes) {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      const size = estimateRowsBytes(rows.slice(0, mid));
      if (size <= maxBytes) low = mid;
      else high = mid - 1;
    }
    rows = rows.slice(0, low);
    bytes = estimateRowsBytes(rows);
    truncated = true;
    truncatedReason = truncatedReason
      ? `${truncatedReason}，且结果体积超过上限（${maxBytes} bytes）`
      : `结果体积超过上限（${maxBytes} bytes）`;
  }

  return {
    ...result,
    rows,
    bytes,
    truncated,
    truncatedReason,
  };
}

function normalizeDatasetQueryOptions(query?: DatasetQueryArg): NormalizedQueryOptions {
  if (typeof query === 'number') {
    return { limit: Math.max(1, Math.min(query || PREVIEW_LIMIT, MAX_LIMIT)) };
  }
  const sortOrder = query?.sortOrder === 'asc' ? 'asc' : 'desc';
  const page = query?.page ? Math.max(1, Math.floor(query.page)) : undefined;
  const pageSize = query?.pageSize ? Math.max(1, Math.min(Math.floor(query.pageSize), 500)) : undefined;
  return {
    limit: query?.limit ? Math.max(1, Math.min(Math.floor(query.limit), MAX_LIMIT)) : undefined,
    page,
    pageSize,
    sortField: query?.sortField?.trim() || undefined,
    sortOrder,
  };
}

function inferFieldType(value: unknown): ReportFieldType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(value)) return 'date';
  return 'string';
}

function buildResultFields(
  columns: string[],
  declaredFields: ReportField[] | undefined,
  computedFields: ReportComputedField[] | undefined,
  rows: Record<string, unknown>[],
): ReportResultField[] {
  const declared = new Map((declaredFields ?? []).map((field) => [normalizeIdentifier(field.name), field]));
  const computed = new Map((computedFields ?? []).map((field) => [normalizeIdentifier(field.name), field]));
  return columns.map((column) => {
    const declaredField = declared.get(normalizeIdentifier(column));
    if (declaredField) return { ...declaredField, source: 'declared' as const };
    const computedField = computed.get(normalizeIdentifier(column));
    if (computedField) {
      return {
        name: computedField.name,
        label: computedField.label,
        type: computedField.type ?? inferFieldType(rows[0]?.[column]),
        source: 'computed' as const,
      };
    }
    return {
      name: column,
      label: column,
      type: inferFieldType(rows[0]?.[column]),
      source: 'inferred' as const,
    };
  });
}

function withFieldMetadata(
  result: Omit<ReportDataResult, 'fields'> | ReportDataResult,
  declaredFields: ReportField[] | undefined,
  computedFields: ReportComputedField[] | undefined,
): ReportDataResult {
  return {
    columns: result.columns,
    fields: buildResultFields(result.columns, declaredFields, computedFields, result.rows),
    rows: result.rows,
    total: result.total,
  };
}

function quoteSortField(field: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) {
    throw new HTTPException(400, { message: '排序字段不合法' });
  }
  return `"${field}"`;
}

function navigatePath(json: unknown, path?: string | null): unknown {
  if (!path) return json;
  return path.split('.').reduce<unknown>(
    (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key.trim()] : undefined),
    json,
  );
}

function buildSqlQueryParts(options: NormalizedQueryOptions): { limit: number; offset: number; orderBy: string } {
  const usePaging = options.page !== undefined && options.pageSize !== undefined;
  const limit = usePaging ? Math.max(1, Math.min(options.pageSize ?? PREVIEW_LIMIT, 500)) : Math.max(1, Math.min(options.limit ?? PREVIEW_LIMIT, MAX_LIMIT));
  const offset = usePaging ? pageOffset(options.page ?? 1, options.pageSize ?? limit) : 0;
  const orderBy = options.sortField ? ` ORDER BY ${quoteSortField(options.sortField)} ${(options.sortOrder === 'asc' ? 'ASC' : 'DESC')}` : '';
  return { limit, offset, orderBy };
}

function applyInMemoryQuery(
  rows: Record<string, unknown>[],
  columns: string[],
  options: NormalizedQueryOptions,
  totalOverride?: number | null,
): Omit<ReportDataResult, 'fields'> {
  const source = [...rows];
  if (options.sortField) {
    if (!columns.includes(options.sortField)) {
      throw new HTTPException(400, { message: `排序字段不存在：${options.sortField}` });
    }
    const direction = options.sortOrder === 'asc' ? 1 : -1;
    source.sort((left, right) => {
      const a = left[options.sortField!];
      const b = right[options.sortField!];
      if (a === b) return 0;
      if (a === null || a === undefined) return 1;
      if (b === null || b === undefined) return -1;
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction;
      return String(a).localeCompare(String(b), 'zh-CN', { numeric: true }) * direction;
    });
  }
  const total = totalOverride ?? source.length;
  if (options.page !== undefined && options.pageSize !== undefined) {
    return {
      columns,
      rows: source.slice(pageOffset(options.page, options.pageSize), pageOffset(options.page, options.pageSize) + options.pageSize),
      total,
    };
  }
  const limit = Math.max(1, Math.min(options.limit ?? PREVIEW_LIMIT, MAX_LIMIT));
  return { columns, rows: source.slice(0, limit), total };
}

/** 只读执行 SQL（READ ONLY 事务 + 超时 + 安全排序分页 + 参数绑定）*/
async function runReadonlySql(text: string, params: Record<string, unknown>, options: NormalizedQueryOptions): Promise<Omit<ReportDataResult, 'fields'>> {
  const trimmed = normalizeReadonlyReportSql(text);
  const queryParts = buildSqlQueryParts(options);
  const inner = buildParamSql(trimmed, params);
  try {
    const result = await db.transaction(async (tx) => {
      await applyReadonlyTransactionGuards((s) => tx.execute(sql.raw(s)), { timeout: QUERY_TIMEOUT });
      const countRows = await tx.execute<{ total: number }>(sql`SELECT COUNT(*)::int AS total FROM (${inner}) AS _count`);
      const suffix = `${queryParts.orderBy} LIMIT ${queryParts.limit}${queryParts.offset > 0 ? ` OFFSET ${queryParts.offset}` : ''}`;
      const dataRows = await tx.execute(sql`SELECT * FROM (${inner}) AS _sub ${sql.raw(suffix)}`);
      return { countRows, dataRows };
    });
    const arr = (result.dataRows as unknown as Record<string, unknown>[]) ?? [];
    const columns = arr.length ? Object.keys(arr[0]) : [];
    const total = Number((result.countRows as unknown as Array<{ total?: number }>)[0]?.total ?? arr.length);
    return { columns, rows: arr, total: Number.isFinite(total) ? total : arr.length };
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `SQL 执行失败：${msg}` });
  }
}

// ─── 取数核心 ────────────────────────────────────────────────────────────────

/** 按数据源类型执行取数；sql 走只读绑定执行器，mysql/postgresql 走外部库，api 走 http-client。最后应用计算字段 */
export async function runReportData(
  type: ReportDatasourceType,
  config: ReportDatasourceConfig,
  content: ReportDatasetContent,
  params: Record<string, unknown> = {},
  query: DatasetQueryArg = PREVIEW_LIMIT,
  fields?: ReportField[],
  computedFields?: ReportComputedField[],
): Promise<ReportDataResult> {
  const queryOptions = normalizeDatasetQueryOptions(query);

  if (type === 'sql') {
    const sqlTextOrUndefined = ((content as ReportSqlDatasetContent).sql ?? '').trim();
    const sqlText = requireRow(sqlTextOrUndefined, '数据集 SQL 不能为空', 400);
    return withFieldMetadata(applyComputedFields(await runReadonlySql(sqlText, params, queryOptions), computedFields), fields, computedFields);
  }

  if (isExternalDbType(type)) {
    const sqlTextOrUndefined = ((content as ReportSqlDatasetContent).sql ?? '').trim();
    const sqlText = requireRow(sqlTextOrUndefined, '数据集 SQL 不能为空', 400);
    const { text, values } = buildExternalParamSql(sqlText, params, type as 'mysql' | 'postgresql' | 'sqlserver');
    const result = await runExternalQuery(type, config as ReportExternalDbConfig, text, values, queryOptions);
    return withFieldMetadata(applyComputedFields(result, computedFields), fields, computedFields);
  }

  if (type === 'static') {
    const staticContent = (content ?? {}) as ReportStaticDatasetContent;
    const rows = Array.isArray(staticContent.data) ? staticContent.data : [];
    const columns = staticContent.columns?.length
      ? staticContent.columns
      : (rows.length ? Object.keys(rows[0]) : []);
    return withFieldMetadata(applyComputedFields(applyInMemoryQuery(rows, columns, queryOptions), computedFields), fields, computedFields);
  }

  // api
  const apiCfg = config as ReportApiDatasourceConfig;
  if (!apiCfg?.url) throw new HTTPException(400, { message: '数据源未配置 URL' });
  const apiContent = (content ?? {}) as ReportApiDatasetContent;
  const method = apiCfg.method === 'POST' ? 'POST' : 'GET';
  // 合并静态 content.params 与运行时 params（运行时优先），剔除空值
  const merged: Record<string, unknown> = { ...(apiContent.params ?? {}), ...params };
  const effective = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  let url = apiCfg.url;
  let body: Record<string, unknown> | undefined;
  if (Object.keys(effective).length > 0) {
    if (method === 'GET') {
      const u = new URL(apiCfg.url);
      for (const [k, v] of Object.entries(effective)) u.searchParams.set(k, String(v));
      url = u.toString();
    } else {
      body = { ...effective };
    }
  }

  let json: unknown;
  try {
    const res = await httpRequest(url, {
      method,
      headers: resolveApiHeaders(apiCfg.headers),
      body,
      timeout: 10_000,
      ssrfProtection: true,
      ssrfAllowlist: appConfig.report.outboundPrivateAllowlist,
      httpLog: { level: 'off' },
    });
    if (!res.ok) throw new HTTPException(502, { message: `数据源返回状态 ${res.status}` });
    json = await res.json();
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(502, { message: '数据源请求失败，请检查 URL 与网络' });
  }

  const arr = navigatePath(json, apiContent.itemsPath);
  if (!Array.isArray(arr)) {
    throw new HTTPException(502, { message: '数据源返回结构不是数组，请检查「数组路径」配置' });
  }
  const sourceRows = arr as Record<string, unknown>[];
  const columns = sourceRows.length > 0 ? Object.keys(sourceRows[0] ?? {}) : [];
  return withFieldMetadata(applyComputedFields(applyInMemoryQuery(sourceRows, columns, queryOptions), computedFields), fields, computedFields);
}

/** 试跑预览（不落库）：用未保存的数据源 + content + 运行时参数取数（`__` 前缀由系统变量权威注入，剥离客户端伪造值） */
export async function previewDataset(input: ReportDatasetPreviewInput): Promise<ReportDataResult> {
  const ds = await ensureDatasourceExists(input.datasourceId);
  ensureDatasourceEnabled(ds);
  const content = normalizeDatasetContent(ds.type, input.content);
  const sqlText = isSqlLikeType(ds.type) ? ((content as ReportSqlDatasetContent).sql ?? '') : '';
  const provided = Object.fromEntries(
    Object.entries((input.params ?? {}) as Record<string, unknown>).filter(([k]) => !k.startsWith('__')),
  );
  const params = { ...provided, ...await buildSystemParams(sqlText) };
  const computed = (input.computedFields ?? []) as ReportComputedField[];
  return runReportData(ds.type, (ds.config ?? {}) as ReportDatasourceConfig, content, params, input.limit ?? PREVIEW_LIMIT, [], computed);
}

/** ChatBI 受治理的临时 SQL 执行：复用只读执行器、容量/配额、结果上限及成本/执行日志。 */
export async function executeGovernedReportSql(input: {
  datasourceId: number;
  datasetId?: number | null;
  sql: string;
  maxRows: number;
  sourceRefId: string;
}): Promise<ReportDataResult> {
  await ensureReportResourceAccess('datasource', input.datasourceId, 'viewer');
  const source = await ensureDatasourceExists(input.datasourceId);
  ensureDatasourceEnabled(source);
  if (!isSqlLikeType(source.type)) {
    throw new HTTPException(400, { message: 'ChatBI 仅支持 SQL 类型数据源' });
  }
  const identity = resolveReportQueryIdentity(source.tenantId);
  const requestId = newReportQueryRequestId();
  const startedAt = Date.now();
  let quotaLease: Awaited<ReturnType<typeof reserveReportQueryQuota>> | null = null;
  let capacityLease: Awaited<ReturnType<typeof acquireReportQueryCapacity>> | null = null;
  try {
    quotaLease = await reserveReportQueryQuota(identity);
    capacityLease = await acquireReportQueryCapacity(source.id);
    const result = applyDatasetGovernance(await runReportData(
      source.type,
      (source.config ?? {}) as ReportDatasourceConfig,
      { sql: normalizeReadonlyReportSql(input.sql) },
      {},
      { limit: Math.max(1, Math.min(input.maxRows, 1000)) },
    ));
    const durationMs = Date.now() - startedAt;
    const rows = result.rows.length;
    const bytes = result.bytes ?? estimateRowsBytes(result.rows);
    const costUnits = calculateQueryCost({ durationMs, rows, bytes, cacheHit: false });
    await settleReportQueryQuota(quotaLease, { rows, bytes, costUnits });
    await Promise.all([
      persistReportQueryCost({
        identity,
        datasetId: input.datasetId ?? null,
        datasourceId: source.id,
        scene: 'chatbi',
        requestId,
        queuedMs: capacityLease.queuedMs,
        durationMs,
        rowCount: rows,
        byteSize: bytes,
        costUnits,
        cacheHit: false,
        success: true,
      }),
      db.insert(reportDatasetExecutionLogs).values({
        tenantId: source.tenantId,
        datasetId: input.datasetId ?? null,
        datasourceId: source.id,
        userId: identity.userId,
        scene: 'chatbi',
        sourceRefId: input.sourceRefId.slice(0, 64),
        durationMs,
        rowCount: rows,
        bytes,
        truncated: result.truncated ?? false,
        slow: durationMs >= getReportRuntimeGovernance().slowQueryMs,
        success: true,
        paramKeys: [],
      }),
    ]);
    return { ...result, bytes, costUnits, queueDurationMs: capacityLease.queuedMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const costUnits = calculateQueryCost({ durationMs, rows: 0, bytes: 0, cacheHit: false });
    if (quotaLease && !quotaLease.settled) {
      await settleReportQueryQuota(quotaLease, { rows: 0, bytes: 0, costUnits });
    }
    const errorCode = error instanceof HTTPException ? String(error.status) : error instanceof Error ? error.name : 'QUERY_ERROR';
    const errorMessage = error instanceof Error ? error.message : 'ChatBI 查询失败';
    await Promise.all([
      persistReportQueryCost({
        identity,
        datasetId: input.datasetId ?? null,
        datasourceId: source.id,
        scene: 'chatbi',
        requestId,
        queuedMs: capacityLease?.queuedMs ?? 0,
        durationMs,
        rowCount: 0,
        byteSize: 0,
        costUnits,
        cacheHit: false,
        success: false,
        errorCode,
      }),
      db.insert(reportDatasetExecutionLogs).values({
        tenantId: source.tenantId,
        datasetId: input.datasetId ?? null,
        datasourceId: source.id,
        userId: identity.userId,
        scene: 'chatbi',
        sourceRefId: input.sourceRefId.slice(0, 64),
        durationMs,
        rowCount: 0,
        bytes: 0,
        slow: durationMs >= getReportRuntimeGovernance().slowQueryMs,
        success: false,
        errorCode: error instanceof HTTPException ? error.status : 500,
        errorMessage: errorMessage.slice(0, 512),
        paramKeys: [],
      }),
    ]);
    throw error;
  } finally {
    capacityLease?.release();
  }
}

function datasetVersionToken(row: { updatedAt: Date; datasource?: { updatedAt?: Date | null } | null }): string {
  return `${row.updatedAt.getTime()}:${row.datasource?.updatedAt?.getTime?.() ?? 0}`;
}

function datasetCacheKey(id: number, version: string, hash: string): string {
  return `${CACHE_PREFIX}${id}:${version}:${hash}`;
}

/** 清除某数据集的全部缓存（更新/删除时调用）：版本化缓存 + 物化快照 */
export async function clearDatasetCache(id: number): Promise<void> {
  try {
    const keys: string[] = [];
    for (const pattern of [`${CACHE_PREFIX}${id}:*`, `${MATVIEW_PREFIX}${id}:*`]) {
      let cursor = '0';
      do {
        const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        keys.push(...batch);
      } while (cursor !== '0');
    }
    if (keys.length) await redis.del(...keys);
  } catch (err) {
    logger.warn('清理报表数据集缓存失败', { datasetId: id, err: err instanceof Error ? err.message : String(err) });
  }
}

/** 取已保存数据集的数据（供仪表盘组件运行时调用，支持参数 + 行级权限 + Redis 缓存）*/
async function getDatasetDataExecutionCore(
  id: number,
  params?: Record<string, unknown>,
  query?: DatasetQueryArg,
  runtime?: DatasetExecutionContext,
): Promise<DatasetExecutionResult> {
  const startedAt = Date.now();
  const rowOrUndefined = await db.query.reportDatasets.findFirst({
    where: reportScopedWhere(reportDatasets, eq(reportDatasets.id, id)),
    with: { datasource: { columns: { id: true, name: true, config: true, status: true, updatedAt: true } } },
  });
  const row = requireRow(rowOrUndefined, '数据集不存在');
  const config = (row.datasource?.config ?? {}) as ReportDatasourceConfig;
  const rawContent = (row.content ?? {}) as ReportDatasetContent;
  const isSqlLike = isSqlLikeType(row.type);
  const declaredFields = (row.fields ?? []) as ReportField[];
  const computed = (row.computedFields ?? []) as ReportComputedField[];
  const queryOptions = normalizeDatasetQueryOptions(query);
  const version = datasetVersionToken(row);
  let resolvedParams: Record<string, unknown> | undefined;
  let cacheHit = false;

  const projectMaterializedSnapshot = async (
    snapshot: ReportDataResult,
    snapshotCacheHit: boolean,
  ): Promise<DatasetExecutionResult> => {
    const projected = applyDatasetGovernance(withFieldMetadata(
      applyInMemoryQuery(
        snapshot.rows,
        snapshot.columns,
        queryOptions,
        snapshot.rows.length,
      ),
      declaredFields,
      computed,
    ));
    await recordDatasetExecutionLog({
      row,
      durationMs: Date.now() - startedAt,
      rowCount: projected.rows.length,
      bytes: projected.bytes ?? null,
      truncated: projected.truncated ?? false,
      cacheHit: snapshotCacheHit,
      success: true,
      runtime,
    });
    return {
      data: projected,
      durationMs: Date.now() - startedAt,
      cacheHit: snapshotCacheHit,
    };
  };

  try {
    if (row.status !== 'enabled') throw new HTTPException(400, { message: '数据集已停用' });
    if (!row.datasource) throw new HTTPException(400, { message: '数据源不存在' });
    ensureDatasourceEnabled(row.datasource);
    // 物化快照优先：返回持久化全局快照（保存时已校验无参数/无系统变量/无行级规则，故与运行时参数/用户无关）
    const materialize = (row.materialize ?? {}) as ReportDatasetMaterialize;
    if (materialize.enabled) {
      const snapshotKey = materializedCacheKey(id, version);
      try {
        const snap = await redis.get(snapshotKey);
        if (snap) {
          cacheHit = true;
          const raw = JSON.parse(snap) as ReportDataResult;
          return projectMaterializedSnapshot(raw, cacheHit);
        }
      } catch (err) {
        logger.warn('读取报表物化快照失败', { datasetId: id, err: err instanceof Error ? err.message : String(err) });
      }
      const durable = await loadCurrentMaterializationSnapshot(id);
      if (durable) {
        const snapshot = durable.data;
        try {
          await redis.set(snapshotKey, JSON.stringify(snapshot), 'EX', MATVIEW_TTL_SECONDS);
        } catch (err) {
          logger.warn('回温报表物化快照失败', { datasetId: id, err: err instanceof Error ? err.message : String(err) });
        }
        return projectMaterializedSnapshot(snapshot, true);
      }
      const live = await runReportData(row.type, config, rawContent, {}, MAX_LIMIT, declaredFields, computed);
      const snapshot = { ...live, total: live.rows.length };
      try {
        await redis.set(snapshotKey, JSON.stringify(snapshot), 'EX', MATVIEW_TTL_SECONDS);
      } catch (err) {
        logger.warn('写入报表物化快照失败', { datasetId: id, err: err instanceof Error ? err.message : String(err) });
      }
      return projectMaterializedSnapshot(snapshot, false);
    }

    // 行级权限：命中规则以 OR 包裹原查询；无上下文拒绝，未命中注入恒假条件，超管不受限
    const effectiveRules = isSqlLike ? resolveEffectiveRowRules(row.rowRules as ReportRowRule[] | null) : [];
    const rawSqlText = isSqlLike ? ((rawContent as ReportSqlDatasetContent).sql ?? '') : '';
    const sqlText = effectiveRules.length ? applyRowRulesToSql(rawSqlText, effectiveRules) : rawSqlText;
    const content: ReportDatasetContent = effectiveRules.length
      ? { ...(rawContent as ReportSqlDatasetContent), sql: sqlText }
      : rawContent;

    const sysParams = await buildSystemParams(sqlText);
    resolvedParams = { ...resolveDatasetParams((row.params ?? []) as ReportDatasetParam[], params), ...sysParams };
    const cacheTtl = row.cacheTtl ?? 0;

    let cacheKey = '';
    if (cacheTtl > 0) {
      const rls = effectiveRules.map((item) => item.where);
      const hash = createHash('md5').update(JSON.stringify({ resolvedParams, queryOptions, rls, version })).digest('hex');
      cacheKey = datasetCacheKey(id, version, hash);
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          cacheHit = true;
          const data = applyDatasetGovernance(withFieldMetadata(JSON.parse(cached) as ReportDataResult, declaredFields, computed));
          await recordDatasetExecutionLog({
            row,
            resolvedParams,
            durationMs: Date.now() - startedAt,
            rowCount: data.rows.length,
            bytes: data.bytes ?? null,
            truncated: data.truncated ?? false,
            cacheHit,
            success: true,
            runtime,
          });
          return { data, durationMs: Date.now() - startedAt, cacheHit };
        }
      } catch (err) {
        logger.warn('读取报表数据集缓存失败', { datasetId: id, err: err instanceof Error ? err.message : String(err) });
      }
    }

    const data = applyDatasetGovernance(await runReportData(row.type, config, content, resolvedParams, queryOptions, declaredFields, computed));
    if (cacheTtl > 0 && cacheKey) {
      try {
        await redis.set(cacheKey, JSON.stringify(data), 'EX', cacheTtl);
      } catch (err) {
        logger.warn('写入报表数据集缓存失败', { datasetId: id, err: err instanceof Error ? err.message : String(err) });
      }
    }
    await recordDatasetExecutionLog({
      row,
      resolvedParams,
      durationMs: Date.now() - startedAt,
      rowCount: data.rows.length,
      bytes: data.bytes ?? null,
      truncated: data.truncated ?? false,
      cacheHit: false,
      success: true,
      runtime,
    });
    return { data, durationMs: Date.now() - startedAt, cacheHit: false };
  } catch (err) {
    await recordDatasetExecutionLog({
      row,
      resolvedParams,
      durationMs: Date.now() - startedAt,
      rowCount: null,
      cacheHit,
      success: false,
      error: toExecutionError(err),
      runtime,
    });
    throw err;
  }
}

export async function getDatasetDataExecution(
  id: number,
  params?: Record<string, unknown>,
  query?: DatasetQueryArg,
  runtime?: DatasetExecutionContext,
): Promise<DatasetExecutionResult> {
  const sourceOrUndefined = await db.query.reportDatasets.findFirst({
    where: reportScopedWhere(reportDatasets, eq(reportDatasets.id, id)),
    columns: { id: true, tenantId: true, datasourceId: true },
  });
  const source = requireRow(sourceOrUndefined, '数据集不存在');
  const identity = resolveReportQueryIdentity(source.tenantId, runtime);
  const requestId = runtime?.requestId ?? newReportQueryRequestId();
  const startedAt = Date.now();
  let quotaLease: Awaited<ReturnType<typeof reserveReportQueryQuota>> | null = null;
  let capacityLease: Awaited<ReturnType<typeof acquireReportQueryCapacity>> | null = null;
  try {
    quotaLease = await reserveReportQueryQuota(identity);
    capacityLease = await acquireReportQueryCapacity(source.datasourceId);
    const result = await getDatasetDataExecutionCore(id, params, query, runtime);
    const rows = result.data.rows.length;
    const bytes = result.data.bytes ?? estimateRowsBytes(result.data.rows);
    const durationMs = Date.now() - startedAt;
    const costUnits = calculateQueryCost({ durationMs, rows, bytes, cacheHit: result.cacheHit });
    try {
      await settleReportQueryQuota(quotaLease, { rows, bytes, costUnits });
    } catch (settleError) {
      logger.warn('结算报表查询配额失败', {
        datasetId: id,
        err: settleError instanceof Error ? settleError.message : String(settleError),
      });
    }
    try {
      await persistReportQueryCost({
        identity,
        datasetId: id,
        datasourceId: source.datasourceId,
        scene: runtime?.scene ?? 'dataset',
        requestId,
        queuedMs: capacityLease.queuedMs,
        durationMs,
        rowCount: rows,
        byteSize: bytes,
        costUnits,
        cacheHit: result.cacheHit,
        success: true,
      });
    } catch (costLogError) {
      logger.warn('记录报表查询成本失败', {
        datasetId: id,
        err: costLogError instanceof Error ? costLogError.message : String(costLogError),
      });
    }
    await recordReportAssetUsage({
      tenantId: source.tenantId,
      resourceType: 'dataset',
      resourceId: id,
      action: runtime?.scene?.includes('export') ? 'export' : 'query',
      scene: runtime?.scene ?? 'dataset',
      durationMs,
      rowCount: rows,
      byteSize: bytes,
      success: true,
    });
    return {
      ...result,
      data: { ...result.data, costUnits, queueDurationMs: capacityLease.queuedMs },
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const costUnits = calculateQueryCost({ durationMs, rows: 0, bytes: 0, cacheHit: false });
    if (quotaLease) {
      try {
        await settleReportQueryQuota(quotaLease, { rows: 0, bytes: 0, costUnits });
      } catch (settleError) {
        logger.warn('结算报表查询配额失败', {
          datasetId: id,
          err: settleError instanceof Error ? settleError.message : String(settleError),
        });
      }
    }
    try {
      await persistReportQueryCost({
        identity,
        datasetId: id,
        datasourceId: source.datasourceId,
        scene: runtime?.scene ?? 'dataset',
        requestId,
        queuedMs: capacityLease?.queuedMs ?? 0,
        durationMs,
        rowCount: 0,
        byteSize: 0,
        costUnits,
        cacheHit: false,
        success: false,
        errorCode: error instanceof HTTPException ? String(error.status) : error instanceof Error ? error.name : 'QUERY_ERROR',
      });
      await recordReportAssetUsage({
        tenantId: source.tenantId,
        resourceType: 'dataset',
        resourceId: id,
        action: runtime?.scene?.includes('export') ? 'export' : 'query',
        scene: runtime?.scene ?? 'dataset',
        durationMs,
        success: false,
      });
    } catch (costLogError) {
      logger.warn('记录报表查询成本失败', {
        datasetId: id,
        err: costLogError instanceof Error ? costLogError.message : String(costLogError),
      });
    }
    throw error;
  } finally {
    capacityLease?.release();
  }
}

export async function getDatasetData(
  id: number,
  params?: Record<string, unknown>,
  query?: DatasetQueryArg,
  runtime?: DatasetExecutionContext,
): Promise<ReportDataResult> {
  return (await getDatasetDataExecution(id, params, query, runtime)).data;
}
