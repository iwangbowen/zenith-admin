import { HTTPException } from 'hono/http-exception';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
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
  driveNodes,
  driveNodeStars,
  driveNodeTags,
  driveShareLinks,
  driveSpaces,
  driveTags,
  managedFiles,
  type DriveNodeRow,
  type DriveSpaceRow,
} from '../../db/schema';
import { currentUser, currentUserId } from '../../lib/context';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { deleteStoredFile } from '../../lib/file-storage';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import logger from '../../lib/logger';
import { ensureNodeRole, ensureSpaceRole, filterVisibleNodes, loadDriveSubjects, resolveNodeRole, resolveNodeRoles, resolveSpaceRoles } from './drive-access.service';
import { collectNodeUserIds, extensionOf, mapDriveNode, mapDriveTag, resolveUserNames, suffixedName } from './drive-common';
import { logDriveActivity } from './drive-activity.service';
import { ensureDriveSpaceExists, getSpaceQuotaState, releaseSpaceQuota, reserveSpaceQuota } from './drive-spaces.service';
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

/** 节点行批量装饰为 DTO：用户名、收藏、标签 */
export async function decorateNodes(
  rows: DriveNodeRow[],
  roleMap?: Map<number, DriveRole | null>,
): Promise<DriveNode[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const uid = currentUserId();
  const [names, stars, tagRows] = await Promise.all([
    resolveUserNames(collectNodeUserIds(rows)),
    db.select({ nodeId: driveNodeStars.nodeId }).from(driveNodeStars).where(and(eq(driveNodeStars.userId, uid), inArray(driveNodeStars.nodeId, ids))),
    db.select({ nodeId: driveNodeTags.nodeId, tag: driveTags }).from(driveNodeTags)
      .innerJoin(driveTags, eq(driveTags.id, driveNodeTags.tagId))
      .where(inArray(driveNodeTags.nodeId, ids)),
  ]);
  const starSet = new Set(stars.map((s) => s.nodeId));
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
  }));
}

// ─── 目录列表 ─────────────────────────────────────────────────────────────────

export interface ListDriveNodesQuery {
  spaceId?: number;
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
  const where = buildWhere(
    eq(driveNodes.spaceId, space.id),
    parent ? eq(driveNodes.parentId, parent.id) : isNull(driveNodes.parentId),
    isNull(driveNodes.deletedAt),
    q.type ? eq(driveNodes.type, q.type) : undefined,
    keywordCondition(q.keyword, [driveNodes.name], 'ilike'),
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
  // 页内精确校验：断开继承的子文件夹对无授权者隐藏
  const visible = await filterVisibleNodes(rows);
  const roleMap = new Map(visible.map((r) => [r.id, r.myRole]));
  const settings = await getDriveSettings();
  const [list, breadcrumbs, parentNames] = await Promise.all([
    decorateNodes(visible, roleMap),
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
  const [[node], breadcrumbs, versionCount, shareLinkCount, childCount] = await Promise.all([
    decorateNodes([row], new Map([[row.id, role]])),
    loadBreadcrumbs(row),
    db.$count(driveFileVersions, eq(driveFileVersions.nodeId, id)),
    db.$count(driveShareLinks, and(eq(driveShareLinks.nodeId, id), isNull(driveShareLinks.revokedAt))),
    row.type === 'folder' ? db.$count(driveNodes, and(eq(driveNodes.parentId, id), isNull(driveNodes.deletedAt))) : Promise.resolve(0),
  ]);
  return {
    ...node,
    spaceName: space?.name ?? '',
    spaceType: space?.type ?? 'personal',
    breadcrumbs,
    versionCount,
    shareLinkCount,
    childCount,
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
  const { space, ancestorIds, role } = await resolveWritableParent(data.spaceId, data.parentId);
  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(driveNodes).values({
        spaceId: space.id,
        parentId: data.parentId,
        ancestorIds,
        depth: ancestorIds.length,
        type: 'folder',
        name: data.name,
        tenantId: getCreateTenantId(currentUser()),
      }).returning();
      await logDriveActivity({ spaceId: space.id, nodeId: created.id, nodeName: created.name, nodeType: 'folder', action: 'create_folder' }, tx);
      return created;
    });
    const [node] = await decorateNodes([row], new Map([[row.id, role]]));
    return node;
  } catch (err) {
    return rethrowPgUniqueViolation(err, NAME_UNIQUE_MESSAGE, NAME_UNIQUE_BY_CONSTRAINT);
  }
}

export async function renameDriveNode(id: number, name: string): Promise<DriveNode> {
  const before = await ensureDriveNodeExists(id);
  const role = await ensureNodeRole(before, 'editor', '没有该文件的编辑权限');
  assertNotLockedByOthers(before);
  if (before.name === name) {
    const [node] = await decorateNodes([before], new Map([[before.id, role]]));
    return node;
  }
  try {
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(driveNodes)
        .set({ name, extension: before.type === 'file' ? extensionOf(name) : null })
        .where(eq(driveNodes.id, id)).returning();
      await logDriveActivity({ spaceId: before.spaceId, nodeId: id, nodeName: name, nodeType: before.type, action: 'rename', detail: { from: before.name, to: name } }, tx);
      return updated;
    });
    const [node] = await decorateNodes([row], new Map([[row.id, role]]));
    return node;
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

// ─── 移动 / 复制 ──────────────────────────────────────────────────────────────

async function ensureEditorOnAll(rows: DriveNodeRow[], message: string) {
  const roleMap = await resolveNodeRoles(rows);
  for (const row of rows) {
    if (!driveRoleAtLeast(roleMap.get(row.id)?.role, 'editor')) throw new HTTPException(403, { message: `${message}：${row.name}` });
  }
}

export async function moveDriveNodes(data: MoveDriveNodesInput): Promise<number> {
  const rows = await loadNodesByIds(data.ids);
  await ensureEditorOnAll(rows, '没有移动权限');
  rows.forEach(assertNotLockedByOthers);
  const { space, parent, ancestorIds: newAnc } = await resolveWritableParent(data.targetSpaceId, data.targetParentId);
  for (const row of rows) {
    if (row.spaceId !== space.id) throw new HTTPException(400, { message: '暂不支持跨空间移动，请使用复制' });
    if (parent && (parent.id === row.id || parent.ancestorIds.includes(row.id))) {
      throw new HTTPException(400, { message: `不能把「${row.name}」移动到自身或其子目录` });
    }
  }
  const targetParentId = parent?.id ?? null;
  const moving = rows.filter((r) => (r.parentId ?? null) !== targetParentId);
  if (moving.length === 0) return 0;
  try {
    await db.transaction(async (tx) => {
      for (const row of moving) {
        await relocateSubtree(tx, row, targetParentId, newAnc);
        await logDriveActivity({
          spaceId: row.spaceId, nodeId: row.id, nodeName: row.name, nodeType: row.type, action: 'move',
          detail: { fromParentId: row.parentId ?? null, toParentId: targetParentId },
        }, tx);
      }
    });
  } catch (err) {
    rethrowPgUniqueViolation(err, '目标目录中已存在同名文件或文件夹', NAME_UNIQUE_BY_CONSTRAINT);
  }
  return moving.length;
}

/** 把节点及其子树挂到新父目录下：一条 SQL 重写子树 ancestorIds / depth */
export async function relocateSubtree(executor: DbExecutor, node: DriveNodeRow, targetParentId: number | null, newAnc: number[]) {
  const oldDepth = node.ancestorIds.length;
  const delta = newAnc.length - oldDepth;
  if (newAnc.length + 1 > DRIVE_MAX_DEPTH) throw new HTTPException(400, { message: `目录层级不能超过 ${DRIVE_MAX_DEPTH} 层` });
  await executor.update(driveNodes)
    .set({ parentId: targetParentId, ancestorIds: newAnc, depth: newAnc.length })
    .where(eq(driveNodes.id, node.id));
  const newAncSql = sql`ARRAY[${sql.join(newAnc.map((id) => sql`${id}`), sql`, `)}]::integer[]`;
  await executor.execute(sql`
    UPDATE ${driveNodes}
    SET ancestor_ids = ${newAnc.length ? newAncSql : sql`'{}'::integer[]`} || ancestor_ids[${oldDepth + 1}:],
        depth = depth + ${delta}
    WHERE ancestor_ids @> ARRAY[${node.id}]::integer[]
  `);
}

/** 目标目录下已占用的名称（小写） */
async function existingNamesIn(executor: DbExecutor, spaceId: number, parentId: number | null): Promise<Set<string>> {
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

/** 加载子树（含根，未删除），按深度升序 */
export async function loadSubtree(executor: DbExecutor, rootId: number, opts: { includeDeleted?: boolean } = {}): Promise<DriveNodeRow[]> {
  return executor.select().from(driveNodes).where(and(
    sql`(${driveNodes.id} = ${rootId} OR ${driveNodes.ancestorIds} @> ARRAY[${rootId}]::integer[])`,
    opts.includeDeleted ? undefined : isNull(driveNodes.deletedAt),
  )).orderBy(asc(driveNodes.depth), asc(driveNodes.id));
}

export async function copyDriveNodes(data: CopyDriveNodesInput): Promise<DriveCopyResult> {
  const rows = await loadNodesByIds(data.ids);
  const roleMap = await resolveNodeRoles(rows);
  for (const row of rows) {
    if (!driveRoleAtLeast(roleMap.get(row.id)?.role, 'downloader')) throw new HTTPException(403, { message: `没有复制权限：${row.name}` });
  }
  const { space, parent, ancestorIds: newAnc } = await resolveWritableParent(data.targetSpaceId, data.targetParentId);
  for (const row of rows) {
    if (parent && (parent.id === row.id || parent.ancestorIds.includes(row.id))) {
      throw new HTTPException(400, { message: `不能把「${row.name}」复制到自身或其子目录` });
    }
  }
  const subtrees = await Promise.all(rows.map((r) => loadSubtree(db, r.id)));
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
      count += await copySubtree(tx, subtree, space, parent?.id ?? null, newAnc, settings);
    }
    return count;
  });
  return { mode: 'sync', taskId: null, copied };
}

/**
 * 复制一棵子树到目标目录（元数据复制 + fileId 引用，不复制对象）。
 * 事务内执行；根节点同名自动加后缀。返回复制的节点数。
 * settings 由调用方在开启事务之前读取传入（事务内不得触发设置冷加载）。
 */
export async function copySubtree(
  executor: DbExecutor,
  subtree: DriveNodeRow[],
  targetSpace: DriveSpaceRow,
  targetParentId: number | null,
  targetAnc: number[],
  settings: DriveSettings,
): Promise<number> {
  if (subtree.length === 0) return 0;
  const root = subtree[0];
  const totalBytes = subtree.filter((n) => n.type === 'file').reduce((s, n) => s + n.size, 0);
  await reserveSpaceQuota(executor, targetSpace.id, totalBytes, settings);
  const taken = await existingNamesIn(executor, targetSpace.id, targetParentId);
  const rootName = pickFreeName(root.name, taken);
  const tenantId = getCreateTenantId(currentUser());
  const idMap = new Map<number, number>();
  const ancMap = new Map<number, number[]>();
  for (const node of subtree) {
    const isRoot = node.id === root.id;
    const newParentId = isRoot ? targetParentId : idMap.get(node.parentId!);
    if (!isRoot && newParentId === undefined) continue; // 父节点未复制（理论上不会发生）
    const anc = isRoot ? targetAnc : [...ancMap.get(node.parentId!)!, newParentId!];
    if (anc.length + 1 > DRIVE_MAX_DEPTH) throw new HTTPException(400, { message: `目录层级不能超过 ${DRIVE_MAX_DEPTH} 层` });
    const [created] = await executor.insert(driveNodes).values({
      spaceId: targetSpace.id,
      parentId: newParentId ?? null,
      ancestorIds: anc,
      depth: anc.length,
      type: node.type,
      name: isRoot ? rootName : node.name,
      extension: node.extension,
      mimeType: node.mimeType,
      fileId: node.fileId,
      size: node.size,
      contentHash: node.contentHash,
      currentVersion: 1,
      thumbnailFileId: node.thumbnailFileId,
      tenantId,
    }).returning();
    idMap.set(node.id, created.id);
    ancMap.set(node.id, anc);
    if (node.type === 'file' && node.fileId) {
      await executor.insert(driveFileVersions).values({
        nodeId: created.id, version: 1, fileId: node.fileId, size: node.size, contentHash: node.contentHash,
        comment: '复制自其他位置', authorId: currentUserId(),
      });
    }
  }
  await logDriveActivity({
    spaceId: targetSpace.id, nodeId: idMap.get(root.id) ?? null, nodeName: rootName, nodeType: root.type, action: 'copy',
    detail: { sourceNodeId: root.id, sourceSpaceId: root.spaceId, nodes: idMap.size },
  }, executor);
  return idMap.size;
}

// ─── 删除 / 回收站 ────────────────────────────────────────────────────────────

export async function deleteDriveNodes(ids: number[]): Promise<number> {
  const rows = await loadNodesByIds(ids);
  await ensureEditorOnAll(rows, '没有删除权限');
  rows.forEach(assertNotLockedByOthers);
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

/** 回收站可见范围：我删除的 ∪ 我是 manager 的空间；网盘管理员全部 */
async function recycleVisibilityCondition(): Promise<SQL | undefined> {
  const subjects = await loadDriveSubjects();
  if (subjects.isAdmin) return undefined;
  const spaces = await db.select().from(driveSpaces).where(buildWhere(tenantCondition(driveSpaces, currentUser())));
  const roleMap = await resolveSpaceRoles(spaces);
  const managedIds = spaces.filter((s) => roleMap.get(s.id) === 'manager').map((s) => s.id);
  return buildWhere(
    managedIds.length
      ? sql`(${driveNodes.deletedBy} = ${subjects.userId} OR ${driveNodes.spaceId} IN (${sql.join(managedIds.map((id) => sql`${id}`), sql`, `)}))`
      : eq(driveNodes.deletedBy, subjects.userId),
  );
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
  const [total, rows] = await Promise.all([
    db.$count(driveNodes, where),
    withPagination(db.select().from(driveNodes).where(where).orderBy(desc(driveNodes.deletedAt), asc(driveNodes.id)).$dynamic(), page, pageSize),
  ]);
  const spaceRows = rows.length ? await db.select({ id: driveSpaces.id, name: driveSpaces.name }).from(driveSpaces).where(inArray(driveSpaces.id, [...new Set(rows.map((r) => r.spaceId))])) : [];
  const spaceNames = new Map(spaceRows.map((s) => [s.id, s.name]));
  const list = await decorateNodes(rows);
  return { list: list.map((n) => ({ ...n, spaceName: spaceNames.get(n.spaceId) ?? '' })), total, page, pageSize };
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
      let parentId = root.parentId ?? null;
      let newAnc = root.ancestorIds;
      if (parentId !== null) {
        const [parent] = await tx.select().from(driveNodes).where(eq(driveNodes.id, parentId)).limit(1);
        if (!parent || parent.deletedAt || parent.type !== 'folder') {
          parentId = null;
          newAnc = [];
        }
      }
      const taken = await existingNamesIn(tx, root.spaceId, parentId);
      const name = pickFreeName(root.name, taken);
      // 先恢复子树的删除标记，再统一挂载（relocateSubtree 按 ancestorIds 定位后代）
      await tx.update(driveNodes)
        .set({ deletedAt: null, deletedBy: null, deletedRootId: null })
        .where(eq(driveNodes.deletedRootId, root.id));
      if (name !== root.name) await tx.update(driveNodes).set({ name }).where(eq(driveNodes.id, root.id));
      if (parentId !== (root.parentId ?? null)) await relocateSubtree(tx, root, parentId, newAnc);
      await logDriveActivity({ spaceId: root.spaceId, nodeId: root.id, nodeName: name, nodeType: root.type, action: 'restore' }, tx);
    }
  });
  return roots.length;
}

export async function purgeDriveNodes(ids: number[]): Promise<number> {
  const roots = await loadRecycleRoots(ids);
  await ensureRecycleOperable(roots, 'manager');
  return purgeSubtrees(roots);
}

/** 彻底删除若干子树：删行、释放配额、回收无引用对象（供回收站与保留策略共用） */
export async function purgeSubtrees(roots: DriveNodeRow[]): Promise<number> {
  let purged = 0;
  const orphanFileIds = new Set<string>();
  for (const root of roots) {
    await db.transaction(async (tx) => {
      const subtree = await loadSubtree(tx, root.id, { includeDeleted: true });
      const nodeIds = subtree.map((n) => n.id);
      if (nodeIds.length === 0) return;
      const versions = await tx.select({ fileId: driveFileVersions.fileId, size: driveFileVersions.size })
        .from(driveFileVersions).where(inArray(driveFileVersions.nodeId, nodeIds));
      const bytes = versions.reduce((s, v) => s + v.size, 0);
      for (const v of versions) orphanFileIds.add(v.fileId);
      for (const n of subtree) if (n.thumbnailFileId) orphanFileIds.add(n.thumbnailFileId);
      await tx.delete(driveNodes).where(inArray(driveNodes.id, nodeIds));
      await releaseSpaceQuota(tx, root.spaceId, bytes);
      await logDriveActivity({ spaceId: root.spaceId, nodeId: null, nodeName: root.name, nodeType: root.type, action: 'purge', detail: { nodes: nodeIds.length, bytes }, tenantId: root.tenantId ?? null }, tx);
      purged += nodeIds.length;
    });
  }
  await releaseUnreferencedFiles([...orphanFileIds]);
  return purged;
}

/** 无任何节点 / 版本 / 缩略图引用的托管文件：删除对象与记录 */
export async function releaseUnreferencedFiles(fileIds: string[]): Promise<number> {
  if (fileIds.length === 0) return 0;
  const [nodeRefs, versionRefs, thumbRefs] = await Promise.all([
    db.select({ id: driveNodes.fileId }).from(driveNodes).where(inArray(driveNodes.fileId, fileIds)),
    db.select({ id: driveFileVersions.fileId }).from(driveFileVersions).where(inArray(driveFileVersions.fileId, fileIds)),
    db.select({ id: driveNodes.thumbnailFileId }).from(driveNodes).where(inArray(driveNodes.thumbnailFileId, fileIds)),
  ]);
  const referenced = new Set([...nodeRefs, ...versionRefs, ...thumbRefs].map((r) => r.id).filter(Boolean));
  const orphans = fileIds.filter((id) => !referenced.has(id));
  if (orphans.length === 0) return 0;
  const files = await db.query.managedFiles.findMany({ where: inArray(managedFiles.id, orphans) });
  const configIds = [...new Set(files.map((f) => f.storageConfigId))];
  const configs = configIds.length ? await db.query.fileStorageConfigs.findMany({ where: (t, { inArray: inArr }) => inArr(t.id, configIds) }) : [];
  const configMap = new Map(configs.map((c) => [c.id, c]));
  await Promise.allSettled(files.map(async (file) => {
    const cfg = configMap.get(file.storageConfigId);
    if (cfg) await deleteStoredFile(file, cfg).catch((err) => logger.warn({ err, fileId: file.id }, 'drive: 删除对象失败，记录仍将移除'));
  }));
  await db.delete(managedFiles).where(inArray(managedFiles.id, orphans));
  return orphans.length;
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
  return purgeSubtrees(roots);
}

/** 保留策略：清理超过保留天数的回收站项目（无请求上下文，跳过权限） */
export async function purgeExpiredRecycleNodes(days: number): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const roots = await db.select().from(driveNodes).where(and(
    isNotNull(driveNodes.deletedAt),
    sql`${driveNodes.deletedRootId} = ${driveNodes.id}`,
    sql`${driveNodes.deletedAt} < ${cutoff}`,
  )).limit(500);
  if (roots.length === 0) return 0;
  return purgeSubtrees(roots);
}

export async function countExpiredRecycleNodes(days: number): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  return db.$count(driveNodes, and(
    isNotNull(driveNodes.deletedAt),
    sql`${driveNodes.deletedRootId} = ${driveNodes.id}`,
    sql`${driveNodes.deletedAt} < ${cutoff}`,
  ));
}

export { getSpaceQuotaState };
