import { createHash, randomBytes } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { tryGetContext } from 'hono/context-storage';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import {
  DRIVE_SHARE_SESSION_TTL_SECONDS,
  driveCollectPolicySchema,
  normalizeDriveShareCapabilities,
  type CreateDriveShareLinkInput,
  type DriveCollectPolicy,
  type DriveCollectSubmission,
  type DrivePublicNode,
  type DrivePublicShareMeta,
  type DrivePublicShareSession,
  type DrivePublicUploadFields,
  type DrivePublicUploadResult,
  type DriveShareLink,
  type DriveShareLinkState,
  type DriveRole,
  type DriveShareCapability,
  type DriveShareKind,
  type SaveFromDriveShareInput,
  type UpdateDriveShareLinkInput,
} from '@zenith/shared/drive';
import { db } from '../../db';
import { driveCollectSubmissions, driveNodes, driveShareAccessLogs, driveShareLinks, driveSpaces, shortLinks, type DriveNodeRow, type DriveShareLinkRow } from '../../db/schema';
import { config } from '../../config';
import { currentUser, currentUserId, currentUserOrNull, isSuperAdmin, runWithCurrentUser, type AppEnv } from '../../lib/context';
import { getDataScopeCondition } from '../../lib/data-scope';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { decryptField, encryptField } from '../../lib/encryption';
import { readStoredFile } from '../../lib/file-storage';
import type { StoredFileRange } from '../../lib/file-storage';
import { ipInAllowlist } from '../../lib/ip-allowlist';
import logger from '../../lib/logger';
import { hashPassword, verifyPassword } from '../../lib/password';
import redis from '../../lib/redis';
import { getClientIp } from '../../lib/request-helpers';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { getRestrictedFileForRead } from '../files/files.service';
import { buildShortUrl, ensureShortLink } from '../short-link/short-link.service';
import { ensureNodeRole, loadDriveSubjects, loadDriveSubjectsForUser, resolveNodeRole, visibleNodeCondition, type DriveSubjectSet } from './drive-access.service';
import { drivePublicShareUrl, extensionOf, loadDriveActorPayload, resolveUserNames } from './drive-common';
import { logDriveActivity } from './drive-activity.service';
import { copySubtree, ensureDriveNodeExists, loadAccessibleSubtree, resolveWritableParent } from './drive-nodes.service';
import { notifyCollectReceived } from './drive-notify.service';
import { ensureDriveLogPartitions } from './drive-partitions.service';
import { ensureDriveSpaceExists } from './drive-spaces.service';
import { getDriveSettings, type DriveSettings } from './drive-settings.service';
import { uploadBufferAsNode } from './drive-upload.service';

const SESSION_PREFIX = `${config.redis.keyPrefix}drive:share-session:`;
const SHORT_LINK_BIZ = 'drive_share' as const;

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

/** 收集上限：策略中的 maxUploads 用尽也视为次数用尽 */
export function shareLinkState(row: DriveShareLinkRow): DriveShareLinkState {
  if (row.revokedAt) return 'revoked';
  if (!row.enabled) return 'disabled';
  if (row.expireAt && row.expireAt.getTime() <= Date.now()) return 'expired';
  if (row.maxAccessCount && row.accessCount >= row.maxAccessCount) return 'exhausted';
  if (row.maxDownloadCount && row.downloadCount >= row.maxDownloadCount) return 'exhausted';
  if (row.kind === 'collect' && row.collectPolicy?.maxUploads && row.uploadCount >= row.collectPolicy.maxUploads) return 'exhausted';
  return 'active';
}

async function loadShortUrls(shareIds: number[]): Promise<Map<number, string>> {
  if (shareIds.length === 0) return new Map();
  const rows = await db.select({ bizRef: shortLinks.bizRef, code: shortLinks.code, status: shortLinks.status }).from(shortLinks)
    .where(and(eq(shortLinks.bizType, SHORT_LINK_BIZ), inArray(shortLinks.bizRef, shareIds.map(String))));
  return new Map(rows.filter((r) => r.bizRef && r.status === 'enabled').map((r) => [Number(r.bizRef), buildShortUrl(r.code)]));
}

async function mapShareLinks(rows: DriveShareLinkRow[]): Promise<DriveShareLink[]> {
  if (rows.length === 0) return [];
  const nodeIds = [...new Set(rows.map((r) => r.nodeId))];
  const [nodes, names, shortUrls] = await Promise.all([
    db.select({ id: driveNodes.id, name: driveNodes.name, type: driveNodes.type, spaceId: driveNodes.spaceId }).from(driveNodes).where(inArray(driveNodes.id, nodeIds)),
    resolveUserNames(rows.map((r) => r.createdBy)),
    loadShortUrls(rows.map((r) => r.id)),
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
      shortUrl: shortUrls.get(r.id) ?? null,
      hasPassword: !!r.passwordHash,
      kind: r.kind,
      capabilities: r.capabilities,
      enabled: r.enabled,
      expireAt: formatNullableDateTime(r.expireAt),
      maxAccessCount: r.maxAccessCount ?? null,
      accessCount: r.accessCount,
      downloadCount: r.downloadCount,
      maxDownloadCount: r.maxDownloadCount ?? null,
      uploadCount: r.uploadCount,
      allowedIps: r.allowedIps,
      watermark: r.watermark,
      collectPolicy: r.kind === 'collect' ? normalizeCollectPolicy(r.collectPolicy) : null,
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

/** 历史行可能没有策略：按 schema 默认值补齐 */
function normalizeCollectPolicy(policy: DriveCollectPolicy | null | undefined): DriveCollectPolicy {
  return driveCollectPolicySchema.parse(policy ?? {});
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
  const capabilities = sharingCapabilities(data.kind, data.capabilities, node);
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
      kind: data.kind,
      capabilities,
      expireAt,
      maxAccessCount: data.maxAccessCount ?? null,
      maxDownloadCount: data.maxDownloadCount ?? null,
      remark: data.remark ?? null,
      allowedIps: data.allowedIps,
      watermark: data.watermark,
      collectPolicy: data.kind === 'collect' ? normalizeCollectPolicy(data.collectPolicy) : null,
      tenantId: getCreateTenantId(currentUser()),
    }).returning();
    await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'share_create', shareId: created.id, detail: { kind: data.kind, capabilities } }, tx);
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
  kind?: DriveShareKind;
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
    case 'exhausted': return and(
      isNull(driveShareLinks.revokedAt), eq(driveShareLinks.enabled, true),
      or(isNull(driveShareLinks.expireAt), sql`${driveShareLinks.expireAt} > ${now}`),
      or(sql`${driveShareLinks.accessCount} >= ${driveShareLinks.maxAccessCount}`, sql`${driveShareLinks.downloadCount} >= ${driveShareLinks.maxDownloadCount}`),
    );
    case 'active': return and(
      isNull(driveShareLinks.revokedAt), eq(driveShareLinks.enabled, true),
      or(isNull(driveShareLinks.expireAt), sql`${driveShareLinks.expireAt} > ${now}`),
      or(isNull(driveShareLinks.maxAccessCount), sql`${driveShareLinks.accessCount} < ${driveShareLinks.maxAccessCount}`),
      or(isNull(driveShareLinks.maxDownloadCount), sql`${driveShareLinks.downloadCount} < ${driveShareLinks.maxDownloadCount}`),
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
    q.kind !== undefined ? eq(driveShareLinks.kind, q.kind) : undefined,
    stateCondition(q.state),
    nodeFilter,
    ...dateRangeConditions(driveShareLinks.createdAt, q.startTime, q.endTime),
    tenantCondition(driveShareLinks, currentUser()),
    extra,
  );
}

async function paginateShares(where: SQL | undefined, page: number, pageSize: number) {
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(driveShareLinks, where),
    rows: async () => {
      const rows = await withPagination(db.select().from(driveShareLinks).where(where).orderBy(desc(driveShareLinks.id)).$dynamic(), page, pageSize);
      return mapShareLinks(rows);
    },
  });
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
  const shareRow = requireRow(share, '外链不存在');
  const node = await ensureDriveNodeExists(shareRow.nodeId, { allowDeleted: true });
  const subjects = await loadDriveSubjects();
  if (shareRow.createdBy !== subjects.userId && !subjects.isAdmin) {
    const role = await resolveNodeRole(node);
    if (role !== 'manager') throw new HTTPException(403, { message: '只能管理自己创建的外链' });
  }
  return { share: shareRow, node };
}

export async function updateDriveShareLink(id: number, data: UpdateDriveShareLinkInput): Promise<DriveShareLink> {
  const { share, node } = await ensureShareEditable(id);
  if (share.revokedAt) throw new HTTPException(400, { message: '外链已撤销，不能修改' });
  const settings = await getDriveSettings();
  const patch: PgUpdateSetSource<typeof driveShareLinks> = {};
  let bumpSession = false;
  if (data.capabilities !== undefined) {
    patch.capabilities = sharingCapabilities(share.kind, data.capabilities, node);
    bumpSession = true;
  }
  if (data.remark !== undefined) patch.remark = data.remark;
  if (data.maxAccessCount !== undefined) patch.maxAccessCount = data.maxAccessCount;
  if (data.maxDownloadCount !== undefined) patch.maxDownloadCount = data.maxDownloadCount;
  if (data.enabled !== undefined) { patch.enabled = data.enabled; bumpSession = true; }
  if (data.allowedIps !== undefined) { patch.allowedIps = data.allowedIps; bumpSession = true; }
  if (data.watermark !== undefined) patch.watermark = data.watermark;
  if (data.collectPolicy !== undefined && share.kind === 'collect') patch.collectPolicy = normalizeCollectPolicy(data.collectPolicy);
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
    await disableShareShortLink(tx, id);
    await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'share_revoke', shareId: id }, tx);
  });
}

export async function deleteDriveShareLink(id: number): Promise<void> {
  const { share, node } = await ensureShareEditable(id);
  await db.transaction(async (tx) => {
    await tx.delete(driveShareLinks).where(eq(driveShareLinks.id, share.id));
    await tx.delete(shortLinks).where(and(eq(shortLinks.bizType, SHORT_LINK_BIZ), eq(shortLinks.bizRef, String(share.id))));
    await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'share_revoke', shareId: id, detail: { deleted: true } }, tx);
  });
}

/** 管理端撤销：不校验创建者（数据权限由列表收窄，此处只做租户校验） */
export async function adminRevokeDriveShareLink(id: number): Promise<void> {
  const [share] = await db.select().from(driveShareLinks).where(buildWhere(eq(driveShareLinks.id, id), tenantCondition(driveShareLinks, currentUser()))).limit(1);
  const shareRow = requireRow(share, '外链不存在');
  const [node] = await db.select().from(driveNodes).where(eq(driveNodes.id, shareRow.nodeId)).limit(1);
  await db.transaction(async (tx) => {
    await tx.update(driveShareLinks)
      .set({ revokedAt: new Date(), enabled: false, sessionVersion: sql`${driveShareLinks.sessionVersion} + 1` })
      .where(eq(driveShareLinks.id, id));
    await disableShareShortLink(tx, id);
    if (node) await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'share_revoke', shareId: id, detail: { byAdmin: true } }, tx);
  });
}

/** 撤销外链时同时停用其短链，避免短链继续跳到已失效的公开页 */
async function disableShareShortLink(tx: Pick<typeof db, 'update'>, shareId: number): Promise<void> {
  await tx.update(shortLinks).set({ status: 'disabled' })
    .where(and(eq(shortLinks.bizType, SHORT_LINK_BIZ), eq(shortLinks.bizRef, String(shareId))));
}

/** 公开页的绝对地址：短链目标必须是完整 URL */
function absolutePublicShareUrl(token: string): string {
  return `${config.publicBaseUrl}${drivePublicShareUrl(token)}`;
}

/** 为外链幂等生成短链（创建者或节点 manager） */
export async function ensureDriveShareShortLink(id: number): Promise<{ shortUrl: string }> {
  const { share, node } = await ensureShareEditable(id);
  if (shareLinkState(share) === 'revoked') throw new HTTPException(400, { message: '外链已撤销' });
  const token = decryptField(share.tokenEncrypted);
  if (!token) throw new HTTPException(500, { message: '外链令牌不可用' });
  const link = await ensureShortLink({
    targetUrl: absolutePublicShareUrl(token),
    bizType: SHORT_LINK_BIZ,
    bizRef: String(share.id),
    title: `网盘外链 · ${node.name}`.slice(0, 128),
    tenantId: share.tenantId ?? null,
  });
  if (link.status !== 'enabled') {
    await db.update(shortLinks).set({ status: 'enabled' }).where(eq(shortLinks.id, link.id));
  }
  return { shortUrl: link.shortUrl };
}

/** 文件收集的提交记录（创建者或节点 manager） */
export async function listCollectSubmissions(shareId: number, page = 1, pageSize = 20) {
  await ensureShareEditable(shareId);
  const where = eq(driveCollectSubmissions.shareId, shareId);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(driveCollectSubmissions, where),
    rows: async () => {
      const rows = await withPagination(db.select().from(driveCollectSubmissions).where(where).orderBy(desc(driveCollectSubmissions.id)).$dynamic(), page, pageSize);
      return rows.map((r): DriveCollectSubmission => ({
        id: r.id, shareId: r.shareId, nodeId: r.nodeId ?? null, fileName: r.fileName, size: r.size,
        submitterName: r.submitterName ?? null, submitterNote: r.submitterNote ?? null, clientIp: r.clientIp ?? null, createdAt: formatDateTime(r.createdAt),
      }));
    },
  });
}

export async function getShareLinkBeforeAudit(id: number) {
  const [share] = await db.select().from(driveShareLinks).where(eq(driveShareLinks.id, id)).limit(1);
  if (!share) return null;
  return { id: share.id, nodeId: share.nodeId, kind: share.kind, capabilities: share.capabilities, enabled: share.enabled, expireAt: formatNullableDateTime(share.expireAt), maxAccessCount: share.maxAccessCount, maxDownloadCount: share.maxDownloadCount, revokedAt: formatNullableDateTime(share.revokedAt) };
}

// ─── 公开访问 ─────────────────────────────────────────────────────────────────

function logShareAccess(share: DriveShareLinkRow, action: string, ok: boolean) {
  const createdAt = new Date();
  const clientIp = currentClientIp() || null;
  void ensureDriveLogPartitions(createdAt).then(() => db.insert(driveShareAccessLogs).values({
    shareId: share.id, nodeId: share.nodeId, action, clientIp, ok, createdAt,
  })).catch((err) => logger.warn({ err, shareId: share.id }, 'drive: 外链访问日志写入失败'));
}

async function findShareByToken(token: string): Promise<DriveShareLinkRow> {
  const [share] = await db.select().from(driveShareLinks).where(eq(driveShareLinks.token, hashToken(token))).limit(1);
  return requireRow(share, '链接不存在或已失效');
}

function assertShareUsable(share: DriveShareLinkRow, action: string, existingSession = false) {
  const state = shareLinkState(share);
  if (state !== 'active' && !(existingSession && state === 'exhausted')) {
    logShareAccess(share, action, false);
    const message = state === 'expired' ? '链接已过期' : state === 'exhausted' ? '链接访问次数已用尽' : '链接已停用';
    throw new HTTPException(403, { message });
  }
  if (!ipInAllowlist(currentClientIp(), share.allowedIps)) {
    logShareAccess(share, action, false);
    throw new HTTPException(403, { message: '当前网络不在该链接允许访问的范围内' });
  }
}

async function loadShareRoot(share: DriveShareLinkRow, subjects?: DriveSubjectSet): Promise<DriveNodeRow> {
  const [node] = await db.select().from(driveNodes).where(eq(driveNodes.id, share.nodeId)).limit(1);
  if (!node || node.deletedAt) throw new HTTPException(404, { message: '分享的文件已被删除' });
  const creator = subjects ?? await loadDriveSubjectsForUser(share.createdBy ?? 0);
  await ensureNodeRole(node, 'editor', '分享者已无权分享该文件', creator);
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
  const [names, settings] = await Promise.all([resolveUserNames([share.createdBy]), getDriveSettings()]);
  const sharerName = share.createdBy ? names.get(share.createdBy) ?? null : null;
  const policy = share.kind === 'collect' ? effectiveCollectPolicy(share, settings) : null;
  return {
    token,
    kind: share.kind,
    capabilities: share.capabilities,
    requirePassword: !!share.passwordHash,
    node: node ? toPublicNode(node, token) : null,
    expireAt: formatNullableDateTime(share.expireAt),
    sharerName,
    collectPolicy: policy,
    uploadCount: share.uploadCount,
    uploadsRemaining: policy?.maxUploads ? Math.max(0, policy.maxUploads - share.uploadCount) : null,
    watermarkText: share.watermark && node ? [sharerName ?? '分享', formatDateTime(new Date()).slice(0, 16), maskIp(currentClientIp())].filter(Boolean).join(' · ') : null,
  };
}

/** 单文件上限取链接策略与系统上限的较小者 */
function effectiveCollectPolicy(share: DriveShareLinkRow, settings: DriveSettings): DriveCollectPolicy & { maxFileSizeMb: number } {
  const policy = normalizeCollectPolicy(share.collectPolicy);
  const maxFileSizeMb = policy.maxFileSizeMb ? Math.min(policy.maxFileSizeMb, settings.collectMaxFileSizeMb) : settings.collectMaxFileSizeMb;
  return { ...policy, maxFileSizeMb };
}

/** 水印只展示 IP 尾段，避免公开页泄露完整访问者地址 */
function maskIp(ip: string): string {
  if (!ip) return '';
  const v4 = ip.split('.');
  if (v4.length === 4) return `*.*.${v4[2]}.${v4[3]}`;
  const parts = ip.split(':');
  return parts.length > 2 ? `…:${parts.slice(-2).join(':')}` : ip;
}

/** 无会话时的元信息（只暴露是否需要密码、分享人、有效期） */
export async function getDrivePublicShareMeta(token: string, sessionToken?: string): Promise<DrivePublicShareMeta> {
  const share = await findShareByToken(token);
  assertShareUsable(share, 'meta', !!sessionToken);
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
  assertShareUsable(share, action, true);
  const session = await readSession(sessionToken);
  if (session.shareId !== share.id || session.nodeId !== share.nodeId) throw new HTTPException(401, { message: '访问会话无效' });
  if (session.sessionVersion !== share.sessionVersion) throw new HTTPException(401, { message: '分享设置已更新，请重新验证' });
  const subjects = await loadDriveSubjectsForUser(share.createdBy ?? 0);
  const node = await loadShareRoot(share, subjects);
  return { share, node, subjects };
}

/** 外链子树内的节点：必须是根节点自身或其后代 */
async function ensureNodeWithinShare(root: DriveNodeRow, nodeId: number, subjects: DriveSubjectSet, minRole: DriveRole = 'viewer'): Promise<DriveNodeRow> {
  const [maybeNode] = nodeId === root.id ? [root] : await db.select().from(driveNodes).where(and(
    eq(driveNodes.id, nodeId),
    sql`${driveNodes.ancestorIds} @> ARRAY[${root.id}]::integer[]`,
    isNull(driveNodes.deletedAt),
  )).limit(1);
  const node = requireRow(maybeNode, '文件不存在');
  const path = [...node.ancestorIds, node.id];
  const ids = path.slice(path.indexOf(root.id));
  const accessible = await db.select({ id: driveNodes.id }).from(driveNodes).where(and(
    inArray(driveNodes.id, ids), eq(driveNodes.spaceId, root.spaceId), isNull(driveNodes.deletedAt), visibleNodeCondition(subjects, minRole),
  ));
  if (accessible.length !== ids.length) throw new HTTPException(404, { message: '文件不存在或不可分享' });
  return node;
}

export async function listDrivePublicChildren(token: string, sessionToken: string, parentId?: number): Promise<DrivePublicNode[]> {
  const { share, node: root, subjects } = await resolveShareSession(token, sessionToken, 'list');
  if (!share.capabilities.includes('preview')) throw new HTTPException(403, { message: '该链接不允许浏览文件' });
  if (root.type !== 'folder') return [toPublicNode(root, token)];
  const parent = parentId ? await ensureNodeWithinShare(root, parentId, subjects) : root;
  if (parent.type !== 'folder') throw new HTTPException(400, { message: '目标不是文件夹' });
  const rows = await db.select().from(driveNodes).where(and(eq(driveNodes.parentId, parent.id), isNull(driveNodes.deletedAt), visibleNodeCondition(subjects)))
    .orderBy(sql`case when ${driveNodes.type} = 'folder' then 0 else 1 end`, asc(sql`lower(${driveNodes.name})`));
  logShareAccess(share, 'list', true);
  return rows.map((r) => toPublicNode(r, token));
}

export async function prepareDrivePublicContent(token: string, sessionToken: string, nodeId: number, download: boolean) {
  const { share, node: root, subjects } = await resolveShareSession(token, sessionToken, download ? 'download' : 'preview');
  if (!share.capabilities.includes(download ? 'download' : 'preview')) throw new HTTPException(403, { message: '该外链不允许此操作' });
  const node = await ensureNodeWithinShare(root, nodeId, subjects, download ? 'downloader' : 'viewer');
  if (node.type !== 'file' || !node.fileId) throw new HTTPException(400, { message: '文件夹没有内容' });
  const { file, storageConfig } = await getRestrictedFileForRead(node.fileId);
  return { share, node, file, storageConfig, download, sessionToken };
}

export async function openDrivePublicContent(
  prepared: Awaited<ReturnType<typeof prepareDrivePublicContent>>,
  range?: StoredFileRange | null,
) {
  const { share, node, file, storageConfig, download, sessionToken } = prepared;
  const firstDownload = download ? await admitShareDownload(share, `${hashToken(sessionToken)}:${file.id}`) : false;
  if (firstDownload || (!download && (!range || range.start === 0))) {
    logShareAccess(share, download ? 'download' : 'preview', true);
    await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: 'file', action: download ? 'download' : 'preview', shareId: share.id, actorId: currentUserOrNull()?.userId ?? null, tenantId: share.tenantId ?? null, detail: { viaShare: true } });
  }
  const stored = await readStoredFile(file, storageConfig, range ?? undefined);
  return { node, file, stored };
}

/** 登录用户把外链内容转存到自己可写的目录 */
export async function saveFromDriveShare(token: string, sessionToken: string, data: SaveFromDriveShareInput): Promise<number> {
  const { share, node: root, subjects } = await resolveShareSession(token, sessionToken, 'save');
  if (!share.capabilities.includes('download')) throw new HTTPException(403, { message: '该外链仅允许在线预览，不能转存' });
  const sources = data.nodeIds?.length
    ? await Promise.all(data.nodeIds.map((id) => ensureNodeWithinShare(root, id, subjects, 'downloader')))
    : [root];
  const { space, parent, ancestorIds } = await resolveWritableParent(data.targetSpaceId, data.targetParentId);
  const subtrees = await Promise.all(sources.map((s) => loadAccessibleSubtree(s.id, 'downloader', subjects)));
  await claimShareDownload(share);
  const settings = await getDriveSettings();
  const copied = await db.transaction(async (tx) => {
    let count = 0;
    for (const subtree of subtrees) count += await copySubtree(tx, subtree, space, parent, ancestorIds, settings);
    return count;
  });
  logShareAccess(share, 'save', true);
  await logDriveActivity({ spaceId: root.spaceId, nodeId: root.id, nodeName: root.name, nodeType: root.type, action: 'save_from_share', shareId: share.id, detail: { copied, targetSpaceId: space.id } });
  return copied;
}

function sharingCapabilities(kind: DriveShareKind, capabilities: DriveShareCapability[], node: Pick<DriveNodeRow, 'type'>): DriveShareCapability[] {
  if (kind === 'share') {
    if (capabilities.includes('upload')) throw new HTTPException(400, { message: '分享链接不能包含上传能力，请创建文件收集链接' });
    return normalizeDriveShareCapabilities(capabilities);
  }
  if (node.type !== 'folder') throw new HTTPException(400, { message: '文件收集链接只能建立在文件夹上' });
  if (capabilities.includes('download')) throw new HTTPException(400, { message: '文件收集链接不允许下载，请另建分享链接' });
  return normalizeDriveShareCapabilities([...new Set<DriveShareCapability>([...capabilities, 'upload'])]);
}

/** 上限内原子占用一个收集名额；失败即拒绝上传（并发提交不会超额） */
async function claimCollectUpload(share: DriveShareLinkRow, maxUploads: number | null): Promise<void> {
  const [claimed] = await db.update(driveShareLinks).set({ uploadCount: sql`${driveShareLinks.uploadCount} + 1` })
    .where(and(
      eq(driveShareLinks.id, share.id), eq(driveShareLinks.sessionVersion, share.sessionVersion),
      eq(driveShareLinks.enabled, true), isNull(driveShareLinks.revokedAt),
      or(isNull(driveShareLinks.expireAt), sql`${driveShareLinks.expireAt} > now()`),
      maxUploads ? sql`${driveShareLinks.uploadCount} < ${maxUploads}` : sql`true`,
    )).returning({ id: driveShareLinks.id });
  if (!claimed) throw new HTTPException(403, { message: '链接已失效或收集数量已达上限' });
}

/**
 * 文件收集：匿名提交者向目标文件夹上传。以链接创建者身份落盘（配额 / 内容策略 / 去重复用），
 * 冲突一律自动重命名，动态记为 collect_upload 且 actor 为空，提交人信息进 drive_collect_submissions。
 */
export async function uploadToDriveCollect(token: string, sessionToken: string, file: File, fields: DrivePublicUploadFields): Promise<DrivePublicUploadResult> {
  const { share, node: root } = await resolveShareSession(token, sessionToken, 'upload');
  if (share.kind !== 'collect' || !share.capabilities.includes('upload')) throw new HTTPException(403, { message: '该链接不接受文件提交' });
  if (root.type !== 'folder') throw new HTTPException(400, { message: '收集目标不是文件夹' });
  const settings = await getDriveSettings();
  const policy = effectiveCollectPolicy(share, settings);
  const submitterName = fields.submitterName?.trim() || null;
  if (policy.requireSubmitter && !submitterName) throw new HTTPException(400, { message: '请填写提交人姓名' });
  if (!file.name || file.size <= 0) throw new HTTPException(400, { message: '请选择要提交的文件' });
  if (file.size > policy.maxFileSizeMb * 1024 * 1024) throw new HTTPException(400, { message: `文件大小超过上限（${policy.maxFileSizeMb}MB）` });
  const extension = extensionOf(file.name);
  if (policy.allowedExtensions.length > 0 && (!extension || !policy.allowedExtensions.includes(extension))) {
    throw new HTTPException(400, { message: `只接受以下类型的文件：${policy.allowedExtensions.join('、')}` });
  }
  const actor = share.createdBy ? await loadDriveActorPayload(share.createdBy) : null;
  if (!actor) throw new HTTPException(403, { message: '链接创建者已停用，无法接收文件' });
  const clientIp = currentClientIp() || null;
  await claimCollectUpload(share, policy.maxUploads);
  let node;
  try {
    node = await runWithCurrentUser(actor, () => uploadBufferAsNode(file, {
      spaceId: root.spaceId, parentId: root.id, conflictPolicy: 'rename',
      maxBytes: policy.maxFileSizeMb * 1024 * 1024, touchRecent: false,
      activity: { action: 'collect_upload', actorId: null, shareId: share.id, detail: { submitterName, viaShare: true } },
    }));
  } catch (err) {
    await db.update(driveShareLinks).set({ uploadCount: sql`greatest(${driveShareLinks.uploadCount} - 1, 0)` }).where(eq(driveShareLinks.id, share.id));
    logShareAccess(share, 'upload', false);
    throw err;
  }
  const [submission] = await db.insert(driveCollectSubmissions).values({
    shareId: share.id, nodeId: node.id, fileName: node.name, size: node.size, submitterName, submitterNote: fields.submitterNote?.trim() || null, clientIp,
  }).returning();
  logShareAccess(share, 'upload', true);
  void notifyCollectReceived(share, root, node.name, submitterName ?? '匿名用户');
  return { id: node.id, name: node.name, size: node.size, submittedAt: formatDateTime(submission.createdAt) };
}

/** A file is counted once per share session, including parallel media ranges and retries. */
async function admitShareDownload(share: DriveShareLinkRow, receipt: string): Promise<boolean> {
  const key = `${SESSION_PREFIX}download:${share.id}:${share.sessionVersion}:${receipt}`;
  if (await redis.get(key) === 'granted') return false;
  const lock = randomBytes(16).toString('hex');
  if (!await redis.set(key, lock, 'EX', 30, 'NX')) {
    if (await redis.get(key) === 'granted') return false;
    throw new HTTPException(409, { message: '下载正在准备，请稍后重试' });
  }
  try {
    await claimShareDownload(share);
    await redis.set(key, 'granted', 'EX', DRIVE_SHARE_SESSION_TTL_SECONDS);
    return true;
  } catch (err) {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", 1, key, lock);
    throw err;
  }
}

async function claimShareDownload(share: DriveShareLinkRow): Promise<void> {
  const [claimed] = await db.update(driveShareLinks).set({ downloadCount: sql`${driveShareLinks.downloadCount} + 1` })
    .where(and(
      eq(driveShareLinks.id, share.id), eq(driveShareLinks.sessionVersion, share.sessionVersion),
      eq(driveShareLinks.enabled, true), isNull(driveShareLinks.revokedAt),
      or(isNull(driveShareLinks.expireAt), sql`${driveShareLinks.expireAt} > now()`),
      or(isNull(driveShareLinks.maxDownloadCount), sql`${driveShareLinks.downloadCount} < ${driveShareLinks.maxDownloadCount}`),
    )).returning({ id: driveShareLinks.id });
  if (!claimed) throw new HTTPException(403, { message: '链接已失效或下载次数已用尽' });
}

/** 外链访问日志（创建者 / manager / 管理员） */
export async function listShareAccessLogs(shareId: number, page = 1, pageSize = 20) {
  await ensureShareEditable(shareId);
  const where = eq(driveShareAccessLogs.shareId, shareId);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(driveShareAccessLogs, where),
    rows: () => withPagination(db.select().from(driveShareAccessLogs).where(where).orderBy(desc(driveShareAccessLogs.id)).$dynamic(), page, pageSize),
    map: (r) => ({ id: r.id, shareId: r.shareId, nodeId: r.nodeId, action: r.action, clientIp: r.clientIp ?? null, ok: r.ok, createdAt: formatDateTime(r.createdAt) }),
  });
}