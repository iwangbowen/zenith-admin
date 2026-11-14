import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { buildListResult } from '../../lib/list-query';
import { getSettings } from '../../lib/settings';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireRow } from '../../lib/db-assert';
import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { stableStringify, type QueryOutputOf } from '@zenith/shared/core';
import { EXPORT_SCOPES, exportJobContract, type ExportScope } from '@zenith/shared/tasks';
import type { JobStuckItem } from '@zenith/shared/platform';
import { db } from '../../db';
import { exportJobDownloads, exportJobs, exportDailyUsage, asyncTasks, managedFiles, users } from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime, formatFileTimestamp, formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { currentUser, runWithCurrentUser } from '../../lib/context';
import { getUserPermissions, isSuperAdmin } from '../../lib/permissions';
import { exactTenantCondition, getCreateTenantId } from '../../lib/tenant';
import { getRestrictedFileForRead, saveGeneratedManagedFile, deleteGeneratedManagedFile } from '../files/files.service';
import { readStoredFile } from '../../lib/file-storage';
import { getExportDefinition, listExportDefinitions } from '../../lib/export-center/registry';
import { leafColumns, renderExportWorkbook, renderExportToPath } from '../../lib/export-center/writer';
import { renderPartitionedExport } from '../../lib/export-center/partition';
import { selectExportRows } from '../../lib/export-center/scope';
import type { AnyExportDefinition, ExportExecutionMode, ExportFormat, ExportRequestMode, ExportRuntimeContext } from '../../lib/export-center/types';
import { DEFAULT_EXPORT_EXECUTION, DEFAULT_EXPORT_RETENTION } from '../../lib/export-center/types';
import { persistAsyncTask, runAsyncTask, requestCancelAsyncTask, restartAsyncTask, registerTaskHandler, TaskCancelledError, TaskNonRetryableError, type TaskRunContext } from '../../lib/task-center';
import { retainManagedFiles, releaseManagedFiles } from '../files/file-gc.service';
import { rememberTransactionEffect, flushTransactionEffects } from '../../lib/transaction-effects';
import type { DbTransaction } from '../../db/types';
import { runAsUser } from '../../lib/audit-context';
import { getExportMaskRuleMap } from '../platform/data-mask.service';
import { notify } from '../messaging/notification-outbox.service';
import logger from '../../lib/logger';
import type { JwtPayload } from '../../middleware/auth';
import type { JobSourceRawSummary } from '../../lib/job-monitor/registry';

export const EXPORT_TASK_TYPE = 'data-export';
export const EXPORT_JOB_STUCK_MS = 30 * 60_000;

export function stuckExportJobCondition(asOf = new Date()) {
  return and(eq(exportJobs.status, 'running'), lt(exportJobs.startedAt, new Date(asOf.getTime() - EXPORT_JOB_STUCK_MS)));
}

/** 导出没有执行心跳，按开始时间和导出域的超时阈值监控。 */
export async function getExportJobHealth(): Promise<JobSourceRawSummary> {
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const hour = new Date(now.getTime() - 3_600_000);
  const [row] = await db.select({
    pending: sql<number>`count(*) filter (where ${exportJobs.status} = 'pending')::int`,
    running: sql<number>`count(*) filter (where ${exportJobs.status} = 'running')::int`,
    stuck: sql<number>`count(*) filter (where ${stuckExportJobCondition(now)})::int`,
    failed24h: sql<number>`count(*) filter (where ${exportJobs.status} = 'failed' and ${exportJobs.completedAt} >= ${sql.param(since, exportJobs.createdAt)})::int`,
    succeeded24h: sql<number>`count(*) filter (where ${exportJobs.status} = 'success' and ${exportJobs.completedAt} >= ${sql.param(since, exportJobs.createdAt)})::int`,
    failed1h: sql<number>`count(*) filter (where ${exportJobs.status} = 'failed' and ${exportJobs.completedAt} >= ${sql.param(hour, exportJobs.createdAt)})::int`,
    oldestPendingAgeSec: sql<number | null>`floor(extract(epoch from (${sql.param(now, exportJobs.createdAt)}::timestamptz - min(${exportJobs.createdAt}) filter (where ${exportJobs.status} = 'pending'))))::int`,
  }).from(exportJobs).where(or(inArray(exportJobs.status, ['pending', 'running']), and(inArray(exportJobs.status, ['success', 'failed']), gte(exportJobs.completedAt, since))));
  return {
    counts: { pending: row?.pending ?? 0, running: row?.running ?? 0, stuck: row?.stuck ?? 0, dead: null, failed24h: row?.failed24h ?? 0, succeeded24h: row?.succeeded24h ?? 0 },
    oldestPendingAgeSec: row?.oldestPendingAgeSec ?? null,
    failed1h: row?.failed1h ?? 0,
    issues: [],
  };
}

export async function listStuckExportJobs(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({
    id: exportJobs.id, entity: exportJobs.entity, moduleName: exportJobs.moduleName,
    filename: exportJobs.filename, status: exportJobs.status, startedAt: exportJobs.startedAt,
    updatedAt: exportJobs.updatedAt, errorMessage: exportJobs.errorMessage,
  }).from(exportJobs).where(stuckExportJobCondition(now)).orderBy(exportJobs.startedAt, exportJobs.id).limit(limit);
  return rows.map((row) => ({
    source: 'export-job', refId: String(row.id), title: row.filename ?? `${row.moduleName} / ${row.entity}`, status: row.status,
    startedAt: formatNullableDateTime(row.startedAt), lastSeenAt: formatDateTime(row.updatedAt),
    ageSec: row.startedAt ? Math.max(0, Math.floor((now.getTime() - row.startedAt.getTime()) / 1000)) : 0,
    nodeId: null, detail: row.errorMessage,
    drillDown: { path: '/system/export-jobs?status=running', label: '查看导出任务' },
  }));
}

export interface CreateExportJobInput {
  entity: string;
  format: ExportFormat;
  query?: Record<string, unknown>;
  columns?: string[];
  scope?: ExportScope;
  rowIds?: Array<string | number>;
  idempotencyKey?: string;
  splitRows?: number;
  raw?: boolean;
  watermark?: boolean;
  executionMode?: ExportRequestMode;
}

function normalizeExecution(definition: AnyExportDefinition) {
  return { ...DEFAULT_EXPORT_EXECUTION, ...definition.execution };
}

function normalizeRetention(definition: AnyExportDefinition) {
  return { ...DEFAULT_EXPORT_RETENTION, ...definition.retention };
}

async function hasPermission(user: JwtPayload, permission?: string): Promise<boolean> {
  if (!permission) return false;
  if (isSuperAdmin(user)) return true;
  const permissions = await getUserPermissions(user.userId);
  return permissions.includes(permission);
}

export async function assertExportPermission(definition: AnyExportDefinition, raw: boolean, user: JwtPayload) {
  if (!await hasPermission(user, definition.permissions.export)) {
    throw new HTTPException(403, { message: '无导出权限' });
  }
  if (raw && (definition.permissions.requireExportRawPermission || definitionHasSensitiveColumns(definition, null) || definition.resolveColumns) && !await hasPermission(user, definition.permissions.exportRaw)) {
    throw new HTTPException(403, { message: '无明文导出权限' });
  }
}

async function canManageAllJobs(user: JwtPayload): Promise<boolean> {
  return isSuperAdmin(user) || await hasPermission(user, 'system:export-job:manage');
}

async function canManageTenantJobs(user: JwtPayload): Promise<boolean> {
  return await canManageAllJobs(user) || await hasPermission(user, 'system:export-job:tenant-manage');
}

function definitionHasSensitiveColumns(definition: AnyExportDefinition, selectedColumns: string[] | null): boolean {
  const selectedSet = selectedColumns?.length ? new Set(selectedColumns) : null;
  return leafColumns(definition.columns).some((column) => {
    if (!column.sensitive) return false;
    return !selectedSet || (column.key ? selectedSet.has(column.key) : false);
  });
}

export function resolveExecutionMode(
  requested: ExportRequestMode | undefined,
  rowCount: number,
  sensitive: boolean,
  raw: boolean,
  definition: AnyExportDefinition,
): ExportExecutionMode {
  const policy = normalizeExecution(definition);
  if (definition.withSnapshot || policy.mode === 'async' || requested === 'async') return 'async';
  if (policy.forceAsyncWhenRaw && raw) return 'async';
  if (policy.forceAsyncWhenSensitive && sensitive) return 'async';
  return rowCount <= policy.syncMaxRows ? 'sync' : 'async';
}

function calculateExpiresAt(definition: AnyExportDefinition, raw: boolean, sensitive: boolean): Date {
  const retention = normalizeRetention(definition);
  const days = raw ? retention.rawDays : sensitive ? retention.sensitiveDays : retention.normalDays;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
}

function buildFilename(definition: AnyExportDefinition, jobId: number, format: ExportFormat): string {
  return `${definition.filenamePrefix}_${formatFileTimestamp()}_${jobId}.${format}`;
}

function mapExportJob(row: typeof exportJobs.$inferSelect & { createdByUser?: { nickname: string | null; username: string } | null }) {
  return {
    id: row.id,
    entity: row.entity,
    moduleName: row.moduleName,
    format: row.format,
    status: row.status,
    executionMode: row.executionMode,
    taskId: row.taskId,
    cancelRequested: row.cancelRequested,
    stage: row.stage,
    sha256: row.sha256,
    query: row.query ?? {},
    columns: row.columns ?? null,
    scope: EXPORT_SCOPES.find(scope => scope === row.scope) ?? 'filtered',
    rowIds: row.rowIds,
    splitRows: row.splitRows,
    manifest: row.manifest,
    rowCount: row.rowCount ?? null,
    processedRows: row.processedRows,
    totalRows: row.totalRows,
    fileId: row.fileId ?? null,
    filename: row.filename ?? null,
    fileSize: row.fileSize ?? null,
    raw: row.raw,
    masked: row.masked,
    sensitive: row.sensitive,
    watermark: row.watermark,
    errorMessage: row.errorMessage ?? null,
    expiresAt: formatNullableDateTime(row.expiresAt),
    fileDeletedAt: formatNullableDateTime(row.fileDeletedAt),
    deleteReason: row.deleteReason ?? null,
    downloadCount: row.downloadCount,
    lastDownloadedAt: formatNullableDateTime(row.lastDownloadedAt),
    tenantId: row.tenantId ?? null,
    createdBy: row.createdBy ?? null,
    createdByName: row.createdByUser?.nickname || row.createdByUser?.username || null,
    startedAt: formatNullableDateTime(row.startedAt),
    completedAt: formatNullableDateTime(row.completedAt),
    ...formatTimestamps(row),
  };
}

function mapExportJobDownload(row: typeof exportJobDownloads.$inferSelect & { user?: { nickname: string | null; username: string } | null }) {
  return {
    id: row.id,
    jobId: row.jobId,
    downloadedBy: row.downloadedBy ?? null,
    downloadedByName: row.user?.nickname || row.user?.username || null,
    tenantId: row.tenantId ?? null,
    ip: row.ip ?? null,
    userAgent: row.userAgent ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

async function getCreatorPayload(row: typeof exportJobs.$inferSelect): Promise<JwtPayload> {
  if (!row.createdBy) throw new HTTPException(403, { message: '导出任务缺少有效创建人' });
  const user = await db.query.users.findFirst({
    where: eq(users.id, row.createdBy),
    columns: { id: true, username: true, tenantId: true, status: true },
    with: { userRoles: { columns: {}, with: { role: { columns: { code: true, status: true } } } } },
  });
  if (!user || user.status !== 'enabled') throw new HTTPException(403, { message: '导出创建人已不存在或已停用' });
  const roles = user.userRoles.filter(item => item.role.status === 'enabled').map(item => item.role.code);
  const payload: JwtPayload = { userId: user.id, username: user.username, roles, tenantId: user.tenantId };
  if (isSuperAdmin(payload)) return { ...payload, viewingTenantId: row.tenantId };
  if (user.tenantId !== row.tenantId) throw new HTTPException(403, { message: '导出创建人的租户已变更，请重新提交' });
  return payload;
}

class ExportCancelledError extends Error {}

function runningAttempt(row: typeof exportJobs.$inferSelect) {
  return buildWhere(eq(exportJobs.id, row.id), eq(exportJobs.status, 'running'), eq(exportJobs.cancelRequested, false), row.executionToken ? eq(exportJobs.executionToken, row.executionToken) : undefined);
}

async function updateExportProgress(row: typeof exportJobs.$inferSelect, processedRows: number, totalRows: number | null) {
  const [updated] = await db.update(exportJobs).set({ processedRows, totalRows }).where(runningAttempt(row)).returning({ id: exportJobs.id });
  if (!updated) throw new ExportCancelledError('导出任务已取消或已被新的执行替换');
}

type RenderedJobFile = { mimeType: string; filename: string; rowCount?: number | null; manifest?: Record<string, unknown>; cleanup?: () => Promise<void> }
  & ({ buffer: Buffer; filePath?: never } | { buffer?: never; filePath: string });

async function renderJobFile(row: typeof exportJobs.$inferSelect, definition: AnyExportDefinition, task?: TaskRunContext): Promise<RenderedJobFile> {
  const creator = await getCreatorPayload(row);
  const filename = row.filename ?? buildFilename(definition, row.id, row.format);
  // 脱敏导出：预加载数据脱敏中心规则，敏感列渲染时统一打码
  const maskRules = row.masked ? await getExportMaskRuleMap() : null;
  const policy = await getSettings('exports');
  const ctx: ExportRuntimeContext = {
    jobId: row.id,
    entity: row.entity,
    moduleName: row.moduleName,
    format: row.format,
    query: row.query as Record<string, unknown>,
    selectedColumns: row.columns ?? null,
    rowIds: row.rowIds,
    raw: row.raw,
    masked: row.masked,
    sensitive: row.sensitive,
    watermark: row.watermark,
    currentUser: creator,
    createdByName: null,
    exportedAt: new Date(),
    maskRules,
    byteLimit: policy.maxFileMb * 1024 * 1024,
    rowLimit: Math.min(normalizeExecution(definition).maxRows, policy.maxRows),
    progress: async (processed, total) => {
      if (task && (await task.progress({ processed, total, note: `导出 ${processed}/${total ?? '?'} 行` })).cancelRequested) throw new TaskCancelledError('导出已请求取消');
      await updateExportProgress(row, processed, total);
    },
  };
  return runWithCurrentUser(creator, async () => {
    await assertExportPermission(definition, row.raw, creator);

    if (definition.withSnapshot) {
      const folder = await mkdtemp(join(tmpdir(), 'zenith-export-'));
      const filePath = join(folder, `report.${row.format}`);
      const cleanup = () => rm(folder, { recursive: true, force: true });
      try {
        let rowCount = 0;
        await definition.withSnapshot(ctx, async (rows, total) => {
          if (ctx.rowLimit && total > ctx.rowLimit) throw new HTTPException(400, { message: `导出数据 ${total} 行，超过上限 ${ctx.rowLimit} 行，请收窄筛选条件` });
          rowCount = await renderExportToPath(definition, rows, ctx, filePath, total);
        });
        return { filePath, filename, rowCount, cleanup, mimeType: row.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
      } catch (error) { await cleanup(); throw error; }
    }
    if (definition.renderFile) {
      await ctx.progress?.(0, row.rowCount);
      const rendered = await definition.renderFile(ctx);
      if (rendered.buffer.length > ctx.byteLimit!) throw new HTTPException(400, { message: '导出文件超过字节预算，请收窄条件' });
      await ctx.progress?.(rendered.rowCount ?? row.rowCount ?? 0, rendered.rowCount ?? row.rowCount);
      return {
        buffer: rendered.buffer,
        mimeType: rendered.mimeType,
        filename: rendered.filename ?? filename,
        rowCount: rendered.rowCount,
      };
    }
    const rows = await definition.streamRows(row.query as Record<string, unknown>, creator, ctx);
    if ((definition.renderMode ?? 'table') === 'table') {
      const folder = await mkdtemp(join(tmpdir(), 'zenith-export-'));
      const filePath = join(folder, `report.${row.format}`);
      const cleanup = () => rm(folder, { recursive: true, force: true });
      try {
        async function* stream() {
          yield* selectExportRows(rows, row.rowIds, async () => {
            if (task && await task.isCancelRequested()) throw new TaskCancelledError('导出已取消');
          });
        }
        if (row.splitRows > 0) {
          const result = await renderPartitionedExport(definition, stream(), ctx, folder, row.splitRows, row.rowCount ?? 0);
          return { ...result, manifest: result.manifest, filename: filename.replace(/\.[^.]+$/u, '.zip'), cleanup, mimeType: 'application/zip' };
        }
        const rowCount = await renderExportToPath(definition, stream(), ctx, filePath, row.rowCount ?? 0);
        return { filePath, filename, rowCount, cleanup, mimeType: row.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
      } catch (error) { await cleanup(); throw error; }
    }
    const buffer = await renderExportWorkbook(definition, rows, ctx);
    if (buffer.length > ctx.byteLimit!) throw new HTTPException(400, { message: '导出文件超过字节预算，请收窄条件' });
    return { buffer, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename };
  });
}

async function executeExportJob(row: typeof exportJobs.$inferSelect, definition: AnyExportDefinition) {
  const startedAt = new Date();
  const [claimed] = await db.update(exportJobs).set({ status: 'running', stage: 'rendering', executionToken: randomUUID(), startedAt, errorMessage: null, processedRows: 0, totalRows: null })
    .where(buildWhere(eq(exportJobs.id, row.id), eq(exportJobs.status, 'pending'), isNull(exportJobs.taskId))).returning();
  if (!claimed) return requireRow(await db.query.exportJobs.findFirst({ where: eq(exportJobs.id, row.id) }), '导出任务不存在');
  row = claimed;
  let rendered: RenderedJobFile | undefined;
  let savedFileId: string | undefined;
  try {
    rendered = await renderJobFile(row, definition);
    const digest = createHash('sha256');
    if (rendered.filePath) for await (const chunk of createReadStream(rendered.filePath)) digest.update(chunk);
    else digest.update(rendered.buffer!);
    const sha256 = digest.digest('hex');
    if (!row.createdBy) throw new HTTPException(400, { message: '导出任务缺少创建人' });
    await updateExportProgress(row, rendered.rowCount ?? row.rowCount ?? 0, rendered.rowCount ?? row.rowCount);
    const savedFile = await saveGeneratedManagedFile({
      ...(rendered.filePath ? { filePath: rendered.filePath } : { buffer: rendered.buffer! }),
      filename: rendered.filename,
      mimeType: rendered.mimeType,
      tenantId: row.tenantId ?? null,
      createdBy: row.createdBy,
      visibility: 'restricted',
    });
    savedFileId = savedFile.id;
    const completedAt = new Date();
    const updated = await db.transaction(async (tx) => {
      const [result] = await tx.update(exportJobs)
      .set({
        status: 'success',
        fileId: savedFile.id,
        filename: rendered!.filename,
        fileSize: savedFile.size,
        sha256,
        manifest: rendered!.manifest ?? null,
        completedAt,
        expiresAt: calculateExpiresAt(definition, row.raw, row.sensitive),
        stage: 'completed',
        // 渲染阶段回读到的真实写入行数（legacy 导出的 countRows 恒为 0，此处回写修正「进度」列）
        ...(rendered!.rowCount !== undefined ? { rowCount: rendered!.rowCount } : {}),
      })
      .where(runningAttempt(row))
      .returning();
      if (!result) throw new ExportCancelledError('导出任务已取消或已被新的执行替换');
      await retainManagedFiles(tx, [savedFile.id]);
      return result;
    });
    savedFileId = undefined;
    await notifyExportFinished(row, '已完成', `，文件「${rendered.filename}」已生成`);
    return updated;
  } catch (err) {
    if (savedFileId) await deleteExportJobFile(savedFileId).catch((cleanupError: unknown) => logger.warn('[export-jobs] 取消后文件回收失败', { fileId: savedFileId, cleanupError }));
    if (err instanceof ExportCancelledError) return await db.query.exportJobs.findFirst({ where: eq(exportJobs.id, row.id) }) ?? { ...row, status: 'cancelled' as const };
    const message = err instanceof Error ? err.message : '导出失败';
    const [failed] = await db.update(exportJobs)
      .set({ status: 'failed', stage: 'failed', errorMessage: message, completedAt: new Date() })
      .where(runningAttempt(row)).returning({ id: exportJobs.id });
    if (failed) await notifyExportFinished(row, '失败', `：${message.slice(0, 120)}`);
    throw err;
  } finally { await rendered?.cleanup?.(); }
}

/** 导出结果通知创建人：异步任务里用户看不到请求响应，完成/失败必须主动触达（同步导出当场拿到文件，不发）。 */
async function notifyExportFinished(row: typeof exportJobs.$inferSelect, resultText: string, detail: string): Promise<void> {
  if (!row.createdBy || row.executionMode === 'sync') return;
  try {
    await notify('platform.export.finished', {
      recipients: [{ type: 'user', id: row.createdBy }],
      vars: { jobId: row.id, moduleName: row.moduleName, resultText, detail },
      tenantId: row.tenantId ?? null,
      link: `/system/export-jobs?jobId=${row.id}`,
    });
  } catch (err) {
    logger.warn('[export-jobs] 导出结果通知发送失败', { jobId: row.id, err });
  }
}

export async function listExportEntities() {
  const user = currentUser();
  const definitions = listExportDefinitions();
  const result = [];
  for (const definition of definitions) {
    if (!await hasPermission(user, definition.permissions.export)) continue;
    const columns = definition.columns.map((column) => ({
      key: column.key ?? column.header,
      header: column.header,
      width: column.width,
      type: column.type,
      sensitive: !!column.sensitive,
      children: column.children?.map((child) => ({
        key: child.key ?? child.header,
        header: child.header,
        width: child.width,
        type: child.type,
        sensitive: !!child.sensitive,
      })),
    }));
    result.push({
      entity: definition.entity,
      moduleName: definition.moduleName,
      filenamePrefix: definition.filenamePrefix,
      sourcePath: definition.sourcePath,
      formats: definition.formats ?? ['xlsx', 'csv'],
      renderMode: definition.renderMode ?? 'table',
      columns,
      sensitive: definitionHasSensitiveColumns(definition, null),
      execution: normalizeExecution(definition),
      permissions: {
        export: definition.permissions.export,
        exportRaw: definition.permissions.exportRaw,
        requireExportRawPermission: definition.permissions.requireExportRawPermission,
      },
    });
  }
  return result;
}

export async function createExportJob(input: CreateExportJobInput) {
  const policy = await getSettings('exports');
  const user = currentUser();
  const definition = getExportDefinition(input.entity);
  if ((input.splitRows ?? 0) > 0 && (definition.withSnapshot || (definition.renderMode ?? 'table') !== 'table' || !['csv', 'xlsx'].includes(input.format))) throw new HTTPException(400, { message: '当前实体暂不支持分卷' });
  const format = input.format;
  if (!(definition.formats ?? ['xlsx', 'csv']).includes(format)) {
    throw new HTTPException(400, { message: '该导出不支持所选格式' });
  }
  if (format === 'csv' && (definition.renderMode ?? 'table') !== 'table') {
    throw new HTTPException(400, { message: '该导出包含复杂布局或自定义样式，仅支持 Excel' });
  }
  // 安全默认：未显式声明时按脱敏导出；明文导出需显式 raw=true 且通过 exportRaw 权限校验
  const raw = input.raw ?? false;
  await assertExportPermission(definition, raw, user);
  const query = definition.prepareQuery ? await definition.prepareQuery(input.query ?? {}, user) : input.query ?? {};
  const resolvedColumns = definition.resolveColumns ? await definition.resolveColumns(query, user) : definition.columns;
  if ((input.columns?.length ?? leafColumns(resolvedColumns).length) > policy.maxColumns) throw new HTTPException(400, { message: '所选列数超过导出治理预算' });
  const selectedColumns = input.columns ? [...new Set(input.columns)] : null;
  if (selectedColumns) {
    const available = new Set(leafColumns(resolvedColumns).map(column => column.key));
    if (!selectedColumns.length || selectedColumns.some(key => !available.has(key))) throw new HTTPException(400, { message: '所选导出字段不存在或不可用' });
  }
  const sensitive = definitionHasSensitiveColumns({ ...definition, columns: resolvedColumns }, selectedColumns);
  const scope = input.scope ?? 'filtered';
  const rowIds = scope === 'filtered' ? null : input.rowIds ?? [];
  if (scope !== 'filtered' && (!rowIds?.length || definition.withSnapshot || (definition.renderMode ?? 'table') !== 'table' || !leafColumns(resolvedColumns).some(column => column.key === 'id'))) throw new HTTPException(400, { message: '当前实体不支持所选范围，或范围内没有记录' });
  const rowCount = rowIds ? rowIds.length : definition.withSnapshot ? null : await definition.countRows(query, user);
  // 行数绝对上限（sync/async 通用）：exceljs 终局序列化与 CSV 全量累积都是主线程
  // 连续 CPU/内存段，提交时快速失败;countRows 不准的定义由 writer 渲染兜底再拦一道
  const maxRows = Math.min(normalizeExecution(definition).maxRows, policy.maxRows);
  if (maxRows > 0 && rowCount !== null && rowCount > maxRows) {
    throw new HTTPException(400, { message: `导出数据 ${rowCount} 行，超过上限 ${maxRows} 行，请收窄筛选条件或分批导出` });
  }
  const executionMode = resolveExecutionMode(input.executionMode, rowCount ?? 0, sensitive, raw, { ...definition, execution: { ...definition.execution, syncMaxRows: Math.min(normalizeExecution(definition).syncMaxRows, policy.syncMaxRows) } });
  const filename = buildFilename(definition, 0, format);
  if (definition.renderMode === 'layout') throw new HTTPException(400, { message: '暂不支持 layout 导出，请使用自定义渲染器' });
  let committed: DbTransaction | undefined;
  const renamed = await runAsUser(user.userId, () => db.transaction(async tx => {
    const budgetKey = stableStringify(['export-daily-budget', getCreateTenantId(user), user.userId]);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${budgetKey}, 0))`);
    if (input.idempotencyKey) {
      const lockKey = stableStringify(['export-admission', getCreateTenantId(user), user.userId, input.idempotencyKey]);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      const existing = await tx.query.exportJobs.findFirst({ where: buildWhere(eq(exportJobs.createdBy, user.userId), exactTenantCondition(exportJobs.tenantId, getCreateTenantId(user)), eq(exportJobs.requestKey, input.idempotencyKey)) });
      if (existing) {
        if (stableStringify([existing.entity, existing.format, existing.query, existing.columns, existing.rowIds, existing.raw, existing.scope, existing.splitRows, existing.watermark]) !== stableStringify([input.entity, format, query, selectedColumns, rowIds, raw, scope, input.splitRows ?? 0, input.watermark ?? true])) throw new HTTPException(409, { message: '相同幂等键不能用于不同导出规格' });
        committed = tx;
        return existing;
      }
    }
    const period = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const usageKey = createHash('sha256').update(stableStringify([getCreateTenantId(user), user.userId, period])).digest('hex');
    const [usage] = await tx.select().from(exportDailyUsage).where(eq(exportDailyUsage.key, usageKey)).limit(1);
    const dailyCount = usage?.jobCount ?? 0;
    if (dailyCount >= policy.dailyJobsPerUser) throw new HTTPException(429, { message: '今日导出任务额度已用尽' });
    await tx.insert(exportDailyUsage).values({ key: usageKey, period, jobCount: 1 }).onConflictDoUpdate({ target: exportDailyUsage.key, set: { jobCount: sql`${exportDailyUsage.jobCount} + 1`, updatedAt: new Date() } });
    const [job] = await tx.insert(exportJobs).values({
      entity: definition.entity, moduleName: definition.moduleName, format, status: 'pending', executionMode,
      query, columns: selectedColumns, scope, rowIds, splitRows: input.splitRows ?? 0, requestKey: input.idempotencyKey, rowCount, filename, raw, masked: !raw, sensitive,
      watermark: input.watermark ?? true, expiresAt: null, tenantId: getCreateTenantId(user),
    }).returning();
    let taskId: number | null = null;
    if (executionMode === 'async') {
      const task = await persistAsyncTask(tx, { taskType: EXPORT_TASK_TYPE, title: `${definition.moduleName} · ${format.toUpperCase()} 导出`, payload: { jobId: job.id }, idempotencyKey: `export:${job.id}`, tenantId: job.tenantId });
      taskId = task.id;
    }
    const [result] = await tx.update(exportJobs).set({ filename: buildFilename(definition, job.id, format), taskId }).where(eq(exportJobs.id, job.id)).returning();
    committed = tx;
    return result;
  }));
  await flushTransactionEffects(committed!);
  if (renamed.status === 'success') return { mode: renamed.executionMode, job: mapExportJob(renamed) };
  if (executionMode === 'sync') return { mode: executionMode, job: mapExportJob(await executeExportJob(renamed, definition)) };
  // Commit hints are best effort; the task center rescans durable pending tasks.
  return { mode: executionMode, job: mapExportJob(renamed) };
}

export async function runExportJob(jobId: number) {
  const job = requireRow(await db.query.exportJobs.findFirst({ where: eq(exportJobs.id, jobId) }), '导出任务不存在');
  if (job.taskId) return runAsyncTask(job.taskId);
}

export function registerExportJobWorker() {
  registerTaskHandler({
    taskType: EXPORT_TASK_TYPE, title: '数据导出', module: '导出中心', allowConcurrent: false, maxAttempts: 3, retryDelayMs: 5000, retentionDays: 180,
    settleInTransaction: settleExportTask, run: runExportTask,
  });
}

export async function settleExportTask(tx: DbTransaction, task: typeof asyncTasks.$inferSelect) {
  const [job] = await tx.select().from(exportJobs).where(eq(exportJobs.taskId, task.id)).for('update').limit(1);
  if (!job || job.status === 'expired') return;
  if (task.status === 'success') {
    if (job.status === 'success') return;
    const result = task.result;
    if (!result || typeof result.fileId !== 'string') throw new Error('导出任务缺少有效产物');
    await retainManagedFiles(tx, [result.fileId]);
    await tx.update(exportJobs).set({ status: 'success', stage: 'completed', cancelRequested: false, fileId: result.fileId, filename: String(result.filename), fileSize: Number(result.fileSize), sha256: String(result.sha256), manifest: result.manifest && typeof result.manifest === 'object' ? result.manifest as Record<string, unknown> : null, rowCount: Number(result.rowCount), processedRows: Number(result.rowCount), totalRows: Number(result.rowCount), completedAt: task.completedAt, expiresAt: calculateExpiresAt(getExportDefinition(job.entity), job.raw, job.sensitive) }).where(eq(exportJobs.id, job.id));
    rememberTransactionEffect(tx, `export-notify:${job.id}`, () => notifyExportFinished(job, '已完成', '，文件已生成'));
    return;
  }
  if (task.status === 'failed' || task.status === 'cancelled') {
    await tx.update(exportJobs).set({ status: task.status, stage: task.status, cancelRequested: task.cancelRequested, errorMessage: task.errorMessage, completedAt: task.completedAt }).where(eq(exportJobs.id, job.id));
    rememberTransactionEffect(tx, `export-notify:${job.id}`, () => notifyExportFinished(job, task.status === 'failed' ? '失败' : '已取消', task.errorMessage ?? ''));
    return;
  }
  if (task.status === 'pending' && job.fileId) {
    await releaseManagedFiles(tx, [job.fileId]);
    await tx.update(exportJobs).set({ fileId: null, filename: buildFilename(getExportDefinition(job.entity), job.id, job.format), fileSize: null, sha256: null, manifest: null, expiresAt: null, fileDeletedAt: null, deleteReason: null }).where(eq(exportJobs.id, job.id));
  }
  await tx.update(exportJobs).set({ status: task.status, stage: task.cancelRequested ? 'cancelling' : task.status === 'running' ? 'rendering' : 'pending', cancelRequested: task.cancelRequested, executionToken: task.dispatchToken, startedAt: task.startedAt, errorMessage: task.errorMessage, completedAt: null }).where(eq(exportJobs.id, job.id));
}

async function runExportTask(task: TaskRunContext): Promise<Record<string, unknown>> {
  const job = await db.query.exportJobs.findFirst({ where: eq(exportJobs.taskId, task.taskId) });
  if (!job) throw new TaskCancelledError('导出任务已删除');
  const definition = getExportDefinition(job.entity);
  let rendered: RenderedJobFile | undefined;
  try {
    rendered = await renderJobFile(job, definition, task);
    if (await task.isCancelRequested()) throw new TaskCancelledError('导出已取消');
    const hash = createHash('sha256');
    if (rendered.filePath) for await (const chunk of createReadStream(rendered.filePath)) hash.update(chunk);
    else hash.update(rendered.buffer!);
    await task.progress({ note: '正在上传导出文件' });
    await task.transaction(async tx => { await tx.update(exportJobs).set({ stage: 'uploading' }).where(runningAttempt(job)); });
    const file = await saveGeneratedManagedFile({ ...(rendered.filePath ? { filePath: rendered.filePath } : { buffer: rendered.buffer! }), filename: rendered.filename, mimeType: rendered.mimeType, tenantId: job.tenantId, createdBy: job.createdBy!, visibility: 'restricted' });
    if (await task.isCancelRequested()) throw new TaskCancelledError('上传完成前任务已取消，产物将自动回收');
    return { fileId: file.id, filename: file.originalName, fileSize: file.size, sha256: hash.digest('hex'), rowCount: rendered.rowCount ?? job.rowCount ?? 0, manifest: rendered.manifest ?? null };
  } catch (error) {
    if (error instanceof ExportCancelledError) throw new TaskCancelledError(error.message);
    if (error instanceof HTTPException && error.status < 500) throw new TaskNonRetryableError(error.message, { cause: error });
    throw error;
  } finally { await rendered?.cleanup?.(); }
}

async function visibleJobWhere(user: JwtPayload): Promise<SQL | undefined> {
  if (await canManageAllJobs(user)) return undefined;
  if (await canManageTenantJobs(user)) {
    return exactTenantCondition(exportJobs.tenantId, user.tenantId);
  }
  return eq(exportJobs.createdBy, user.userId);
}

export async function listExportJobs(query: QueryOutputOf<typeof exportJobContract.list>) {
  const user = currentUser();
  const visibleWhere = await visibleJobWhere(user);
  const { page, pageSize } = query;
  const where = buildWhere(
    visibleWhere,
    query.entity ? eq(exportJobs.entity, query.entity) : undefined,
    query.status ? eq(exportJobs.status, query.status) : undefined,
    query.format ? eq(exportJobs.format, query.format) : undefined,
    keywordCondition(query.keyword, [exportJobs.moduleName, exportJobs.filename, exportJobs.entity], 'ilike'),
    ...dateRangeConditions(exportJobs.createdAt, query.startTime, query.endTime),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(exportJobs, where),
    rows: () => db.query.exportJobs.findMany({
      where,
      with: { createdByUser: { columns: { nickname: true, username: true } } },
      orderBy: desc(exportJobs.createdAt),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    map: mapExportJob,
  });
}

export async function getExportJob(id: number) {
  const user = currentUser();
  const visibleWhere = await visibleJobWhere(user);
  const where = visibleWhere ? and(eq(exportJobs.id, id), visibleWhere) : eq(exportJobs.id, id);
  const row = await db.query.exportJobs.findFirst({
    where,
    with: { createdByUser: { columns: { nickname: true, username: true } } },
  });
  return mapExportJob(requireRow(row, '导出任务不存在'));
}

export async function getExportJobDownload(id: number, meta: { ip?: string | null; userAgent?: string | null }) {
  const user = currentUser();
  const job = requireRow(await db.query.exportJobs.findFirst({
    where: eq(exportJobs.id, id),
    with: { createdByUser: { columns: { nickname: true, username: true } } },
  }), '导出任务不存在');
  const visibleWhere = await visibleJobWhere(user);
  if (visibleWhere) {
    const [allowed] = await db.select({ id: exportJobs.id }).from(exportJobs).where(and(eq(exportJobs.id, id), visibleWhere)).limit(1);
    requireRow(allowed, '无权下载该导出文件', 403);
  }
  if (job.status !== 'success' || !job.fileId) throw new HTTPException(400, { message: '导出文件尚未生成' });
  if (job.fileDeletedAt || (job.expiresAt && job.expiresAt.getTime() < Date.now())) {
    throw new HTTPException(410, { message: '导出文件已过期，请重新导出' });
  }
  const definition = getExportDefinition(job.entity);
  await assertExportPermission(definition, job.raw, user);
  if (definition.prepareQuery) await definition.prepareQuery(job.query, user);
  const stored = await getRestrictedFileForRead(job.fileId);
  const readable = await readStoredFile(stored.file, stored.storageConfig);
  await db.insert(exportJobDownloads).values({
    jobId: job.id,
    downloadedBy: user.userId,
    tenantId: job.tenantId ?? user.tenantId ?? null,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 512) ?? null,
  });
  await db.update(exportJobs).set({
    downloadCount: sql`${exportJobs.downloadCount} + 1`,
    lastDownloadedAt: new Date(),
  }).where(eq(exportJobs.id, job.id));
  return {
    stream: readable.stream,
    contentType: readable.contentType,
    filename: job.filename ?? readable.fileName ?? stored.file.originalName,
    size: stored.file.size,
  };
}

export async function listExportJobDownloads(jobId: number) {
  await getExportJob(jobId);
  const rows = await db.query.exportJobDownloads.findMany({
    where: eq(exportJobDownloads.jobId, jobId),
    with: { user: { columns: { nickname: true, username: true } } },
    orderBy: desc(exportJobDownloads.createdAt),
    limit: 200,
  });
  return rows.map(mapExportJobDownload);
}

export async function cancelExportJob(id: number) {
  const job = await getExportJob(id);
  if (job.taskId) { await requestCancelAsyncTask(job.taskId); return getExportJob(id); }
  const [updated] = await db.update(exportJobs).set({ status: 'cancelled', stage: 'cancelled', cancelRequested: true, completedAt: new Date() }).where(buildWhere(eq(exportJobs.id, id), exactTenantCondition(exportJobs.tenantId, job.tenantId ?? null), inArray(exportJobs.status, ['pending', 'running']))).returning();
  return mapExportJob(requireRow(updated, '可取消的导出任务不存在'));
}

export async function retryExportJob(id: number) {
  const job = await getExportJob(id);
  if (job.status !== 'failed') throw new HTTPException(400, { message: '仅失败任务可重试' });
  if (!job.taskId) throw new HTTPException(400, { message: '请使用重新导出创建新任务' });
  await restartAsyncTask(job.taskId);
  return getExportJob(id);
}

export async function deleteExportJob(id: number) {
  const user = currentUser();
  const visibleWhere = await visibleJobWhere(user);
  const where = visibleWhere ? and(eq(exportJobs.id, id), visibleWhere) : eq(exportJobs.id, id);
  const jobToDelete = await getExportJob(id);
  if (jobToDelete.taskId && ['pending', 'running'].includes(jobToDelete.status)) await requestCancelAsyncTask(jobToDelete.taskId);
  await db.transaction(async (tx) => {
    const [deleted] = await tx.delete(exportJobs).where(where).returning();
    const job = requireRow(deleted, '导出任务不存在');
    // Restricted export files have exactly one owning job; GC can reclaim them after deletion.
    if (job.fileId) await releaseManagedFiles(tx, [job.fileId]);
  });
}

export async function cleanupExpiredExportFiles() {
  const now = new Date();
  const usageCutoff = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now.getTime() - 90 * 86400000));
  await db.delete(exportDailyUsage).where(lt(exportDailyUsage.period, usageCutoff));
  const rows = await db.select().from(exportJobs)
    .where(and(lte(exportJobs.expiresAt, now), isNull(exportJobs.fileDeletedAt), eq(exportJobs.status, 'success')));
  let cleaned = 0;
  for (const job of rows) {
    if (!job.fileId) continue;
    try {
      await deleteExportJobFile(job.fileId);
      await db.update(exportJobs)
        .set({ status: 'expired', fileDeletedAt: new Date(), deleteReason: 'expired' })
        .where(eq(exportJobs.id, job.id));
      cleaned++;
    } catch (err) {
      logger.warn('[export-jobs] cleanup failed', { jobId: job.id, err });
    }
  }
  return cleaned;
}

/** 删除导出任务关联的托管文件与物理文件 */
async function deleteExportJobFile(fileId: string): Promise<void> {
  const [file] = await db.select().from(managedFiles).where(eq(managedFiles.id, fileId)).limit(1);
  if (!file) return;
  await db.update(managedFiles).set({ refCount: 0, gcState: 'deleting', orphanedAt: new Date() }).where(eq(managedFiles.id, fileId));
  await deleteGeneratedManagedFile(fileId, file.tenantId);
}

/**
 * 清理超过保留期的导出任务记录（数据保留策略 export_jobs 的 custom 实现）。
 * 文件通常已由 `cleanupExpiredExportFiles` 按 expires_at 提前回收；此处兜底删除
 * 仍挂着文件的超期行（如未设置过期时间的任务），随后删行并级联下载记录。
 */
export async function purgeExpiredExportJobRecords(retentionDays: number, batchSize = 5000): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const victims = await db.select({ id: exportJobs.id, fileId: exportJobs.fileId, fileDeletedAt: exportJobs.fileDeletedAt })
    .from(exportJobs).where(lt(exportJobs.createdAt, cutoff));
  for (const job of victims) {
    if (!job.fileId || job.fileDeletedAt) continue;
    try {
      await deleteExportJobFile(job.fileId);
    } catch (err) {
      logger.warn('[export-jobs] purge file failed', { jobId: job.id, err });
    }
  }
  let total = 0;
  for (let start = 0; start < victims.length; start += batchSize) {
    const ids = victims.slice(start, start + batchSize).map((job) => job.id);
    const rows = await db.delete(exportJobs).where(inArray(exportJobs.id, ids)).returning({ id: exportJobs.id });
    total += rows.length;
  }
  return total;
}
