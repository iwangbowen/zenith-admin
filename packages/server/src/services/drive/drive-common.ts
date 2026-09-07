import { and, eq, inArray } from 'drizzle-orm';
import type { DriveNode, DriveRole, DriveSpace, DriveSubjectType, DriveTag } from '@zenith/shared/drive';
import { db } from '../../db';
import { departments, roles, userGroups, userRoles, users, type DriveNodeRow, type DriveSpaceRow, type DriveTagRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import type { JwtPayload } from '../../middleware/auth';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';

/** 节点内容鉴权地址（与 routes/drive/drive-nodes.ts 的 /{id}/content 一致） */
export function driveNodeContentUrl(nodeId: number): string {
  return `/api/drive/nodes/${nodeId}/content`;
}

export function driveNodeThumbnailUrl(nodeId: number): string {
  return `/api/drive/nodes/${nodeId}/thumbnail`;
}

export function driveVersionContentUrl(nodeId: number, version: number): string {
  return `/api/drive/nodes/${nodeId}/versions/${version}/content`;
}

export function drivePublicShareUrl(token: string): string {
  return `/public/drive/${token}`;
}

/**
 * 以某个启用中的用户身份构造请求主体，供 worker / 匿名入口代用户执行依赖 currentUser() 的服务
 * （文件收集以链接创建者身份落盘）。用户不存在或已停用返回 null。
 */
export async function loadDriveActorPayload(userId: number, executor: DbExecutor = db): Promise<JwtPayload | null> {
  const [row] = await executor.select({ id: users.id, username: users.username, tenantId: users.tenantId }).from(users)
    .where(and(eq(users.id, userId), eq(users.status, 'enabled'))).limit(1);
  if (!row) return null;
  const roleRows = await executor.select({ code: roles.code }).from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.userId, userId), eq(roles.status, 'enabled')));
  return { userId: row.id, username: row.username, roles: roleRows.map((r) => r.code), tenantId: row.tenantId ?? null };
}

// ─── 名称批量解析 ─────────────────────────────────────────────────────────────

export type NameMap = Map<number, string>;

export async function resolveUserNames(ids: Iterable<number | null | undefined>, executor: DbExecutor = db): Promise<NameMap> {
  const uniq = [...new Set([...ids].filter((id): id is number => typeof id === 'number'))];
  if (uniq.length === 0) return new Map();
  const rows = await executor.select({ id: users.id, nickname: users.nickname, username: users.username })
    .from(users).where(inArray(users.id, uniq));
  return new Map(rows.map((r) => [r.id, r.nickname || r.username]));
}

export function subjectKey(subjectType: DriveSubjectType, subjectId: number): string {
  return `${subjectType}:${subjectId}`;
}

/** 四类授权主体的展示名（用户昵称 / 部门名 / 角色名 / 用户组名） */
export async function resolveSubjectNames(
  subjects: Array<{ subjectType: DriveSubjectType; subjectId: number }>,
  executor: DbExecutor = db,
): Promise<Map<string, string>> {
  const byType: Record<DriveSubjectType, Set<number>> = { user: new Set(), department: new Set(), role: new Set(), user_group: new Set() };
  for (const s of subjects) byType[s.subjectType].add(s.subjectId);
  const [userRows, deptRows, roleRows, groupRows] = await Promise.all([
    byType.user.size ? executor.select({ id: users.id, nickname: users.nickname, username: users.username }).from(users).where(inArray(users.id, [...byType.user])) : Promise.resolve([]),
    byType.department.size ? executor.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, [...byType.department])) : Promise.resolve([]),
    byType.role.size ? executor.select({ id: roles.id, name: roles.name }).from(roles).where(inArray(roles.id, [...byType.role])) : Promise.resolve([]),
    byType.user_group.size ? executor.select({ id: userGroups.id, name: userGroups.name }).from(userGroups).where(inArray(userGroups.id, [...byType.user_group])) : Promise.resolve([]),
  ]);
  const map = new Map<string, string>();
  for (const r of userRows) map.set(subjectKey('user', r.id), r.nickname || r.username);
  for (const r of deptRows) map.set(subjectKey('department', r.id), r.name);
  for (const r of roleRows) map.set(subjectKey('role', r.id), r.name);
  for (const r of groupRows) map.set(subjectKey('user_group', r.id), r.name);
  return map;
}

// ─── 行 → DTO ─────────────────────────────────────────────────────────────────

export interface SpaceMapExtras {
  quotaBytes: number;
  ownerName?: string | null;
  departmentName?: string | null;
  myRole?: DriveRole | null;
  memberCount?: number;
  nodeCount?: number;
}

export function mapDriveSpace(row: DriveSpaceRow, extras: SpaceMapExtras): DriveSpace {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    description: row.description ?? null,
    icon: row.icon ?? null,
    ownerId: row.ownerId ?? null,
    ownerName: extras.ownerName ?? null,
    departmentId: row.departmentId ?? null,
    departmentName: extras.departmentName ?? null,
    defaultMemberRole: row.defaultMemberRole ?? null,
    quotaBytes: extras.quotaBytes,
    customQuotaBytes: row.quotaBytes ?? null,
    usedBytes: row.usedBytes,
    maxVersions: row.maxVersions ?? null,
    allowExternalShare: row.allowExternalShare,
    status: row.status,
    sort: row.sort,
    tenantId: row.tenantId ?? null,
    myRole: extras.myRole,
    memberCount: extras.memberCount,
    nodeCount: extras.nodeCount,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export interface NodeMapExtras {
  userNames?: NameMap;
  isStarred?: boolean;
  myRole?: DriveRole | null;
  tags?: DriveTag[];
  /** 已有可用缩略图产物（drive_node_renditions kind=thumbnail status=ready） */
  hasThumbnail?: boolean;
}

export function mapDriveNode(row: DriveNodeRow, extras: NodeMapExtras = {}): DriveNode {
  const names = extras.userNames;
  return {
    id: row.id,
    spaceId: row.spaceId,
    parentId: row.parentId ?? null,
    ancestorIds: row.ancestorIds ?? [],
    depth: row.depth,
    type: row.type,
    name: row.name,
    extension: row.extension ?? null,
    mimeType: row.mimeType ?? null,
    fileId: row.fileId ?? null,
    size: row.size,
    contentHash: row.contentHash ?? null,
    currentVersion: row.currentVersion,
    inheritPermissions: row.inheritPermissions,
    lockedBy: row.lockedBy ?? null,
    lockedByName: row.lockedBy ? names?.get(row.lockedBy) ?? null : null,
    lockedAt: formatNullableDateTime(row.lockedAt),
    lockExpiresAt: formatNullableDateTime(row.lockExpiresAt),
    thumbnailUrl: extras.hasThumbnail ? driveNodeThumbnailUrl(row.id) : null,
    url: row.type === 'file' ? driveNodeContentUrl(row.id) : null,
    deletedAt: formatNullableDateTime(row.deletedAt),
    deletedBy: row.deletedBy ?? null,
    deletedByName: row.deletedBy ? names?.get(row.deletedBy) ?? null : null,
    isStarred: extras.isStarred,
    myRole: extras.myRole,
    tags: extras.tags,
    createdBy: row.createdBy ?? null,
    createdByName: row.createdBy ? names?.get(row.createdBy) ?? null : null,
    updatedBy: row.updatedBy ?? null,
    updatedByName: row.updatedBy ? names?.get(row.updatedBy) ?? null : null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapDriveTag(row: DriveTagRow): DriveTag {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    color: row.color ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 收集一批节点行涉及的全部用户 id（创建 / 更新 / 锁定 / 删除人） */
export function collectNodeUserIds(rows: DriveNodeRow[]): number[] {
  const ids = new Set<number>();
  for (const r of rows) {
    for (const id of [r.createdBy, r.updatedBy, r.lockedBy, r.deletedBy]) if (typeof id === 'number') ids.add(id);
  }
  return [...ids];
}

/** 从文件名取小写扩展名（无点）；无扩展名返回 null */
export function extensionOf(name: string): string | null {
  const idx = name.lastIndexOf('.');
  if (idx <= 0 || idx === name.length - 1) return null;
  return name.slice(idx + 1).toLowerCase().slice(0, 32);
}

/** 生成「name (n).ext」形式的候选名 */
export function suffixedName(name: string, n: number): string {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return `${name} (${n})`;
  return `${name.slice(0, idx)} (${n})${name.slice(idx)}`;
}
