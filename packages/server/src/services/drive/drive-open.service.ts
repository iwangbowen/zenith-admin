import { HTTPException } from 'hono/http-exception';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import {
  driveRoleAtLeast,
  openDriveContract,
  type CreateDriveOpenAppGrantInput,
  type DriveOpenAppGrant,
  type DriveRole,
  type OpenDriveNode,
  type OpenDriveSpace,
} from '@zenith/shared/drive';
import { db } from '../../db';
import { driveNodes, driveOpenAppGrants, driveSpaces, oauth2Clients, type DriveNodeRow, type DriveOpenAppGrantRow, type DriveSpaceRow } from '../../db/schema';
import { currentUser, runWithCurrentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { readStoredFile, type StoredFileRange } from '../../lib/file-storage';
import { buildListResult } from '../../lib/list-query';
import { exactTenantCondition, getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import type { OpenPrincipal } from '../../middleware/open-gateway';
import { getRestrictedFileForRead } from '../files/files.service';
import { logDriveActivity } from './drive-activity.service';
import { loadDriveActorPayload } from './drive-common';
import { legalHoldNodeIds } from './drive-governance.service';
import { effectiveQuotaBytes, getDriveSettings } from './drive-settings.service';
import { ensureDriveSpaceExists } from './drive-spaces.service';
import { uploadBufferAsNode } from './drive-upload.service';

/**
 * 网盘 × 开放平台。
 *
 * - 治理侧维护「开放应用 → 空间」授权（drive_open_app_grants），是开放 API 与 Webhook 的唯一可见性来源；
 * - 开放 API 调用主体是应用（无管理员上下文），因此不走 currentUser()/tenantCondition，
 *   一律以 principal.tenantId + 授权空间集合收窄；对外不暴露对象 id、存储路径与操作人。
 */

// ─── 治理：授权维护 ───────────────────────────────────────────────────────────

async function mapGrants(rows: DriveOpenAppGrantRow[]): Promise<DriveOpenAppGrant[]> {
  if (rows.length === 0) return [];
  const [apps, spaces] = await Promise.all([
    db.select({ clientId: oauth2Clients.clientId, name: oauth2Clients.name }).from(oauth2Clients).where(inArray(oauth2Clients.clientId, [...new Set(rows.map((r) => r.clientId))])),
    db.select({ id: driveSpaces.id, name: driveSpaces.name }).from(driveSpaces).where(inArray(driveSpaces.id, [...new Set(rows.map((r) => r.spaceId))])),
  ]);
  const appMap = new Map(apps.map((a) => [a.clientId, a.name]));
  const spaceMap = new Map(spaces.map((s) => [s.id, s.name]));
  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    appName: appMap.get(r.clientId) ?? null,
    spaceId: r.spaceId,
    spaceName: spaceMap.get(r.spaceId) ?? '',
    role: r.role,
    status: r.status,
    remark: r.remark ?? null,
    createdAt: formatDateTime(r.createdAt),
  }));
}

export async function listOpenAppGrants(q: { spaceId?: number; clientId?: string }): Promise<DriveOpenAppGrant[]> {
  const rows = await db.select().from(driveOpenAppGrants).where(buildWhere(
    q.spaceId !== undefined ? eq(driveOpenAppGrants.spaceId, q.spaceId) : undefined,
    q.clientId ? eq(driveOpenAppGrants.clientId, q.clientId) : undefined,
    tenantCondition(driveOpenAppGrants, currentUser()),
  )).orderBy(desc(driveOpenAppGrants.id)).limit(200);
  return mapGrants(rows);
}

export async function createOpenAppGrant(data: CreateDriveOpenAppGrantInput): Promise<DriveOpenAppGrant> {
  const user = currentUser();
  const space = await ensureDriveSpaceExists(data.spaceId);
  if (space.type === 'personal') throw new HTTPException(400, { message: '个人空间不能授权给开放应用' });
  const [app] = await db.select({ clientId: oauth2Clients.clientId, tenantId: oauth2Clients.tenantId }).from(oauth2Clients)
    .where(buildWhere(eq(oauth2Clients.clientId, data.clientId), tenantCondition(oauth2Clients, user))).limit(1);
  const client = requireRow(app, '开放应用不存在', 400);
  if ((client.tenantId ?? null) !== (space.tenantId ?? null)) throw new HTTPException(400, { message: '应用与空间不属于同一租户' });
  const [row] = await db.insert(driveOpenAppGrants).values({
    clientId: client.clientId, spaceId: space.id, role: data.role, remark: data.remark?.trim() || null, status: 'enabled', tenantId: getCreateTenantId(user),
  }).onConflictDoUpdate({
    target: [driveOpenAppGrants.clientId, driveOpenAppGrants.spaceId],
    set: { role: data.role, remark: data.remark?.trim() || null, status: 'enabled' },
  }).returning();
  const [dto] = await mapGrants([row]);
  return dto;
}

export async function removeOpenAppGrant(id: number): Promise<void> {
  const [row] = await db.delete(driveOpenAppGrants).where(buildWhere(eq(driveOpenAppGrants.id, id), tenantCondition(driveOpenAppGrants, currentUser()))).returning();
  requireRow(row, '授权不存在');
}

export async function getOpenAppGrantBeforeAudit(id: number) {
  const [row] = await db.select().from(driveOpenAppGrants).where(eq(driveOpenAppGrants.id, id)).limit(1);
  return row ? { id: row.id, clientId: row.clientId, spaceId: row.spaceId, role: row.role, status: row.status } : null;
}

/** Webhook 订阅匹配：某应用是否被授权访问该空间（启用中） */
export async function clientIdsGrantedForSpace(spaceId: number, clientIds: string[]): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set();
  const rows = await db.select({ clientId: driveOpenAppGrants.clientId }).from(driveOpenAppGrants).where(and(
    eq(driveOpenAppGrants.spaceId, spaceId), eq(driveOpenAppGrants.status, 'enabled'), inArray(driveOpenAppGrants.clientId, clientIds),
  ));
  return new Set(rows.map((r) => r.clientId));
}

// ─── 开放 API：应用视角 ───────────────────────────────────────────────────────

interface GrantedSpace {
  space: DriveSpaceRow;
  grant: DriveOpenAppGrantRow;
}

async function loadGrantedSpaces(principal: OpenPrincipal): Promise<GrantedSpace[]> {
  const rows = await db.select({ space: driveSpaces, grant: driveOpenAppGrants }).from(driveOpenAppGrants)
    .innerJoin(driveSpaces, eq(driveSpaces.id, driveOpenAppGrants.spaceId))
    .where(and(
      eq(driveOpenAppGrants.clientId, principal.app.clientId),
      eq(driveOpenAppGrants.status, 'enabled'),
      exactTenantCondition(driveOpenAppGrants.tenantId, principal.tenantId),
      eq(driveSpaces.status, 'enabled'),
    ))
    .orderBy(asc(driveSpaces.type), asc(driveSpaces.sort), asc(driveSpaces.id));
  return rows;
}

async function requireGrantedSpace(principal: OpenPrincipal, spaceId: number, minRole: DriveRole): Promise<GrantedSpace> {
  const row = await requireFirstRow(
    db.select({ space: driveSpaces, grant: driveOpenAppGrants }).from(driveOpenAppGrants)
      .innerJoin(driveSpaces, eq(driveSpaces.id, driveOpenAppGrants.spaceId))
      .where(and(
        eq(driveOpenAppGrants.clientId, principal.app.clientId), eq(driveOpenAppGrants.spaceId, spaceId),
        eq(driveOpenAppGrants.status, 'enabled'), exactTenantCondition(driveOpenAppGrants.tenantId, principal.tenantId),
        eq(driveSpaces.status, 'enabled'),
      )).limit(1),
    '空间不存在或未授权给当前应用',
  );
  if (!driveRoleAtLeast(row.grant.role, minRole)) throw new HTTPException(403, { message: '应用在该空间的授权角色不足' });
  return row;
}

export async function listOpenDriveSpaces(principal: OpenPrincipal): Promise<OpenDriveSpace[]> {
  const rows = await loadGrantedSpaces(principal);
  if (rows.length === 0) return [];
  const settings = await getDriveSettings({ tenantId: principal.tenantId });
  return rows.map(({ space, grant }) => ({
    id: space.id, name: space.name, type: space.type, role: grant.role, archived: !!space.archivedAt,
    usedBytes: space.usedBytes, quotaBytes: effectiveQuotaBytes(settings, space),
  }));
}

function mapOpenNode(row: DriveNodeRow, held: Set<number>): OpenDriveNode {
  return {
    id: row.id,
    spaceId: row.spaceId,
    parentId: row.parentId ?? null,
    type: row.type,
    name: row.name,
    extension: row.extension ?? null,
    mimeType: row.mimeType ?? null,
    size: row.size,
    contentHash: row.contentHash ?? null,
    version: row.currentVersion,
    legalHold: held.has(row.id),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function listOpenDriveNodes(principal: OpenPrincipal, q: QueryOutputOf<typeof openDriveContract.nodes>) {
  const { page, pageSize } = q;
  await requireGrantedSpace(principal, q.spaceId, 'viewer');
  const keyword = q.keyword?.trim();
  const parentCondition: SQL | undefined = keyword
    ? undefined
    : q.parentId !== undefined ? eq(driveNodes.parentId, q.parentId) : isNull(driveNodes.parentId);
  if (q.parentId !== undefined) {
    await requireFirstRow(
      db.select({ id: driveNodes.id }).from(driveNodes)
        .where(and(eq(driveNodes.id, q.parentId), eq(driveNodes.spaceId, q.spaceId), eq(driveNodes.type, 'folder'), isNull(driveNodes.deletedAt))).limit(1),
      '父文件夹不存在',
    );
  }
  const where = buildWhere(
    eq(driveNodes.spaceId, q.spaceId),
    isNull(driveNodes.deletedAt),
    parentCondition,
    keywordCondition(keyword, [driveNodes.name], 'ilike'),
    q.type ? eq(driveNodes.type, q.type) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(driveNodes, where),
    rows: async () => {
      const rows = await withPagination(
        db.select().from(driveNodes).where(where).orderBy(sql`case when ${driveNodes.type} = 'folder' then 0 else 1 end`, asc(driveNodes.name), asc(driveNodes.id)).$dynamic(),
        page, pageSize,
      );
      const held = await legalHoldNodeIds(rows);
      return rows.map((row) => mapOpenNode(row, held));
    },
  });
}

async function requireOpenNode(principal: OpenPrincipal, id: number, minRole: DriveRole): Promise<{ node: DriveNodeRow; granted: GrantedSpace }> {
  const node = await requireFirstRow(db.select().from(driveNodes).where(and(eq(driveNodes.id, id), isNull(driveNodes.deletedAt))).limit(1), '节点不存在');
  // 先按空间授权判定；未授权空间的节点对应用表现为不存在，避免探测
  let granted: GrantedSpace;
  try {
    granted = await requireGrantedSpace(principal, node.spaceId, minRole);
  } catch (err) {
    if (err instanceof HTTPException && err.status === 404) throw new HTTPException(404, { message: '节点不存在' });
    throw err;
  }
  return { node, granted };
}

export async function getOpenDriveNode(principal: OpenPrincipal, id: number): Promise<OpenDriveNode> {
  const { node } = await requireOpenNode(principal, id, 'viewer');
  return mapOpenNode(node, await legalHoldNodeIds([node]));
}

export async function prepareOpenDriveContent(principal: OpenPrincipal, id: number) {
  const { node } = await requireOpenNode(principal, id, 'downloader');
  if (node.type !== 'file' || !node.fileId) throw new HTTPException(400, { message: '文件夹没有内容' });
  const { file, storageConfig } = await getRestrictedFileForRead(node.fileId);
  return { node, file, storageConfig };
}

export async function openOpenDriveContent(prepared: Awaited<ReturnType<typeof prepareOpenDriveContent>>, principal: OpenPrincipal, range: StoredFileRange | null) {
  const stored = await readStoredFile(prepared.file, prepared.storageConfig, range ?? undefined);
  if (!range || range.start === 0) {
    await logDriveActivity({
      spaceId: prepared.node.spaceId, nodeId: prepared.node.id, nodeName: prepared.node.name, nodeType: 'file', action: 'download',
      actorId: principal.userId, tenantId: principal.tenantId, detail: { viaOpenApp: principal.app.clientId },
    });
  }
  return stored;
}

export interface OpenDriveUploadInput {
  spaceId: number;
  parentId: number | null;
  conflictPolicy: 'rename' | 'version' | 'fail';
}

/**
 * 开放应用上传：以授权人（授权记录的创建者）身份落盘，复用配额 / 内容策略 / 去重 / 冲突策略；
 * 动态 actor 为令牌用户（client_credentials 与签名通道为空），detail 标注应用。
 */
export async function uploadOpenDriveFile(principal: OpenPrincipal, file: File, input: OpenDriveUploadInput): Promise<OpenDriveNode> {
  const { grant } = await requireGrantedSpace(principal, input.spaceId, 'editor');
  const actor = grant.createdBy ? await loadDriveActorPayload(grant.createdBy) : null;
  if (!actor) throw new HTTPException(403, { message: '授权人已停用，应用无法上传；请重新授权' });
  if (!file.name || file.size <= 0) throw new HTTPException(400, { message: '请提供要上传的文件' });
  const node = await runWithCurrentUser(actor, () => uploadBufferAsNode(file, {
    spaceId: input.spaceId, parentId: input.parentId, conflictPolicy: input.conflictPolicy, touchRecent: false,
    activity: { action: 'upload', actorId: principal.userId, detail: { viaOpenApp: principal.app.clientId } },
  }));
  const [row] = await db.select().from(driveNodes).where(eq(driveNodes.id, node.id)).limit(1);
  return mapOpenNode(requireRow(row, '上传结果不可读'), new Set());
}
