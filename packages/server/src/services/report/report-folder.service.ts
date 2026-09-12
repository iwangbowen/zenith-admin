import { requireRow } from '../../lib/db-assert';
import { HTTPException } from 'hono/http-exception';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { CreateReportFolderInput, MoveReportFolderInput, ReportFolder, ReportFolderTreeNode, ReportResourceType, UpdateReportFolderInput } from '@zenith/shared/report';
import { db } from '../../db';
import {
  reportAssetTemplates,
  reportDashboards,
  reportDatasets,
  reportDatasources,
  reportFillTemplates,
  reportFolders,
  reportMetrics,
  reportPrintTemplates,
  reportResourceAcls,
} from '../../db/schema';
import { currentUserOrNull, isSuperAdmin } from '../../lib/context';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { formatTimestamps } from '../../lib/datetime';
import { reportCreateTenantId, reportScopedWhere, reportTenantScope } from './report-access';
import { defaultReportOwnerId, ensureReportOwner } from './report-resource.service';
import { buildTree } from '@zenith/shared/core';

type FolderRow = typeof reportFolders.$inferSelect & {
  owner?: { nickname: string | null; username: string } | null;
};

export function mapReportFolder(row: FolderRow): ReportFolder {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    parentId: row.parentId ?? null,
    name: row.name,
    resourceType: row.resourceType,
    ownerId: row.ownerId ?? null,
    ownerName: row.owner?.nickname || row.owner?.username || null,
    sort: row.sort,
    status: row.status,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    ...formatTimestamps(row),
  };
}

async function ensureFolderManager(row: typeof reportFolders.$inferSelect): Promise<void> {
  const user = currentUserOrNull();
  if (!user || (!isSuperAdmin() && row.ownerId !== user.userId && row.createdBy !== user.userId)) {
    throw new HTTPException(403, { message: '仅目录负责人可修改该目录' });
  }
}

export async function ensureReportFolderExists(id: number) {
  const [rowOrUndefined] = await db.select().from(reportFolders)
    .where(reportScopedWhere(reportFolders, eq(reportFolders.id, id))).limit(1);
  const row = requireRow(rowOrUndefined, '资源目录不存在');
  return row;
}

async function ensureParent(
  parentId: number | null | undefined,
  resourceType: ReportResourceType,
  tenantId: number | null,
) {
  if (!parentId) return null;
  const parent = await ensureReportFolderExists(parentId);
  if (parent.resourceType !== resourceType || parent.tenantId !== tenantId) {
    throw new HTTPException(400, { message: '上级目录类型或租户不匹配' });
  }
  if (parent.status !== 'enabled') throw new HTTPException(400, { message: '上级目录已停用' });
  return parent;
}

const FOLDER_RESOURCE_TABLES = {
  datasource: reportDatasources,
  dataset: reportDatasets,
  dashboard: reportDashboards,
  metric: reportMetrics,
  print_template: reportPrintTemplates,
  fill_template: reportFillTemplates,
  asset_template: reportAssetTemplates,
} as const;

async function countFolderResourcesByFolder(rows: Array<{ id: number; resourceType: ReportResourceType }>): Promise<Map<number, number>> {
  const idsByType = new Map<ReportResourceType, number[]>();
  for (const row of rows) {
    const ids = idsByType.get(row.resourceType) ?? [];
    ids.push(row.id);
    idsByType.set(row.resourceType, ids);
  }
  const result = new Map<number, number>();
  await Promise.all([...idsByType].map(async ([type, ids]) => {
    const table = FOLDER_RESOURCE_TABLES[type];
    const grouped = await db.select({ folderId: table.folderId, total: count() })
      .from(table)
      .where(inArray(table.folderId, ids))
      .groupBy(table.folderId);
    for (const item of grouped) {
      if (item.folderId != null) result.set(item.folderId, Number(item.total));
    }
  }));
  return result;
}

export async function listReportFolderTree(resourceType?: ReportResourceType): Promise<ReportFolderTreeNode[]> {
  const rows = await db.query.reportFolders.findMany({
    where: resourceType
      ? reportScopedWhere(reportFolders, eq(reportFolders.resourceType, resourceType))
      : reportTenantScope(reportFolders),
    with: { owner: { columns: { nickname: true, username: true } } },
    orderBy: [asc(reportFolders.sort), asc(reportFolders.id)],
  });
  const resourceCounts = await countFolderResourcesByFolder(rows);
  return buildTree<ReportFolderTreeNode>(
    rows.map((row) => ({ ...mapReportFolder(row), resourceCount: resourceCounts.get(row.id) ?? 0 })),
    { keepEmptyChildren: true },
  );
}

export async function getReportFolder(id: number): Promise<ReportFolder> {
  const rowOrUndefined = await db.query.reportFolders.findFirst({
    where: reportScopedWhere(reportFolders, eq(reportFolders.id, id)),
    with: { owner: { columns: { nickname: true, username: true } } },
  });
  const row = requireRow(rowOrUndefined, '资源目录不存在');
  return mapReportFolder(row);
}

export async function createReportFolder(input: CreateReportFolderInput): Promise<ReportFolder> {
  const tenantId = reportCreateTenantId();
  const ownerId = input.ownerId ?? defaultReportOwnerId();
  await Promise.all([
    ensureParent(input.parentId, input.resourceType, tenantId),
    ensureReportOwner(ownerId, tenantId),
  ]);
  try {
    const [row] = await db.insert(reportFolders).values({
      tenantId,
      parentId: input.parentId ?? null,
      name: input.name,
      resourceType: input.resourceType,
      ownerId,
      sort: input.sort ?? 0,
      status: input.status ?? 'enabled',
    }).returning();
    return mapReportFolder(row);
  } catch (error) {
    rethrowPgUniqueViolation(error, '同级目录名称已存在');
    throw error;
  }
}

export async function updateReportFolder(id: number, input: UpdateReportFolderInput): Promise<ReportFolder> {
  const current = await ensureReportFolderExists(id);
  await ensureFolderManager(current);
  const nextParentId = input.parentId === undefined ? current.parentId : input.parentId;
  if (nextParentId === id) throw new HTTPException(400, { message: '目录不能移动到自身' });
  await Promise.all([
    ensureParent(nextParentId, current.resourceType, current.tenantId ?? null),
    input.ownerId ? ensureReportOwner(input.ownerId, current.tenantId ?? null) : Promise.resolve(),
  ]);
  if (nextParentId) await ensureNoFolderCycle(id, nextParentId);
  try {
    const [rowOrUndefined] = await db.update(reportFolders).set({
      parentId: input.parentId,
      name: input.name,
      ownerId: input.ownerId,
      sort: input.sort,
      status: input.status,
    }).where(eq(reportFolders.id, id)).returning();
    const row = requireRow(rowOrUndefined, '资源目录不存在');
    return mapReportFolder(row);
  } catch (error) {
    rethrowPgUniqueViolation(error, '同级目录名称已存在');
    throw error;
  }
}

async function ensureNoFolderCycle(id: number, parentId: number): Promise<void> {
  const rows = await db.select({ id: reportFolders.id, parentId: reportFolders.parentId })
    .from(reportFolders).where(reportTenantScope(reportFolders));
  const parents = new Map(rows.map((row) => [row.id, row.parentId]));
  const seen = new Set<number>();
  let cursor: number | null | undefined = parentId;
  while (cursor && !seen.has(cursor)) {
    if (cursor === id) throw new HTTPException(400, { message: '不能将目录移动到其子目录' });
    seen.add(cursor);
    cursor = parents.get(cursor);
  }
}

export async function moveReportFolder(id: number, input: MoveReportFolderInput): Promise<ReportFolder> {
  return updateReportFolder(id, { parentId: input.parentId, sort: input.sort });
}

async function countFolderResources(type: ReportResourceType, folderId: number): Promise<number> {
  switch (type) {
    case 'datasource': return db.$count(reportDatasources, eq(reportDatasources.folderId, folderId));
    case 'dataset': return db.$count(reportDatasets, eq(reportDatasets.folderId, folderId));
    case 'dashboard': return db.$count(reportDashboards, eq(reportDashboards.folderId, folderId));
    case 'metric': return db.$count(reportMetrics, eq(reportMetrics.folderId, folderId));
    case 'print_template': return db.$count(reportPrintTemplates, eq(reportPrintTemplates.folderId, folderId));
    case 'fill_template': return db.$count(reportFillTemplates, eq(reportFillTemplates.folderId, folderId));
    case 'asset_template': return db.$count(reportAssetTemplates, eq(reportAssetTemplates.folderId, folderId));
  }
}

export async function deleteReportFolder(id: number): Promise<void> {
  const current = await ensureReportFolderExists(id);
  await ensureFolderManager(current);
  const [children, resources] = await Promise.all([
    db.$count(reportFolders, reportScopedWhere(reportFolders, eq(reportFolders.parentId, id))),
    countFolderResources(current.resourceType, id),
  ]);
  if (children > 0 || resources > 0) {
    throw new HTTPException(400, { message: '目录仍包含子目录或资源，无法删除' });
  }
  await db.transaction(async (tx) => {
    await tx.delete(reportResourceAcls).where(and(
      eq(reportResourceAcls.resourceType, current.resourceType),
      eq(reportResourceAcls.resourceId, id),
      eq(reportResourceAcls.inheritFromFolder, true),
    ));
    await tx.delete(reportFolders).where(eq(reportFolders.id, id));
  });
}
