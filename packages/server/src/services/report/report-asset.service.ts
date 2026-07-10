import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  createReportDashboardSchema,
  createReportDatasetSchema,
  createReportPrintTemplateSchema,
  reportGridItemSchema,
  reportWidgetSchema,
} from '@zenith/shared';
import type {
  ApplyReportAssetTemplateInput,
  CreateReportAssetTemplateInput,
  CreateReportDeprecationNoticeInput,
  ReportAssetCatalogItem,
  ReportAssetTemplate,
  ReportAssetTemplateType,
  ReportAssetUsageLog,
  ReportAssetUsageSummary,
  ReportDeprecationNotice,
  ReportResourceType,
  UpdateReportAssetTemplateInput,
  UpdateReportDeprecationNoticeInput,
} from '@zenith/shared';
import { db } from '../../db';
import {
  managedFiles,
  reportAssetTemplates,
  reportAssetUsageLogs,
  reportDashboards,
  reportDatasets,
  reportDatasources,
  reportDeprecationNotices,
  reportFillTemplates,
  reportFolders,
  reportMetrics,
  reportPrintTemplates,
  users,
} from '../../db/schema';
import { currentUserId } from '../../lib/context';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import {
  formatDateTime,
  formatNullableDateTime,
  parseDateRangeEnd,
  parseDateRangeStart,
  parseDateTimeInput,
} from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import { createDashboard, getDashboard, updateDashboardDraft } from './report-dashboard.service';
import { createDataset } from './report-dataset.service';
import { createPrintTemplate } from './report-print.service';
import { reportCreateTenantId, reportScopedWhere, reportTenantScope } from './report-access';
import {
  ensureReportResourceAccess,
  listAccessibleReportResourceIds,
} from './report-resource-acl.service';
import { reportTimeBucketExpression } from './report-time-bucket';
import {
  defaultReportOwnerId,
  validateReportResourcePlacement,
} from './report-resource.service';
import { recordReportAssetUsage } from './report-asset-usage.service';

type AssetTemplateRow = typeof reportAssetTemplates.$inferSelect;
type DeprecationRow = typeof reportDeprecationNotices.$inferSelect;
type UsageRow = typeof reportAssetUsageLogs.$inferSelect;

interface CatalogBasicRow {
  resourceType: ReportResourceType;
  resourceId: number;
  tenantId: number | null;
  name: string;
  ownerId: number | null;
  folderId: number | null;
  lifecycleStatus: string | null;
  status: string | null;
  updatedAt: Date;
}

interface CatalogRowsResult {
  rows: CatalogBasicRow[];
  total: number;
}

const REPORT_ASSET_RESOURCE_TYPES: ReportResourceType[] = [
  'datasource',
  'dataset',
  'dashboard',
  'metric',
  'print_template',
  'fill_template',
  'asset_template',
];

async function resourceAclCondition(
  resourceTypeColumn: AnyPgColumn,
  resourceIdColumn: AnyPgColumn,
): Promise<SQL> {
  const access = await Promise.all(REPORT_ASSET_RESOURCE_TYPES.map(async (resourceType) => ({
    resourceType,
    ids: await listAccessibleReportResourceIds(resourceType),
  })));
  const conditions = access.flatMap(({ resourceType, ids }) => {
    if (ids?.length === 0) return [];
    return [ids
      ? and(eq(resourceTypeColumn, resourceType), inArray(resourceIdColumn, ids))!
      : eq(resourceTypeColumn, resourceType)];
  });
  return or(...conditions) ?? sql`false`;
}

export function mapReportAssetTemplate(
  row: AssetTemplateRow,
  ownerName?: string | null,
  folderName?: string | null,
): ReportAssetTemplate {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    folderId: row.folderId ?? null,
    folderName: folderName ?? null,
    ownerId: row.ownerId ?? null,
    ownerName: ownerName ?? null,
    code: row.code,
    name: row.name,
    type: row.type,
    description: row.description ?? null,
    content: row.content,
    previewFileId: row.previewFileId ?? null,
    version: row.version,
    usageCount: row.usageCount,
    status: row.status,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapReportDeprecationNotice(row: DeprecationRow): ReportDeprecationNotice {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    title: row.title,
    message: row.message,
    replacementResourceType: row.replacementResourceType ?? null,
    replacementResourceId: row.replacementResourceId ?? null,
    effectiveAt: formatDateTime(row.effectiveAt),
    expiresAt: formatNullableDateTime(row.expiresAt),
    publishedAt: formatNullableDateTime(row.publishedAt),
    publishedBy: row.publishedBy ?? null,
    processedAt: formatNullableDateTime(row.processedAt),
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapReportAssetUsageLog(row: UsageRow): ReportAssetUsageLog {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    userId: row.userId ?? null,
    action: row.action,
    scene: row.scene ?? null,
    durationMs: row.durationMs ?? null,
    rowCount: row.rowCount,
    byteSize: row.byteSize,
    success: row.success,
    occurredAt: formatDateTime(row.occurredAt),
  };
}

async function catalogRowsForType(
  resourceType: ReportResourceType,
  query: {
    keyword?: string;
    ownerId?: number;
    folderId?: number;
    lifecycle?: string;
    status?: string;
    updatedStart?: Date;
    updatedEnd?: Date;
  },
  limit: number,
): Promise<CatalogRowsResult> {
  const accessibleIds = await listAccessibleReportResourceIds(resourceType);
  if (accessibleIds && accessibleIds.length === 0) return { rows: [], total: 0 };
  const keyword = query.keyword ? `%${escapeLike(query.keyword)}%` : null;
  const common = (columns: {
    id: AnyPgColumn;
    ownerId: AnyPgColumn;
    folderId: AnyPgColumn;
    name: AnyPgColumn;
    updatedAt: AnyPgColumn;
  }, scope: SQL | undefined) => {
    const conds = [];
    if (scope) conds.push(scope);
    if (accessibleIds) conds.push(inArray(columns.id, accessibleIds));
    if (keyword) conds.push(ilike(columns.name, keyword));
    if (query.ownerId) conds.push(eq(columns.ownerId, query.ownerId));
    if (query.folderId) conds.push(eq(columns.folderId, query.folderId));
    if (query.updatedStart) conds.push(gte(columns.updatedAt, query.updatedStart));
    if (query.updatedEnd) conds.push(lte(columns.updatedAt, query.updatedEnd));
    return conds;
  };
  switch (resourceType) {
    case 'datasource': {
      const conds = common(reportDatasources, reportTenantScope(reportDatasources));
      if (query.status) conds.push(eq(reportDatasources.status, query.status === 'enabled' ? 'enabled' : 'disabled'));
      const where = conds.length ? and(...conds) : undefined;
      const [total, rows] = await Promise.all([
        db.$count(reportDatasources, where),
        db.select().from(reportDatasources).where(where).orderBy(desc(reportDatasources.updatedAt)).limit(limit),
      ]);
      return { total, rows: rows.map((row) => ({
        resourceType, resourceId: row.id, tenantId: row.tenantId, name: row.name, ownerId: row.ownerId,
        folderId: row.folderId, lifecycleStatus: null, status: row.status, updatedAt: row.updatedAt,
      })) };
    }
    case 'dataset': {
      const conds = common(reportDatasets, reportTenantScope(reportDatasets));
      if (query.status) conds.push(eq(reportDatasets.status, query.status === 'enabled' ? 'enabled' : 'disabled'));
      const where = conds.length ? and(...conds) : undefined;
      const [total, rows] = await Promise.all([
        db.$count(reportDatasets, where),
        db.select().from(reportDatasets).where(where).orderBy(desc(reportDatasets.updatedAt)).limit(limit),
      ]);
      return { total, rows: rows.map((row) => ({
        resourceType, resourceId: row.id, tenantId: row.tenantId, name: row.name, ownerId: row.ownerId,
        folderId: row.folderId, lifecycleStatus: null, status: row.status, updatedAt: row.updatedAt,
      })) };
    }
    case 'dashboard': {
      const conds = common(reportDashboards, reportTenantScope(reportDashboards));
      if (query.lifecycle && ['draft', 'published', 'offline'].includes(query.lifecycle)) {
        conds.push(eq(reportDashboards.lifecycleStatus, query.lifecycle as 'draft' | 'published' | 'offline'));
      }
      const where = conds.length ? and(...conds) : undefined;
      const [total, rows] = await Promise.all([
        db.$count(reportDashboards, where),
        db.select().from(reportDashboards).where(where).orderBy(desc(reportDashboards.updatedAt)).limit(limit),
      ]);
      return { total, rows: rows.map((row) => ({
        resourceType, resourceId: row.id, tenantId: row.tenantId, name: row.name, ownerId: row.ownerId,
        folderId: row.folderId, lifecycleStatus: row.lifecycleStatus, status: row.status, updatedAt: row.updatedAt,
      })) };
    }
    case 'metric': {
      const conds = common(reportMetrics, reportTenantScope(reportMetrics));
      if (query.lifecycle && ['draft', 'published', 'deprecated'].includes(query.lifecycle)) {
        conds.push(eq(reportMetrics.lifecycleStatus, query.lifecycle as 'draft' | 'published' | 'deprecated'));
      }
      const where = conds.length ? and(...conds) : undefined;
      const [total, rows] = await Promise.all([
        db.$count(reportMetrics, where),
        db.select().from(reportMetrics).where(where).orderBy(desc(reportMetrics.updatedAt)).limit(limit),
      ]);
      return { total, rows: rows.map((row) => ({
        resourceType, resourceId: row.id, tenantId: row.tenantId, name: row.name, ownerId: row.ownerId,
        folderId: row.folderId, lifecycleStatus: row.lifecycleStatus, status: null, updatedAt: row.updatedAt,
      })) };
    }
    case 'print_template': {
      const conds = common(reportPrintTemplates, reportTenantScope(reportPrintTemplates));
      if (query.status) conds.push(eq(reportPrintTemplates.status, query.status === 'enabled' ? 'enabled' : 'disabled'));
      const where = conds.length ? and(...conds) : undefined;
      const [total, rows] = await Promise.all([
        db.$count(reportPrintTemplates, where),
        db.select().from(reportPrintTemplates).where(where).orderBy(desc(reportPrintTemplates.updatedAt)).limit(limit),
      ]);
      return { total, rows: rows.map((row) => ({
        resourceType, resourceId: row.id, tenantId: row.tenantId, name: row.name, ownerId: row.ownerId,
        folderId: row.folderId, lifecycleStatus: null, status: row.status, updatedAt: row.updatedAt,
      })) };
    }
    case 'fill_template': {
      const conds = common(reportFillTemplates, reportTenantScope(reportFillTemplates));
      if (query.status && ['draft', 'published', 'disabled'].includes(query.status)) {
        conds.push(eq(reportFillTemplates.status, query.status as 'draft' | 'published' | 'disabled'));
      }
      const where = conds.length ? and(...conds) : undefined;
      const [total, rows] = await Promise.all([
        db.$count(reportFillTemplates, where),
        db.select().from(reportFillTemplates).where(where).orderBy(desc(reportFillTemplates.updatedAt)).limit(limit),
      ]);
      return { total, rows: rows.map((row) => ({
        resourceType, resourceId: row.id, tenantId: row.tenantId, name: row.name, ownerId: row.ownerId,
        folderId: row.folderId, lifecycleStatus: row.status, status: row.status, updatedAt: row.updatedAt,
      })) };
    }
    case 'asset_template': {
      const conds = common(reportAssetTemplates, reportTenantScope(reportAssetTemplates));
      if (query.status) conds.push(eq(reportAssetTemplates.status, query.status === 'enabled' ? 'enabled' : 'disabled'));
      const where = conds.length ? and(...conds) : undefined;
      const [total, rows] = await Promise.all([
        db.$count(reportAssetTemplates, where),
        db.select().from(reportAssetTemplates).where(where).orderBy(desc(reportAssetTemplates.updatedAt)).limit(limit),
      ]);
      return { total, rows: rows.map((row) => ({
        resourceType, resourceId: row.id, tenantId: row.tenantId, name: row.name, ownerId: row.ownerId,
        folderId: row.folderId, lifecycleStatus: null, status: row.status, updatedAt: row.updatedAt,
      })) };
    }
  }
}

export async function listReportAssetCatalog(query: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  types?: ReportResourceType[];
  ownerId?: number;
  folderId?: number;
  lifecycle?: string;
  status?: string;
  updatedStart?: string;
  updatedEnd?: string;
}) {
  const { page = 1, pageSize = 20 } = query;
  const updatedStart = parseDateRangeStart(query.updatedStart) ?? undefined;
  const updatedEnd = parseDateRangeEnd(query.updatedEnd) ?? undefined;
  if (updatedStart && updatedEnd && updatedStart > updatedEnd) {
    throw new HTTPException(400, { message: '更新时间范围无效' });
  }
  const types = query.types?.length
    ? [...new Set(query.types)]
    : REPORT_ASSET_RESOURCE_TYPES;
  const fetchLimit = pageOffset(page, pageSize) + pageSize;
  const groups = await Promise.all(types.map((type) => catalogRowsForType(type, {
    keyword: query.keyword,
    ownerId: query.ownerId,
    folderId: query.folderId,
    lifecycle: query.lifecycle,
    status: query.status,
    updatedStart,
    updatedEnd,
  }, fetchLimit)));
  const rows = groups.flatMap((group) => group.rows)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  const paged = rows.slice(pageOffset(page, pageSize), pageOffset(page, pageSize) + pageSize);
  const ownerIds = [...new Set(paged.flatMap((row) => row.ownerId ? [row.ownerId] : []))];
  const folderIds = [...new Set(paged.flatMap((row) => row.folderId ? [row.folderId] : []))];
  const [owners, folders, notices] = await Promise.all([
    ownerIds.length ? db.select({ id: users.id, username: users.username, nickname: users.nickname }).from(users).where(inArray(users.id, ownerIds)) : [],
    folderIds.length ? db.select({ id: reportFolders.id, name: reportFolders.name }).from(reportFolders).where(inArray(reportFolders.id, folderIds)) : [],
    paged.length ? db.select().from(reportDeprecationNotices).where(and(
      reportTenantScope(reportDeprecationNotices),
      or(...paged.map((row) => and(
        eq(reportDeprecationNotices.resourceType, row.resourceType),
        eq(reportDeprecationNotices.resourceId, row.resourceId),
      ))),
      isNotNull(reportDeprecationNotices.publishedAt),
      lte(reportDeprecationNotices.effectiveAt, new Date()),
      or(isNull(reportDeprecationNotices.expiresAt), gte(reportDeprecationNotices.expiresAt, new Date())),
    )) : [],
  ]);
  const ownerMap = new Map(owners.map((row) => [row.id, row.nickname || row.username]));
  const folderMap = new Map(folders.map((row) => [row.id, row.name]));
  const noticeMap = new Map(notices.map((row) => [`${row.resourceType}:${row.resourceId}`, row]));
  const list: ReportAssetCatalogItem[] = paged.map((row) => ({
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    tenantId: row.tenantId,
    name: row.name,
    ownerId: row.ownerId,
    ownerName: row.ownerId ? ownerMap.get(row.ownerId) ?? null : null,
    folderId: row.folderId,
    folderName: row.folderId ? folderMap.get(row.folderId) ?? null : null,
    lifecycleStatus: row.lifecycleStatus,
    status: row.status,
    deprecationEffectiveAt: formatNullableDateTime(noticeMap.get(`${row.resourceType}:${row.resourceId}`)?.effectiveAt),
    updatedAt: formatDateTime(row.updatedAt),
  }));
  return { list, total: groups.reduce((sum, group) => sum + group.total, 0), page, pageSize };
}

export async function getReportAssetUsageSummary(
  resourceType: ReportResourceType,
  resourceId: number,
  days = 30,
): Promise<ReportAssetUsageSummary> {
  await ensureReportResourceAccess(resourceType, resourceId, 'viewer');
  const startAt = dayjs().subtract(days, 'day').toDate();
  const scope = reportTenantScope(reportAssetUsageLogs);
  const where = and(
    eq(reportAssetUsageLogs.resourceType, resourceType),
    eq(reportAssetUsageLogs.resourceId, resourceId),
    gte(reportAssetUsageLogs.occurredAt, startAt),
    ...(scope ? [scope] : []),
  );
  const [usageRows, notice] = await Promise.all([
    db.select({
      views: sql<number>`sum(case when ${reportAssetUsageLogs.action} = 'view' then 1 else 0 end)::int`,
      queries: sql<number>`sum(case when ${reportAssetUsageLogs.action} = 'query' then 1 else 0 end)::int`,
      exports: sql<number>`sum(case when ${reportAssetUsageLogs.action} = 'export' then 1 else 0 end)::int`,
      uniqueUsers: sql<number>`count(distinct ${reportAssetUsageLogs.userId})::int`,
      lastUsedAt: sql<Date | null>`max(${reportAssetUsageLogs.occurredAt})`,
    }).from(reportAssetUsageLogs).where(where),
    db.query.reportDeprecationNotices.findFirst({
      where: reportScopedWhere(reportDeprecationNotices, and(
        eq(reportDeprecationNotices.resourceType, resourceType),
        eq(reportDeprecationNotices.resourceId, resourceId),
        isNotNull(reportDeprecationNotices.publishedAt),
      )!),
      orderBy: desc(reportDeprecationNotices.effectiveAt),
    }),
  ]);
  const usage = usageRows[0];
  return {
    resourceType,
    resourceId,
    views: Number(usage?.views ?? 0),
    queries: Number(usage?.queries ?? 0),
    exports: Number(usage?.exports ?? 0),
    uniqueUsers: Number(usage?.uniqueUsers ?? 0),
    lastUsedAt: formatNullableDateTime(usage?.lastUsedAt),
    deprecated: Boolean(notice && notice.effectiveAt <= new Date()),
    deprecationNotice: notice ? mapReportDeprecationNotice(notice) : null,
  };
}

export async function listTopReportAssets(days = 30, limit = 20): Promise<ReportAssetUsageSummary[]> {
  const startAt = dayjs().subtract(days, 'day').toDate();
  const scope = reportTenantScope(reportAssetUsageLogs);
  const acl = await resourceAclCondition(reportAssetUsageLogs.resourceType, reportAssetUsageLogs.resourceId);
  const rows = await db.select({
    resourceType: reportAssetUsageLogs.resourceType,
    resourceId: reportAssetUsageLogs.resourceId,
    count: sql<number>`count(*)::int`,
  }).from(reportAssetUsageLogs).where(and(
    gte(reportAssetUsageLogs.occurredAt, startAt),
    acl,
    ...(scope ? [scope] : []),
  )).groupBy(reportAssetUsageLogs.resourceType, reportAssetUsageLogs.resourceId)
    .orderBy(desc(sql`count(*)`)).limit(Math.min(limit * 3, 200));
  const out: ReportAssetUsageSummary[] = [];
  for (const row of rows) {
    try {
      out.push(await getReportAssetUsageSummary(row.resourceType, row.resourceId, days));
      if (out.length >= limit) break;
    } catch (error) {
      if (!(error instanceof HTTPException) || [403, 404].indexOf(error.status) < 0) throw error;
    }
  }
  return out;
}

export async function listInactiveReportAssets(days = 90, page = 1, pageSize = 20) {
  const cutoff = dayjs().subtract(days, 'day').toDate();
  const acl = await resourceAclCondition(reportAssetUsageLogs.resourceType, reportAssetUsageLogs.resourceId);
  const usage = await db.select({
    resourceType: reportAssetUsageLogs.resourceType,
    resourceId: reportAssetUsageLogs.resourceId,
    lastUsedAt: sql<Date | null>`max(${reportAssetUsageLogs.occurredAt})`,
  }).from(reportAssetUsageLogs).where(and(reportTenantScope(reportAssetUsageLogs), acl))
    .groupBy(reportAssetUsageLogs.resourceType, reportAssetUsageLogs.resourceId);
  const map = new Map(usage.map((row) => [`${row.resourceType}:${row.resourceId}`, row.lastUsedAt]));
  const offset = pageOffset(page, pageSize);
  const list: ReportAssetCatalogItem[] = [];
  let total = 0;
  let catalogPage = 1;
  const catalogPageSize = 500;
  while (true) {
    const catalog = await listReportAssetCatalog({ page: catalogPage, pageSize: catalogPageSize });
    for (const row of catalog.list) {
      const last = map.get(`${row.resourceType}:${row.resourceId}`);
      if (last && last >= cutoff) continue;
      if (total >= offset && list.length < pageSize) list.push(row);
      total++;
    }
    if (catalogPage * catalogPageSize >= catalog.total) break;
    catalogPage++;
  }
  return { list, total, page, pageSize };
}

export async function getReportAssetUsageTrend(query: {
  days?: number;
  bucket?: 'hour' | 'day';
  resourceType?: ReportResourceType;
  resourceId?: number;
}) {
  const days = Math.min(Math.max(query.days ?? 30, 1), 90);
  const bucket = query.bucket ?? 'day';
  const conds = [gte(reportAssetUsageLogs.occurredAt, dayjs().subtract(days, 'day').toDate())];
  const scope = reportTenantScope(reportAssetUsageLogs);
  if (scope) conds.push(scope);
  conds.push(await resourceAclCondition(reportAssetUsageLogs.resourceType, reportAssetUsageLogs.resourceId));
  if (query.resourceType) conds.push(eq(reportAssetUsageLogs.resourceType, query.resourceType));
  if (query.resourceId) conds.push(eq(reportAssetUsageLogs.resourceId, query.resourceId));
  if (query.resourceType && query.resourceId) await ensureReportResourceAccess(query.resourceType, query.resourceId, 'viewer');
  const bucketSql = reportTimeBucketExpression(bucket, reportAssetUsageLogs.occurredAt);
  const rows = await db.select({
    bucket: bucketSql,
    views: sql<number>`sum(case when ${reportAssetUsageLogs.action} = 'view' then 1 else 0 end)::int`,
    queries: sql<number>`sum(case when ${reportAssetUsageLogs.action} = 'query' then 1 else 0 end)::int`,
    exports: sql<number>`sum(case when ${reportAssetUsageLogs.action} = 'export' then 1 else 0 end)::int`,
    embeds: sql<number>`sum(case when ${reportAssetUsageLogs.action} = 'embed' then 1 else 0 end)::int`,
    shares: sql<number>`sum(case when ${reportAssetUsageLogs.action} = 'share' then 1 else 0 end)::int`,
    uniqueUsers: sql<number>`count(distinct ${reportAssetUsageLogs.userId})::int`,
  }).from(reportAssetUsageLogs).where(and(...conds)).groupBy(bucketSql).orderBy(bucketSql);
  return rows.map((row) => ({
    bucket: formatDateTime(row.bucket),
    views: Number(row.views ?? 0),
    queries: Number(row.queries ?? 0),
    exports: Number(row.exports ?? 0),
    embeds: Number(row.embeds ?? 0),
    shares: Number(row.shares ?? 0),
    uniqueUsers: Number(row.uniqueUsers ?? 0),
  }));
}

async function ensureDeprecationNotice(id: number): Promise<DeprecationRow> {
  const row = await db.query.reportDeprecationNotices.findFirst({
    where: reportScopedWhere(reportDeprecationNotices, eq(reportDeprecationNotices.id, id)),
  });
  if (!row) throw new HTTPException(404, { message: '弃用公告不存在' });
  await ensureReportResourceAccess(row.resourceType, row.resourceId, 'editor');
  return row;
}

async function validateDeprecationReferences(input: {
  resourceType: ReportResourceType;
  resourceId: number;
  replacementResourceType?: ReportResourceType | null;
  replacementResourceId?: number | null;
}) {
  const resource = await ensureReportResourceAccess(input.resourceType, input.resourceId, 'owner');
  if (input.replacementResourceType && input.replacementResourceId) {
    const replacement = await ensureReportResourceAccess(input.replacementResourceType, input.replacementResourceId, 'viewer');
    if (replacement.tenantId !== resource.tenantId) throw new HTTPException(400, { message: '替代资源必须属于同一租户' });
    if (input.replacementResourceType === input.resourceType && input.replacementResourceId === input.resourceId) {
      throw new HTTPException(400, { message: '替代资源不能指向自身' });
    }
  }
  return resource;
}

export async function listReportDeprecationNotices(query: {
  page?: number;
  pageSize?: number;
  resourceType?: ReportResourceType;
  resourceId?: number;
  published?: boolean;
}) {
  const { page = 1, pageSize = 20 } = query;
  const conds = [];
  const scope = reportTenantScope(reportDeprecationNotices);
  if (scope) conds.push(scope);
  conds.push(await resourceAclCondition(
    reportDeprecationNotices.resourceType,
    reportDeprecationNotices.resourceId,
  ));
  if (query.resourceType) conds.push(eq(reportDeprecationNotices.resourceType, query.resourceType));
  if (query.resourceId) conds.push(eq(reportDeprecationNotices.resourceId, query.resourceId));
  if (query.published !== undefined) conds.push(query.published
    ? isNotNull(reportDeprecationNotices.publishedAt)
    : isNull(reportDeprecationNotices.publishedAt));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(reportDeprecationNotices, where),
    db.select().from(reportDeprecationNotices).where(where).orderBy(desc(reportDeprecationNotices.id))
      .limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  const list = [];
  for (const row of rows) {
    try {
      await ensureReportResourceAccess(row.resourceType, row.resourceId, 'viewer');
      list.push(mapReportDeprecationNotice(row));
    } catch (error) {
      if (!(error instanceof HTTPException) || error.status !== 403) throw error;
    }
  }
  return { list, total: list.length === rows.length ? total : list.length, page, pageSize };
}

export async function createReportDeprecationNotice(
  input: CreateReportDeprecationNoticeInput,
): Promise<ReportDeprecationNotice> {
  const resource = await validateDeprecationReferences(input);
  const effectiveAt = parseDateTimeInput(input.effectiveAt);
  const expiresAt = parseDateTimeInput(input.expiresAt);
  if (!effectiveAt) throw new HTTPException(400, { message: '生效时间无效' });
  if (expiresAt && expiresAt <= effectiveAt) throw new HTTPException(400, { message: '过期时间必须晚于生效时间' });
  const [row] = await db.insert(reportDeprecationNotices).values({
    tenantId: resource.tenantId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    title: input.title,
    message: input.message,
    replacementResourceType: input.replacementResourceType ?? null,
    replacementResourceId: input.replacementResourceId ?? null,
    effectiveAt,
    expiresAt,
    createdBy: currentUserId(),
    updatedBy: currentUserId(),
  }).returning();
  return mapReportDeprecationNotice(row!);
}

export async function updateReportDeprecationNotice(
  id: number,
  input: UpdateReportDeprecationNoticeInput,
): Promise<ReportDeprecationNotice> {
  const existing = await ensureDeprecationNotice(id);
  await validateDeprecationReferences({
    resourceType: existing.resourceType,
    resourceId: existing.resourceId,
    replacementResourceType: input.replacementResourceType === undefined ? existing.replacementResourceType : input.replacementResourceType,
    replacementResourceId: input.replacementResourceId === undefined ? existing.replacementResourceId : input.replacementResourceId,
  });
  const effectiveAt = input.effectiveAt ? parseDateTimeInput(input.effectiveAt) : existing.effectiveAt;
  const expiresAt = input.expiresAt === undefined ? existing.expiresAt : parseDateTimeInput(input.expiresAt);
  if (!effectiveAt || (expiresAt && expiresAt <= effectiveAt)) throw new HTTPException(400, { message: '弃用公告时间范围无效' });
  const [row] = await db.update(reportDeprecationNotices).set({
    ...input,
    effectiveAt,
    expiresAt,
    updatedBy: currentUserId(),
  }).where(eq(reportDeprecationNotices.id, id)).returning();
  return mapReportDeprecationNotice(row!);
}

export async function deleteReportDeprecationNotice(id: number): Promise<void> {
  const row = await ensureDeprecationNotice(id);
  if (row.publishedAt) throw new HTTPException(409, { message: '已发布公告请先撤销发布' });
  await db.delete(reportDeprecationNotices).where(eq(reportDeprecationNotices.id, id));
}

export async function publishReportDeprecationNotice(id: number, publish: boolean): Promise<ReportDeprecationNotice> {
  await ensureDeprecationNotice(id);
  const [row] = await db.update(reportDeprecationNotices).set({
    publishedAt: publish ? new Date() : null,
    publishedBy: publish ? currentUserId() : null,
    processedAt: null,
    updatedBy: currentUserId(),
  }).where(eq(reportDeprecationNotices.id, id)).returning();
  return mapReportDeprecationNotice(row!);
}

export async function scanReportDeprecationSunsets(now = new Date()): Promise<number> {
  const rows = await db.select().from(reportDeprecationNotices).where(and(
    isNotNull(reportDeprecationNotices.publishedAt),
    isNull(reportDeprecationNotices.processedAt),
    lte(reportDeprecationNotices.effectiveAt, now),
  ));
  for (const row of rows) {
    await db.update(reportDeprecationNotices).set({ processedAt: now })
      .where(and(eq(reportDeprecationNotices.id, row.id), isNull(reportDeprecationNotices.processedAt)));
  }
  return rows.length;
}

export function validateReportAssetTemplateContent(type: ReportAssetTemplateType, content: Record<string, unknown>): void {
  let result;
  if (type === 'dashboard') {
    result = createReportDashboardSchema.safeParse({ ...content, name: typeof content.name === 'string' ? content.name : '模板仪表盘' });
  } else if (type === 'widget') {
    result = reportWidgetSchema.safeParse(content.widget ?? content);
    if (result.success && content.layout !== undefined) result = reportGridItemSchema.safeParse(content.layout);
  } else if (type === 'print') {
    result = createReportPrintTemplateSchema.safeParse({ ...content, name: typeof content.name === 'string' ? content.name : '模板打印报表' });
  } else {
    result = createReportDatasetSchema.safeParse({ ...content, name: typeof content.name === 'string' ? content.name : '模板语义模型' });
  }
  if (!result.success) throw new HTTPException(400, { message: `资产模板内容无效：${result.error.issues[0]?.message ?? '格式错误'}` });
}

async function validateAssetTemplatePlacement(input: {
  ownerId?: number | null;
  folderId?: number | null;
  previewFileId?: string | null;
}) {
  const tenantId = reportCreateTenantId();
  const ownerId = input.ownerId ?? defaultReportOwnerId();
  await validateReportResourcePlacement('asset_template', { ownerId, folderId: input.folderId, tenantId });
  if (input.previewFileId) {
    const tenantWhere = tenantId === null ? isNull(managedFiles.tenantId) : eq(managedFiles.tenantId, tenantId);
    const [file] = await db.select({ id: managedFiles.id }).from(managedFiles)
      .where(and(eq(managedFiles.id, input.previewFileId), tenantWhere)).limit(1);
    if (!file) throw new HTTPException(400, { message: '模板预览文件不存在或不属于当前租户' });
  }
  return { tenantId, ownerId };
}

async function ensureAssetTemplate(id: number, role: 'viewer' | 'editor' | 'owner' = 'viewer'): Promise<AssetTemplateRow> {
  await ensureReportResourceAccess('asset_template', id, role);
  const row = await db.query.reportAssetTemplates.findFirst({
    where: reportScopedWhere(reportAssetTemplates, eq(reportAssetTemplates.id, id)),
  });
  if (!row) throw new HTTPException(404, { message: '资产模板不存在' });
  return row;
}

export async function listReportAssetTemplates(query: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  type?: ReportAssetTemplateType;
  status?: 'enabled' | 'disabled';
}) {
  const { page = 1, pageSize = 20 } = query;
  const conds = [];
  const scope = reportTenantScope(reportAssetTemplates);
  if (scope) conds.push(scope);
  const accessibleIds = await listAccessibleReportResourceIds('asset_template');
  if (accessibleIds && !accessibleIds.length) return { list: [], total: 0, page, pageSize };
  if (accessibleIds) conds.push(inArray(reportAssetTemplates.id, accessibleIds));
  if (query.keyword) {
    const value = `%${escapeLike(query.keyword)}%`;
    conds.push(or(ilike(reportAssetTemplates.name, value), ilike(reportAssetTemplates.code, value)));
  }
  if (query.type) conds.push(eq(reportAssetTemplates.type, query.type));
  if (query.status) conds.push(eq(reportAssetTemplates.status, query.status));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(reportAssetTemplates, where),
    db.select().from(reportAssetTemplates).where(where).orderBy(desc(reportAssetTemplates.id))
      .limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map((row) => mapReportAssetTemplate(row)), total, page, pageSize };
}

export async function getReportAssetTemplate(id: number): Promise<ReportAssetTemplate> {
  return mapReportAssetTemplate(await ensureAssetTemplate(id));
}

export async function createReportAssetTemplate(input: CreateReportAssetTemplateInput): Promise<ReportAssetTemplate> {
  validateReportAssetTemplateContent(input.type, input.content);
  const placement = await validateAssetTemplatePlacement(input);
  try {
    const [row] = await db.insert(reportAssetTemplates).values({
      tenantId: placement.tenantId,
      folderId: input.folderId ?? null,
      ownerId: placement.ownerId,
      code: input.code,
      name: input.name,
      type: input.type,
      description: input.description ?? null,
      content: input.content,
      previewFileId: input.previewFileId ?? null,
      status: input.status,
      createdBy: currentUserId(),
      updatedBy: currentUserId(),
    }).returning();
    return mapReportAssetTemplate(row!);
  } catch (error) {
    rethrowPgUniqueViolation(error, '资产模板编码已存在');
  }
}

export async function updateReportAssetTemplate(
  id: number,
  input: UpdateReportAssetTemplateInput,
): Promise<ReportAssetTemplate> {
  const existing = await ensureAssetTemplate(id, 'editor');
  const type = input.type ?? existing.type;
  const content = input.content ?? existing.content;
  validateReportAssetTemplateContent(type, content);
  await validateAssetTemplatePlacement({
    ownerId: input.ownerId === undefined ? existing.ownerId : input.ownerId,
    folderId: input.folderId === undefined ? existing.folderId : input.folderId,
    previewFileId: input.previewFileId === undefined ? existing.previewFileId : input.previewFileId,
  });
  const [row] = await db.update(reportAssetTemplates).set({
    ...input,
    content,
    version: sql`${reportAssetTemplates.version} + 1`,
    updatedBy: currentUserId(),
  }).where(eq(reportAssetTemplates.id, id)).returning();
  return mapReportAssetTemplate(row!);
}

export async function deleteReportAssetTemplate(id: number): Promise<void> {
  const existing = await ensureAssetTemplate(id, 'owner');
  const references = await db.$count(reportDeprecationNotices, and(
    eq(reportDeprecationNotices.replacementResourceType, 'asset_template'),
    eq(reportDeprecationNotices.replacementResourceId, existing.id),
    isNotNull(reportDeprecationNotices.publishedAt),
  ));
  if (references > 0) throw new HTTPException(409, { message: '资产模板仍被已发布的弃用公告引用，不能删除' });
  await db.delete(reportAssetTemplates).where(eq(reportAssetTemplates.id, id));
}

export async function cloneReportAssetTemplate(
  id: number,
  input: { name: string; folderId?: number | null },
): Promise<ReportAssetTemplate> {
  const source = await ensureAssetTemplate(id);
  const placement = await validateAssetTemplatePlacement({
    ownerId: defaultReportOwnerId(),
    folderId: input.folderId,
    previewFileId: source.previewFileId,
  });
  let suffix = 1;
  let code = `${source.code}_copy`;
  while (await db.query.reportAssetTemplates.findFirst({
    where: reportScopedWhere(reportAssetTemplates, eq(reportAssetTemplates.code, code)),
  })) {
    suffix++;
    code = `${source.code}_copy_${suffix}`;
  }
  const [row] = await db.insert(reportAssetTemplates).values({
    tenantId: placement.tenantId,
    folderId: input.folderId ?? source.folderId,
    ownerId: placement.ownerId,
    code,
    name: input.name,
    type: source.type,
    description: source.description,
    content: source.content,
    previewFileId: source.previewFileId,
    status: source.status,
    createdBy: currentUserId(),
    updatedBy: currentUserId(),
  }).returning();
  return mapReportAssetTemplate(row!);
}

export async function applyReportAssetTemplate(id: number, input: ApplyReportAssetTemplateInput) {
  const template = await ensureAssetTemplate(id);
  if (template.status !== 'enabled') throw new HTTPException(400, { message: '资产模板已停用' });
  validateReportAssetTemplateContent(template.type, template.content);
  let resource: { id: number; name: string };
  if (template.type === 'dashboard') {
    const parsed = createReportDashboardSchema.parse({
      ...template.content,
      name: input.name ?? template.name,
      folderId: input.folderId ?? template.folderId,
      ownerId: defaultReportOwnerId(),
    });
    resource = await createDashboard(parsed);
  } else if (template.type === 'print') {
    const parsed = createReportPrintTemplateSchema.parse({
      ...template.content,
      name: input.name ?? template.name,
      folderId: input.folderId ?? template.folderId,
      ownerId: defaultReportOwnerId(),
    });
    resource = await createPrintTemplate(parsed);
  } else if (template.type === 'semantic_model') {
    const parsed = createReportDatasetSchema.parse({
      ...template.content,
      name: input.name ?? template.name,
      folderId: input.folderId ?? template.folderId,
      ownerId: defaultReportOwnerId(),
    });
    resource = await createDataset(parsed);
  } else {
    if (!input.targetResourceId) throw new HTTPException(400, { message: '应用组件模板必须指定目标仪表盘' });
    await ensureReportResourceAccess('dashboard', input.targetResourceId, 'editor');
    const dashboard = await getDashboard(input.targetResourceId, { mode: 'draft' });
    const sourceWidget = reportWidgetSchema.parse(template.content.widget ?? template.content);
    const widgetId = `tpl_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const widget = { ...sourceWidget, i: widgetId };
    const sourceLayout = template.content.layout
      ? reportGridItemSchema.parse(template.content.layout)
      : { i: widgetId, x: 0, y: Math.max(0, ...dashboard.layout.map((item) => item.y + item.h)), w: 6, h: 4 };
    const layout = { ...sourceLayout, i: widgetId };
    const existingWidgets = reportWidgetSchema.array().parse(dashboard.widgets);
    resource = await updateDashboardDraft(dashboard.id, {
      widgets: [...existingWidgets, widget],
      layout: [...dashboard.layout, layout],
      expectedRevision: dashboard.revision,
    });
  }
  await db.update(reportAssetTemplates).set({
    usageCount: sql`${reportAssetTemplates.usageCount} + 1`,
  }).where(eq(reportAssetTemplates.id, id));
  await recordReportAssetUsage({
    tenantId: template.tenantId,
    resourceType: 'asset_template',
    resourceId: template.id,
    action: 'query',
    scene: 'template_apply',
  });
  const resourceType: ReportResourceType = template.type === 'print'
      ? 'print_template'
      : template.type === 'semantic_model'
        ? 'dataset'
        : 'dashboard';
  return {
    resourceType,
    resourceId: resource.id,
    name: resource.name,
  };
}
