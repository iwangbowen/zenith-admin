/**
 * 报表数据集 Service 内部共享模块：常量、治理配置、执行上下文类型与跨子模块复用的 helper。
 * 仅供 report-dataset-* 子模块引用；对外统一经 report-dataset.service.ts facade 暴露。
 */
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { reportDatasetExecutionLogs } from '../../db/schema';
import { config as appConfig } from '../../config';
import logger from '../../lib/logger';
import { currentUserOrNull } from '../../lib/context';
import { normalizeReadonlyReportSql } from '../../lib/report-sql-safety';
import { markDatasourceExecutionHealth } from './report-datasource.service';
import { isSqlLikeType } from '@zenith/shared/report';
import type { ReportDatasetRow } from '../../db/schema';
import type { ReportDataResult, ReportDatasetContent, ReportDatasetMaterialize, ReportDatasetParam, ReportDatasourceType, ReportRowRule, ReportRuntimeGovernance, ReportSqlDatasetContent } from '@zenith/shared/report';

import { MAX_LIMIT } from './report-result-processing';
export { PREVIEW_LIMIT, MAX_LIMIT } from './report-result-processing';
export const QUERY_TIMEOUT = '15s';
export const CACHE_PREFIX = `${appConfig.redis.keyPrefix}report:dataset:`;
export const MATVIEW_PREFIX = `${appConfig.redis.keyPrefix}report:matview:`;
/** 物化快照安全 TTL（秒）：即便无 cron 刷新，也不会永久冻结（默认 24h） */
export const MATVIEW_TTL_SECONDS = 24 * 60 * 60;

export interface DatasetExecutionContext {
  scene?: string;
  sourceRefId?: string | number | null;
  requestId?: string;
  effectiveTenantId?: number | null;
  effectiveUserId?: number | null;
}

export interface DatasetExecutionResult {
  data: ReportDataResult;
  durationMs: number;
  cacheHit: boolean;
}

export function getReportRuntimeGovernance(): ReportRuntimeGovernance {
  return {
    slowQueryMs: appConfig.report.slowQueryMs,
    dashboardMaxConcurrent: appConfig.report.dashboardMaxConcurrent,
    datasetMaxRows: appConfig.report.datasetMaxRows,
    datasetMaxBytes: appConfig.report.datasetMaxBytes,
  };
}

export function estimateRowsBytes(rows: Record<string, unknown>[]): number {
  try {
    return Buffer.byteLength(JSON.stringify(rows), 'utf8');
  } catch {
    return 0;
  }
}

export function normalizeIdentifier(name: string): string {
  return name.trim().toLowerCase();
}

/** 按 type 规整数据集查询内容 */
export function normalizeDatasetContent(
  type: ReportDatasourceType,
  content: Record<string, unknown> | null | undefined,
): ReportDatasetContent {
  const c = (content ?? {}) as Record<string, unknown>;
  if (isSqlLikeType(type)) {
    return {
      sql: normalizeReadonlyReportSql(typeof c.sql === 'string' ? c.sql : ''),
      // 可视化建模模型（回显编辑用；SQL 为最终执行内容）
      ...(c.visual && typeof c.visual === 'object' ? { visual: c.visual as ReportSqlDatasetContent['visual'] } : {}),
    };
  }
  if (type === 'static') {
    const rawData = Array.isArray(c.data) ? (c.data as Record<string, unknown>[]) : [];
    if (rawData.length > MAX_LIMIT) {
      throw new HTTPException(400, { message: `静态数据集最多 ${MAX_LIMIT} 行，当前 ${rawData.length} 行，请精简后再保存` });
    }
    const columns = Array.isArray(c.columns) ? (c.columns as string[]) : undefined;
    return { data: rawData, ...(columns ? { columns } : {}) };
  }
  const itemsPath = typeof c.itemsPath === 'string' ? c.itemsPath : null;
  const params = c.params && typeof c.params === 'object' && !Array.isArray(c.params)
    ? (c.params as Record<string, string>)
    : null;
  return { itemsPath, params };
}

/**
 * 物化前置校验：物化为「全局快照」，忽略运行时参数且不含用户上下文。
 * 因此禁止在 ① 使用数据权限系统变量(${__userId} 等) ② 声明了任何参数 ③ 配置了行级权限规则
 * 的数据集上启用，否则会出现跨用户数据串号 / 筛选被静默忽略。
 */
export function assertMaterializable(
  materialize: ReportDatasetMaterialize | null | undefined,
  type: ReportDatasourceType,
  content: ReportDatasetContent,
  params: ReportDatasetParam[] | undefined,
  rowRules?: ReportRowRule[] | null,
): void {
  if (!materialize?.enabled) return;
  const sqlText = isSqlLikeType(type) ? ((content as ReportSqlDatasetContent).sql ?? '') : '';
  if (/\$\{\s*__\w+\s*\}/.test(sqlText)) {
    throw new HTTPException(400, { message: '该数据集使用了数据权限系统变量（${__userId} 等），启用物化会导致跨用户数据串号，请先关闭物化' });
  }
  if ((params ?? []).length > 0) {
    throw new HTTPException(400, { message: '含参数的数据集不支持物化：物化为全局快照会忽略运行时参数/筛选，请先移除参数或关闭物化' });
  }
  if ((rowRules ?? []).some((r) => r.enabled ?? true)) {
    throw new HTTPException(400, { message: '配置了行级权限规则的数据集不支持物化：物化快照对所有人一致，会绕过行级过滤' });
  }
}

export function materializedCacheKey(id: number, version: string): string {
  return `${MATVIEW_PREFIX}${id}:${version}`;
}

export function toExecutionError(err: unknown): { code: number; message: string } {
  if (err instanceof HTTPException) {
    return { code: err.status, message: err.message };
  }
  if (err instanceof Error) {
    return { code: 500, message: err.message };
  }
  return { code: 500, message: String(err) };
}

export async function recordDatasetExecutionLog(input: {
  row: ReportDatasetRow & { datasource?: { id: number; name: string | null } | null };
  resolvedParams?: Record<string, unknown>;
  durationMs: number;
  rowCount?: number | null;
  bytes?: number | null;
  truncated?: boolean;
  cacheHit: boolean;
  success: boolean;
  error?: { code: number; message: string } | null;
  runtime?: DatasetExecutionContext;
}) {
  const user = currentUserOrNull();
  const governance = getReportRuntimeGovernance();
  try {
    await db.insert(reportDatasetExecutionLogs).values({
      tenantId: rowTenantId(input.row),
      datasetId: input.row.id,
      datasourceId: input.row.datasourceId,
      userId: user?.userId ?? null,
      scene: input.runtime?.scene ?? 'dataset',
      sourceRefId: input.runtime?.sourceRefId == null ? null : String(input.runtime.sourceRefId),
      durationMs: Math.max(0, Math.round(input.durationMs)),
      rowCount: input.rowCount ?? null,
      bytes: input.bytes ?? null,
      truncated: input.truncated ?? false,
      slow: input.durationMs >= governance.slowQueryMs,
      cacheHit: input.cacheHit,
      success: input.success,
      errorCode: input.error?.code ?? null,
      errorMessage: input.error?.message?.slice(0, 512) ?? null,
      paramKeys: Object.keys(input.resolvedParams ?? {}).filter((key) => !key.startsWith('__')).sort(),
    });
  } catch (err) {
    logger.warn('记录报表数据集执行日志失败', { datasetId: input.row.id, err: err instanceof Error ? err.message : String(err) });
  }
  if (input.row.datasourceId) {
    await markDatasourceExecutionHealth(input.row.datasourceId, {
      success: input.success,
      latencyMs: input.durationMs,
      error: input.error?.message ?? null,
    }).catch(() => undefined);
  }
}

function rowTenantId(row: { tenantId?: number | null }): number | null {
  return row.tenantId ?? currentUserOrNull()?.tenantId ?? null;
}

/** 结果集中该字段是否存在可解析为有限数的值（数值或数值字符串） */
export function runtimeHasNumericValue(rows: Record<string, unknown>[], field: string): boolean {
  return rows.some((row) => {
    const value = row[field];
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.trim());
      return Number.isFinite(parsed);
    }
    return false;
  });
}
