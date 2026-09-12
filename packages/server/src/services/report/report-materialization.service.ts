import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { createHash } from 'node:crypto';
import dayjs from 'dayjs';
import { HTTPException } from 'hono/http-exception';
import { and, asc, desc, eq, gt, inArray, isNull, lt, max, or } from 'drizzle-orm';
import { reportMaterializationContract } from '@zenith/shared/report';
import type { ReportDataResult, ReportMaterializationSnapshot, ReportMaterializationStrategy, ReportResultField } from '@zenith/shared/report';
import type { QueryOutputOf } from '@zenith/shared/core';
import { config } from '../../config';
import { db } from '../../db';
import { reportDatasets, reportMaterializationSnapshots } from '../../db/schema';
import { currentUserId } from '../../lib/context';
import { formatFileTimestamp, formatNullableDateTime, formatTimestamps, parseDateTimeInput } from '../../lib/datetime';
import logger from '../../lib/logger';
import { pageOffset } from '../../lib/pagination';
import redis from '../../lib/redis';
import {
  deleteGeneratedManagedFile,
  readGeneratedManagedFile,
  saveGeneratedManagedFile,
} from '../files/files.service';
import { reportScopedWhere } from './report-access';
import { ensureReportResourceAccess } from './report-resource-acl.service';

const INLINE_SNAPSHOT_MAX_BYTES = 256 * 1024;
const SNAPSHOT_MAX_BYTES = 32 * 1024 * 1024;
const MATERIALIZATION_CACHE_PREFIX = `${config.redis.keyPrefix}report:matview:`;

type SnapshotRow = typeof reportMaterializationSnapshots.$inferSelect;

async function clearMaterializationHotCache(datasetId: number): Promise<void> {
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${MATERIALIZATION_CACHE_PREFIX}${datasetId}:*`,
        'COUNT',
        200,
      );
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } catch (error) {
    logger.warn('清理物化快照热缓存失败', {
      datasetId,
      err: error instanceof Error ? error.message : String(error),
    });
  }
}

function parseSnapshotData(value: unknown): ReportDataResult {
  if (!value || typeof value !== 'object') throw new HTTPException(500, { message: '物化快照内容无效' });
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.columns) || !record.columns.every((item) => typeof item === 'string') || !Array.isArray(record.rows)) {
    throw new HTTPException(500, { message: '物化快照结构无效' });
  }
  const rows = record.rows.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  if (rows.length !== record.rows.length) throw new HTTPException(500, { message: '物化快照行结构无效' });
  const fields: ReportResultField[] = record.columns.map((name) => {
    const raw = Array.isArray(record.fields)
      ? record.fields.find((item) => Boolean(item) && typeof item === 'object' && (item as Record<string, unknown>).name === name)
      : undefined;
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    const rawType = item?.type;
    const type = rawType === 'number' || rawType === 'date' || rawType === 'boolean' ? rawType : 'string';
    return {
      name,
      label: typeof item?.label === 'string' ? item.label : name,
      type,
      source: item?.source === 'declared' || item?.source === 'computed' ? item.source : 'inferred',
    };
  });
  return {
    columns: record.columns,
    fields,
    rows,
    total: typeof record.total === 'number' ? record.total : rows.length,
    bytes: typeof record.bytes === 'number' ? record.bytes : undefined,
    truncated: typeof record.truncated === 'boolean' ? record.truncated : undefined,
  };
}

export function mapReportMaterializationSnapshot(row: SnapshotRow): ReportMaterializationSnapshot {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    datasetId: row.datasetId,
    strategy: row.strategy,
    status: row.status,
    revision: row.revision,
    keyField: row.keyField ?? null,
    watermark: row.watermark ?? null,
    deltaWindowMinutes: row.deltaWindowMinutes ?? null,
    fileId: row.fileId ?? null,
    rowCount: row.rowCount,
    byteSize: row.byteSize,
    checksum: row.checksum ?? null,
    startedAt: formatNullableDateTime(row.startedAt),
    completedAt: formatNullableDateTime(row.completedAt),
    expiresAt: formatNullableDateTime(row.expiresAt),
    errorMessage: row.errorMessage ?? null,
    createdBy: row.createdBy ?? null,
    ...formatTimestamps(row),
  };
}

function keyToken(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    throw new HTTPException(400, { message: '增量物化键不能为空' });
  }
  if (typeof value === 'object') throw new HTTPException(400, { message: '增量物化键必须是标量值' });
  return `${typeof value}:${String(value)}`;
}

export function mergeIncrementalSnapshot(
  previous: ReportDataResult | null,
  delta: ReportDataResult,
  keyField: string,
): ReportDataResult {
  if (!delta.columns.includes(keyField)) throw new HTTPException(400, { message: `增量键不存在：${keyField}` });
  const merged = new Map<string, Record<string, unknown>>();
  for (const row of previous?.rows ?? []) merged.set(keyToken(row[keyField]), row);
  for (const row of delta.rows) merged.set(keyToken(row[keyField]), row);
  const rows = [...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en', { numeric: true }))
    .map(([, row]) => row);
  const columns = [...new Set([...(previous?.columns ?? []), ...delta.columns])];
  const previousFields = previous?.fields ?? [];
  const fields = columns.map((name) =>
    delta.fields.find((field) => field.name === name)
    ?? previousFields.find((field) => field.name === name)
    ?? { name, label: name, type: 'string' as const, source: 'inferred' as const });
  return { columns, fields, rows, total: rows.length };
}

export function filterIncrementalDelta(
  data: ReportDataResult,
  keyField: string,
  watermark: string | null,
  deltaWindowMinutes: number | null,
): ReportDataResult {
  if (!watermark) return data;
  const watermarkDate = dayjs(watermark);
  const numericWatermark = Number(watermark);
  const threshold = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/.test(watermark) && watermarkDate.isValid()
    ? watermarkDate.subtract(deltaWindowMinutes ?? 0, 'minute')
    : null;
  const rows = data.rows.filter((row) => {
    const value = row[keyField];
    if (threshold) {
      const parsed = dayjs(value as string | number | Date);
      return parsed.isValid() && !parsed.isBefore(threshold);
    }
    if (Number.isFinite(numericWatermark)) return Number(value) >= numericWatermark;
    return String(value ?? '').localeCompare(watermark) >= 0;
  });
  return { ...data, rows, total: rows.length };
}

export function resolveSnapshotWatermark(rows: Record<string, unknown>[], keyField: string): string | null {
  let best: unknown = null;
  for (const row of rows) {
    const value = row[keyField];
    if (value === null || value === undefined || value === '') continue;
    if (best === null || String(value).localeCompare(String(best), 'en', { numeric: true }) > 0) best = value;
  }
  return best === null ? null : String(best);
}

export async function beginMaterializationSnapshot(input: {
  datasetId: number;
  tenantId: number | null;
  strategy: ReportMaterializationStrategy;
  keyField?: string | null;
  deltaWindowMinutes?: number | null;
  expiresAt?: string | null;
}): Promise<SnapshotRow> {
  return db.transaction(async (tx) => {
    await tx.select({ id: reportDatasets.id }).from(reportDatasets)
      .where(eq(reportDatasets.id, input.datasetId))
      .for('update');
    const [latest] = await tx.select({ revision: max(reportMaterializationSnapshots.revision) })
      .from(reportMaterializationSnapshots)
      .where(eq(reportMaterializationSnapshots.datasetId, input.datasetId));
    const [row] = await tx.insert(reportMaterializationSnapshots).values({
      tenantId: input.tenantId,
      datasetId: input.datasetId,
      strategy: input.strategy,
      status: 'building',
      revision: (latest?.revision ?? 0) + 1,
      keyField: input.keyField ?? null,
      deltaWindowMinutes: input.deltaWindowMinutes ?? null,
      expiresAt: input.expiresAt ? parseDateTimeInput(input.expiresAt) : null,
      startedAt: new Date(),
      createdBy: currentUserId(),
      updatedBy: currentUserId(),
    }).returning();
    return row!;
  });
}

export async function resumeMaterializationSnapshot(snapshotId: number, datasetId: number): Promise<SnapshotRow> {
  const rowOrUndefined = await db.query.reportMaterializationSnapshots.findFirst({
    where: and(
      eq(reportMaterializationSnapshots.id, snapshotId),
      eq(reportMaterializationSnapshots.datasetId, datasetId),
    ),
  });
  const row = requireRow(rowOrUndefined, '物化任务断点不存在');
  if (row.status === 'ready') return row;
  const [updated] = await db.update(reportMaterializationSnapshots).set({
    status: 'building',
    startedAt: new Date(),
    completedAt: null,
    errorMessage: null,
    updatedBy: currentUserId(),
  }).where(eq(reportMaterializationSnapshots.id, snapshotId)).returning();
  return updated!;
}

export async function completeMaterializationSnapshot(
  snapshotId: number,
  data: ReportDataResult,
  watermark: string | null,
): Promise<SnapshotRow> {
  const rowOrUndefined = await db.query.reportMaterializationSnapshots.findFirst({
    where: eq(reportMaterializationSnapshots.id, snapshotId),
  });
  const row = requireRow(rowOrUndefined, '物化快照不存在');
  const json = JSON.stringify({ ...data, total: data.rows.length });
  const buffer = Buffer.from(json, 'utf8');
  if (buffer.byteLength > SNAPSHOT_MAX_BYTES) {
    throw new HTTPException(413, { message: `物化快照不能超过 ${SNAPSHOT_MAX_BYTES / 1024 / 1024}MB` });
  }
  let fileId: string | null = null;
  let inlineData: ReportDataResult | null = null;
  if (buffer.byteLength <= INLINE_SNAPSHOT_MAX_BYTES) {
    inlineData = parseSnapshotData(JSON.parse(json));
  } else {
    const file = await saveGeneratedManagedFile({
      buffer,
      filename: `report-snapshot-${row.datasetId}-r${row.revision}-${formatFileTimestamp(new Date())}.json`,
      mimeType: 'application/json',
      tenantId: row.tenantId,
      createdBy: currentUserId(),
    });
    fileId = file!.id;
  }
  const completedAt = new Date();
  const [updated] = await db.update(reportMaterializationSnapshots).set({
    status: 'ready',
    inlineData,
    fileId,
    watermark,
    rowCount: data.rows.length,
    byteSize: buffer.byteLength,
    checksum: createHash('sha256').update(buffer).digest('hex'),
    completedAt,
    errorMessage: null,
    updatedBy: currentUserId(),
  }).where(eq(reportMaterializationSnapshots.id, snapshotId)).returning();
  return updated!;
}

export async function failMaterializationSnapshot(snapshotId: number, error: unknown): Promise<void> {
  await db.update(reportMaterializationSnapshots).set({
    status: 'failed',
    completedAt: new Date(),
    errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    updatedBy: currentUserId(),
  }).where(eq(reportMaterializationSnapshots.id, snapshotId));
}

export async function loadMaterializationSnapshotData(row: SnapshotRow): Promise<ReportDataResult> {
  if (row.inlineData) return parseSnapshotData(row.inlineData);
  if (!row.fileId) throw new HTTPException(500, { message: '物化快照缺少数据载体' });
  const content = await readGeneratedManagedFile(row.fileId, row.tenantId);
  const bytes = await new Response(content.stream).arrayBuffer();
  return parseSnapshotData(JSON.parse(Buffer.from(bytes).toString('utf8')));
}

export async function loadCurrentMaterializationSnapshot(datasetId: number): Promise<{
  snapshot: SnapshotRow;
  data: ReportDataResult;
} | null> {
  const now = new Date();
  const row = await db.query.reportMaterializationSnapshots.findFirst({
    where: and(
      eq(reportMaterializationSnapshots.datasetId, datasetId),
      eq(reportMaterializationSnapshots.status, 'ready'),
      or(isNull(reportMaterializationSnapshots.expiresAt), gt(reportMaterializationSnapshots.expiresAt, now)),
    ),
    orderBy: desc(reportMaterializationSnapshots.revision),
  });
  return row ? { snapshot: row, data: await loadMaterializationSnapshotData(row) } : null;
}

export async function listMaterializationSnapshots(datasetId: number, query: QueryOutputOf<typeof reportMaterializationContract.snapshots>) {
  const { page, pageSize } = query;
  await ensureReportResourceAccess('dataset', datasetId, 'viewer');
  const where = reportScopedWhere(
    reportMaterializationSnapshots,
    eq(reportMaterializationSnapshots.datasetId, datasetId),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(reportMaterializationSnapshots, where),
    rows: () => db.select().from(reportMaterializationSnapshots).where(where)
            .orderBy(desc(reportMaterializationSnapshots.revision))
            .limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapReportMaterializationSnapshot,
  });
}

export async function getCurrentMaterializationSnapshot(datasetId: number): Promise<ReportMaterializationSnapshot | null> {
  await ensureReportResourceAccess('dataset', datasetId, 'viewer');
  const current = await loadCurrentMaterializationSnapshot(datasetId);
  return current ? mapReportMaterializationSnapshot(current.snapshot) : null;
}

export async function purgeMaterializationSnapshot(id: number): Promise<void> {
  const rowOrUndefined = await db.query.reportMaterializationSnapshots.findFirst({
    where: reportScopedWhere(reportMaterializationSnapshots, eq(reportMaterializationSnapshots.id, id)),
  });
  const row = requireRow(rowOrUndefined, '物化快照不存在');
  await ensureReportResourceAccess('dataset', row.datasetId, 'editor');
  if (row.fileId) await deleteGeneratedManagedFile(row.fileId, row.tenantId);
  await db.update(reportMaterializationSnapshots).set({
    status: 'deleted',
    inlineData: null,
    fileId: null,
    updatedBy: currentUserId(),
  }).where(eq(reportMaterializationSnapshots.id, id));
  await db.update(reportDatasets).set({ updatedAt: new Date() }).where(eq(reportDatasets.id, row.datasetId));
  await clearMaterializationHotCache(row.datasetId);
}

export async function purgeDatasetMaterializationSnapshots(datasetId: number): Promise<number> {
  await ensureReportResourceAccess('dataset', datasetId, 'editor');
  const rows = await db.select().from(reportMaterializationSnapshots).where(and(
    eq(reportMaterializationSnapshots.datasetId, datasetId),
    inArray(reportMaterializationSnapshots.status, ['ready', 'failed', 'expired']),
  )).orderBy(asc(reportMaterializationSnapshots.revision));
  for (const row of rows) await purgeMaterializationSnapshot(row.id);
  return rows.length;
}

export async function cleanupStaleMaterializationSnapshots(now = new Date()): Promise<number> {
  const rows = await db.select().from(reportMaterializationSnapshots).where(and(
    inArray(reportMaterializationSnapshots.status, ['ready', 'failed', 'expired']),
    or(
      and(eq(reportMaterializationSnapshots.status, 'ready'), lt(reportMaterializationSnapshots.expiresAt, now)),
      lt(reportMaterializationSnapshots.createdAt, dayjs(now).subtract(30, 'day').toDate()),
    ),
  ));
  const affectedDatasets = new Set<number>();
  for (const row of rows) {
    if (row.fileId) await deleteGeneratedManagedFile(row.fileId, row.tenantId);
    await db.update(reportMaterializationSnapshots).set({
      status: 'deleted',
      inlineData: null,
      fileId: null,
    }).where(eq(reportMaterializationSnapshots.id, row.id));
    affectedDatasets.add(row.datasetId);
  }
  if (affectedDatasets.size) {
    await db.update(reportDatasets).set({ updatedAt: now })
      .where(inArray(reportDatasets.id, [...affectedDatasets]));
  }
  for (const datasetId of affectedDatasets) await clearMaterializationHotCache(datasetId);
  return rows.length;
}
