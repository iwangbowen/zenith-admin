import { HTTPException } from 'hono/http-exception';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import {
  DRIVE_SYNC_COPY_MAX_NODES,
  driveRoleAtLeast,
  type CopyDriveNodesInput,
  type CreateDriveFolderInput,
  type DriveBreadcrumb,
  type DriveCopyResult,
  type DriveNode,
  type DriveNodeDetail,
  type DriveNodeListResult,
  type DriveNodeType,
  type DriveRole,
  type DriveTag,
  type MoveDriveNodesInput,
} from '@zenith/shared/drive';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import {
  driveFileVersions,
  driveLegalHolds,
  driveNodePermissions,
  driveNodeProfiles,
  driveNodeRenditions,
  driveNodes,
  driveNodeStars,
  driveNodeTags,
  driveShareLinks,
  driveSpaces,
  driveTags,
  type DriveNodeRow,
  type DriveSpaceRow,
} from '../../db/schema';
import { currentUser, currentUserId } from '../../lib/context';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { releaseManagedFiles, retainManagedFiles } from '../files/file-gc.service';
import {
  attachNodeRoles,
  ensureNodeRole,
  ensureNodeRoleOnAll,
  ensureSpaceRole,
  loadDriveSubjects,
  managerSpaceIdsSubquery,
  resolveNodeRole,
  resolveNodeRoles,
  visibleNodeCondition,
  type DriveSubjectSet,
} from './drive-access.service';
import { childAclOf, ownAclOf } from './drive-acl';
import { collectNodeUserIds, extensionOf, mapDriveNode, mapDriveTag, resolveUserNames, suffixedName } from './drive-common';
import { assertRenameExtensionAllowed } from './drive-content-policy';
import { logDriveActivity } from './drive-activity.service';
import { assertNoLegalHold, heldRootIds, isNodeOnLegalHold } from './drive-governance.service';
import { ensureDriveSpaceExists, releaseSpaceQuota, reserveSpaceQuota } from './drive-spaces.service';
import { effectiveQuotaBytes, getDriveSettings, type DriveSettings } from './drive-settings.service';

/** 目录最大深度（含根级子项 = 1） */
export const DRIVE_MAX_DEPTH = 32;

const NAME_UNIQUE_MESSAGE = '同一目录下已存在同名文件或文件夹';
const NAME_UNIQUE_BY_CONSTRAINT = { drive_nodes_sibling_name_uq: NAME_UNIQUE_MESSAGE } as const;

// ─── 基础查询 ─────────────────────────────────────────────────────────────────

export async function ensureDriveNodeExists(id: number, opts: { allowDeleted?: boolean } = {}): Promise<DriveNodeRow> {
  const [row] = await db.select().from(driveNodes)
    .where(buildWhere(eq(driveNodes.id, id), tenantCondition(driveNodes, currentUser())))
    .limit(1);
  if (!row || (!opts.allowDeleted && row.deletedAt)) throw new HTTPException(404, { message: '文件或文件夹不存在' });
  return row;
}

export async function loadNodesByIds(ids: number[], opts: { allowDeleted?: boolean } = {}): Promise<DriveNodeRow[]> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return [];
  const rows = await db.select().from(driveNodes)
    .where(buildWhere(inArray(driveNodes.id, uniq), tenantCondition(driveNodes, currentUser()), opts.allowDeleted ? undefined : isNull(driveNodes.deletedAt)));
  if (rows.length !== uniq.length) throw new HTTPException(404, { message: '部分文件或文件夹不存在或已删除' });
  return rows;
}

export async function loadBreadcrumbs(node: Pick<DriveNodeRow, 'ancestorIds'>): Promise<DriveBreadcrumb[]> {
  if (node.ancestorIds.length === 0) return [];
  const rows = await db.select({ id: driveNodes.id, name: driveNodes.name }).from(driveNodes).where(inArray(driveNodes.id, node.ancestorIds));
  const map = new Map(rows.map((r) => [r.id, r.name]));
  return node.ancestorIds.filter((id) => map.has(id)).map((id) => ({ id, name: map.get(id)! }));
}

/** 节点行批量装饰为 DTO：用户名、收藏、标签、缩略图可用性 */
export async function decorateNodes(
  rows: DriveNodeRow[],
  roleMap?: Map<number, DriveRole | null>,
): Promise<DriveNode[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const uid = currentUserId();
  const [names, stars, tagRows, thumbs] = await Promise.all([
    resolveUserNames(collectNodeUserIds(rows)),
    db.select({ nodeId: driveNodeStars.nodeId }).from(driveNodeStars).where(and(eq(driveNodeStars.userId, uid), inArray(driveNodeStars.nodeId, ids))),
    db.select({ nodeId: driveNodeTags.nodeId, tag: driveTags }).from(driveNodeTags)
      .innerJoin(driveTags, eq(driveTags.id, driveNodeTags.tagId))
      .where(inArray(driveNodeTags.nodeId, ids)),
    db.select({ nodeId: driveNodeRenditions.nodeId }).from(driveNodeRenditions)
      .where(and(inArray(driveNodeRenditions.nodeId, ids), eq(driveNodeRenditions.kind, 'thumbnail'), eq(driveNodeRenditions.status, 'ready'))),
  ]);
  const starSet = new Set(stars.map((s) => s.nodeId));
  const thumbSet = new Set(thumbs.map((t) => t.nodeId));
  const tagMap = new Map<number, DriveTag[]>();
  for (const r of tagRows) {
    const list = tagMap.get(r.nodeId) ?? [];
    list.push(mapDriveTag(r.tag));
    tagMap.set(r.nodeId, list);
  }
  return rows.map((row) => mapDriveNode(row, {
    userNames: names,
    isStarred: starSet.has(row.id),
    myRole: roleMap?.get(row.id),
    tags: tagMap.get(row.id) ?? [],
    hasThumbnail: thumbSet.has(row.id),
  }));
}

/** 单节点 DTO（附带角色） */
export async function decorateNode(row: DriveNodeRow, role: DriveRole | null | undefined): Promise<DriveNode> {
  const [node] = await decorateNodes([row], new Map([[row.id, role ?? null]]));
  return node;
}

// ─── 目录列表 ─────────────────────────────────────────────────────────────────

export interface ListDriveNodesQuery {
  spaceId?: number;
  tagId?: number;
  parentId?: number;
  keyword?: string;
  type?: DriveNodeType;
  sortBy?: 'name' | 'size' | 'updatedAt' | 'createdAt';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

function sortColumn(sortBy: ListDriveNodesQuery['sortBy']) {
  switch (sortBy) {
    case 'size': return driveNodes.size;
    case 'updatedAt': return driveNodes.updatedAt;
    case 'createdAt': return driveNodes.createdAt;
    default: return sql`lower(${driveNodes.name})`;
  }
}

/** 定位当前目录：返回空间、父节点（根级为 null）与当前用户在该目录的角色 */
async function resolveDirectory(spaceId: number | undefined, parentId: number | undefined) {
  if (parentId !== undefined) {
    const parent = await ensureDriveNodeExists(parentId);
    if (parent.type !== 'folder') throw new HTTPException(400, { message: '目标不是文件夹' });
    const space = await ensureDriveSpaceExists(parent.spaceId);
    const role = await resolveNodeRole(parent);
    if (!driveRoleAtLeast(role, 'viewer')) throw new HTTPException(403, { message: '没有该文件夹的访问权限' });
    return { space, parent, role };
  }
  if (spaceId === undefined) throw new HTTPException(400, { message: '缺少 spaceId 或 parentId' });
  const space = await ensureDriveSpaceExists(spaceId);
  const role = await ensureSpaceRole(space, 'viewer');
  return { space, parent: null, role };
}

export async function listDriveNodes(q: ListDriveNodesQuery): Promise<DriveNodeListResult> {
  const { page = 1, pageSize = 50 } = q;
  const { space, parent, role } = await resolveDirectory(q.spaceId, q.parentId);
  const subjects = await loadDriveSubjects();
  const where = buildWhere(
    eq(driveNodes.spaceId, space.id),
    parent ? eq(driveNodes.parentId, parent.id) : isNull(driveNodes.parentId),
    isNull(driveNodes.deletedAt),
    q.type ? eq(driveNodes.type, q.type) : undefined,
    keywordCondition(q.keyword, [driveNodes.name], 'ilike'),
    q.tagId ? inArray(driveNodes.id, db.select({ id: driveNodeTags.nodeId }).from(driveNodeTags).where(eq(driveNodeTags.tagId, q.tagId))) : undefined,
    // 精确可见性：断开继承且未授权的子文件夹不进 total 也不进页
    visibleNodeCondition(subjects),
  );
  const direction = q.order === 'desc' ? desc : asc;
  const [total, rows] = await Promise.all([
    db.$count(driveNodes, where),
    withPagination(
      db.select().from(driveNodes).where(where)
        .orderBy(sql`case when ${driveNodes.type} = 'folder' then 0 else 1 end`, direction(sortColumn(q.sortBy)), asc(driveNodes.id))
        .$dynamic(),
      page,
      pageSize,
    ),
  ]);
  const withRoles = await attachNodeRoles(rows, subjects);
  const roleMap = new Map(withRoles.map((r) => [r.id, r.myRole]));
  const settings = await getDriveSettings();
  const [list, breadcrumbs, parentNames] = await Promise.all([
    decorateNodes(rows, roleMap),
    parent ? loadBreadcrumbs(parent) : Promise.resolve([]),
    parent ? resolveUserNames(collectNodeUserIds([parent])) : Promise.resolve(new Map<number, string>()),
  ]);
  return {
    list,
    total,
    page,
    pageSize,
    space: {
      id: space.id, name: space.name, type: space.type,
      quotaBytes: effectiveQuotaBytes(settings, space), usedBytes: space.usedBytes, allowExternalShare: space.allowExternalShare,
    },
    parent: parent ? mapDriveNode(parent, { userNames: parentNames, myRole: role }) : null,
    breadcrumbs: parent ? [...breadcrumbs, { id: parent.id, name: parent.name }] : [],
    myRole: role,
  };
}

export async function getDriveNodeDetail(id: number): Promise<DriveNodeDetail> {
  const row = await ensureDriveNodeExists(id, { allowDeleted: true });
  const role = await ensureNodeRole(row, 'viewer', '没有该文件的访问权限');
  const [space] = await db.select().from(driveSpaces).where(eq(driveSpaces.id, row.spaceId)).limit(1);
  const [node, breadcrumbs, versionCount, shareLinkCount, childCount, legalHold] = await Promise.all([
    decorateNode(row, role),
    loadBreadcrumbs(row),
    db.$count(driveFileVersions, eq(driveFileVersions.nodeId, id)),
    db.$count(driveShareLinks, and(eq(driveShareLinks.nodeId, id), isNull(driveShareLinks.revokedAt))),
    row.type === 'folder' ? db.$count(driveNodes, and(eq(driveNodes.parentId, id), isNull(driveNodes.deletedAt))) : Promise.resolve(0),
    isNodeOnLegalHold(row),
  ]);
  return {
    ...node,
    spaceName: space?.name ?? '',
    spaceType: space?.type ?? 'personal',
    breadcrumbs,
    versionCount,
    shareLinkCount,
    childCount,
    legalHold,
    spaceArchived: !!space?.archivedAt,
  };
}

// ─── 新建 / 重命名 ────────────────────────────────────────────────────────────

/** 解析写入目标目录并校验 editor 权限 */
export async function resolveWritableParent(spaceId: number, parentId: number | null) {
  const space = await ensureDriveSpaceExists(spaceId);
  if (space.status !== 'enabled') throw new HTTPException(400, { message: '空间已停用' });
  if (parentId === null) {
    const role = await ensureSpaceRole(space, 'editor');
    return { space, parent: null as DriveNodeRow | null, ancestorIds: [] as number[], role };
  }
  const parent = await ensureDriveNodeExists(parentId);
  if (parent.type !== 'folder') throw new HTTPException(400, { message: '目标不是文件夹' });
  if (parent.spaceId !== space.id) throw new HTTPException(400, { message: '目标文件夹不属于该空间' });
  const role = await ensureNodeRole(parent, 'editor', '没有该文件夹的写入权限');
  const ancestorIds = [...parent.ancestorIds, parent.id];
  if (ancestorIds.length >= DRIVE_MAX_DEPTH) throw new HTTPException(400, { message: `目录层级不能超过 ${DRIVE_MAX_DEPTH} 层` });
  return { space, parent, ancestorIds, role };
}

export async function createDriveFolder(data: CreateDriveFolderInput): Promise<DriveNode> {
  const { space, parent, ancestorIds, role } = await resolveWritableParent(data.spaceId, data.parentId);
  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(driveNodes).values({
        spaceId: space.id,
        parentId: data.parentId,
        ancestorIds,
        depth: ancestorIds.length,
        ...childAclOf(parent),
        type: 'folder',
        name: data.name,
        tenantId: getCreateTenantId(currentUser()),
      }).returning();
      await logDriveActivity({ spaceId: space.id, nodeId: created.id, nodeName: created.name, nodeType: 'folder', action: 'create_folder' }, tx);
      return created;
    });
    return decorateNode(row, role);
  } catch (err) {
    return rethrowPgUniqueViolation(err, NAME_UNIQUE_MESSAGE, NAME_UNIQUE_BY_CONSTRAINT);
  }

}

export async function renameDriveNode(id: number, name: string): Promise<DriveNode> {
  const before = await ensureDriveNodeExists(id);
  const role = await ensureNodeRole(before, 'editor', '没有该文件的编辑权限');
  assertNotLockedByOthers(before);
  if (before.name === name) return decorateNode(before, role);
  if (before.type === 'file') await assertRenameExtensionAllowed(name);
  try {
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(driveNodes)
        .set({ name, extension: before.type === 'file' ? extensionOf(name) : null })
        .where(eq(driveNodes.id, id)).returning();
      await logDriveActivity({ spaceId: before.spaceId, nodeId: id, nodeName: name, nodeType: before.type, action: 'rename', detail: { from: before.name, to: name } }, tx);
      return updated;
    });
    return decorateNode(row, role);
  } catch (err) {
    return rethrowPgUniqueViolation(err, NAME_UNIQUE_MESSAGE, NAME_UNIQUE_BY_CONSTRAINT);
  }
}

/** 被他人签出锁定的文件不可改名 / 移动 / 覆盖 / 删除 */
export function assertNotLockedByOthers(node: Pick<DriveNodeRow, 'lockedBy' | 'lockExpiresAt' | 'name'>) {
  if (!node.lockedBy) return;
  if (node.lockExpiresAt && node.lockExpiresAt.getTime() <= Date.now()) return;
  if (node.lockedBy !== currentUserId()) throw new HTTPException(423, { message: `「${node.name}」已被他人签出锁定` });
}

/** 子树内（含根）存在被他人有效锁定的文件时拒绝移动 / 删除整棵子树 */
export async function assertSubtreeNotLockedByOthers(roots: DriveNodeRow[]) {
  roots.forEach(assertNotLockedByOthers);
  const folderIds = roots.filter((r) => r.type === 'folder').map((r) => r.id);
  if (folderIds.length === 0) return;
  const [locked] = await db.select({ name: driveNodes.name }).from(driveNodes).where(and(
    sql`${driveNodes.ancestorIds} && ARRAY[${sql.join(folderIds.map((id) => sql`${id}`), sql`, `)}]::integer[]`,
    isNull(driveNodes.deletedAt),
    isNotNull(driveNodes.lockedBy),
    sql`${driveNodes.lockedBy} <> ${currentUserId()}`,
    sql`(${driveNodes.lockExpiresAt} is null or ${driveNodes.lockExpiresAt} > now())`,
  )).limit(1);
  if (locked) throw new HTTPException(423, { message: `子目录中的「${locked.name}」已被他人签出锁定` });
}

// ─── 子树加载（含 ACL 裁剪）───────────────────────────────────────────────────

/** 加载子树（含根，未删除），按深度升序 */
export async function loadSubtree(executor: DbExecutor, rootId: number, opts: { includeDeleted?: boolean; where?: SQL } = {}): Promise<DriveNodeRow[]> {
  return executor.select().from(driveNodes).where(and(
    sql`(${driveNodes.id} = ${rootId} OR ${driveNodes.ancestorIds} @> ARRAY[${rootId}]::integer[])`,
    opts.includeDeleted ? undefined : isNull(driveNodes.deletedAt),
    opts.where,
  )).orderBy(asc(driveNodes.depth), asc(driveNodes.id));
}

/**
 * 按主体视角加载可访问子树：SQL 精确过滤角色 ≥ minRole 的节点，
 * 再剪掉父节点不可达的"悬空"后代（不允许穿过不可见文件夹拿到里面的文件）。
 * 根节点自身不可达时返回空数组。
 */
export async function loadAccessibleSubtree(rootId: number, minRole: DriveRole, subjects: DriveSubjectSet, executor: DbExecutor = db): Promise<DriveNodeRow[]> {
  const rows = await loadSubtree(executor, rootId, { where: visibleNodeCondition(subjects, minRole) });
  const reachable = new Set<number>();
  const result: DriveNodeRow[] = [];
  for (const row of rows) {
    if (row.id === rootId || (row.parentId !== null && reachable.has(row.parentId))) {
      reachable.add(row.id);
      result.push(row);
    }
  }
  return result;
}

// ─── 移动 / 复制 ──────────────────────────────────────────────────────────────

export async function moveDriveNodes(data: MoveDriveNodesInput): Promise<number> {
  const selected = await loadNodesByIds(data.ids);
  const selectedIds = new Set(selected.map((row) => row.id));
  const rows = selected.filter((row) => !row.ancestorIds.some((id) => selectedIds.has(id)));
  await ensureNodeRoleOnAll(rows, 'editor', '没有移动权限');
  await assertSubtreeNotLockedByOthers(rows);
  const { space, parent, ancestorIds: newAnc } = await resolveWritableParent(data.targetSpaceId, data.targetParentId);
  for (const row of rows) {
    if (row.tenantId !== space.tenantId) throw new HTTPException(400, { message: '不能跨租户移动文件' });
    if (parent && (parent.id === row.id || parent.ancestorIds.includes(row.id))) {
      throw new HTTPException(400, { message: `不能把「${row.name}」移动到自身或其子目录` });
    }
  }
  const targetParentId = parent?.id ?? null;
  const moving = rows.filter((r) => r.spaceId !== space.id || (r.parentId ?? null) !== targetParentId);
  if (moving.length === 0) return 0;
  // 法律保留：冻结的子树不允许离开所在空间（空间内移动不受影响）
  await assertNoLegalHold(db, moving.filter((r) => r.spaceId !== space.id), '跨空间移动');
  const subjects = await loadDriveSubjects();
  const settings = await getDriveSettings();
  try {
    await db.transaction(async (tx) => {
      for (const row of moving) {
        if (row.spaceId === space.id) {
          await relocateSubtree(tx, row, parent, newAnc);
        } else {
          const subtree = await loadSubtree(tx, row.id, { includeDeleted: true });
          const roles = await resolveNodeRoles(subtree, subjects, tx);
          for (const child of subtree) {
            if (!driveRoleAtLeast(roles.get(child.id)?.role, 'editor')) throw new HTTPException(403, { message: `没有移动子项「${child.name}」的权限` });
          }
          await transferDriveSubtree(tx, row, space, parent, settings);
        }
        await logDriveActivity({
          spaceId: space.id, nodeId: row.id, nodeName: row.name, nodeType: row.type, action: 'move',
          detail: { fromSpaceId: row.spaceId, toSpaceId: space.id, fromParentId: row.parentId ?? null, toParentId: targetParentId },
        }, tx);
      }
    });
  } catch (err) {
    rethrowPgUniqueViolation(err, '目标目录中已存在同名文件或文件夹', NAME_UNIQUE_BY_CONSTRAINT);
  }
  return moving.length;
}

export async function transferDriveSubtree(executor: DbExecutor, root: DriveNodeRow, target: DriveSpaceRow, parent: DriveNodeRow | null, settings: DriveSettings): Promise<void> {
  if (root.tenantId !== target.tenantId) throw new HTTPException(400, { message: '不能跨租户交接文件' });
  const subtree = await loadSubtree(executor, root.id, { includeDeleted: true });
  const ids = subtree.map((node) => node.id);
  if (!ids.length) throw new HTTPException(404, { message: '待移动文件不存在' });
  const ancestorIds = parent ? [...parent.ancestorIds, parent.id] : [];
  if (subtree.some((node) => node.depth - root.depth + ancestorIds.length >= DRIVE_MAX_DEPTH)) {
    throw new HTTPException(400, { message: '移动后目录超过最大层级' });
  }
  const versions = await executor.select({ size: driveFileVersions.size }).from(driveFileVersions).where(inArray(driveFileVersions.nodeId, ids));
  const bytes = versions.reduce((sum, version) => sum + version.size, 0);
  await reserveSpaceQuota(executor, target.id, bytes, settings);
  await releaseSpaceQuota(executor, root.spaceId, bytes);
  const tagLinks = await executor.select({ nodeId: driveNodeTags.nodeId, tag: driveTags }).from(driveNodeTags)
    .innerJoin(driveTags, eq(driveTags.id, driveNodeTags.tagId)).where(inArray(driveNodeTags.nodeId, ids));
  const tagMap = new Map<number, number>();
  for (const { tag } of tagLinks) {
    if (tagMap.has(tag.id)) continue;
    let [destination] = await executor.select().from(driveTags).where(and(eq(driveTags.spaceId, target.id), eq(driveTags.name, tag.name))).limit(1);
    if (!destination) {
      [destination] = await executor.insert(driveTags).values({ spaceId: target.id, name: tag.name, color: tag.color, tenantId: target.tenantId }).onConflictDoNothing().returning();
      if (!destination) [destination] = await executor.select().from(driveTags).where(and(eq(driveTags.spaceId, target.id), eq(driveTags.name, tag.name))).limit(1);
    }
    if (!destination) throw new HTTPException(409, { message: '目标标签发生变化，请重试' });
    tagMap.set(tag.id, destination.id);
  }
  await executor.delete(driveNodeTags).where(inArray(driveNodeTags.nodeId, ids));
  if (tagLinks.length) await executor.insert(driveNodeTags).values(tagLinks.map((link) => ({ nodeId: link.nodeId, tagId: tagMap.get(link.tag.id)! }))).onConflictDoNothing();
  await executor.delete(driveNodePermissions).where(inArray(driveNodePermissions.nodeId, ids));
  await executor.update(driveShareLinks).set({ enabled: false, revokedAt: new Date(), sessionVersion: sql`${driveShareLinks.sessionVersion} + 1` })
    .where(inArray(driveShareLinks.nodeId, ids));
  const acl = childAclOf(parent);
  await executor.update(driveNodes).set({
    spaceId: target.id, tenantId: target.tenantId,
    parentId: sql`case when ${driveNodes.id} = ${root.id} then ${parent?.id ?? null}::integer else ${driveNodes.parentId} end`,
    ancestorIds: sql`${intArray(ancestorIds)} || ${driveNodes.ancestorIds}[${root.depth + 1}:]`,
    depth: sql`${driveNodes.depth} + ${ancestorIds.length - root.depth}`,
    inheritPermissions: true, aclOpen: acl.aclOpen,
    aclChainIds: sql`${intArray(acl.aclChainIds)} || ${driveNodes.ancestorIds}[${root.depth + 1}:]`,
  }).where(inArray(driveNodes.id, ids));
  // 空间交接允许带着法律保留一起迁移（证据不丢失），保留记录跟随到目标空间
  await executor.update(driveLegalHolds).set({ spaceId: target.id }).where(inArray(driveLegalHolds.nodeId, ids));
}

function intArray(ids: number[]): SQL {
  return ids.length ? sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::integer[]` : sql`'{}'::integer[]`;
}

/**
 * 把节点及其子树挂到新父目录下：重写子树 ancestorIds / depth，并同步 ACL 生效链。
 * - 根：chain/open 按新父节点重算（自身断开继承时保持空链）；
 * - 后代：只有"根仍在其生效链上"（即断点不在根以下）的后代需要把根之前的前缀替换为新前缀；
 *   断点位于根以下的后代不受影响。
 */
export async function relocateSubtree(executor: DbExecutor, node: DriveNodeRow, targetParent: DriveNodeRow | null, newAnc: number[]) {
  const oldDepth = node.ancestorIds.length;
  const delta = newAnc.length - oldDepth;
  if (newAnc.length + 1 > DRIVE_MAX_DEPTH) throw new HTTPException(400, { message: `目录层级不能超过 ${DRIVE_MAX_DEPTH} 层` });
  const rootAcl = ownAclOf(node.inheritPermissions, targetParent);
  await executor.update(driveNodes)
    .set({ parentId: targetParent?.id ?? null, ancestorIds: newAnc, depth: newAnc.length, aclChainIds: rootAcl.aclChainIds, aclOpen: rootAcl.aclOpen })
    .where(eq(driveNodes.id, node.id));
  await executor.execute(sql`
    UPDATE ${driveNodes}
    SET ancestor_ids = ${intArray(newAnc)} || ancestor_ids[${oldDepth + 1}:],
        depth = depth + ${delta}
    WHERE ancestor_ids @> ARRAY[${node.id}]::integer[]
  `);
  if (node.inheritPermissions) {
    // 后代生效链含根 ⇒ 根之前的前缀来自旧祖先，替换为新前缀；open 取根的新 open
    await executor.execute(sql`
      UPDATE ${driveNodes}
      SET acl_chain_ids = ${intArray(rootAcl.aclChainIds)} || acl_chain_ids[array_position(acl_chain_ids, ${node.id}):],
          acl_open = ${rootAcl.aclOpen}
      WHERE ancestor_ids @> ARRAY[${node.id}]::integer[] AND acl_chain_ids @> ARRAY[${node.id}]::integer[]
    `);
  }
}

/** 目标目录下已占用的名称（小写） */
export async function existingNamesIn(executor: DbExecutor, spaceId: number, parentId: number | null): Promise<Set<string>> {
  const rows = await executor.select({ name: driveNodes.name }).from(driveNodes).where(and(
    eq(driveNodes.spaceId, spaceId),
    parentId === null ? isNull(driveNodes.parentId) : eq(driveNodes.parentId, parentId),
    isNull(driveNodes.deletedAt),
  ));
  return new Set(rows.map((r) => r.name.toLowerCase()));
}

export function pickFreeName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 1; n < 1000; n++) {
    const candidate = suffixedName(name, n);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  throw new HTTPException(400, { message: '无法生成不重复的名称' });
}

export async function copyDriveNodes(data: CopyDriveNodesInput): Promise<DriveCopyResult> {
  const rows = await loadNodesByIds(data.ids);
  await ensureNodeRoleOnAll(rows, 'downloader', '没有复制权限');
  const { space, parent, ancestorIds: newAnc } = await resolveWritableParent(data.targetSpaceId, data.targetParentId);
  for (const row of rows) {
    if (parent && (parent.id === row.id || parent.ancestorIds.includes(row.id))) {
      throw new HTTPException(400, { message: `不能把「${row.name}」复制到自身或其子目录` });
    }
  }
  // 子树按当前用户视角裁剪：断开继承且未授权的子目录不会随复制"越权带出"
  const subjects = await loadDriveSubjects();
  const subtrees = await Promise.all(rows.map((r) => loadAccessibleSubtree(r.id, 'downloader', subjects)));
  const totalNodes = subtrees.reduce((n, s) => n + s.length, 0);
  if (totalNodes > DRIVE_SYNC_COPY_MAX_NODES) {
    const { submitAsyncTask } = await import('../../lib/task-center');
    const task = await submitAsyncTask({
      taskType: 'drive-copy-subtree',
      title: `复制 ${rows.length} 个项目（共 ${totalNodes} 个节点）到「${parent?.name ?? space.name}」`,
      payload: { ids: rows.map((r) => r.id), targetSpaceId: space.id, targetParentId: parent?.id ?? null },
    });
    return { mode: 'task', taskId: task.id, copied: 0 };
  }
  const settings = await getDriveSettings();
  const copied = await db.transaction(async (tx) => {
    let count = 0;
    for (const subtree of subtrees) {
      count += await copySubtree(tx, subtree, space, parent, newAnc, settings);
    }
    return count;
  });
  return { mode: 'sync', taskId: null, copied };
}

/**
 * 复制一棵（已裁剪的）子树到目标目录：元数据复制 + fileId 引用（对象引用计数 +1，不复制对象）。
 * 事务内执行；根节点同名自动加后缀；复制件不携带授权、继承默认开启。返回复制的节点数。
 * settings 由调用方在开启事务之前读取传入（事务内不得触发设置冷加载）。
 */
export async function copySubtree(
  executor: DbExecutor,
  subtree: DriveNodeRow[],
  targetSpace: DriveSpaceRow,
  targetParent: DriveNodeRow | null,
  targetAnc: number[],
  settings: DriveSettings,
): Promise<number> {
  if (subtree.length === 0) return 0;
  const root = subtree[0];
  const totalBytes = subtree.filter((n) => n.type === 'file').reduce((s, n) => s + n.size, 0);
  await reserveSpaceQuota(executor, targetSpace.id, totalBytes, settings);
  const taken = await existingNamesIn(executor, targetSpace.id, targetParent?.id ?? null);
  const rootName = pickFreeName(root.name, taken);
  const tenantId = getCreateTenantId(currentUser());
  const idMap = new Map<number, number>();
  const createdRows = new Map<number, DriveNodeRow>();
  const sourceProfiles = await executor.select().from(driveNodeProfiles).where(inArray(driveNodeProfiles.nodeId, subtree.map((node) => node.id)));
  const profiles = new Map(sourceProfiles.map((profile) => [profile.nodeId, profile]));
  const retained: string[] = [];
  for (const node of subtree) {
    const isRoot = node.id === root.id;
    const newParent = isRoot ? targetParent : createdRows.get(node.parentId!) ?? null;
    if (!isRoot && !newParent) continue; // 父节点未复制（已被 ACL 裁剪）
    const anc = isRoot ? targetAnc : [...newParent!.ancestorIds, newParent!.id];
    if (anc.length + 1 > DRIVE_MAX_DEPTH) throw new HTTPException(400, { message: `目录层级不能超过 ${DRIVE_MAX_DEPTH} 层` });
    const [created] = await executor.insert(driveNodes).values({
      spaceId: targetSpace.id,
      parentId: newParent?.id ?? null,
      ancestorIds: anc,
      depth: anc.length,
      ...childAclOf(newParent),
      type: node.type,
      name: isRoot ? rootName : node.name,
      extension: node.extension,
      mimeType: node.mimeType,
      fileId: node.fileId,
      size: node.size,
      contentHash: node.contentHash,
      currentVersion: 1,
      tenantId,
    }).returning();
    idMap.set(node.id, created.id);
    createdRows.set(node.id, created);
    const profile = profiles.get(node.id);
    if (profile) await executor.insert(driveNodeProfiles).values({ nodeId: created.id, description: profile.description, metadata: profile.metadata });
    if (node.type === 'file' && node.fileId) {
      await executor.insert(driveFileVersions).values({
        nodeId: created.id, version: 1, fileId: node.fileId, size: node.size, contentHash: node.contentHash,
        comment: '复制自其他位置', authorId: currentUserId(),
      });
      retained.push(node.fileId);
    }
  }
  await retainManagedFiles(executor, retained);
  await logDriveActivity({
    spaceId: targetSpace.id, nodeId: idMap.get(root.id) ?? null, nodeName: rootName, nodeType: root.type, action: 'copy',
    detail: { sourceNodeId: root.id, sourceSpaceId: root.spaceId, nodes: idMap.size },
  }, executor);
  return idMap.size;
}

// ─── 删除 / 回收站 ────────────────────────────────────────────────────────────

export async function deleteDriveNodes(ids: number[]): Promise<number> {
  const rows = await loadNodesByIds(ids);
  await ensureNodeRoleOnAll(rows, 'editor', '没有删除权限');
  await assertSubtreeNotLockedByOthers(rows);
  await assertNoLegalHold(db, rows, '删除');
  const uid = currentUserId();
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx.update(driveNodes)
        .set({ deletedAt: now, deletedBy: uid, deletedRootId: row.id })
        .where(and(
          sql`(${driveNodes.id} = ${row.id} OR ${driveNodes.ancestorIds} @> ARRAY[${row.id}]::integer[])`,
          isNull(driveNodes.deletedAt),
        ));
      await logDriveActivity({ spaceId: row.spaceId, nodeId: row.id, nodeName: row.name, nodeType: row.type, action: 'delete' }, tx);
    }
  });
  return rows.length;
}

export interface ListRecycleQuery {
  page?: number;
  pageSize?: number;
  spaceId?: number;
  keyword?: string;
  type?: DriveNodeType;
}

/** 回收站可见范围（SQL）：我删除的 ∪ 我是 manager 的空间；网盘管理员全部 */
async function recycleVisibilityCondition(): Promise<SQL | undefined> {
  const subjects = await loadDriveSubjects();
  if (subjects.isAdmin) return undefined;
  return sql`(${driveNodes.deletedBy} = ${subjects.userId} OR ${inArray(driveNodes.spaceId, managerSpaceIdsSubquery(subjects))})`;
}

export async function listRecycleNodes(q: ListRecycleQuery) {
  const { page = 1, pageSize = 20 } = q;
  const where = buildWhere(
    isNotNull(driveNodes.deletedAt),
    sql`${driveNodes.deletedRootId} = ${driveNodes.id}`,
    q.spaceId !== undefined ? eq(driveNodes.spaceId, q.spaceId) : undefined,
    q.type ? eq(driveNodes.type, q.type) : undefined,
    keywordCondition(q.keyword, [driveNodes.name], 'ilike'),
    tenantCondition(driveNodes, currentUser()),
    await recycleVisibilityCondition(),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(driveNodes, where),
    rows: async () => {
      const rows = await withPagination(db.select().from(driveNodes).where(where).orderBy(desc(driveNodes.deletedAt), asc(driveNodes.id)).$dynamic(), page, pageSize);
      const spaceRows = rows.length ? await db.select({ id: driveSpaces.id, name: driveSpaces.name }).from(driveSpaces).where(inArray(driveSpaces.id, [...new Set(rows.map((r) => r.spaceId))])) : [];
      const spaceNames = new Map(spaceRows.map((s) => [s.id, s.name]));
      const list = await decorateNodes(rows);
      return list.map((n) => ({ ...n, spaceName: spaceNames.get(n.spaceId) ?? '' }));
    },
  });
}

async function loadRecycleRoots(ids: number[]): Promise<DriveNodeRow[]> {
  const rows = await loadNodesByIds(ids, { allowDeleted: true });
  const bad = rows.find((r) => !r.deletedAt || r.deletedRootId !== r.id);
  if (bad) throw new HTTPException(400, { message: `「${bad.name}」不是回收站中的项目` });
  return rows;
}

async function ensureRecycleOperable(rows: DriveNodeRow[], minRole: DriveRole) {
  const subjects = await loadDriveSubjects();
  if (subjects.isAdmin) return;
  const roleMap = await resolveNodeRoles(rows);
  for (const row of rows) {
    const own = row.deletedBy === subjects.userId;
    if (!own && !driveRoleAtLeast(roleMap.get(row.id)?.role, minRole)) {
      throw new HTTPException(403, { message: `没有操作「${row.name}」的权限` });
    }
  }
}

export async function restoreDriveNodes(ids: number[]): Promise<number> {
  const roots = await loadRecycleRoots(ids);
  await ensureRecycleOperable(roots, 'editor');
  await db.transaction(async (tx) => {
    for (const root of roots) {
      // 原父目录仍可用则原位还原，否则回到空间根级
      let parent: DriveNodeRow | null = null;
      let relocate = root.parentId === null && root.ancestorIds.length > 0;
      if (root.parentId !== null) {
        const [row] = await tx.select().from(driveNodes).where(eq(driveNodes.id, root.parentId)).limit(1);
        if (row && !row.deletedAt && row.type === 'folder') parent = row;
        else relocate = true;
      }
      const parentId = parent?.id ?? null;
      const taken = await existingNamesIn(tx, root.spaceId, parentId);
      const name = pickFreeName(root.name, taken);
      // 先恢复子树的删除标记，再统一挂载（relocateSubtree 按 ancestorIds 定位后代）
      await tx.update(driveNodes)
        .set({ deletedAt: null, deletedBy: null, deletedRootId: null })
        .where(eq(driveNodes.deletedRootId, root.id));
      if (name !== root.name) await tx.update(driveNodes).set({ name }).where(eq(driveNodes.id, root.id));
      if (relocate) await relocateSubtree(tx, root, null, []);
      await logDriveActivity({ spaceId: root.spaceId, nodeId: root.id, nodeName: name, nodeType: root.type, action: 'restore' }, tx);
    }
  });
  return roots.length;
}

export async function purgeDriveNodes(ids: number[]): Promise<number> {
  const roots = await loadRecycleRoots(ids);
  await ensureRecycleOperable(roots, 'manager');
  await assertNoLegalHold(db, roots, '彻底删除');
  return purgeSubtrees(roots);
}

/** 剔除被法律保留覆盖的根（自动清理 / 清空回收站静默跳过，不报错） */
async function withoutHeldRoots(roots: DriveNodeRow[]): Promise<DriveNodeRow[]> {
  if (roots.length === 0) return roots;
  const held = await heldRootIds(db, roots);
  return held.size ? roots.filter((r) => !held.has(r.id)) : roots;
}

/** 彻底删除若干子树：删行、释放配额、对象引用计数 -1（真正回收由 files-gc 延迟执行） */
export async function purgeSubtrees(roots: DriveNodeRow[]): Promise<number> {
  let purged = 0;
  for (const root of roots) {
    await db.transaction(async (tx) => {
      const subtree = await loadSubtree(tx, root.id, { includeDeleted: true });
      const nodeIds = subtree.map((n) => n.id);
      if (nodeIds.length === 0) return;
      const [versions, renditions] = await Promise.all([
        tx.select({ fileId: driveFileVersions.fileId, size: driveFileVersions.size }).from(driveFileVersions).where(inArray(driveFileVersions.nodeId, nodeIds)),
        tx.select({ fileId: driveNodeRenditions.fileId }).from(driveNodeRenditions).where(and(inArray(driveNodeRenditions.nodeId, nodeIds), isNotNull(driveNodeRenditions.fileId))),
      ]);
      const bytes = versions.reduce((s, v) => s + v.size, 0);
      await tx.delete(driveNodes).where(inArray(driveNodes.id, nodeIds));
      await releaseManagedFiles(tx, [...versions.map((v) => v.fileId), ...renditions.map((r) => r.fileId)]);
      await releaseSpaceQuota(tx, root.spaceId, bytes);
      await logDriveActivity({ spaceId: root.spaceId, nodeId: null, nodeName: root.name, nodeType: root.type, action: 'purge', detail: { nodes: nodeIds.length, bytes }, tenantId: root.tenantId ?? null }, tx);
      purged += nodeIds.length;
    });
  }
  return purged;
}

export async function emptyRecycle(spaceId?: number): Promise<number> {
  const where = buildWhere(
    isNotNull(driveNodes.deletedAt),
    sql`${driveNodes.deletedRootId} = ${driveNodes.id}`,
    spaceId !== undefined ? eq(driveNodes.spaceId, spaceId) : undefined,
    tenantCondition(driveNodes, currentUser()),
    await recycleVisibilityCondition(),
  );
  const roots = await db.select().from(driveNodes).where(where);
  await ensureRecycleOperable(roots, 'manager');
  return purgeSubtrees(await withoutHeldRoots(roots));
}

/** 保留策略：清理超过保留天数的回收站项目（无请求上下文，跳过权限；法律保留项跳过） */
export async function purgeExpiredRecycleNodes(days: number): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const roots = await db.select().from(driveNodes).where(and(
    isNotNull(driveNodes.deletedAt),
    sql`${driveNodes.deletedRootId} = ${driveNodes.id}`,
    lt(driveNodes.deletedAt, cutoff),
  )).limit(500);
  if (roots.length === 0) return 0;
  return purgeSubtrees(await withoutHeldRoots(roots));
}

export async function countExpiredRecycleNodes(days: number): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  return db.$count(driveNodes, and(
    isNotNull(driveNodes.deletedAt),
    sql`${driveNodes.deletedRootId} = ${driveNodes.id}`,
    lt(driveNodes.deletedAt, cutoff),
  ));
}

// ─── 继承切换的 ACL 链维护（由 drive-permissions.service 调用）────────────────

/**
 * 切换节点继承开关后重算其自身与后代的 ACL 生效链：
 * - 关闭：自身链清空、open=false；后代中"链上含本节点"者把本节点之前的前缀截掉并 open=false；
 * - 开启：自身链按父节点重算；后代中"链以本节点开头"（本节点曾是断点）者把新前缀接回并 open 取本节点的 open。
 */
export async function rewriteAclAfterInheritChange(executor: DbExecutor, node: DriveNodeRow, inherit: boolean) {
  const parent = node.parentId
    ? (await executor.select().from(driveNodes).where(eq(driveNodes.id, node.parentId)).limit(1))[0] ?? null
    : null;
  const own = ownAclOf(inherit, parent);
  await executor.update(driveNodes)
    .set({ inheritPermissions: inherit, aclChainIds: own.aclChainIds, aclOpen: own.aclOpen })
    .where(eq(driveNodes.id, node.id));
  if (!inherit) {
    await executor.execute(sql`
      UPDATE ${driveNodes}
      SET acl_chain_ids = acl_chain_ids[array_position(acl_chain_ids, ${node.id}):],
          acl_open = false
      WHERE ancestor_ids @> ARRAY[${node.id}]::integer[] AND acl_chain_ids @> ARRAY[${node.id}]::integer[]
    `);
  } else {
    await executor.execute(sql`
      UPDATE ${driveNodes}
      SET acl_chain_ids = ${intArray(own.aclChainIds)} || acl_chain_ids,
          acl_open = ${own.aclOpen}
      WHERE ancestor_ids @> ARRAY[${node.id}]::integer[] AND acl_chain_ids[1] = ${node.id}
    `);
  }
}
