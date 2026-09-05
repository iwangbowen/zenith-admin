import { createHash, randomBytes } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { tryGetContext } from 'hono/context-storage';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import {
  DRIVE_SHARE_SESSION_TTL_SECONDS,
  type CreateDriveShareLinkInput,
  type DrivePublicNode,
  type DrivePublicShareMeta,
  type DrivePublicShareSession,
  type DriveShareLink,
  type DriveShareLinkState,
  type SaveFromDriveShareInput,
  type UpdateDriveShareLinkInput,
} from '@zenith/shared/drive';
import { db } from '../../db';
import { driveNodes, driveShareAccessLogs, driveShareLinks, driveSpaces, type DriveNodeRow, type DriveShareLinkRow } from '../../db/schema';
import { config } from '../../config';
import { currentUser, currentUserId, currentUserOrNull, isSuperAdmin, type AppEnv } from '../../lib/context';
import { getDataScopeCondition } from '../../lib/data-scope';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { decryptField, encryptField } from '../../lib/encryption';
import { readStoredFile } from '../../lib/file-storage';
import type { StoredFileRange } from '../../lib/file-storage';
import logger from '../../lib/logger';
import { hashPassword, verifyPassword } from '../../lib/password';
import redis from '../../lib/redis';
import { getClientIp } from '../../lib/request-helpers';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { getRestrictedFileForRead } from '../files/files.service';
import { ensureNodeRole, loadDriveSubjects, resolveNodeRole } from './drive-access.service';
import { drivePublicShareUrl, resolveUserNames } from './drive-common';
import { logDriveActivity } from './drive-activity.service';
import { copySubtree, ensureDriveNodeExists, loadSubtree, resolveWritableParent } from './drive-nodes.service';
import { ensureDriveSpaceExists } from './drive-spaces.service';
import { getDriveSettings } from './drive-settings.service';

const SESSION_PREFIX = `${config.redis.keyPrefix}drive:share-session:`;

interface ShareSessionPayload {
  shareId: number;
  nodeId: number;
  sessionVersion: number;
  clientIp: string;
  expiresAt: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function currentClientIp(): string {
  const ctx = tryGetContext<AppEnv>();
  return ctx ? getClientIp(ctx).slice(0, 64) : '';
}

export function shareLinkState(row: DriveShareLinkRow): DriveShareLinkState {
  if (row.revokedAt) return 'revoked';
  if (!row.enabled) return 'disabled';
  if (row.expireAt && row.expireAt.getTime() <= Date.now()) return 'expired';
  if (row.maxAccessCount && row.accessCount >= row.maxAccessCount) return 'exhausted';
  return 'active';
}

async function mapShareLinks(rows: DriveShareLinkRow[]): Promise<DriveShareLink[]> {
  if (rows.length === 0) return [];
  const nodeIds = [...new Set(rows.map((r) => r.nodeId))];
  const [nodes, names] = await Promise.all([
    db.select({ id: driveNodes.id, name: driveNodes.name, type: driveNodes.type, spaceId: driveNodes.spaceId }).from(driveNodes).where(inArray(driveNodes.id, nodeIds)),
    resolveUserNames(rows.map((r) => r.createdBy)),
  ]);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return rows.map((r) => {
    const node = nodeMap.get(r.nodeId);
    const token = decryptField(r.tokenEncrypted) ?? '';
    return {
      id: r.id,
      nodeId: r.nodeId,
      nodeName: node?.name ?? '',
      nodeType: node?.type ?? 'file',
      spaceId: node?.spaceId ?? 0,
      token,
      url: drivePublicShareUrl(token),
      hasPassword: !!r.passwordHash,
      permission: r.permission,
      enabled: r.enabled,
      expireAt: formatNullableDateTime(r.expireAt),
      maxAccessCount: r.maxAccessCount ?? null,
      accessCount: r.accessCount,
      downloadCount: r.downloadCount,
      revokedAt: formatNullableDateTime(r.revokedAt),
      remark: r.remark ?? null,
      state: shareLinkState(r),
      createdBy: r.createdBy ?? null,
      createdByName: r.createdBy ? names.get(r.createdBy) ?? null : null,
      createdAt: formatDateTime(r.createdAt),
      updatedAt: formatDateTime(r.updatedAt),
    };
  });
}

// ─── 管理：创建 / 列表 / 修改 / 撤销 ─────────────────────────────────────────

async function assertExternalShareAllowed(node: DriveNodeRow) {
  const settings = await getDriveSettings();
  if (!settings.externalShareEnabled) throw new HTTPException(403, { message: '管理员已关闭外链分享功能' });
  const space = await ensureDriveSpaceExists(node.spaceId);
  if (!space.allowExternalShare) throw new HTTPException(403, { message: '该空间不允许外链分享' });
  return settings;
}

function assertExpireWithinLimit(expireAt: Date | null, maxDays: number) {
  if (maxDays <= 0) return;
  const limit = Date.now() + maxDays * 86_400_000;
  if (!expireAt) throw new HTTPException(400, { message: `外链必须设置有效期，且不超过 ${maxDays} 天` });
  if (expireAt.getTime() > limit) throw new HTTPException(400, { message: `外链有效期不能超过 ${maxDays} 天` });
}

export async function createDriveShareLink(nodeId: number, data: CreateDriveShareLinkInput): Promise<DriveShareLink> {
  const node = await ensureDriveNodeExists(nodeId);
  await ensureNodeRole(node, 'editor', '没有分享该文件的权限');
  const settings = await assertExternalShareAllowed(node);
  const expireAt = data.expireAt ? parseDateTimeInput(data.expireAt) : null;
  if (expireAt && expireAt.getTime() <= Date.now()) throw new HTTPException(400, { message: '有效期必须晚于当前时间' });
  assertExpireWithinLimit(expireAt, settings.externalShareMaxDays);
  if (settings.externalShareRequirePassword && !data.password) throw new HTTPException(400, { message: '管理员要求外链必须设置访问密码' });
  const token = randomBytes(24).toString('hex');
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(driveShareLinks).values({
      nodeId,
      token: hashToken(token),
      tokenEncrypted: encryptField(token),
      passwordHash: data.password ? await hashPassword(data.password) : null,
      permission: data.permission,
      expireAt,
      maxAccessCount: data.maxAccessCount ?? null,
      remark: data.remark ?? null,
      tenantId: getCreateTenantId(currentUser()),
    }).returning();
    await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'share_create', shareId: created.id, detail: { permission: data.permission } }, tx);
    return created;
  });
  const [link] = await mapShareLinks([row]);
  return link;
}

export interface ListShareLinksQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  nodeId?: number;
  spaceId?: number;
  state?: DriveShareLinkState;
  createdBy?: number;
  startTime?: string;
  endTime?: string;
}

function stateCondition(state?: DriveShareLinkState): SQL | undefined {
  const now = new Date();
  switch (state) {
    case 'revoked': return sql`${driveShareLinks.revokedAt} is not null`;
    case 'disabled': return and(isNull(driveShareLinks.revokedAt), eq(driveShareLinks.enabled, false));
    case 'expired': return and(isNull(driveShareLinks.revokedAt), eq(driveShareLinks.enabled, true), lt(driveShareLinks.expireAt, now));
    case 'exhausted': return and(isNull(driveShareLinks.revokedAt), eq(driveShareLinks.enabled, true), sql`${driveShareLinks.maxAccessCount} is not null and ${driveShareLinks.accessCount} >= ${driveShareLinks.maxAccessCount}`);
    case 'active': return and(
      isNull(driveShareLinks.revokedAt), eq(driveShareLinks.enabled, true),
      or(isNull(driveShareLinks.expireAt), sql`${driveShareLinks.expireAt} > ${now}`),
      or(isNull(driveShareLinks.maxAccessCount), sql`${driveShareLinks.accessCount} < ${driveShareLinks.maxAccessCount}`),
    );
    default: return undefined;
  }
}

async function buildShareWhere(q: ListShareLinksQuery, extra?: SQL): Promise<SQL | undefined> {
  const nodeFilter = q.keyword || q.spaceId !== undefined
    ? inArray(driveShareLinks.nodeId, db.select({ id: driveNodes.id }).from(driveNodes).where(buildWhere(
      keywordCondition(q.keyword, [driveNodes.name], 'ilike'),
      q.spaceId !== undefined ? eq(driveNodes.spaceId, q.spaceId) : undefined,
    )))
    : undefined;
  return buildWhere(
    q.nodeId !== undefined ? eq(driveShareLinks.nodeId, q.nodeId) : undefined,
    q.createdBy !== undefined ? eq(driveShareLinks.createdBy, q.createdBy) : undefined,
    stateCondition(q.state),
    nodeFilter,
    ...dateRangeConditions(driveShareLinks.createdAt, q.startTime, q.endTime),
    tenantCondition(driveShareLinks, currentUser()),
    extra,
  );
}

async function paginateShares(where: SQL | undefined, page: number, pageSize: number) {
  const [total, rows] = await Promise.all([
    db.$count(driveShareLinks, where),
    withPagination(db.select().from(driveShareLinks).where(where).orderBy(desc(driveShareLinks.id)).$dynamic(), page, pageSize),
  ]);
  return { list: await mapShareLinks(rows), total, page, pageSize };
}

/** 我创建的外链 */
export async function listMyShareLinks(q: ListShareLinksQuery) {
  const { page = 1, pageSize = 20 } = q;
  return paginateShares(await buildShareWhere({ ...q, createdBy: currentUserId() }), page, pageSize);
}

/** 节点的外链（需 viewer，manager 可见全部，其他人只见自己创建的） */
export async function listNodeShareLinks(nodeId: number) {
  const node = await ensureDriveNodeExists(nodeId, { allowDeleted: true });
  const role = await ensureNodeRole(node, 'viewer');
  const where = await buildShareWhere({ nodeId, createdBy: role === 'manager' ? undefined : currentUserId() });
  const rows = await db.select().from(driveShareLinks).where(where).orderBy(asc(driveShareLinks.id));
  return mapShareLinks(rows);
}

/** 管理端：全部外链（数据权限按空间归属收窄） */
export async function listShareLinksForAdmin(q: ListShareLinksQuery) {
  const { page = 1, pageSize = 20 } = q;
  let scope: SQL | undefined;
  if (!isSuperAdmin()) {
    const cond = await getDataScopeCondition({ currentUserId: currentUserId(), deptColumn: driveSpaces.departmentId, ownerColumn: driveSpaces.ownerId });
    if (cond) {
      scope = inArray(driveShareLinks.nodeId, db.select({ id: driveNodes.id }).from(driveNodes)
        .where(inArray(driveNodes.spaceId, db.select({ id: driveSpaces.id }).from(driveSpaces).where(cond))));
    }
  }
  return paginateShares(await buildShareWhere(q, scope), page, pageSize);
}

async function ensureShareEditable(id: number): Promise<{ share: DriveShareLinkRow; node: DriveNodeRow }> {
  const [share] = await db.select().from(driveShareLinks).where(buildWhere(eq(driveShareLinks.id, id), tenantCondition(driveShareLinks, currentUser()))).limit(1);
  if (!share) throw new HTTPException(404, { message: '外链不存在' });
  const node = await ensureDriveNodeExists(share.nodeId, { allowDeleted: true });
  const subjects = await loadDriveSubjects();
  if (share.createdBy !== subjects.userId && !subjects.isAdmin) {
    const role = await resolveNodeRole(node);
    if (role !== 'manager') throw new HTTPException(403, { message: '只能管理自己创建的外链' });
  }
  return { share, node };
}

export async function updateDriveShareLink(id: number, data: UpdateDriveShareLinkInput): Promise<DriveShareLink> {
  const { share, node } = await ensureShareEditable(id);
  if (share.revokedAt) throw new HTTPException(400, { message: '外链已撤销，不能修改' });
  const settings = await getDriveSettings();
  const patch: PgUpdateSetSource<typeof driveShareLinks> = {};
  let bumpSession = false;
  if (data.permission !== undefined) patch.permission = data.permission;
  if (data.remark !== undefined) patch.remark = data.remark;
  if (data.maxAccessCount !== undefined) patch.maxAccessCount = data.maxAccessCount;
  if (data.enabled !== undefined) { patch.enabled = data.enabled; bumpSession = true; }
  if (data.expireAt !== undefined) {
    const expireAt = data.expireAt ? parseDateTimeInput(data.expireAt) : null;
    assertExpireWithinLimit(expireAt, settings.externalShareMaxDays);
    patch.expireAt = expireAt;
  }
  if (data.clearPassword) {
    if (settings.externalShareRequirePassword) throw new HTTPException(400, { message: '管理员要求外链必须设置访问密码' });
    patch.passwordHash = null;
    bumpSession = true;
  } else if (data.password) {
    patch.passwordHash = await hashPassword(data.password);
    bumpSession = true;
  }
  if (bumpSession) patch.sessionVersion = sql`${driveShareLinks.sessionVersion} + 1`;
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(driveShareLinks).set(patch).where(eq(driveShareLinks.id, id)).returning();
    await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'share_update', shareId: id }, tx);
    return updated;
  });
  const [link] = await mapShareLinks([row]);
  return link;
}

export async function revokeDriveShareLink(id: number): Promise<void> {
  const { share, node } = await ensureShareEditable(id);
  if (share.revokedAt) return;
  await db.transaction(async (tx) => {
    await tx.update(driveShareLinks)
      .set({ revokedAt: new Date(), enabled: false, sessionVersion: sql`${driveShareLinks.sessionVersion} + 1` })
      .where(eq(driveShareLinks.id, id));
    await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'share_revoke', shareId: id }, tx);
  });
}

export async function deleteDriveShareLink(id: number): Promise<void> {
  const { share, node } = await ensureShareEditable(id);
  await db.transaction(async (tx) => {
    await tx.delete(driveShareLinks).where(eq(driveShareLinks.id, share.id));
    await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'share_revoke', shareId: id, detail: { deleted: true } }, tx);
  });
}

/** 管理端撤销：不校验创建者（数据权限由列表收窄，此处只做租户校验） */
export async function adminRevokeDriveShareLink(id: number): Promise<void> {
  const [share] = await db.select().from(driveShareLinks).where(buildWhere(eq(driveShareLinks.id, id), tenantCondition(driveShareLinks, currentUser()))).limit(1);
  if (!share) throw new HTTPException(404, { message: '外链不存在' });
  const [node] = await db.select().from(driveNodes).where(eq(driveNodes.id, share.nodeId)).limit(1);
  await db.transaction(async (tx) => {
    await tx.update(driveShareLinks)
      .set({ revokedAt: new Date(), enabled: false, sessionVersion: sql`${driveShareLinks.sessionVersion} + 1` })
      .where(eq(driveShareLinks.id, id));
    if (node) await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'share_revoke', shareId: id, detail: { byAdmin: true } }, tx);
  });
}

export async function getShareLinkBeforeAudit(id: number) {
  const [share] = await db.select().from(driveShareLinks).where(eq(driveShareLinks.id, id)).limit(1);
  if (!share) return null;
  return { id: share.id, nodeId: share.nodeId, permission: share.permission, enabled: share.enabled, expireAt: formatNullableDateTime(share.expireAt), maxAccessCount: share.maxAccessCount, revokedAt: formatNullableDateTime(share.revokedAt) };
}

// ─── 公开访问 ─────────────────────────────────────────────────────────────────

function logShareAccess(share: DriveShareLinkRow, action: string, ok: boolean) {
  void db.insert(driveShareAccessLogs).values({
    shareId: share.id, nodeId: share.nodeId, action, clientIp: currentClientIp() || null, ok,
  }).catch((err) => logger.warn({ err, shareId: share.id }, 'drive: 外链访问日志写入失败'));
}

async function findShareByToken(token: string): Promise<DriveShareLinkRow> {
  const [share] = await db.select().from(driveShareLinks).where(eq(driveShareLinks.token, hashToken(token))).limit(1);
  if (!share) throw new HTTPException(404, { message: '链接不存在或已失效' });
  return share;
}

function assertShareUsable(share: DriveShareLinkRow, action: string) {
  const state = shareLinkState(share);
  if (state === 'active') return;
  logShareAccess(share, action, false);
  const message = state === 'expired' ? '链接已过期' : state === 'exhausted' ? '链接访问次数已用尽' : '链接已停用';
  throw new HTTPException(403, { message });
}

async function loadShareRoot(share: DriveShareLinkRow): Promise<DriveNodeRow> {
  const [node] = await db.select().from(driveNodes).where(eq(driveNodes.id, share.nodeId)).limit(1);
  if (!node || node.deletedAt) throw new HTTPException(404, { message: '分享的文件已被删除' });
  return node;
}

function toPublicNode(node: DriveNodeRow, token: string): DrivePublicNode {
  return {
    id: node.id,
    parentId: node.parentId ?? null,
    type: node.type,
    name: node.name,
    extension: node.extension ?? null,
    mimeType: node.mimeType ?? null,
    size: node.size,
    url: node.type === 'file' ? `/api/drive/public/shares/${token}/nodes/${node.id}/content` : null,
    updatedAt: formatDateTime(node.updatedAt),
  };
}

async function saveSession(sessionToken: string, payload: ShareSessionPayload) {
  try {
    await redis.set(`${SESSION_PREFIX}${hashToken(sessionToken)}`, JSON.stringify(payload), 'EX', DRIVE_SHARE_SESSION_TTL_SECONDS);
  } catch {
    throw new HTTPException(503, { message: '访问会话创建失败，请稍后重试' });
  }
}

async function readSession(sessionToken: string): Promise<ShareSessionPayload> {
  try {
    const raw = await redis.get(`${SESSION_PREFIX}${hashToken(sessionToken)}`);
    if (!raw) throw new HTTPException(401, { message: '访问会话已失效，请重新验证' });
    return JSON.parse(raw) as ShareSessionPayload;
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(503, { message: '访问会话不可用，请稍后重试' });
  }
}

async function claimAccess(share: DriveShareLinkRow) {
  const where = share.maxAccessCount
    ? and(eq(driveShareLinks.id, share.id), lt(driveShareLinks.accessCount, share.maxAccessCount))
    : eq(driveShareLinks.id, share.id);
  const [claimed] = await db.update(driveShareLinks).set({ accessCount: sql`${driveShareLinks.accessCount} + 1` }).where(where).returning({ id: driveShareLinks.id });
  if (!claimed) {
    logShareAccess(share, 'access', false);
    throw new HTTPException(403, { message: '链接访问次数已用尽' });
  }
}

/** 密码校验并签发访问会话（无密码外链同样需要换取会话，便于统一计数与留痕） */
export async function createDriveShareSession(token: string, password?: string): Promise<DrivePublicShareSession & { meta: DrivePublicShareMeta }> {
  const share = await findShareByToken(token);
  assertShareUsable(share, 'access');
  if (share.passwordHash) {
    if (!password || !(await verifyPassword(password, share.passwordHash))) {
      logShareAccess(share, 'access', false);
      throw new HTTPException(401, { message: '访问密码错误' });
    }
  }
  const node = await loadShareRoot(share);
  await claimAccess(share);
  const sessionToken = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + DRIVE_SHARE_SESSION_TTL_SECONDS * 1000);
  await saveSession(sessionToken, {
    shareId: share.id, nodeId: share.nodeId, sessionVersion: share.sessionVersion, clientIp: currentClientIp(), expiresAt: formatDateTime(expiresAt),
  });
  logShareAccess(share, 'access', true);
  await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'share_access', shareId: share.id, actorId: currentUserOrNull()?.userId ?? null, tenantId: share.tenantId ?? null });
  return {
    session: sessionToken,
    expiresAt: formatDateTime(expiresAt),
    meta: await buildPublicMeta(share, token, node),
  };
}

async function buildPublicMeta(share: DriveShareLinkRow, token: string, node: DriveNodeRow | null): Promise<DrivePublicShareMeta> {
  const names = await resolveUserNames([share.createdBy]);
  return {
    token,
    permission: share.permission,
    requirePassword: !!share.passwordHash,
    node: node ? toPublicNode(node, token) : null,
    expireAt: formatNullableDateTime(share.expireAt),
    sharerName: share.createdBy ? names.get(share.createdBy) ?? null : null,
  };
}

/** 无会话时的元信息（只暴露是否需要密码、分享人、有效期） */
export async function getDrivePublicShareMeta(token: string, sessionToken?: string): Promise<DrivePublicShareMeta> {
  const share = await findShareByToken(token);
  assertShareUsable(share, 'meta');
  if (!sessionToken) {
    // 无密码外链：元信息可直接带根节点名，但内容仍需先换会话
    const node = share.passwordHash ? null : await loadShareRoot(share);
    return buildPublicMeta(share, token, node);
  }
  const { share: verified, node } = await resolveShareSession(token, sessionToken, 'meta');
  return buildPublicMeta(verified, token, node);
}

async function resolveShareSession(token: string, sessionToken: string, action: string) {
  const share = await findShareByToken(token);
  assertShareUsable(share, action);
  const session = await readSession(sessionToken);
  if (session.shareId !== share.id || session.nodeId !== share.nodeId) throw new HTTPException(401, { message: '访问会话无效' });
  if (session.sessionVersion !== share.sessionVersion) throw new HTTPException(401, { message: '分享设置已更新，请重新验证' });
  const node = await loadShareRoot(share);
  return { share, node };
}

/** 外链子树内的节点：必须是根节点自身或其后代 */
async function ensureNodeWithinShare(root: DriveNodeRow, nodeId: number): Promise<DriveNodeRow> {
  if (nodeId === root.id) return root;
  const [node] = await db.select().from(driveNodes).where(and(
    eq(driveNodes.id, nodeId),
    sql`${driveNodes.ancestorIds} @> ARRAY[${root.id}]::integer[]`,
    isNull(driveNodes.deletedAt),
  )).limit(1);
  if (!node) throw new HTTPException(404, { message: '文件不存在' });
  return node;
}

export async function listDrivePublicChildren(token: string, sessionToken: string, parentId?: number): Promise<DrivePublicNode[]> {
  const { share, node: root } = await resolveShareSession(token, sessionToken, 'list');
  if (root.type !== 'folder') return [toPublicNode(root, token)];
  const parent = parentId ? await ensureNodeWithinShare(root, parentId) : root;
  if (parent.type !== 'folder') throw new HTTPException(400, { message: '目标不是文件夹' });
  const rows = await db.select().from(driveNodes).where(and(eq(driveNodes.parentId, parent.id), isNull(driveNodes.deletedAt)))
    .orderBy(sql`case when ${driveNodes.type} = 'folder' then 0 else 1 end`, asc(sql`lower(${driveNodes.name})`));
  logShareAccess(share, 'list', true);
  return rows.map((r) => toPublicNode(r, token));
}

export async function readDrivePublicContent(token: string, sessionToken: string, nodeId: number, download: boolean, range?: StoredFileRange | null) {
  const { share, node: root } = await resolveShareSession(token, sessionToken, download ? 'download' : 'preview');
  if (download && share.permission !== 'download') throw new HTTPException(403, { message: '该外链仅允许在线预览' });
  const node = await ensureNodeWithinShare(root, nodeId);
  if (node.type !== 'file' || !node.fileId) throw new HTTPException(400, { message: '文件夹没有内容' });
  const { file, storageConfig } = await getRestrictedFileForRead(node.fileId);
  const stored = await readStoredFile(file, storageConfig, range ?? undefined);
  if (!range || range.start === 0) {
    logShareAccess(share, download ? 'download' : 'preview', true);
    if (download) {
      await db.update(driveShareLinks).set({ downloadCount: sql`${driveShareLinks.downloadCount} + 1` }).where(eq(driveShareLinks.id, share.id));
    }
    await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: 'file', action: download ? 'download' : 'preview', shareId: share.id, actorId: currentUserOrNull()?.userId ?? null, tenantId: share.tenantId ?? null, detail: { viaShare: true } });
  }
  return { node, file, stored };
}

/** 登录用户把外链内容转存到自己可写的目录 */
export async function saveFromDriveShare(token: string, sessionToken: string, data: SaveFromDriveShareInput): Promise<number> {
  const { share, node: root } = await resolveShareSession(token, sessionToken, 'save');
  if (share.permission !== 'download') throw new HTTPException(403, { message: '该外链仅允许在线预览，不能转存' });
  const sources = data.nodeIds?.length
    ? await Promise.all(data.nodeIds.map((id) => ensureNodeWithinShare(root, id)))
    : [root];
  const { space, parent, ancestorIds } = await resolveWritableParent(data.targetSpaceId, data.targetParentId);
  const subtrees = await Promise.all(sources.map((s) => loadSubtree(db, s.id)));
  const settings = await getDriveSettings();
  const copied = await db.transaction(async (tx) => {
    let count = 0;
    for (const subtree of subtrees) count += await copySubtree(tx, subtree, space, parent?.id ?? null, ancestorIds, settings);
    return count;
  });
  logShareAccess(share, 'save', true);
  await logDriveActivity({ spaceId: root.spaceId, nodeId: root.id, nodeName: root.name, nodeType: root.type, action: 'save_from_share', shareId: share.id, detail: { copied, targetSpaceId: space.id } });
  return copied;
}

/** 外链访问日志（创建者 / manager / 管理员） */
export async function listShareAccessLogs(shareId: number, page = 1, pageSize = 20) {
  await ensureShareEditable(shareId);
  const where = eq(driveShareAccessLogs.shareId, shareId);
  const [total, rows] = await Promise.all([
    db.$count(driveShareAccessLogs, where),
    withPagination(db.select().from(driveShareAccessLogs).where(where).orderBy(desc(driveShareAccessLogs.id)).$dynamic(), page, pageSize),
  ]);
  return {
    list: rows.map((r) => ({ id: r.id, shareId: r.shareId, nodeId: r.nodeId, action: r.action, clientIp: r.clientIp ?? null, ok: r.ok, createdAt: formatDateTime(r.createdAt) })),
    total, page, pageSize,
  };
}