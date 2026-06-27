import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { exportJobDownloads, exportJobs, fileStorageConfigs, managedFiles, users } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { escapeLike } from '../lib/where-helpers';
import { formatDateTime, formatFileTimestamp, formatNullableDateTime, parseDateTimeInput } from '../lib/datetime';
import { currentUser, runWithCurrentUser } from '../lib/context';
import { getUserPermissions, isSuperAdmin } from '../lib/permissions';
import { getCreateTenantId, tenantCondition } from '../lib/tenant';
import { getStoredFileForRead, saveGeneratedManagedFile } from './files.service';
import { deleteStoredFile, readStoredFile } from '../lib/file-storage';
import { getExportDefinition, listExportDefinitions } from '../lib/export-center/registry';
import { leafColumns, renderExportCsv, renderExportWorkbook } from '../lib/export-center/writer';
import type { AnyExportDefinition, ExportExecutionMode, ExportFormat, ExportRequestMode, ExportRuntimeContext } from '../lib/export-center/types';
import { DEFAULT_EXPORT_EXECUTION, DEFAULT_EXPORT_RETENTION } from '../lib/export-center/types';
import { registerSystemQueueWorker, sendSystemJob } from '../lib/pg-boss-scheduler';
import { runAsUser } from '../lib/audit-context';
import logger from '../lib/logger';
import type { JwtPayload } from '../middleware/auth';

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

export interface ListExportJobsQuery {
  page?: number;
  pageSize?: number;
  entity?: string;
  status?: 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'expired';
  format?: ExportFormat;
  keyword?: string;
  startTime?: string;
  endTime?: string;
}

function normalizeExecution(definition: AnyExportDefinition) {
  return { ...DEFAULT_EXPORT_EXECUTION, ...definition.execution };
}

function normalizeRetention(definition: AnyExportDefinition) {
  return { ...DEFAULT_EXPORT_RETENTION, ...definition.retention };
}

async function hasPermission(user: JwtPayload, permission?: string): Promise<boolean> {
  if (!permission) return false;
  if (isSuperAdmin(user.roles)) return true;
  const permissions = await getUserPermissions(user.userId);
  return permissions.includes(permission);
}

async function assertExportPermission(definition: AnyExportDefinition, raw: boolean, user: JwtPayload) {
  if (!await hasPermission(user, definition.permissions.export)) {
    throw new HTTPException(403, { message: '无导出权限' });
  }
  if (raw && definition.permissions.requireExportRawPermission && !await hasPermission(user, definition.permissions.exportRaw)) {
    throw new HTTPException(403, { message: '无明文导出权限' });
  }
}

async function canManageAllJobs(user: JwtPayload): Promise<boolean> {
  return isSuperAdmin(user.roles) || await hasPermission(user, 'system:export-job:manage');
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
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
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

async function renderJobFile(row: typeof exportJobs.$inferSelect, definition: AnyExportDefinition): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const creator = await getCreatorPayload(row);
  const filename = row.filename ?? buildFilename(definition, row.id, row.format);
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
  };
  return runWithCurrentUser(creator, async () => {
    if (definition.renderFile) {
      const rendered = await definition.renderFile(ctx);
      return {
        buffer: rendered.buffer,
        mimeType: rendered.mimeType,
        filename: rendered.filename ?? filename,
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
      })
      .where(eq(exportJobs.id, row.id))
      .returning();
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : '导出失败';
    await db.update(exportJobs)
      .set({ status: 'failed', errorMessage: message, completedAt: new Date() })
      .where(eq(exportJobs.id, row.id));
    throw err;
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
  const raw = input.raw ?? true;
  await assertExportPermission(definition, raw, user);
  const selectedColumns = input.columns?.length ? [...new Set(input.columns)] : null;
  const sensitive = definitionHasSensitiveColumns(definition, selectedColumns);
  const rowCount = await definition.countRows((input.query ?? {}) as Record<string, unknown>, user);
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
  if (!job) throw new HTTPException(404, { message: '导出任务不存在' });
  if (job.status !== 'pending' && job.status !== 'running') return;
  const definition = getExportDefinition(job.entity);
  await executeExportJob(job, definition);
}

export async function registerExportJobWorker() {
  await registerSystemQueueWorker<{ jobId: number }>(
    EXPORT_JOB_QUEUE,
    async ({ jobId }) => {
      await runExportJob(jobId);
    },
    { retentionSeconds: 60 * 60 * 24 * 7 },
  );
}

async function visibleJobWhere(user: JwtPayload): Promise<SQL | undefined> {
  if (await canManageAllJobs(user)) return undefined;
  if (await canManageTenantJobs(user)) {
    return user.tenantId == null ? isNull(exportJobs.tenantId) : eq(exportJobs.tenantId, user.tenantId);
  }
  return eq(exportJobs.createdBy, user.userId);
}

export async function listExportJobs(query: ListExportJobsQuery) {
  const user = currentUser();
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 10);
  const conditions: SQL[] = [];
  const visibleWhere = await visibleJobWhere(user);
  if (visibleWhere) conditions.push(visibleWhere);
  if (query.entity) conditions.push(eq(exportJobs.entity, query.entity));
  if (query.status) conditions.push(eq(exportJobs.status, query.status));
  if (query.format) conditions.push(eq(exportJobs.format, query.format));
  if (query.keyword) {
    const kw = `%${escapeLike(query.keyword)}%`;
    conditions.push(or(ilike(exportJobs.moduleName, kw), ilike(exportJobs.filename, kw), ilike(exportJobs.entity, kw))!);
  }
  const startTime = parseDateTimeInput(query.startTime);
  const endTime = parseDateTimeInput(query.endTime);
  if (startTime) conditions.push(gte(exportJobs.createdAt, startTime));
  if (endTime) conditions.push(lte(exportJobs.createdAt, endTime));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(exportJobs, where),
    db.query.exportJobs.findMany({
      where,
      with: { createdByUser: { columns: { nickname: true, username: true } } },
      orderBy: desc(exportJobs.createdAt),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  return { list: rows.map(mapExportJob), total, page, pageSize };
}

export async function getExportJob(id: number) {
  const user = currentUser();
  const visibleWhere = await visibleJobWhere(user);
  const where = visibleWhere ? and(eq(exportJobs.id, id), visibleWhere) : eq(exportJobs.id, id);
  const row = await db.query.exportJobs.findFirst({
    where,
    with: { createdByUser: { columns: { nickname: true, username: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '导出任务不存在' });
  return mapExportJob(row);
}

export async function getExportJobDownload(id: number, meta: { ip?: string | null; userAgent?: string | null }) {
  const user = currentUser();
  const job = await db.query.exportJobs.findFirst({
    where: eq(exportJobs.id, id),
    with: { createdByUser: { columns: { nickname: true, username: true } } },
  });
  if (!job) throw new HTTPException(404, { message: '导出任务不存在' });
  const visibleWhere = await visibleJobWhere(user);
  if (visibleWhere) {
    const [allowed] = await db.select({ id: exportJobs.id }).from(exportJobs).where(and(eq(exportJobs.id, id), visibleWhere)).limit(1);
    if (!allowed) throw new HTTPException(403, { message: '无权下载该导出文件' });
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
  if (!job) throw new HTTPException(404, { message: '可取消的导出任务不存在' });
  return mapExportJob(job);
}

export async function retryExportJob(id: number) {
  const user = currentUser();
  const visibleWhere = await visibleJobWhere(user);
  const where = visibleWhere ? and(eq(exportJobs.id, id), visibleWhere, eq(exportJobs.status, 'failed')) : and(eq(exportJobs.id, id), eq(exportJobs.status, 'failed'));
  const [job] = await db.update(exportJobs)
    .set({ status: 'pending', errorMessage: null, startedAt: null, completedAt: null })
    .where(where)
    .returning();
  if (!job) throw new HTTPException(404, { message: '可重试的导出任务不存在' });
  await enqueueExportJob(job.id);
  return mapExportJob(job);
}

export async function deleteExportJob(id: number) {
  const user = currentUser();
  const visibleWhere = await visibleJobWhere(user);
  const where = visibleWhere ? and(eq(exportJobs.id, id), visibleWhere) : eq(exportJobs.id, id);
  const [job] = await db.delete(exportJobs).where(where).returning();
  if (!job) throw new HTTPException(404, { message: '导出任务不存在' });
}

export async function cleanupExpiredExportFiles() {
  const now = new Date();
  const rows = await db.select().from(exportJobs)
    .where(and(lte(exportJobs.expiresAt, now), isNull(exportJobs.fileDeletedAt), eq(exportJobs.status, 'success')));
  let cleaned = 0;
  for (const job of rows) {
    if (!job.fileId) continue;
    try {
      const [file] = await db.select().from(managedFiles).where(eq(managedFiles.id, job.fileId)).limit(1);
      if (file) {
        const [storageConfig] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, file.storageConfigId)).limit(1);
        if (storageConfig) await deleteStoredFile(file, storageConfig);
        await db.delete(managedFiles).where(eq(managedFiles.id, job.fileId));
      }
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
