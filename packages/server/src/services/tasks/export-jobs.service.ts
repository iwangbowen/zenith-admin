import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { and, desc, eq, inArray, isNull, lt, lte, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { QueryOutputOf } from '@zenith/shared/core';
import { exportJobContract } from '@zenith/shared/tasks';
import { db } from '../../db';
import { exportJobDownloads, exportJobs, fileStorageConfigs, managedFiles, users } from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime, formatFileTimestamp, formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { currentUser, runWithCurrentUser } from '../../lib/context';
import { getUserPermissions, isSuperAdmin } from '../../lib/permissions';
import { exactTenantCondition, getCreateTenantId } from '../../lib/tenant';
import { getStoredFileForRead, saveGeneratedManagedFile } from '../files/files.service';
import { deleteStoredFile, readStoredFile } from '../../lib/file-storage';
import { getExportDefinition, listExportDefinitions } from '../../lib/export-center/registry';
import { leafColumns, renderExportCsv, renderExportWorkbook } from '../../lib/export-center/writer';
import type { AnyExportDefinition, ExportExecutionMode, ExportFormat, ExportRequestMode, ExportRuntimeContext } from '../../lib/export-center/types';
import { DEFAULT_EXPORT_EXECUTION, DEFAULT_EXPORT_RETENTION } from '../../lib/export-center/types';
import { registerSystemQueueWorker, sendSystemJob } from '../../lib/pg-boss-scheduler';
import { runAsUser } from '../../lib/audit-context';
import { getExportMaskRuleMap } from '../platform/data-mask.service';
import { notify } from '../messaging/notification-outbox.service';
import logger from '../../lib/logger';
import type { JwtPayload } from '../../middleware/auth';

export const EXPORT_JOB_QUEUE = 'export-jobs';

export interface CreateExportJobInput {
  entity: string;
  format: ExportFormat;
  query?: Record<string, unknown>;
  columns?: string[];
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
  if (raw && definition.permissions.requireExportRawPermission && !await hasPermission(user, definition.permissions.exportRaw)) {
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

function resolveExecutionMode(
  requested: ExportRequestMode | undefined,
  rowCount: number,
  sensitive: boolean,
  raw: boolean,
  definition: AnyExportDefinition,
): ExportExecutionMode {
  const policy = normalizeExecution(definition);
  const mode = requested ?? policy.mode;
  if (mode === 'sync' && policy.syncModeOverridesAsyncPolicies) return 'sync';
  if (policy.forceAsyncWhenRaw && raw) return 'async';
  if (policy.forceAsyncWhenSensitive && sensitive) return 'async';
  if (mode === 'sync') return 'sync';
  if (mode === 'async') return 'async';
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
    query: row.query ?? {},
    columns: row.columns ?? null,
    rowCount: row.rowCount ?? null,
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

function userFromJob(row: typeof exportJobs.$inferSelect): JwtPayload {
  if (!row.createdBy) throw new HTTPException(400, { message: '导出任务缺少创建人' });
  return {
    userId: row.createdBy,
    username: `user:${row.createdBy}`,
    roles: [],
    tenantId: row.tenantId ?? null,
  };
}

async function getCreatorPayload(row: typeof exportJobs.$inferSelect): Promise<JwtPayload> {
  if (!row.createdBy) return userFromJob(row);
  const user = await db.query.users.findFirst({
    where: eq(users.id, row.createdBy),
    columns: { id: true, username: true, tenantId: true },
    with: { userRoles: { columns: {}, with: { role: { columns: { code: true } } } } },
  });
  if (!user) return userFromJob(row);
  return {
    userId: user.id,
    username: user.username,
    roles: user.userRoles.map((item) => item.role.code),
    tenantId: user.tenantId,
  };
}

async function renderJobFile(row: typeof exportJobs.$inferSelect, definition: AnyExportDefinition): Promise<{ buffer: Buffer; mimeType: string; filename: string; rowCount?: number | null }> {
  const creator = await getCreatorPayload(row);
  const filename = row.filename ?? buildFilename(definition, row.id, row.format);
  // 脱敏导出：预加载数据脱敏中心规则，敏感列渲染时统一打码
  const maskRules = row.masked ? await getExportMaskRuleMap() : null;
  const ctx: ExportRuntimeContext = {
    jobId: row.id,
    entity: row.entity,
    moduleName: row.moduleName,
    format: row.format,
    query: row.query as Record<string, unknown>,
    selectedColumns: row.columns ?? null,
    raw: row.raw,
    masked: row.masked,
    sensitive: row.sensitive,
    watermark: row.watermark,
    currentUser: creator,
    createdByName: null,
    exportedAt: new Date(),
    maskRules,
    rowLimit: normalizeExecution(definition).maxRows,
  };
  return runWithCurrentUser(creator, async () => {
    if (definition.renderFile) {
      const rendered = await definition.renderFile(ctx);
      return {
        buffer: rendered.buffer,
        mimeType: rendered.mimeType,
        filename: rendered.filename ?? filename,
        rowCount: rendered.rowCount,
      };
    }
    const rows = await definition.streamRows(row.query as Record<string, unknown>, creator, ctx);
    if (row.format === 'csv') {
      return { buffer: await renderExportCsv(definition, rows, ctx), mimeType: 'text/csv; charset=utf-8', filename };
    }
    return {
      buffer: await renderExportWorkbook(definition, rows, ctx),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename,
    };
  });
}

async function executeExportJob(row: typeof exportJobs.$inferSelect, definition: AnyExportDefinition) {
  const startedAt = new Date();
  await db.update(exportJobs).set({ status: 'running', startedAt, errorMessage: null }).where(eq(exportJobs.id, row.id));
  try {
    const rendered = await renderJobFile(row, definition);
    if (!row.createdBy) throw new HTTPException(400, { message: '导出任务缺少创建人' });
    const savedFile = await saveGeneratedManagedFile({
      buffer: rendered.buffer,
      filename: rendered.filename,
      mimeType: rendered.mimeType,
      tenantId: row.tenantId ?? null,
      createdBy: row.createdBy,
    });
    const completedAt = new Date();
    const [updated] = await db.update(exportJobs)
      .set({
        status: 'success',
        fileId: savedFile.id,
        filename: rendered.filename,
        fileSize: savedFile.size,
        completedAt,
        expiresAt: row.expiresAt ?? calculateExpiresAt(definition, row.raw, row.sensitive),
        // 渲染阶段回读到的真实写入行数（legacy 导出的 countRows 恒为 0，此处回写修正「进度」列）
        ...(rendered.rowCount !== undefined ? { rowCount: rendered.rowCount } : {}),
      })
      .where(eq(exportJobs.id, row.id))
      .returning();
    await notifyExportFinished(row, '已完成', `，文件「${rendered.filename}」已生成`);
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : '导出失败';
    await db.update(exportJobs)
      .set({ status: 'failed', errorMessage: message, completedAt: new Date() })
      .where(eq(exportJobs.id, row.id));
    await notifyExportFinished(row, '失败', `：${message.slice(0, 120)}`);
    throw err;
  }
}

/** 导出结果通知创建人：异步任务里用户看不到请求响应，完成/失败必须主动触达（同步导出当场拿到文件，不发）。 */
async function notifyExportFinished(row: typeof exportJobs.$inferSelect, resultText: string, detail: string): Promise<void> {
  if (!row.createdBy || row.executionMode === 'sync') return;
  try {
    await notify('platform.export.finished', {
      recipients: [{ type: 'user', id: row.createdBy }],
      vars: { jobId: row.id, moduleName: row.moduleName, resultText, detail },
      tenantId: row.tenantId ?? null,
      link: '/system/export-jobs',
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
  const user = currentUser();
  const definition = getExportDefinition(input.entity);
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
  const selectedColumns = input.columns?.length ? [...new Set(input.columns)] : null;
  const sensitive = definitionHasSensitiveColumns(definition, selectedColumns);
  const rowCount = await definition.countRows((input.query ?? {}) as Record<string, unknown>, user);
  // 行数绝对上限（sync/async 通用）：exceljs 终局序列化与 CSV 全量累积都是主线程
  // 连续 CPU/内存段，提交时快速失败;countRows 不准的定义由 writer 渲染兜底再拦一道
  const { maxRows } = normalizeExecution(definition);
  if (maxRows > 0 && rowCount > maxRows) {
    throw new HTTPException(400, { message: `导出数据 ${rowCount} 行，超过上限 ${maxRows} 行，请收窄筛选条件或分批导出` });
  }
  const executionMode = resolveExecutionMode(input.executionMode, rowCount, sensitive, raw, definition);
  const filename = buildFilename(definition, 0, format);
  const [job] = await runAsUser(user.userId, () =>
    db.insert(exportJobs).values({
      entity: definition.entity,
      moduleName: definition.moduleName,
      format,
      status: executionMode === 'sync' ? 'running' : 'pending',
      executionMode,
      query: input.query ?? {},
      columns: selectedColumns,
      rowCount,
      filename,
      raw,
      masked: !raw,
      sensitive,
      watermark: input.watermark ?? true,
      expiresAt: calculateExpiresAt(definition, raw, sensitive),
      tenantId: getCreateTenantId(user),
    }).returning(),
  );
  const realFilename = buildFilename(definition, job.id, format);
  const [renamed] = await db.update(exportJobs).set({ filename: realFilename }).where(eq(exportJobs.id, job.id)).returning();
  if (executionMode === 'sync') {
    const updated = await executeExportJob(renamed, definition);
    return { mode: executionMode, job: mapExportJob(updated) };
  }
  await enqueueExportJob(job.id);
  return { mode: executionMode, job: mapExportJob(renamed) };
}

async function enqueueExportJob(jobId: number) {
  await sendSystemJob(EXPORT_JOB_QUEUE, { jobId }, { retryLimit: 1 });
}

export async function runExportJob(jobId: number) {
  const [job] = await db.select().from(exportJobs).where(eq(exportJobs.id, jobId)).limit(1);
  requireRow(job, '导出任务不存在');
  if (job.status !== 'pending' && job.status !== 'running') return;
  const definition = getExportDefinition(job.entity);
  await executeExportJob(job, definition);
}

export async function registerExportJobWorker() {
  await registerSystemQueueWorker<{ jobId: number }>({
    name: EXPORT_JOB_QUEUE,
    title: '导出任务执行 Worker',
    module: '导出中心',
    description: '消费异步导出任务队列，生成 Excel/CSV 文件并更新导出中心任务状态。',
    handler: async ({ jobId }) => {
      await runExportJob(jobId);
      return `导出任务 ${jobId} 执行完成`;
    },
    queueOptions: { retentionSeconds: 60 * 60 * 24 * 7 },
  });
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
  const stored = await getStoredFileForRead(job.fileId);
  const readable = await readStoredFile(stored.file, stored.storageConfig);
  await db.insert(exportJobDownloads).values({
    jobId: job.id,
    downloadedBy: user.userId,
    tenantId: job.tenantId ?? user.tenantId ?? null,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 512) ?? null,
  });
  await db.update(exportJobs).set({
    downloadCount: job.downloadCount + 1,
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
  const user = currentUser();
  const visibleWhere = await visibleJobWhere(user);
  const where = visibleWhere ? and(eq(exportJobs.id, id), visibleWhere, inArray(exportJobs.status, ['pending', 'running'])) : and(eq(exportJobs.id, id), inArray(exportJobs.status, ['pending', 'running']));
  const [job] = await db.update(exportJobs).set({ status: 'cancelled', completedAt: new Date() }).where(where).returning();
  return mapExportJob(requireRow(job, '可取消的导出任务不存在'));
}

export async function retryExportJob(id: number) {
  const user = currentUser();
  const visibleWhere = await visibleJobWhere(user);
  const where = visibleWhere ? and(eq(exportJobs.id, id), visibleWhere, eq(exportJobs.status, 'failed')) : and(eq(exportJobs.id, id), eq(exportJobs.status, 'failed'));
  const [job] = await db.update(exportJobs)
    .set({ status: 'pending', errorMessage: null, startedAt: null, completedAt: null })
    .where(where)
    .returning();
  requireRow(job, '可重试的导出任务不存在');
  await enqueueExportJob(job.id);
  return mapExportJob(job);
}

export async function deleteExportJob(id: number) {
  const user = currentUser();
  const visibleWhere = await visibleJobWhere(user);
  const where = visibleWhere ? and(eq(exportJobs.id, id), visibleWhere) : eq(exportJobs.id, id);
  const [job] = await db.delete(exportJobs).where(where).returning();
  requireRow(job, '导出任务不存在');
}

export async function cleanupExpiredExportFiles() {
  const now = new Date();
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
  const [storageConfig] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, file.storageConfigId)).limit(1);
  if (storageConfig) await deleteStoredFile(file, storageConfig);
  await db.delete(managedFiles).where(eq(managedFiles.id, fileId));
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
