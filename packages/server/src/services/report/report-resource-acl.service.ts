import { requireRow } from '../../lib/db-assert';
import { HTTPException } from 'hono/http-exception';
import { and, eq, inArray } from 'drizzle-orm';
import type { GrantReportResourceAclInput, ReportAclRole, ReportAclSubjectType, ReportResourceAcl, ReportResourceType, UpdateReportResourceAclInput } from '@zenith/shared/report';
import { db } from '../../db';
import {
  departments,
  reportAssetTemplates,
  reportDashboards,
  reportDatasets,
  reportDatasources,
  reportFillTemplates,
  reportFolders,
  reportMetrics,
  reportPrintTemplates,
  reportResourceAcls,
  roles,
  userGroups,
  userRoles,
  users,
} from '../../db/schema';
import { getUserEnabledGroupIds } from '../../lib/user-group-access';
import { currentUserOrNull } from '../../lib/context';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { isSuperAdmin } from '../../lib/context';
import { reportScopedWhere, reportTenantScope } from './report-access';
import { resolveReportResource } from './report-resource.service';

const ACL_RANK: Record<ReportAclRole, number> = { viewer: 1, editor: 2, owner: 3 };

export interface AccessCandidate {
  id: number;
  tenantId: number | null;
  ownerId: number | null;
  folderId: number | null;
  createdBy: number | null;
}

export interface SubjectSet {
  user: Set<number>;
  role: Set<number>;
  department: Set<number>;
  user_group: Set<number>;
}

export interface AclEvaluationEntry {
  tenantId: number | null;
  resourceType: ReportResourceType;
  resourceId: number;
  subjectType: ReportAclSubjectType;
  subjectId: number;
  role: ReportAclRole;
  inheritFromFolder: boolean;
  expiresAt: Date | null;
}

export function reportAclRoleSatisfies(actual: ReportAclRole, required: ReportAclRole): boolean {
  return ACL_RANK[actual] >= ACL_RANK[required];
}

export function isReportAclActive(expiresAt: Date | null, now = new Date()): boolean {
  return expiresAt === null || expiresAt.getTime() > now.getTime();
}

async function loadCurrentSubjects(): Promise<SubjectSet> {
  const user = currentUserOrNull();
  if (!user) return { user: new Set(), role: new Set(), department: new Set(), user_group: new Set() };
  const [userRow, directRoles, groupIds] = await Promise.all([
    db.select({ departmentId: users.departmentId }).from(users).where(eq(users.id, user.userId)).limit(1),
    db.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, user.userId)),
    // 仅启用组参与授权匹配：禁用组的成员立即失去按组授予的资源（口径见 user-group-access）
    getUserEnabledGroupIds(user.userId),
  ]);
  return {
    user: new Set([user.userId]),
    role: new Set(directRoles.map((row) => row.roleId)),
    department: new Set(userRow[0]?.departmentId ? [userRow[0].departmentId] : []),
    user_group: new Set(groupIds),
  };
}

function subjectMatches(
  acl: { subjectType: ReportAclSubjectType; subjectId: number },
  subjects: SubjectSet,
): boolean {
  return subjects[acl.subjectType].has(acl.subjectId);
}

async function loadFolderAncestors(folderId: number | null): Promise<number[]> {
  if (!folderId) return [];
  const rows = await db.select({ id: reportFolders.id, parentId: reportFolders.parentId })
    .from(reportFolders).where(reportTenantScope(reportFolders));
  const parents = new Map(rows.map((row) => [row.id, row.parentId]));
  const out: number[] = [];
  const seen = new Set<number>();
  let cursor: number | null | undefined = folderId;
  while (cursor && !seen.has(cursor)) {
    out.push(cursor);
    seen.add(cursor);
    cursor = parents.get(cursor);
  }
  return out;
}

function legacyResourceAllows(resource: AccessCandidate): boolean {
  return resource.ownerId === null && resource.createdBy === null;
}

export function resolveReportAclRoleFromEntries(
  resourceType: ReportResourceType,
  resource: AccessCandidate,
  userId: number | null,
  superAdmin: boolean,
  subjects: SubjectSet,
  folderIds: number[],
  rows: AclEvaluationEntry[],
  now = new Date(),
): ReportAclRole | null {
  if (!userId) return null;
  if (superAdmin) return 'owner';
  if (resource.ownerId === userId || (!resource.ownerId && resource.createdBy === userId)) return 'owner';
  if (legacyResourceAllows(resource)) return 'owner';
  let role: ReportAclRole | null = null;
  for (const acl of rows) {
    if (acl.tenantId !== resource.tenantId || acl.resourceType !== resourceType) continue;
    const direct = acl.resourceId === resource.id && !acl.inheritFromFolder;
    const inherited = folderIds.includes(acl.resourceId) && acl.inheritFromFolder;
    if ((!direct && !inherited) || !isReportAclActive(acl.expiresAt, now) || !subjectMatches(acl, subjects)) continue;
    if (!role || ACL_RANK[acl.role] > ACL_RANK[role]) role = acl.role;
  }
  return role;
}

async function resolveEffectiveRole(
  resourceType: ReportResourceType,
  resource: AccessCandidate,
): Promise<ReportAclRole | null> {
  const user = currentUserOrNull();
  if (!user) return null;
  if (isSuperAdmin() || resource.ownerId === user.userId || (!resource.ownerId && resource.createdBy === user.userId) || legacyResourceAllows(resource)) {
    return 'owner';
  }

  const [subjects, folderIds] = await Promise.all([
    loadCurrentSubjects(),
    loadFolderAncestors(resource.folderId),
  ]);
  const resourceIds = [resource.id, ...folderIds];
  const rows = await db.select().from(reportResourceAcls).where(reportScopedWhere(
    reportResourceAcls,
    and(eq(reportResourceAcls.resourceType, resourceType), inArray(reportResourceAcls.resourceId, resourceIds))!,
  ));
  return resolveReportAclRoleFromEntries(resourceType, resource, user.userId, false, subjects, folderIds, rows);
}

export async function ensureReportResourceAccess(
  resourceType: ReportResourceType,
  id: number,
  requiredRole: ReportAclRole,
  options?: { allowAnonymous?: boolean },
) {
  const resource = await resolveReportResource(resourceType, id);
  if (!currentUserOrNull() && options?.allowAnonymous) return resource;
  const role = await resolveEffectiveRole(resourceType, resource);
  if (!role || !reportAclRoleSatisfies(role, requiredRole)) {
    throw new HTTPException(403, { message: '无权访问该报表资源' });
  }
  return resource;
}

async function listCandidates(resourceType: ReportResourceType): Promise<AccessCandidate[]> {
  const columns = {
    id: reportDatasources.id,
    tenantId: reportDatasources.tenantId,
    ownerId: reportDatasources.ownerId,
    folderId: reportDatasources.folderId,
    createdBy: reportDatasources.createdBy,
  };
  switch (resourceType) {
    case 'datasource':
      return db.select(columns).from(reportDatasources).where(reportTenantScope(reportDatasources));
    case 'dataset':
      return db.select({
        id: reportDatasets.id, tenantId: reportDatasets.tenantId, ownerId: reportDatasets.ownerId,
        folderId: reportDatasets.folderId, createdBy: reportDatasets.createdBy,
      }).from(reportDatasets).where(reportTenantScope(reportDatasets));
    case 'dashboard':
      return db.select({
        id: reportDashboards.id, tenantId: reportDashboards.tenantId, ownerId: reportDashboards.ownerId,
        folderId: reportDashboards.folderId, createdBy: reportDashboards.createdBy,
      }).from(reportDashboards).where(reportTenantScope(reportDashboards));
    case 'metric':
      return db.select({
        id: reportMetrics.id, tenantId: reportMetrics.tenantId, ownerId: reportMetrics.ownerId,
        folderId: reportMetrics.folderId, createdBy: reportMetrics.createdBy,
      }).from(reportMetrics).where(reportTenantScope(reportMetrics));
    case 'print_template':
      return db.select({
        id: reportPrintTemplates.id, tenantId: reportPrintTemplates.tenantId, ownerId: reportPrintTemplates.ownerId,
        folderId: reportPrintTemplates.folderId, createdBy: reportPrintTemplates.createdBy,
      }).from(reportPrintTemplates).where(reportTenantScope(reportPrintTemplates));
    case 'fill_template':
      return db.select({
        id: reportFillTemplates.id, tenantId: reportFillTemplates.tenantId, ownerId: reportFillTemplates.ownerId,
        folderId: reportFillTemplates.folderId, createdBy: reportFillTemplates.createdBy,
      }).from(reportFillTemplates).where(reportTenantScope(reportFillTemplates));
    case 'asset_template':
      return db.select({
        id: reportAssetTemplates.id, tenantId: reportAssetTemplates.tenantId, ownerId: reportAssetTemplates.ownerId,
        folderId: reportAssetTemplates.folderId, createdBy: reportAssetTemplates.createdBy,
      }).from(reportAssetTemplates).where(reportTenantScope(reportAssetTemplates));
  }
}

export async function listAccessibleReportResourceIds(
  resourceType: ReportResourceType,
  requiredRole: ReportAclRole = 'viewer',
): Promise<number[] | null> {
  if (isSuperAdmin()) return null;
  const candidates = await listCandidates(resourceType);
  const user = currentUserOrNull();
  if (!user || candidates.length === 0) return [];
  const [subjects, folders, aclRows] = await Promise.all([
    loadCurrentSubjects(),
    db.select({ id: reportFolders.id, parentId: reportFolders.parentId })
      .from(reportFolders).where(reportTenantScope(reportFolders)),
    db.select().from(reportResourceAcls).where(reportScopedWhere(
      reportResourceAcls,
      eq(reportResourceAcls.resourceType, resourceType),
    )),
  ]);
  const parents = new Map(folders.map((folder) => [folder.id, folder.parentId]));
  const ancestors = (folderId: number | null): number[] => {
    const result: number[] = [];
    const seen = new Set<number>();
    let cursor: number | null | undefined = folderId;
    while (cursor && !seen.has(cursor)) {
      result.push(cursor);
      seen.add(cursor);
      cursor = parents.get(cursor);
    }
    return result;
  };
  const checks = candidates.map((resource) => {
    const role = resolveReportAclRoleFromEntries(
      resourceType,
      resource,
      user.userId,
      false,
      subjects,
      ancestors(resource.folderId),
      aclRows,
    );
    return role && reportAclRoleSatisfies(role, requiredRole) ? resource.id : null;
  });
  return checks.filter((id): id is number => id !== null);
}

export async function filterReportResourceRowsByAccess<T extends { id: number }>(
  resourceType: ReportResourceType,
  rows: T[],
  requiredRole: ReportAclRole = 'viewer',
): Promise<T[]> {
  const ids = await listAccessibleReportResourceIds(resourceType, requiredRole);
  if (ids === null) return rows;
  const allowed = new Set(ids);
  return rows.filter((row) => allowed.has(row.id));
}

async function ensureAclSubject(
  subjectType: ReportAclSubjectType,
  subjectId: number,
  tenantId: number | null,
): Promise<void> {
  let row: { id: number; tenantId: number | null } | undefined;
  switch (subjectType) {
    case 'user':
      [row] = await db.select({ id: users.id, tenantId: users.tenantId }).from(users).where(eq(users.id, subjectId)).limit(1);
      break;
    case 'role':
      [row] = await db.select({ id: roles.id, tenantId: roles.tenantId }).from(roles).where(eq(roles.id, subjectId)).limit(1);
      break;
    case 'department':
      [row] = await db.select({ id: departments.id, tenantId: departments.tenantId }).from(departments).where(eq(departments.id, subjectId)).limit(1);
      break;
    case 'user_group':
      [row] = await db.select({ id: userGroups.id, tenantId: userGroups.tenantId }).from(userGroups).where(eq(userGroups.id, subjectId)).limit(1);
      break;
  }
  if (!row || row.tenantId !== tenantId) throw new HTTPException(400, { message: '授权主体不存在或跨租户' });
}

async function ensureFolderAclManager(folderId: number, resourceType: ReportResourceType) {
  const [folderOrUndefined] = await db.select().from(reportFolders)
    .where(reportScopedWhere(reportFolders, and(eq(reportFolders.id, folderId), eq(reportFolders.resourceType, resourceType))!))
    .limit(1);
  const folder = requireRow(folderOrUndefined, '资源目录不存在');
  const user = currentUserOrNull();
  if (!user || (!isSuperAdmin() && folder.ownerId !== user.userId && folder.createdBy !== user.userId)) {
    throw new HTTPException(403, { message: '仅目录负责人可管理继承权限' });
  }
  return folder;
}

export function mapReportResourceAcl(row: typeof reportResourceAcls.$inferSelect): ReportResourceAcl {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    role: row.role,
    inheritFromFolder: row.inheritFromFolder,
    expiresAt: formatNullableDateTime(row.expiresAt),
    grantedBy: row.grantedBy ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function listReportResourceAcls(
  resourceType: ReportResourceType,
  resourceId: number,
  inheritFromFolder = false,
): Promise<ReportResourceAcl[]> {
  if (inheritFromFolder) await ensureFolderAclManager(resourceId, resourceType);
  else await ensureReportResourceAccess(resourceType, resourceId, 'owner');
  const rows = await db.select().from(reportResourceAcls)
    .where(reportScopedWhere(reportResourceAcls, and(
      eq(reportResourceAcls.resourceType, resourceType),
      eq(reportResourceAcls.resourceId, resourceId),
      eq(reportResourceAcls.inheritFromFolder, inheritFromFolder),
    )!));
  return rows.map(mapReportResourceAcl);
}

export async function grantReportResourceAcl(input: GrantReportResourceAclInput): Promise<ReportResourceAcl> {
  const target = input.inheritFromFolder
    ? await ensureFolderAclManager(input.resourceId, input.resourceType)
    : await ensureReportResourceAccess(input.resourceType, input.resourceId, 'owner');
  await ensureAclSubject(input.subjectType, input.subjectId, target.tenantId ?? null);
  try {
    const [row] = await db.insert(reportResourceAcls).values({
      tenantId: target.tenantId ?? null,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      role: input.role,
      inheritFromFolder: input.inheritFromFolder ?? false,
      expiresAt: input.expiresAt ? parseDateTimeInput(input.expiresAt) : null,
      grantedBy: currentUserOrNull()?.userId ?? null,
    }).returning();
    return mapReportResourceAcl(row);
  } catch (error) {
    rethrowPgUniqueViolation(error, '该主体已拥有资源权限');
    throw error;
  }
}

async function ensureAclManageable(id: number) {
  const [aclOrUndefined] = await db.select().from(reportResourceAcls)
    .where(reportScopedWhere(reportResourceAcls, eq(reportResourceAcls.id, id))).limit(1);
  const acl = requireRow(aclOrUndefined, '资源权限不存在');
  if (acl.inheritFromFolder) await ensureFolderAclManager(acl.resourceId, acl.resourceType);
  else await ensureReportResourceAccess(acl.resourceType, acl.resourceId, 'owner');
  return acl;
}

export async function updateReportResourceAcl(id: number, input: UpdateReportResourceAclInput): Promise<ReportResourceAcl> {
  const current = await ensureAclManageable(id);
  if (input.inheritFromFolder !== undefined && input.inheritFromFolder !== current.inheritFromFolder) {
    throw new HTTPException(400, { message: '不能变更授权对象类型，请撤销后重新授权' });
  }
  const [rowOrUndefined] = await db.update(reportResourceAcls).set({
    role: input.role,
    expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt ? parseDateTimeInput(input.expiresAt) : null,
  }).where(eq(reportResourceAcls.id, id)).returning();
  const row = requireRow(rowOrUndefined, '资源权限不存在');
  return mapReportResourceAcl(row);
}

export async function revokeReportResourceAcl(id: number): Promise<void> {
  await ensureAclManageable(id);
  await db.delete(reportResourceAcls).where(eq(reportResourceAcls.id, id));
}

export async function checkReportResourceAccess(
  resourceType: ReportResourceType,
  resourceId: number,
  requiredRole: ReportAclRole,
) {
  try {
    await ensureReportResourceAccess(resourceType, resourceId, requiredRole);
    return { allowed: true, requiredRole };
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return { allowed: false, requiredRole };
    throw error;
  }
}
