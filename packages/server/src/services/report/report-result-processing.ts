import { HTTPException } from 'hono/http-exception';
import type { ReportDataResult, ReportDatasetQueryOptions, ReportRuntimeGovernance } from '@zenith/shared/report';
import { pageOffset } from '../../lib/pagination';

export const PREVIEW_LIMIT = 100;
export const MAX_LIMIT = 5000;
export type ReportResultQueryOptions = Pick<ReportDatasetQueryOptions, 'limit' | 'page' | 'pageSize' | 'sortField' | 'sortOrder'>;

const collator = new Intl.Collator('zh-CN', { numeric: true });

/** Bound the returned JSON array in one pass; never serialize a rejected tail. */
export function governReportResult(
  result: ReportDataResult,
  limits: Pick<ReportRuntimeGovernance, 'datasetMaxRows' | 'datasetMaxBytes'>,
): ReportDataResult {
  const maxRows = Math.max(1, limits.datasetMaxRows);
  const maxBytes = Math.max(1024, limits.datasetMaxBytes);
  const end = Math.min(result.rows.length, maxRows);
  let bytes = 2; // JSON array brackets; separators are counted with each subsequent row.
  let kept = 0;
  for (; kept < end; kept++) {
    const json = JSON.stringify(result.rows[kept]) ?? 'null';
    const next = bytes + Buffer.byteLength(json, 'utf8') + (kept > 0 ? 1 : 0);
    if (next > maxBytes) break;
    bytes = next;
  }
  const reasons = result.truncatedReason ? [result.truncatedReason] : [];
  if (result.rows.length > maxRows) reasons.push(`结果行数超过上限（${maxRows} 行）`);
  if (kept < end) reasons.push(`结果体积超过上限（${maxBytes} bytes）`);
  return {
    ...result,
    rows: kept === result.rows.length ? result.rows : result.rows.slice(0, kept),
    bytes,
    truncated: !!result.truncated || kept < result.rows.length,
    truncatedReason: reasons.length ? [...new Set(reasons)].join('，') : null,
  };
}

/** Sort a copy only when requested; the source may be a shared materialized snapshot. */
export function applyInMemoryQuery(
  rows: Record<string, unknown>[],
  columns: string[],
  options: ReportResultQueryOptions,
  totalOverride?: number | null,
): Omit<ReportDataResult, 'fields'> {
  let source = rows;
  const field = options.sortField;
  if (field) {
    if (!columns.includes(field)) throw new HTTPException(400, { message: `排序字段不存在：${field}` });
    const direction = options.sortOrder === 'asc' ? 1 : -1;
    source = [...rows].sort((left, right) => {
      const a = left[field];
      const b = right[field];
      if (a === b) return 0;
      if (a === null || a === undefined) return 1;
      if (b === null || b === undefined) return -1;
      return (typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b))) * direction;
    });
  }
  const total = totalOverride ?? source.length;
  if (options.page !== undefined && options.pageSize !== undefined) {
    const offset = pageOffset(options.page, options.pageSize);
    return { columns, rows: source.slice(offset, offset + options.pageSize), total };
  }
  const limit = Math.max(1, Math.min(options.limit ?? PREVIEW_LIMIT, MAX_LIMIT));
  return { columns, rows: source.slice(0, limit), total };
}
