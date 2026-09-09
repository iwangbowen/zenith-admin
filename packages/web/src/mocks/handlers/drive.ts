import { HttpResponse } from 'msw';
import { fillPath } from '@zenith/shared/core';
import {
  DRIVE_SYNC_ZIP_MAX_FILES,
  normalizeDriveShareCapabilities,
  isOrphanedDriveSpace,
  driveAccessRequestContract,
  driveCollaborationContract,
  driveAdminContract,
  driveNodeContract,
  drivePublicShareContract,
  driveShareLinkContract,
  driveSpaceContract,
  driveTagContract,
  type DriveAccessRequest,
  type DriveLegalHold,
  type DriveNode,
  type DriveNodeDetail,
  type DriveNodeListResult,
  type DriveNodePermissionsResult,
  type DriveNodeProfile,
  type DriveOpenAppGrant,
  type DrivePublicNode,
  type DrivePublicShareMeta,
  type DriveQuotaRequest,
  type DriveShareLink,
  type DriveShareLinkState,
  type DriveSpace,
  type DriveSubjectType,
  type DriveTag,
} from '@zenith/shared/drive';
import { mock } from '@/mocks/utils/contract';
import { requireItem, updateItem } from '@/mocks/utils/crud';
import { badRequest, conflict, forbidden, locked, notFound, unauthorized } from '@/mocks/utils/handlers';
import { mockDateTime } from '@/mocks/utils/date';
import { removeWhere } from '@/mocks/utils/array';
import { createImmediateMockTask } from './async-tasks';
import { filterByKeyword } from '@/mocks/utils/filter';
import {
  MOCK_USER,
  getNextDriveCommentId,
  getNextDriveNodeId,
  getNextDrivePermissionId,
  getNextDriveShareId,
  getNextDriveSpaceId,
  getNextDriveTagId,
  getNextDriveVersionId,
  logMockDriveActivity,
  mockDriveAccessRequests,
  mockDriveActivities,
  mockDriveCollectSubmissions,
  mockDriveComments,
  mockDriveContentUrl,
  mockDriveMembers,
  mockDriveNodeTags,
  mockDriveNodes,
  mockDrivePermissions,
  mockDriveRecent,
  mockDriveSettings,
  mockDriveShareAccessLogs,
  mockDriveShareLinks,
  mockDriveSharePasswords,
  mockDriveShareSessions,
  mockDriveSpaces,
  mockDriveStars,
  mockDriveTags,
  mockDriveTexts,
  mockDriveThumbnailUrl,
  mockDriveVersions,
  recalcMockDriveUsage,
} from '../data/drive';

// ─── 工具 ─────────────────────────────────────────────────────────────────────

const SUBJECT_NAMES: Record<DriveSubjectType, Record<number, string>> = {
  user: { 1: '管理员', 2: '张三', 3: '李四' },
  department: { 1: '总部', 2: '研发部', 3: '市场部' },
  role: { 1: '超级管理员', 2: '普通用户' },
  user_group: { 1: '产品组', 2: '运维组' },
};

const SHARE_STATE_MESSAGES: Record<DriveShareLinkState, string> = {
  active: '', expired: '链接已过期', exhausted: '链接访问次数已用尽', disabled: '链接已停用', revoked: '链接已撤销',
};

function subjectName(type: DriveSubjectType, id: number): string {
  return SUBJECT_NAMES[type]?.[id] ?? `${type}#${id}`;
}

function liveNodes(): DriveNode[] {
  return mockDriveNodes.filter((n) => !n.deletedAt);
}

function findNode(id: number): DriveNode | undefined {
  return mockDriveNodes.find((n) => n.id === id);
}

function spaceName(spaceId: number): string {
  return mockDriveSpaces.find((s) => s.id === spaceId)?.name ?? '';
}

function decorate(node: DriveNode): DriveNode {
  const tagIds = mockDriveNodeTags.get(node.id) ?? [];
  return { ...node, isStarred: mockDriveStars.has(node.id), tags: mockDriveTags.filter((t) => tagIds.includes(t.id)) };
}

/** 个人视图列表项：节点 + 所在空间名 */
function withSpaceName(node: DriveNode) {
  return { ...decorate(node), spaceName: spaceName(node.spaceId) };
}

function breadcrumbsOf(node: DriveNode | null) {
  if (!node) return [];
  return [...node.ancestorIds, node.id].map((id) => findNode(id)).filter((n): n is DriveNode => !!n).map((n) => ({ id: n.id, name: n.name }));
}

function detailOf(node: DriveNode): DriveNodeDetail {
  const space = mockDriveSpaces.find((s) => s.id === node.spaceId);
  return {
    ...decorate(node),
    spaceName: space?.name ?? '', spaceType: space?.type ?? 'personal',
    breadcrumbs: breadcrumbsOf(node.parentId ? findNode(node.parentId) ?? null : null),
    versionCount: node.type === 'file' ? Math.max(1, mockDriveVersions.filter((v) => v.nodeId === node.id).length) : 0,
    shareLinkCount: mockDriveShareLinks.filter((l) => l.nodeId === node.id && l.state === 'active').length,
    childCount: node.type === 'folder' ? liveNodes().filter((n) => n.parentId === node.id).length : 0,
    legalHold: isHeld(node),
    spaceArchived: !!space?.archivedAt,
  };
}

// ─── 治理：法律保留 / 扩容申请 / 开放应用授权（Demo 内存态）─────────────────────

const mockLegalHolds: DriveLegalHold[] = [];
const mockQuotaRequests: DriveQuotaRequest[] = [];
const mockOpenGrants: DriveOpenAppGrant[] = [];
let nextHoldId = 1;
let nextQuotaRequestId = 1;
let nextGrantId = 1;

/** 自身或祖先处于生效保留 */
function isHeld(node: Pick<DriveNode, 'id' | 'ancestorIds'>): boolean {
  return mockLegalHolds.some((h) => h.active && (h.nodeId === node.id || node.ancestorIds.includes(h.nodeId)));
}

/** 根集合（含子树）被保留覆盖时返回 423，供删除 / 彻底删除 / 跨空间移动复用 */
function legalHoldBlock(roots: DriveNode[], action: string) {
  for (const root of roots) {
    if (isHeld(root)) return locked(`「${root.name}」处于法律保留，${action}被拒绝`, { status: 423 });
    const hit = mockLegalHolds.find((h) => h.active && subtree(root.id).some((n) => n.id === h.nodeId));
    if (hit) return locked(`「${root.name}」涉及的「${hit.nodeName}」处于法律保留，${action}被拒绝`, { status: 423 });
  }
  return null;
}

function archivedBlock(spaceId: number) {
  const space = mockDriveSpaces.find((s) => s.id === spaceId);
  if (!space?.archivedAt) return null;
  return locked('空间已归档，仅可查看与下载；如需修改请先恢复归档', { status: 423 });
}

function subtree(rootId: number): DriveNode[] {
  return mockDriveNodes.filter((n) => n.id === rootId || n.ancestorIds.includes(rootId));
}

function sortNodes(list: DriveNode[], sortBy: string, order: string): DriveNode[] {
  const dir = order === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    switch (sortBy) {
      case 'size': return (a.size - b.size) * dir;
      case 'updatedAt': return a.updatedAt.localeCompare(b.updatedAt) * dir;
      case 'createdAt': return a.createdAt.localeCompare(b.createdAt) * dir;
      default: return a.name.localeCompare(b.name, 'zh-CN') * dir;
    }
  });
}

function uniqueName(name: string, spaceId: number, parentId: number | null, excludeId?: number): string {
  const siblings = liveNodes().filter((n) => n.spaceId === spaceId && n.parentId === parentId && n.id !== excludeId).map((n) => n.name.toLowerCase());
  if (!siblings.includes(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; ; i++) {
    const candidate = `${base}(${i})${ext}`;
    if (!siblings.includes(candidate.toLowerCase())) return candidate;
  }
}

function shareState(link: DriveShareLink): DriveShareLinkState {
  if (link.revokedAt) return 'revoked';
  if (!link.enabled) return 'disabled';
  if (link.expireAt && link.expireAt <= mockDateTime()) return 'expired';
  if (link.maxAccessCount && link.accessCount >= link.maxAccessCount) return 'exhausted';
  if (link.maxDownloadCount && link.downloadCount >= link.maxDownloadCount) return 'exhausted';
  return 'active';
}

function withState(link: DriveShareLink): DriveShareLink {
  const node = findNode(link.nodeId);
  return { ...link, state: shareState(link), nodeName: node?.name ?? link.nodeName };
}

function svgPlaceholder(label: string): string {
  const hue = Array.from(label).reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="hsl(${hue} 60% 55%)"/><circle cx="320" cy="180" r="110" fill="hsl(${(hue + 40) % 360} 80% 70%)"/><text x="320" y="360" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`;
}

function contentResponse(node: DriveNode, download: boolean): Response {
  const isImage = node.mimeType?.startsWith('image/');
  const body = isImage ? svgPlaceholder(node.name) : (mockDriveTexts.get(node.id) ?? `这是演示模式下「${node.name}」的占位内容。`);
  const type = isImage ? 'image/svg+xml' : (node.mimeType?.startsWith('text/') ? `${node.mimeType}; charset=utf-8` : 'text/plain; charset=utf-8');
  const headers: Record<string, string> = { 'Content-Type': type };
  if (download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(node.name)}`;
  return new HttpResponse(body, { status: 200, headers });
}

function toPublicNode(node: DriveNode, token: string): DrivePublicNode {
  return {
    id: node.id, parentId: node.parentId, type: node.type, name: node.name, extension: node.extension, mimeType: node.mimeType, size: node.size,
    url: node.type === 'file' ? fillPath(drivePublicShareContract.content.fullPath, { token, nodeId: node.id }) : null, updatedAt: node.updatedAt,
  };
}

function permissionsResult(node: DriveNode): DriveNodePermissionsResult {
  const direct = mockDrivePermissions.filter((p) => p.nodeId === node.id).map((p) => ({ ...p, inheritedFrom: null }));
  const inherited = node.inheritPermissions
    ? node.ancestorIds.flatMap((aid) => {
      const anc = findNode(aid);
      return mockDrivePermissions.filter((p) => p.nodeId === aid).map((p) => ({ ...p, inheritedFrom: anc ? { id: anc.id, name: anc.name } : null }));
    })
    : [];
  return { nodeId: node.id, inheritPermissions: node.inheritPermissions, spaceRole: 'manager', effectiveRole: 'manager', direct, inherited };
}

function softDelete(ids: number[]) {
  const now = mockDateTime();
  for (const id of ids) {
    for (const n of subtree(id)) {
      if (n.deletedAt) continue;
      n.deletedAt = now; n.deletedBy = MOCK_USER.id; n.deletedByName = MOCK_USER.name;
      (n as DriveNode & { deletedRootId?: number }).deletedRootId = id;
    }
    const root = findNode(id);
    if (root) logMockDriveActivity({ spaceId: root.spaceId, nodeId: root.id, nodeName: root.name, nodeType: root.type, action: 'delete', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: null });
  }
}

interface NodeFilter {
  keyword?: string;
  spaceId?: number;
  type?: DriveNode['type'];
  tagId?: number;
  createdBy?: number;
  extension?: string;
  startTime?: string;
  endTime?: string;
}

function filterNodes<T extends DriveNode>(list: T[], q: NodeFilter): T[] {
  const keyword = q.keyword?.trim().toLowerCase();
  return filterByKeyword(list, keyword, [(n) => n.name], { caseInsensitive: true })
    .filter((n) => (!q.spaceId || n.spaceId === q.spaceId) && (!q.type || n.type === q.type)
      && (!q.tagId || (mockDriveNodeTags.get(n.id) ?? []).includes(q.tagId))
      && (!q.createdBy || n.createdBy === q.createdBy)
      && (!q.extension || n.extension === q.extension.toLowerCase().replace(/^\./, ''))
      && (!q.startTime || n.updatedAt >= q.startTime)
      && (!q.endTime || n.updatedAt <= (q.endTime.length === 10 ? `${q.endTime} 23:59:59` : q.endTime)));
}

function quotaFallbackGb(type: DriveSpace['type']): number {
  return type === 'personal' ? mockDriveSettings.personalQuotaGb : type === 'department' ? mockDriveSettings.departmentQuotaGb : mockDriveSettings.teamQuotaGb;
}

/** 空间删除：文件进回收站、成员一并移除 */
function removeSpace(id: number) {
  const idx = mockDriveSpaces.findIndex((s) => s.id === id);
  if (idx === -1) return notFound('空间不存在', { status: 404 });
  if (mockDriveSpaces[idx].type === 'personal') return badRequest('个人空间不能删除', { status: 400 });
  softDelete(liveNodes().filter((n) => n.spaceId === id && n.parentId === null).map((n) => n.id));
  mockDriveSpaces.splice(idx, 1);
  removeWhere(mockDriveMembers, (m) => m.spaceId === id);
  return null;
}

function revokeShareLink(id: number) {
  const link = mockDriveShareLinks.find((l) => l.id === id);
  if (!link) return null;
  link.revokedAt = mockDateTime(); link.updatedAt = link.revokedAt;
  return link;
}

// ─── 空间 ─────────────────────────────────────────────────────────────────────

const spaceHandlers = [
  mock(driveSpaceContract.my, ({ ok }) => { recalcMockDriveUsage(); return ok(mockDriveSpaces.filter((s) => s.status === 'enabled' && !s.archivedAt)); }),
  mock(driveSpaceContract.list, ({ query, ok, paginate }) => {
    const keyword = query.keyword?.trim();
    recalcMockDriveUsage();
    let list = mockDriveSpaces.filter((s) => s.type !== 'personal' || s.ownerId === MOCK_USER.id);
    list = list.filter((s) => (query.archived ? !!s.archivedAt : !s.archivedAt));
    if (keyword) list = filterByKeyword(list, keyword, [(s) => s.name, (s) => s.ownerName]);
    if (query.type) list = list.filter((s) => s.type === query.type);
    if (query.status) list = list.filter((s) => s.status === query.status);
    return ok(paginate(list));
  }),
  mock(driveSpaceContract.archive, ({ params, ok }) => {
    const space = requireItem(mockDriveSpaces, params.id, '空间不存在', { status: 404 });
    if (space.type === 'personal') return badRequest('个人空间不支持归档');
    if (space.archivedAt) return badRequest('空间已处于归档状态');
    space.archivedAt = mockDateTime();
    space.updatedAt = space.archivedAt;
    logMockDriveActivity({ spaceId: space.id, nodeId: null, nodeName: space.name, nodeType: 'folder', action: 'archive', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: null });
    return ok(space, '空间已归档（只读）');
  }),
  mock(driveSpaceContract.unarchive, ({ params, ok }) => {
    const space = requireItem(mockDriveSpaces, params.id, '空间不存在', { status: 404 });
    if (!space.archivedAt) return badRequest('空间未归档');
    space.archivedAt = null;
    space.updatedAt = mockDateTime();
    logMockDriveActivity({ spaceId: space.id, nodeId: null, nodeName: space.name, nodeType: 'folder', action: 'unarchive', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: null });
    return ok(space, '已恢复归档');
  }),
  mock(driveSpaceContract.quotaRequests, ({ params, ok }) => ok(mockQuotaRequests.filter((r) => r.spaceId === params.id).sort((a, b) => b.id - a.id))),
  mock(driveSpaceContract.requestQuota, ({ params, body, ok }) => {
    const space = requireItem(mockDriveSpaces, params.id, '空间不存在', { status: 404 });
    if (!space.quotaBytes) return badRequest('该空间当前不限配额，无需扩容');
    if (body.requestedGb * 1024 ** 3 <= space.quotaBytes) return badRequest('申请配额需大于当前配额');
    if (mockQuotaRequests.some((r) => r.spaceId === space.id && r.status === 'pending')) return conflict('该空间已有待审批的扩容申请', { status: 409 });
    const now = mockDateTime();
    const request: DriveQuotaRequest = {
      id: nextQuotaRequestId++, spaceId: space.id, spaceName: space.name, spaceType: space.type, currentQuotaBytes: space.quotaBytes, usedBytes: space.usedBytes,
      requestedGb: body.requestedGb, reason: body.reason?.trim() || null, status: 'pending', requesterId: MOCK_USER.id, requesterName: MOCK_USER.name,
      approvedGb: null, decidedBy: null, decidedByName: null, decidedAt: null, decisionNote: null, createdAt: now, updatedAt: now,
    };
    mockQuotaRequests.unshift(request);
    return ok(request, '扩容申请已提交，等待网盘管理员审批');
  }),
  mock(driveSpaceContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const space: DriveSpace = {
      id: getNextDriveSpaceId(), type: 'team', name: body.name, description: body.description ?? null, icon: body.icon ?? null,
      ownerId: MOCK_USER.id, ownerName: MOCK_USER.name, departmentId: null, departmentName: null, defaultMemberRole: body.defaultMemberRole,
      quotaBytes: (body.quotaGb ?? mockDriveSettings.teamQuotaGb) * 1024 ** 3, customQuotaBytes: body.quotaGb === null ? null : body.quotaGb * 1024 ** 3,
      usedBytes: 0, maxVersions: body.maxVersions, allowExternalShare: body.allowExternalShare, status: body.status, archivedAt: null, sort: body.sort,
      tenantId: null, myRole: 'manager', memberCount: body.members.length, nodeCount: 0, createdAt: now, updatedAt: now,
    };
    mockDriveSpaces.push(space);
    for (const m of body.members) mockDriveMembers.push({ spaceId: space.id, ...m, subjectName: subjectName(m.subjectType, m.subjectId), createdAt: now });
    return ok(space, '创建成功');
  }),
  mock(driveSpaceContract.detail, ({ params, ok }) => {
    const space = requireItem(mockDriveSpaces, params.id, '空间不存在', { status: 404 });
    recalcMockDriveUsage();
    return ok(space);
  }),
  mock(driveSpaceContract.update, ({ params, body, ok }) => {
    const space = requireItem(mockDriveSpaces, params.id, '空间不存在', { status: 404 });
    const { quotaGb, ...rest } = body;
    Object.assign(space, rest, { updatedAt: mockDateTime() });
    if (quotaGb !== undefined) {
      space.customQuotaBytes = quotaGb === null ? null : quotaGb * 1024 ** 3;
      space.quotaBytes = (quotaGb ?? mockDriveSettings.teamQuotaGb) * 1024 ** 3;
    }
    return ok(space, '更新成功');
  }),
  mock(driveSpaceContract.remove, ({ params, ok }) => removeSpace(params.id) ?? ok(null, '删除成功')),
  mock(driveSpaceContract.members, ({ params, ok }) => ok(mockDriveMembers.filter((m) => m.spaceId === params.id))),
  mock(driveSpaceContract.saveMembers, ({ params, body, ok }) => {
    removeWhere(mockDriveMembers, (m) => m.spaceId === params.id);
    const now = mockDateTime();
    for (const m of body.members) mockDriveMembers.push({ spaceId: params.id, ...m, subjectName: subjectName(m.subjectType, m.subjectId), createdAt: now });
    recalcMockDriveUsage();
    return ok(null, '成员已更新');
  }),
  mock(driveSpaceContract.transfer, ({ params, body, ok }) => {
    const space = requireItem(mockDriveSpaces, params.id, '空间不存在', { status: 404 });
    space.ownerId = body.ownerId; space.ownerName = subjectName('user', body.ownerId); space.updatedAt = mockDateTime();
    return ok(space, '已转让');
  }),
];

// ─── 节点：静态路径 ───────────────────────────────────────────────────────────

function createMockDriveFolder(spaceId: number, parentId: number | null, name: string): DriveNode {
  const parent = parentId ? findNode(parentId) : null;
  const now = mockDateTime();
  const node: DriveNode = {
    id: getNextDriveNodeId(), spaceId, parentId, ancestorIds: parent ? [...parent.ancestorIds, parent.id] : [], depth: parent ? parent.depth + 1 : 0,
    type: 'folder', name, extension: null, mimeType: null, fileId: null, size: 0, contentHash: null, currentVersion: 1, inheritPermissions: true,
    lockedBy: null, lockedByName: null, lockedAt: null, lockExpiresAt: null, thumbnailUrl: null, url: null, deletedAt: null, deletedBy: null, deletedByName: null,
    createdBy: MOCK_USER.id, createdByName: MOCK_USER.name, updatedBy: MOCK_USER.id, updatedByName: MOCK_USER.name, createdAt: now, updatedAt: now,
  };
  mockDriveNodes.push(node);
  logMockDriveActivity({ spaceId, nodeId: node.id, nodeName: name, nodeType: 'folder', action: 'create_folder', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: null });
  return node;
}

const mockDriveProfiles = new Map<number, DriveNodeProfile>();
const mockDriveSubscriptions = new Set<number>();

function remapMovedMockNodes(nodes: DriveNode[], targetSpaceId: number): void {
  const ids = new Set(nodes.map((node) => node.id));
  const mapping = new Map<number, number>();
  for (const node of nodes) {
    node.spaceId = targetSpaceId;
    node.inheritPermissions = true;
    const nextTags = (mockDriveNodeTags.get(node.id) ?? []).map((id) => {
      const source = mockDriveTags.find((tag) => tag.id === id);
      if (!source) return null;
      if (!mapping.has(id)) {
        let target = mockDriveTags.find((tag) => tag.spaceId === targetSpaceId && tag.name === source.name);
        if (!target) {
          target = { ...source, id: getNextDriveTagId(), spaceId: targetSpaceId };
          mockDriveTags.push(target);
        }
        mapping.set(id, target.id);
      }
      return mapping.get(id)!;
    }).filter((id): id is number => id !== null);
    mockDriveNodeTags.set(node.id, [...new Set(nextTags)]);
  }
  removeWhere(mockDrivePermissions, (permission) => ids.has(permission.nodeId));
  for (const link of mockDriveShareLinks) if (ids.has(link.nodeId)) revokeShareLink(link.id);
}

const nodeStaticHandlers = [
  mock(driveNodeContract.ensureDirectories, ({ body, ok }) => {
    const root = body.parentId ? findNode(body.parentId) : null;
    if (!mockDriveSpaces.some((space) => space.id === body.spaceId)
      || (body.parentId && (!root || root.type !== 'folder' || root.spaceId !== body.spaceId))) return notFound('上传目录不存在', { status: 404 });
    for (const path of body.paths) {
      const segments = path.split('/');
      if (segments.length + (root ? root.depth + 1 : 0) > 32) return badRequest('目录超过最大层级', { status: 400 });
      let parentId = body.parentId;
      for (const name of segments) {
        const existing = liveNodes().find((node) => node.spaceId === body.spaceId && node.parentId === parentId && node.name.toLowerCase() === name.toLowerCase());
        if (!existing) break;
        if (existing.type !== 'folder') return badRequest(`目录与文件冲突：${path}`, { status: 409 });
        parentId = existing.id;
      }
    }
    return ok(body.paths.map((path) => {
      let parentId = body.parentId;
      for (const name of path.split('/')) {
        const node = liveNodes().find((item) => item.spaceId === body.spaceId && item.parentId === parentId && item.name.toLowerCase() === name.toLowerCase())
          ?? createMockDriveFolder(body.spaceId, parentId, name);
        parentId = node.id;
      }
      return { path, nodeId: parentId! };
    }));
  }),
  mock(driveNodeContract.recycle, ({ query, ok, paginate }) => {
    const roots = mockDriveNodes.filter((n) => n.deletedAt && (n as DriveNode & { deletedRootId?: number }).deletedRootId === n.id);
    const list = filterNodes(roots, query).sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')).map(withSpaceName);
    return ok(paginate(list));
  }),
  mock(driveNodeContract.restore, ({ body, ok }) => {
    for (const id of body.ids) {
      const root = findNode(id);
      if (!root?.deletedAt) continue;
      if (root.parentId && !liveNodes().some((n) => n.id === root.parentId)) { root.parentId = null; root.ancestorIds = []; root.depth = 0; }
      root.name = uniqueName(root.name, root.spaceId, root.parentId, root.id);
      for (const n of subtree(id)) { n.deletedAt = null; n.deletedBy = null; n.deletedByName = null; }
      logMockDriveActivity({ spaceId: root.spaceId, nodeId: root.id, nodeName: root.name, nodeType: root.type, action: 'restore', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: null });
    }
    return ok(null, '已还原');
  }),
  mock(driveNodeContract.purge, ({ body, ok }) => {
    const blocked = legalHoldBlock(body.ids.map((id) => findNode(id)).filter((n): n is DriveNode => !!n), '彻底删除');
    if (blocked) return blocked;
    const victims = new Set(body.ids.flatMap((id) => subtree(id).map((n) => n.id)));
    victims.forEach((id) => { mockDriveProfiles.delete(id); mockDriveSubscriptions.delete(id); });
    removeWhere(mockDriveNodes, (n) => victims.has(n.id));
    removeWhere(mockDriveVersions, (v) => victims.has(v.nodeId));
    recalcMockDriveUsage();
    return ok(null, '已彻底删除');
  }),
  mock(driveNodeContract.emptyRecycle, ({ query, ok }) => {
    removeWhere(mockDriveNodes, (n) => !!n.deletedAt && (!query.spaceId || n.spaceId === query.spaceId));
    recalcMockDriveUsage();
    return ok(null, '回收站已清空');
  }),
  mock(driveNodeContract.starred, ({ query, ok, paginate }) => {
    const list = filterNodes(liveNodes().filter((n) => mockDriveStars.has(n.id)), query).map(withSpaceName);
    return ok(paginate(list));
  }),
  mock(driveNodeContract.recent, ({ query, ok, paginate }) => {
    const list = mockDriveRecent
      .map((r) => ({ node: findNode(r.nodeId), r }))
      .filter((x): x is { node: DriveNode; r: typeof mockDriveRecent[number] } => !!x.node && !x.node.deletedAt)
      .sort((a, b) => b.r.lastAccessAt.localeCompare(a.r.lastAccessAt))
      .map(({ node, r }) => ({ ...withSpaceName(node), lastAccessAt: r.lastAccessAt, lastAction: r.lastAction }));
    return ok(paginate(filterNodes(list, query)));
  }),
  mock(driveNodeContract.sharedWithMe, ({ query, ok, paginate }) => {
    const list = mockDrivePermissions
      .filter((p) => p.subjectType === 'user' && p.subjectId === MOCK_USER.id)
      .map((p) => ({ node: findNode(p.nodeId), p }))
      .filter((x): x is { node: DriveNode; p: typeof mockDrivePermissions[number] } => !!x.node && !x.node.deletedAt)
      .map(({ node, p }) => ({ ...withSpaceName(node), grantedVia: p.subjectType, grantedRole: p.role }));
    return ok(paginate(filterNodes(list, query)));
  }),
  mock(driveNodeContract.search, ({ query, ok, paginate }) => {
    const kw = query.keyword.trim().toLowerCase();
    if (!kw) return badRequest('请输入搜索关键词', { status: 400 });
    const list = filterNodes(liveNodes(), { ...query, keyword: undefined })
      .map((n) => {
        const text = query.fullText ? mockDriveTexts.get(n.id) : undefined;
        const hitName = n.name.toLowerCase().includes(kw);
        const idx = text ? text.toLowerCase().indexOf(kw) : -1;
        if (!hitName && idx < 0) return null;
        const snippet = idx >= 0 && text ? `${idx > 30 ? '…' : ''}${text.slice(Math.max(0, idx - 30), idx + kw.length + 30).replaceAll(/\s+/g, ' ')}…` : null;
        return { ...withSpaceName(n), snippet };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    return ok(paginate(list));
  }),
  mock(driveNodeContract.precheck, ({ body, ok }) => {
    const space = requireItem(mockDriveSpaces, body.spaceId, '空间不存在', { status: 404 });
    const existing = liveNodes().find((n) => n.spaceId === body.spaceId && n.parentId === body.parentId && n.name.toLowerCase() === body.fileName.toLowerCase());
    const remaining = space.quotaBytes ? space.quotaBytes - space.usedBytes : null;
    return ok({ conflict: !!existing, existingNodeId: existing?.id ?? null, quotaOk: remaining === null || remaining >= body.fileSize, quotaRemaining: remaining, instant: false, node: null });
  }),
  mock(driveNodeContract.upload, async ({ body, ok }) => {
    const file = body.get('file');
    if (!(file instanceof File)) return badRequest('缺少文件', { status: 400 });
    const spaceId = Number(body.get('spaceId'));
    const archivedUpload = archivedBlock(spaceId);
    if (archivedUpload) return archivedUpload;
    const parentId = body.get('parentId') ? Number(body.get('parentId')) : null;
    const policy = String(body.get('conflictPolicy') ?? 'rename');
    const parent = parentId ? findNode(parentId) : null;
    const existing = liveNodes().find((n) => n.spaceId === spaceId && n.parentId === parentId && n.name.toLowerCase() === file.name.toLowerCase());
    if (existing && policy === 'fail') return badRequest('同名文件已存在', { status: 400 });
    const now = mockDateTime();
    if (existing && policy === 'version' && existing.type === 'file') {
      mockDriveVersions.forEach((v) => { if (v.nodeId === existing.id) v.isCurrent = false; });
      existing.currentVersion += 1; existing.size = file.size; existing.updatedAt = now;
      mockDriveVersions.push({ id: getNextDriveVersionId(), nodeId: existing.id, version: existing.currentVersion, fileId: `mock-file-${existing.id}-v${existing.currentVersion}`, size: file.size, contentHash: null, comment: null, authorId: MOCK_USER.id, authorName: MOCK_USER.name, isCurrent: true, url: existing.url ?? '', createdAt: now });
      if (file.type.startsWith('text/')) mockDriveTexts.set(existing.id, await file.text());
      recalcMockDriveUsage();
      return ok(decorate(existing), '已上传新版本');
    }
    const id = getNextDriveNodeId();
    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : null;
    const node: DriveNode = {
      id, spaceId, parentId, ancestorIds: parent ? [...parent.ancestorIds, parent.id] : [], depth: parent ? parent.depth + 1 : 0, type: 'file',
      name: uniqueName(file.name, spaceId, parentId), extension: ext, mimeType: file.type || null, fileId: `mock-file-${id}`, size: file.size, contentHash: null,
      currentVersion: 1, inheritPermissions: true, lockedBy: null, lockedByName: null, lockedAt: null, lockExpiresAt: null,
      thumbnailUrl: file.type.startsWith('image/') ? mockDriveThumbnailUrl(id) : null, url: mockDriveContentUrl(id),
      deletedAt: null, deletedBy: null, deletedByName: null, createdBy: MOCK_USER.id, createdByName: MOCK_USER.name, updatedBy: MOCK_USER.id, updatedByName: MOCK_USER.name, createdAt: now, updatedAt: now,
    };
    mockDriveNodes.push(node);
    if (file.type.startsWith('text/')) mockDriveTexts.set(id, await file.text());
    mockDriveRecent.unshift({ nodeId: id, lastAccessAt: now, lastAction: 'upload' });
    logMockDriveActivity({ spaceId, nodeId: id, nodeName: node.name, nodeType: 'file', action: 'upload', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: { size: file.size } });
    recalcMockDriveUsage();
    return ok(decorate(node), '上传成功');
  }),
  mock(driveNodeContract.createFolder, ({ body, ok }) => {
    const archivedFolder = archivedBlock(body.spaceId);
    if (archivedFolder) return archivedFolder;
    const parent = body.parentId ? findNode(body.parentId) : null;
    if (body.parentId && !parent) return notFound('父目录不存在', { status: 404 });
    if (liveNodes().some((n) => n.spaceId === body.spaceId && n.parentId === body.parentId && n.name.toLowerCase() === body.name.toLowerCase())) {
      return badRequest('同一目录下已存在同名项目', { status: 400 });
    }
    return ok(decorate(createMockDriveFolder(body.spaceId, body.parentId, body.name)), '文件夹已创建');
  }),
  mock(driveNodeContract.move, ({ body, ok }) => {
    const archivedTarget = archivedBlock(body.targetSpaceId);
    if (archivedTarget) return archivedTarget;
    const crossSpace = body.ids.map((id) => findNode(id)).filter((n): n is DriveNode => !!n && n.spaceId !== body.targetSpaceId);
    const heldMove = legalHoldBlock(crossSpace, '跨空间移动');
    if (heldMove) return heldMove;
    const target = body.targetParentId ? findNode(body.targetParentId) : null;
    for (const id of body.ids) {
      const node = findNode(id);
      if (!node) continue;
      if (target && (target.id === id || target.ancestorIds.includes(id))) return badRequest('不能移动到自身或其子目录', { status: 400 });
      const oldDepth = node.ancestorIds.length;
      const newAncestors = target ? [...target.ancestorIds, target.id] : [];
      const descendants = subtree(id);
      if (node.spaceId !== body.targetSpaceId) remapMovedMockNodes(descendants, body.targetSpaceId);
      for (const n of descendants) {
        n.ancestorIds = [...newAncestors, ...n.ancestorIds.slice(oldDepth)];
        n.depth = n.ancestorIds.length; n.spaceId = body.targetSpaceId;
      }
      node.parentId = body.targetParentId;
      node.name = uniqueName(node.name, body.targetSpaceId, node.parentId, node.id);
      node.updatedAt = mockDateTime();
      logMockDriveActivity({ spaceId: node.spaceId, nodeId: id, nodeName: node.name, nodeType: node.type, action: 'move', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: null });
    }
    recalcMockDriveUsage();
    return ok(null, '已移动');
  }),
  mock(driveNodeContract.copy, ({ body, ok }) => {
    const target = body.targetParentId ? findNode(body.targetParentId) : null;
    let copied = 0;
    const clone = (node: DriveNode, parent: DriveNode | null) => {
      const now = mockDateTime();
      const id = getNextDriveNodeId();
      const copy: DriveNode = {
        ...node, id, spaceId: body.targetSpaceId, parentId: parent?.id ?? null, ancestorIds: parent ? [...parent.ancestorIds, parent.id] : [], depth: parent ? parent.depth + 1 : 0,
        name: uniqueName(node.name, body.targetSpaceId, parent?.id ?? null), url: node.type === 'file' ? mockDriveContentUrl(id) : null,
        thumbnailUrl: node.thumbnailUrl ? mockDriveThumbnailUrl(id) : null, currentVersion: node.type === 'file' ? 1 : 0, lockedBy: null, lockedByName: null, lockedAt: null, lockExpiresAt: null, createdAt: now, updatedAt: now,
      };
      mockDriveNodes.push(copy);
      const profile = mockDriveProfiles.get(node.id);
      if (profile) mockDriveProfiles.set(copy.id, { ...profile, nodeId: copy.id, metadata: { ...profile.metadata } });
      copied += 1;
      const text = mockDriveTexts.get(node.id);
      if (text) mockDriveTexts.set(id, text);
      for (const child of liveNodes().filter((n) => n.parentId === node.id)) clone(child, copy);
    };
    for (const id of body.ids) { const node = findNode(id); if (node) clone(node, target ?? null); }
    recalcMockDriveUsage();
    return ok({ mode: 'sync', taskId: null, copied }, '已复制');
  }),
  mock(driveNodeContract.removeBatch, ({ body, ok }) => {
    const roots = body.ids.map((id) => findNode(id)).filter((n): n is DriveNode => !!n);
    const archived = roots.map((n) => archivedBlock(n.spaceId)).find((r) => r !== null);
    if (archived) return archived;
    const held = legalHoldBlock(roots, '删除');
    if (held) return held;
    softDelete(body.ids);
    return ok(null, '已移入回收站');
  }),
  mock(driveNodeContract.batchDownload, ({ body, ok }) => {
    const files = body.ids.flatMap((id) => subtree(id)).filter((n) => n.type === 'file');
    if (files.length > DRIVE_SYNC_ZIP_MAX_FILES) {
      const task = createImmediateMockTask({ taskType: 'drive-batch-download', title: `打包下载 ${files.length} 个文件`, module: '企业网盘' });
      return ok({ mode: 'task', taskId: task.id });
    }
    const manifest = files.map((f) => `${f.name}\t${f.size}`).join('\n');
    return new HttpResponse(`演示模式：打包内容清单\n${manifest}`, { status: 200, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`drive_${Date.now()}.zip`)}` } });
  }),
  mock(driveNodeContract.list, ({ query, ok, paginate }) => {
    const parentId = query.parentId ?? null;
    const parent = parentId ? findNode(parentId) ?? null : null;
    if (parentId && !parent) return notFound('目录不存在', { status: 404 });
    const spaceId = parent?.spaceId ?? query.spaceId;
    const space = mockDriveSpaces.find((s) => s.id === spaceId);
    if (!space) return notFound('空间不存在', { status: 404 });
    recalcMockDriveUsage();
    const siblings = filterNodes(liveNodes().filter((n) => n.spaceId === space.id && n.parentId === parentId), { keyword: query.keyword, type: query.type });
    const sorted = sortNodes(siblings, query.sortBy ?? 'name', query.order ?? 'asc').map(decorate);
    const result: DriveNodeListResult = {
      ...paginate(sorted),
      space: { id: space.id, name: space.name, type: space.type, quotaBytes: space.quotaBytes, usedBytes: space.usedBytes, allowExternalShare: space.allowExternalShare },
      parent: parent ? decorate(parent) : null, breadcrumbs: breadcrumbsOf(parent), myRole: 'manager',
    };
    return ok(result);
  }),
];

// ─── 节点：动态路径 ───────────────────────────────────────────────────────────

const nodeItemHandlers = [
  mock(driveNodeContract.content, ({ params, query }) => {
    const node = findNode(params.id);
    if (!node || node.type !== 'file') return notFound('文件不存在', { status: 404 });
    return contentResponse(node, !!query.download);
  }),
  mock(driveNodeContract.thumbnail, ({ params }) => {
    const node = findNode(params.id);
    if (!node) return notFound('文件不存在', { status: 404 });
    return new HttpResponse(svgPlaceholder(node.name), { status: 200, headers: { 'Content-Type': 'image/svg+xml' } });
  }),
  mock(driveNodeContract.rename, ({ params, body, ok }) => {
    const node = findNode(params.id);
    if (!node) return notFound('节点不存在', { status: 404 });
    if (liveNodes().some((n) => n.id !== node.id && n.spaceId === node.spaceId && n.parentId === node.parentId && n.name.toLowerCase() === body.name.toLowerCase())) {
      return badRequest('同一目录下已存在同名项目', { status: 400 });
    }
    const from = node.name;
    node.name = body.name; node.updatedAt = mockDateTime();
    if (node.type === 'file') node.extension = node.name.includes('.') ? node.name.split('.').pop()!.toLowerCase() : null;
    logMockDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'rename', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: { from, to: node.name } });
    return ok(decorate(node), '已重命名');
  }),
  mock(driveNodeContract.star, ({ params, ok }) => { mockDriveStars.add(params.id); return ok(null); }),
  mock(driveNodeContract.unstar, ({ params, ok }) => { mockDriveStars.delete(params.id); return ok(null); }),
  mock(driveNodeContract.permissions, ({ params, ok }) => {
    const node = findNode(params.id);
    if (!node) return notFound('节点不存在', { status: 404 });
    return ok(permissionsResult(node));
  }),
  mock(driveNodeContract.savePermissions, ({ params, body, ok }) => {
    const node = findNode(params.id);
    if (!node) return notFound('节点不存在', { status: 404 });
    removeWhere(mockDrivePermissions, (p) => p.nodeId === node.id);
    const now = mockDateTime();
    for (const p of body.permissions) {
      mockDrivePermissions.push({ id: getNextDrivePermissionId(), nodeId: node.id, subjectType: p.subjectType, subjectId: p.subjectId, subjectName: subjectName(p.subjectType, p.subjectId), role: p.role, expireAt: p.expireAt ?? null, createdBy: MOCK_USER.id, createdByName: MOCK_USER.name, createdAt: now, inheritedFrom: null });
    }
    logMockDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'permission_change', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: null });
    return ok(permissionsResult(node), '授权已保存');
  }),
  mock(driveNodeContract.setInherit, ({ params, body, ok }) => {
    const node = findNode(params.id);
    if (!node) return notFound('节点不存在', { status: 404 });
    node.inheritPermissions = body.inherit;
    logMockDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'inherit_change', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: { inherit: body.inherit } });
    return ok(permissionsResult(node));
  }),
  mock(driveNodeContract.versions, ({ params, ok }) => {
    const node = findNode(params.id);
    if (!node) return notFound('节点不存在', { status: 404 });
    let versions = mockDriveVersions.filter((v) => v.nodeId === node.id);
    if (versions.length === 0 && node.type === 'file') {
      versions = [{ id: getNextDriveVersionId(), nodeId: node.id, version: node.currentVersion || 1, fileId: node.fileId ?? '', size: node.size, contentHash: node.contentHash, comment: null, authorId: node.createdBy, authorName: node.createdByName, isCurrent: true, url: node.url ?? '', createdAt: node.createdAt }];
      mockDriveVersions.push(...versions);
    }
    return ok([...versions].sort((a, b) => b.version - a.version));
  }),
  mock(driveNodeContract.uploadVersion, ({ params, body, ok }) => {
    const node = findNode(params.id);
    if (!node || node.type !== 'file') return notFound('文件不存在', { status: 404 });
    const file = body.get('file');
    if (!(file instanceof File)) return badRequest('缺少文件', { status: 400 });
    const now = mockDateTime();
    mockDriveVersions.forEach((v) => { if (v.nodeId === node.id) v.isCurrent = false; });
    node.currentVersion += 1; node.size = file.size; node.updatedAt = now;
    mockDriveVersions.push({ id: getNextDriveVersionId(), nodeId: node.id, version: node.currentVersion, fileId: `mock-file-${node.id}-v${node.currentVersion}`, size: file.size, contentHash: null, comment: String(body.get('comment') ?? '') || null, authorId: MOCK_USER.id, authorName: MOCK_USER.name, isCurrent: true, url: node.url ?? '', createdAt: now });
    logMockDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: 'file', action: 'new_version', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: { size: file.size, version: node.currentVersion } });
    recalcMockDriveUsage();
    return ok(decorate(node), '已上传新版本');
  }),
  mock(driveNodeContract.restoreVersion, ({ params, ok }) => {
    const node = findNode(params.id);
    const source = mockDriveVersions.find((v) => v.nodeId === params.id && v.version === params.version);
    if (!node || !source) return notFound('版本不存在', { status: 404 });
    const now = mockDateTime();
    mockDriveVersions.forEach((v) => { if (v.nodeId === node.id) v.isCurrent = false; });
    node.currentVersion += 1; node.size = source.size; node.updatedAt = now;
    mockDriveVersions.push({ ...source, id: getNextDriveVersionId(), version: node.currentVersion, comment: `回滚自 v${source.version}`, isCurrent: true, createdAt: now, authorId: MOCK_USER.id, authorName: MOCK_USER.name });
    logMockDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: 'file', action: 'version_restore', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: { version: source.version } });
    return ok(decorate(node), '已回滚');
  }),
  mock(driveNodeContract.removeVersion, ({ params, ok }) => {
    const idx = mockDriveVersions.findIndex((v) => v.nodeId === params.id && v.version === params.version);
    if (idx === -1) return notFound('版本不存在', { status: 404 });
    if (mockDriveVersions[idx].isCurrent) return badRequest('不能删除当前版本', { status: 400 });
    mockDriveVersions.splice(idx, 1);
    recalcMockDriveUsage();
    return ok(null, '已删除');
  }),
  mock(driveNodeContract.activities, ({ params, ok, paginate }) => ok(paginate(mockDriveActivities.filter((a) => a.nodeId === params.id)))),
  mock(driveNodeContract.comments, ({ params, ok }) => ok(mockDriveComments.filter((c) => c.nodeId === params.id))),
  mock(driveNodeContract.createComment, ({ params, body, ok }) => {
    const node = findNode(params.id);
    if (!node) return notFound('节点不存在', { status: 404 });
    const now = mockDateTime();
    const comment = { id: getNextDriveCommentId(), nodeId: node.id, parentId: body.parentId, content: body.content, mentionUserIds: body.mentionUserIds, authorId: MOCK_USER.id, authorName: MOCK_USER.name, createdAt: now, updatedAt: now };
    mockDriveComments.push(comment);
    logMockDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'comment', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: null });
    return ok(comment, '已评论');
  }),
  mock(driveNodeContract.removeComment, ({ params, ok }) => {
    removeWhere(mockDriveComments, (c) => c.id === params.commentId);
    return ok(null, '已删除');
  }),
  mock(driveNodeContract.setTags, ({ params, body, ok }) => {
    const node = findNode(params.id);
    if (!node) return notFound('节点不存在', { status: 404 });
    mockDriveNodeTags.set(node.id, body.tagIds);
    return ok(decorate(node), '标签已更新');
  }),
  mock(driveNodeContract.lock, ({ params, body, ok }) => {
    const node = findNode(params.id);
    if (!node) return notFound('节点不存在', { status: 404 });
    if (node.lockedBy && node.lockedBy !== MOCK_USER.id) return forbidden(`文件已被 ${node.lockedByName ?? '他人'} 锁定`, { status: 403 });
    const now = new Date();
    node.lockedBy = MOCK_USER.id; node.lockedByName = MOCK_USER.name; node.lockedAt = mockDateTime(now);
    node.lockExpiresAt = mockDateTime(new Date(now.getTime() + (body.minutes ?? 60) * 60_000));
    logMockDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'lock', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: null });
    return ok(decorate(node), '已锁定');
  }),
  mock(driveNodeContract.unlock, ({ params, ok }) => {
    const node = findNode(params.id);
    if (!node) return notFound('节点不存在', { status: 404 });
    node.lockedBy = null; node.lockedByName = null; node.lockedAt = null; node.lockExpiresAt = null;
    logMockDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'unlock', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: null });
    return ok(decorate(node), '已解锁');
  }),
  mock(driveNodeContract.shareLinks, ({ params, ok }) => ok(mockDriveShareLinks.filter((l) => l.nodeId === params.id).map(withState))),
  mock(driveNodeContract.createShareLink, ({ params, body, ok }) => {
    const node = findNode(params.id);
    if (!node) return notFound('节点不存在', { status: 404 });
    if (body.kind === 'share' && body.capabilities.includes('upload')) return badRequest('分享链接不能包含上传能力，请创建文件收集链接', { status: 400 });
    if (body.kind === 'collect' && node.type !== 'folder') return badRequest('文件收集链接只能建立在文件夹上', { status: 400 });
    if (!mockDriveSettings.externalShareEnabled) return forbidden('管理员已关闭外链分享功能', { status: 403 });
    if (mockDriveSettings.externalShareRequirePassword && !body.password) return badRequest('管理员要求外链必须设置访问密码', { status: 400 });
    const now = mockDateTime();
    const id = getNextDriveShareId();
    const token = `demo-share-${id.toString().padStart(4, '0')}-${Math.random().toString(36).slice(2, 10)}`;
    const capabilities = normalizeDriveShareCapabilities(body.kind === 'collect' ? [...new Set([...body.capabilities, 'upload' as const])] : body.capabilities);
    const link: DriveShareLink = {
      id, nodeId: node.id, nodeName: node.name, nodeType: node.type, spaceId: node.spaceId, token, url: `/public/drive/${token}`, shortUrl: null,
      hasPassword: !!body.password, kind: body.kind, capabilities, maxDownloadCount: body.maxDownloadCount, uploadCount: 0, enabled: true, expireAt: body.expireAt, maxAccessCount: body.maxAccessCount,
      accessCount: 0, downloadCount: 0, allowedIps: body.allowedIps, watermark: body.watermark,
      collectPolicy: body.kind === 'collect' ? (body.collectPolicy ?? { maxFileSizeMb: null, allowedExtensions: [], requireSubmitter: true, maxUploads: null }) : null,
      revokedAt: null, remark: body.remark ?? null, state: 'active', createdBy: MOCK_USER.id, createdByName: MOCK_USER.name, createdAt: now, updatedAt: now,
    };
    if (body.password) mockDriveSharePasswords.set(id, body.password);
    mockDriveShareLinks.unshift(link);
    logMockDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'share_create', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: id, detail: null });
    return ok(withState(link), '外链已创建');
  }),
  mock(driveNodeContract.presence, ({ params, ok }) => ok(findNode(params.id) ? [{ userId: MOCK_USER.id, name: MOCK_USER.name, avatar: null, lastSeenAt: mockDateTime() }] : [])),
  mock(driveNodeContract.heartbeat, ({ params, ok }) => ok(findNode(params.id) ? [{ userId: MOCK_USER.id, name: MOCK_USER.name, avatar: null, lastSeenAt: mockDateTime() }] : [])),
  mock(driveNodeContract.leavePresence, ({ ok }) => ok(null)),
  mock(driveNodeContract.sendToChat, ({ params, body, ok }) => {
    requireItem(mockDriveNodes, params.id, '文件或文件夹不存在', { status: 404 });
    return ok({ sent: new Set(body.conversationIds).size }, '已发送到聊天');
  }),
  mock(driveNodeContract.detail, ({ params, ok }) => {
    const node = findNode(params.id);
    if (!node) return notFound('节点不存在', { status: 404 });
    return ok(detailOf(node));
  }),
];

// ─── 外链 ─────────────────────────────────────────────────────────────────────

const shareLinkHandlers = [
  mock(driveShareLinkContract.list, ({ query, ok, paginate }) => {
    let list = mockDriveShareLinks.map(withState);
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(l) => l.nodeName, (l) => l.remark]);
    if (query.state) list = list.filter((l) => l.state === query.state);
    if (query.kind) list = list.filter((l) => l.kind === query.kind);
    return ok(paginate(list));
  }),
  mock(driveShareLinkContract.accessLogs, ({ params, ok, paginate }) =>
    ok(paginate(mockDriveShareAccessLogs.filter((l) => l.shareId === params.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))))),
  mock(driveShareLinkContract.revoke, ({ params, ok }) => (revokeShareLink(params.id) ? ok(null, '已撤销') : notFound('外链不存在', { status: 404 }))),
  mock(driveShareLinkContract.update, ({ params, body, ok }) => {
    const link = requireItem(mockDriveShareLinks, params.id, '外链不存在', { status: 404 });
    if (link.revokedAt) return badRequest('外链已撤销，不能修改', { status: 400 });
    if (link.kind === 'share' && body.capabilities?.includes('upload')) return badRequest('分享链接不能包含上传能力', { status: 400 });
    const { password, clearPassword, collectPolicy, ...rest } = body;
    Object.assign(link, rest, { updatedAt: mockDateTime() });
    if (collectPolicy !== undefined && link.kind === 'collect') link.collectPolicy = collectPolicy;
    if (body.capabilities) link.capabilities = normalizeDriveShareCapabilities(link.kind === 'collect' ? [...new Set([...body.capabilities, 'upload' as const])] : body.capabilities);
    if (body.capabilities || password || clearPassword || body.enabled !== undefined || body.allowedIps) {
      for (const [session, shareId] of mockDriveShareSessions) {
        if (shareId === link.id) mockDriveShareSessions.delete(session);
      }
    }
    if (clearPassword) { mockDriveSharePasswords.delete(link.id); link.hasPassword = false; }
    if (password) { mockDriveSharePasswords.set(link.id, password); link.hasPassword = true; }
    return ok(withState(link), '已更新');
  }),
  mock(driveShareLinkContract.remove, ({ params, ok }) => {
    removeWhere(mockDriveShareLinks, (l) => l.id === params.id);
    return ok(null, '已删除');
  }),
  mock(driveShareLinkContract.submissions, ({ params, ok, paginate }) => ok(paginate(mockDriveCollectSubmissions.filter((s) => s.shareId === params.id)))),
  mock(driveShareLinkContract.shortLink, ({ params, ok }) => {
    const link = requireItem(mockDriveShareLinks, params.id, '外链不存在', { status: 404 });
    link.shortUrl ??= `https://demo.zenith.local/s/d${link.id.toString(36)}`;
    return ok({ shortUrl: link.shortUrl }, '短链已生成');
  }),
];

// ─── 访问申请 ─────────────────────────────────────────────────────────────────

const accessRequestHandlers = [
  mock(driveAccessRequestContract.list, ({ query, ok, paginate }) => {
    let list = query.box === 'outbox' ? mockDriveAccessRequests.filter((r) => r.requesterId === MOCK_USER.id) : mockDriveAccessRequests.filter((r) => r.requesterId !== MOCK_USER.id);
    if (query.status) list = list.filter((r) => r.status === query.status);
    return ok(paginate(list));
  }),
  mock(driveAccessRequestContract.pendingCount, ({ ok }) => ok(mockDriveAccessRequests.filter((r) => r.status === 'pending' && r.requesterId !== MOCK_USER.id).length)),
  mock(driveAccessRequestContract.target, ({ params, ok }) => {
    const node = findNode(params.id);
    if (!node) return notFound('文件或文件夹不存在', { status: 404 });
    const pending = mockDriveAccessRequests.find((r) => r.nodeId === node.id && r.requesterId === MOCK_USER.id && r.status === 'pending');
    return ok({ nodeId: node.id, nodeName: node.name, nodeType: node.type, spaceName: mockDriveSpaces.find((s) => s.id === node.spaceId)?.name ?? '', pendingRequestId: pending?.id ?? null });
  }),
  mock(driveAccessRequestContract.create, ({ body, ok }) => {
    const node = findNode(body.nodeId);
    if (!node) return notFound('文件或文件夹不存在', { status: 404 });
    const now = mockDateTime();
    const req: DriveAccessRequest = {
      id: mockDriveAccessRequests.length + 1, nodeId: node.id, nodeName: node.name, nodeType: node.type, spaceId: node.spaceId,
      spaceName: mockDriveSpaces.find((s) => s.id === node.spaceId)?.name ?? '', requesterId: MOCK_USER.id, requesterName: MOCK_USER.name,
      role: body.role, reason: body.reason ?? null, status: 'pending', grantedRole: null, grantedExpireAt: null,
      decidedBy: null, decidedByName: null, decidedAt: null, decisionNote: null, createdAt: now, updatedAt: now,
    };
    mockDriveAccessRequests.unshift(req);
    return ok(req, '申请已提交');
  }),
  mock(driveAccessRequestContract.decide, ({ params, body, ok }) => {
    const req = requireItem(mockDriveAccessRequests, params.id, '访问申请不存在', { status: 404 });
    if (req.status !== 'pending') return badRequest('该申请已处理', { status: 400 });
    const now = mockDateTime();
    Object.assign(req, {
      status: body.approve ? 'approved' : 'rejected', grantedRole: body.approve ? (body.role ?? req.role) : null, grantedExpireAt: body.approve ? body.expireAt ?? null : null,
      decidedBy: MOCK_USER.id, decidedByName: MOCK_USER.name, decidedAt: now, decisionNote: body.note ?? null, updatedAt: now,
    });
    if (body.approve) {
      mockDrivePermissions.push({ id: getNextDrivePermissionId(), nodeId: req.nodeId, subjectType: 'user', subjectId: req.requesterId, subjectName: req.requesterName ?? '', role: body.role ?? req.role, expireAt: body.expireAt ?? null, createdBy: MOCK_USER.id, createdByName: MOCK_USER.name, createdAt: now, inheritedFrom: null });
    }
    return ok(req, body.approve ? '已通过' : '已拒绝');
  }),
  mock(driveAccessRequestContract.cancel, ({ params, ok }) => {
    const req = requireItem(mockDriveAccessRequests, params.id, '访问申请不存在', { status: 404 });
    if (req.status !== 'pending') return badRequest('该申请已处理，无法撤回', { status: 400 });
    Object.assign(req, { status: 'cancelled', updatedAt: mockDateTime() });
    return ok(req, '已撤回');
  }),
];

// ─── 公开外链 ─────────────────────────────────────────────────────────────────

function shareByToken(token: string): DriveShareLink | undefined {
  return mockDriveShareLinks.find((l) => l.token === token);
}

function publicMeta(share: DriveShareLink, node: DriveNode | null, requirePassword: boolean): DrivePublicShareMeta {
  const policy = share.kind === 'collect' && share.collectPolicy ? { ...share.collectPolicy, maxFileSizeMb: share.collectPolicy.maxFileSizeMb ?? mockDriveSettings.collectMaxFileSizeMb } : null;
  return {
    token: share.token, kind: share.kind, capabilities: share.capabilities, requirePassword, node: node ? toPublicNode(node, share.token) : null,
    expireAt: share.expireAt, sharerName: share.createdByName, collectPolicy: policy, uploadCount: share.uploadCount,
    uploadsRemaining: policy?.maxUploads ? Math.max(0, policy.maxUploads - share.uploadCount) : null,
    watermarkText: share.watermark && node ? `${share.createdByName ?? '分享'} · ${mockDateTime().slice(0, 16)} · *.*.0.1` : null,
  };
}

/** 会话可经 header `session` 或查询串 `session` 携带 */
function sessionShare(request: Request, querySession: string | undefined, token: string): DriveShareLink | null {
  const session = request.headers.get('session') ?? querySession;
  if (!session) return null;
  const shareId = mockDriveShareSessions.get(session);
  const share = shareByToken(token);
  if (!share || share.id !== shareId || share.revokedAt || !share.enabled || (share.expireAt && share.expireAt <= mockDateTime())) return null;
  return share;
}

const mockDownloadReceipts = new Set<string>();

const publicHandlers = [
  mock(drivePublicShareContract.access, ({ params, body, ok }) => {
    const share = shareByToken(params.token);
    if (!share) return notFound('链接不存在或已失效', { status: 404 });
    const state = shareState(share);
    if (state !== 'active') return forbidden(SHARE_STATE_MESSAGES[state], { status: 403 });
    const expected = mockDriveSharePasswords.get(share.id);
    if (expected && body.password !== expected) {
      mockDriveShareAccessLogs.push({ id: mockDriveShareAccessLogs.length + 1, shareId: share.id, nodeId: share.nodeId, action: 'access', clientIp: '127.0.0.1', ok: false, createdAt: mockDateTime() });
      return unauthorized('访问密码错误', { status: 401 });
    }
    const node = findNode(share.nodeId);
    if (!node || node.deletedAt) return notFound('分享的文件已被删除', { status: 404 });
    share.accessCount += 1;
    const session = `demo-session-${Math.random().toString(36).slice(2)}`;
    mockDriveShareSessions.set(session, share.id);
    mockDriveShareAccessLogs.push({ id: mockDriveShareAccessLogs.length + 1, shareId: share.id, nodeId: share.nodeId, action: 'access', clientIp: '127.0.0.1', ok: true, createdAt: mockDateTime() });
    logMockDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'share_access', actorId: null, actorName: null, shareId: share.id, detail: null });
    return ok({
      session, expiresAt: mockDateTime(new Date(Date.now() + 2 * 60 * 60_000)),
      meta: publicMeta(share, node, !!expected),
    });
  }),
  mock(drivePublicShareContract.upload, async ({ params, request, url, ok }) => {
    const share = sessionShare(request, url.searchParams.get('session') ?? undefined, params.token);
    if (!share) return unauthorized('访问会话已失效，请重新验证', { status: 401 });
    if (share.kind !== 'collect' || !share.capabilities.includes('upload')) return forbidden('该链接不接受文件提交', { status: 403 });
    const root = findNode(share.nodeId);
    if (!root) return notFound('收集目标不存在', { status: 404 });
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return badRequest('请选择要提交的文件', { status: 400 });
    const policy = share.collectPolicy;
    const submitterName = String(form.get('submitterName') ?? '').trim() || null;
    if (policy?.requireSubmitter && !submitterName) return badRequest('请填写提交人姓名', { status: 400 });
    if (policy?.maxUploads && share.uploadCount >= policy.maxUploads) return forbidden('收集数量已达上限', { status: 403 });
    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
    if (policy?.allowedExtensions.length && !policy.allowedExtensions.includes(ext)) return badRequest(`只接受以下类型的文件：${policy.allowedExtensions.join('、')}`, { status: 400 });
    const now = mockDateTime();
    const id = getNextDriveNodeId();
    const node: DriveNode = {
      id, spaceId: root.spaceId, parentId: root.id, ancestorIds: [...root.ancestorIds, root.id], depth: root.depth + 1, type: 'file',
      name: uniqueName(file.name, root.spaceId, root.id), extension: ext || null, mimeType: file.type || null, fileId: `mock-file-${id}`, size: file.size, contentHash: null,
      currentVersion: 1, inheritPermissions: true, lockedBy: null, lockedByName: null, lockedAt: null, lockExpiresAt: null, thumbnailUrl: null, url: mockDriveContentUrl(id),
      deletedAt: null, deletedBy: null, deletedByName: null, isStarred: false, myRole: 'manager', tags: [], createdBy: share.createdBy, createdByName: share.createdByName, updatedBy: share.createdBy, updatedByName: share.createdByName, createdAt: now, updatedAt: now,
    };
    mockDriveNodes.push(node);
    share.uploadCount += 1;
    mockDriveCollectSubmissions.unshift({ id: mockDriveCollectSubmissions.length + 1, shareId: share.id, nodeId: id, fileName: node.name, size: file.size, submitterName, submitterNote: String(form.get('submitterNote') ?? '').trim() || null, clientIp: '127.0.0.1', createdAt: now });
    logMockDriveActivity({ spaceId: root.spaceId, nodeId: id, nodeName: node.name, nodeType: 'file', action: 'collect_upload', actorId: null, actorName: null, shareId: share.id, detail: { submitterName, viaShare: true } });
    recalcMockDriveUsage();
    return ok({ id, name: node.name, size: file.size, submittedAt: now }, '提交成功');
  }),
  mock(drivePublicShareContract.content, ({ params, query, request }) => {
    const share = sessionShare(request, query.session, params.token);
    if (!share) return unauthorized('访问会话已失效，请重新验证', { status: 401 });
    const download = !!query.download;
    if (download && !share.capabilities.includes('download')) return forbidden('该外链仅允许在线预览', { status: 403 });
    const node = findNode(params.nodeId);
    if (!node || node.type !== 'file' || (node.id !== share.nodeId && !node.ancestorIds.includes(share.nodeId))) return notFound('文件不存在', { status: 404 });
    if (download) {
      const receipt = `${request.headers.get('session') ?? query.session}:${node.id}:${node.currentVersion}`;
      if (!mockDownloadReceipts.has(receipt)) {
        if (share.maxDownloadCount && share.downloadCount >= share.maxDownloadCount) return forbidden('下载次数已用尽', { status: 403 });
        share.downloadCount += 1;
        mockDownloadReceipts.add(receipt);
      }
    }
    return contentResponse(node, download);
  }),
  mock(drivePublicShareContract.children, ({ params, query, request, ok }) => {
    const share = sessionShare(request, query.session, params.token);
    if (!share) return unauthorized('访问会话已失效，请重新验证', { status: 401 });
    const parentId = query.parentId ?? share.nodeId;
    const parent = findNode(parentId);
    if (!parent || (parent.id !== share.nodeId && !parent.ancestorIds.includes(share.nodeId))) return notFound('目录不存在', { status: 404 });
    return ok(sortNodes(liveNodes().filter((n) => n.parentId === parentId), 'name', 'asc').map((n) => toPublicNode(n, share.token)));
  }),
  mock(drivePublicShareContract.save, ({ params, body, request, url, ok }) => {
    const share = sessionShare(request, url.searchParams.get('session') ?? undefined, params.token);
    if (!share) return unauthorized('访问会话已失效，请重新验证', { status: 401 });
    if (!share.capabilities.includes('download')) return forbidden('该外链仅允许在线预览，不能转存', { status: 403 });
    if (share.maxDownloadCount && share.downloadCount >= share.maxDownloadCount) return forbidden('下载次数已用尽', { status: 403 });
    share.downloadCount += 1;
    const target = body.targetParentId ? findNode(body.targetParentId) : null;
    const now = mockDateTime();
    for (const id of body.nodeIds ?? [share.nodeId]) {
      const src = findNode(id);
      if (!src) continue;
      const nid = getNextDriveNodeId();
      mockDriveNodes.push({ ...src, id: nid, spaceId: body.targetSpaceId, parentId: target?.id ?? null, ancestorIds: target ? [...target.ancestorIds, target.id] : [], depth: target ? target.depth + 1 : 0, name: uniqueName(src.name, body.targetSpaceId, target?.id ?? null), url: src.type === 'file' ? mockDriveContentUrl(nid) : null, createdAt: now, updatedAt: now });
    }
    recalcMockDriveUsage();
    return ok(null, '已转存');
  }),
  mock(drivePublicShareContract.meta, ({ params, request, url, ok }) => {
    const share = shareByToken(params.token);
    if (!share) return notFound('链接不存在或已失效', { status: 404 });
    const state = shareState(share);
    const querySession = url.searchParams.get('session') ?? undefined;
    const authed = sessionShare(request, querySession, params.token);
    if (state !== 'active' && !(state === 'exhausted' && authed)) return forbidden(SHARE_STATE_MESSAGES[state], { status: 403 });
    const node = findNode(share.nodeId);
    const hasSessionParam = !!(request.headers.get('session') ?? querySession);
    if (hasSessionParam && !authed) return unauthorized('访问会话已失效，请重新验证', { status: 401 });
    return ok(publicMeta(share, authed && node ? node : null, mockDriveSharePasswords.has(share.id)));
  }),
];

// ─── 标签 ─────────────────────────────────────────────────────────────────────

const tagHandlers = [
  mock(driveTagContract.merge, ({ params, body, ok }) => {
    const source = requireItem(mockDriveTags, params.id, '标签不存在');
    const target = requireItem(mockDriveTags, body.targetId, '目标标签不存在');
    if (source.spaceId !== target.spaceId || source.id === target.id) return badRequest('请选择同空间的另一个标签', { status: 400 });
    for (const [nodeId, ids] of mockDriveNodeTags) {
      mockDriveNodeTags.set(nodeId, [...new Set(ids.map((id) => id === source.id ? target.id : id))]);
    }
    removeWhere(mockDriveTags, (tag) => tag.id === source.id);
    return ok(null, '标签已合并');
  }),
  mock(driveTagContract.list, ({ query, ok }) => ok(mockDriveTags.filter((t) => t.spaceId === query.spaceId))),
  mock(driveTagContract.create, ({ body, ok }) => {
    const existing = mockDriveTags.find((t) => t.spaceId === body.spaceId && t.name === body.name);
    if (existing) return ok(existing);
    const now = mockDateTime();
    const tag: DriveTag = { id: getNextDriveTagId(), spaceId: body.spaceId, name: body.name, color: body.color ?? null, createdAt: now, updatedAt: now };
    mockDriveTags.push(tag);
    return ok(tag, '创建成功');
  }),
  mock(driveTagContract.update, ({ params, body, ok }) => {
    const tag = updateItem(mockDriveTags, params.id, body, { notFoundMessage: '标签不存在', now: mockDateTime, init: { status: 404 } });
    return ok(tag, '更新成功');
  }),
  mock(driveTagContract.remove, ({ params, ok }) => {
    removeWhere(mockDriveTags, (t) => t.id === params.id);
    for (const [nodeId, ids] of mockDriveNodeTags) mockDriveNodeTags.set(nodeId, ids.filter((x) => x !== params.id));
    return ok(null, '删除成功');
  }),
];

// ─── 治理 ─────────────────────────────────────────────────────────────────────

function categoryOf(node: DriveNode): string {
  const mime = node.mimeType ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('sheet') || mime.includes('excel')) return 'spreadsheet';
  if (mime.includes('word') || mime.includes('document')) return 'document';
  if (mime.startsWith('text/')) return 'text';
  return 'other';
}

const adminHandlers = [
  mock(driveAdminContract.stats, ({ ok }) => {
    recalcMockDriveUsage();
    const files = liveNodes().filter((n) => n.type === 'file');
    const byCategory = new Map<string, { count: number; bytes: number }>();
    for (const f of files) {
      const row = byCategory.get(categoryOf(f)) ?? { count: 0, bytes: 0 };
      row.count += 1; row.bytes += f.size; byCategory.set(categoryOf(f), row);
    }
    const today = mockDateTime().slice(0, 10);
    const dailyTrend = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (13 - i));
      const date = mockDateTime(d).slice(0, 10);
      const dayActs = mockDriveActivities.filter((a) => a.createdAt.startsWith(date));
      return { date, uploads: dayActs.filter((a) => a.action === 'upload' || a.action === 'new_version').length + (i % 4 === 0 ? 2 : i % 3), downloads: dayActs.filter((a) => a.action === 'download').length + (i % 5 === 0 ? 3 : i % 2) };
    });
    return ok({
      spaceCount: mockDriveSpaces.length,
      spaceCountByType: { personal: mockDriveSpaces.filter((s) => s.type === 'personal').length, department: mockDriveSpaces.filter((s) => s.type === 'department').length, team: mockDriveSpaces.filter((s) => s.type === 'team').length },
      fileCount: files.length, folderCount: liveNodes().filter((n) => n.type === 'folder').length,
      totalBytes: mockDriveSpaces.reduce((s, x) => s + x.usedBytes, 0),
      recycleBytes: mockDriveNodes.filter((n) => n.deletedAt && n.type === 'file').reduce((s, n) => s + n.size, 0),
      versionBytes: mockDriveVersions.filter((v) => !v.isCurrent).reduce((s, v) => s + v.size, 0),
      activeShareLinks: mockDriveShareLinks.filter((l) => shareState(l) === 'active').length,
      todayUploads: mockDriveActivities.filter((a) => a.createdAt.startsWith(today) && (a.action === 'upload' || a.action === 'new_version')).length,
      todayDownloads: mockDriveActivities.filter((a) => a.createdAt.startsWith(today) && a.action === 'download').length,
      topSpaces: [...mockDriveSpaces].sort((a, b) => b.usedBytes - a.usedBytes).slice(0, 5).map((s) => ({ id: s.id, name: s.name, type: s.type, usedBytes: s.usedBytes, quotaBytes: s.quotaBytes })),
      typeDistribution: [...byCategory.entries()].map(([category, v]) => ({ category, ...v })),
      dailyTrend,
    });
  }),
  mock(driveAdminContract.spaces, ({ query, ok, paginate }) => {
    const keyword = query.keyword?.trim();
    recalcMockDriveUsage();
    let list = [...mockDriveSpaces];
    if (keyword) list = filterByKeyword(list, keyword, [(s) => s.name, (s) => s.ownerName, (s) => s.departmentName]);
    if (query.type) list = list.filter((s) => s.type === query.type);
    if (query.status) list = list.filter((s) => s.status === query.status);
    if (query.orphaned) list = list.filter(isOrphanedDriveSpace);
    if (query.archived !== undefined) list = list.filter((s) => (query.archived ? !!s.archivedAt : !s.archivedAt));
    // Demo：按已用量估算近 30 天日增（用量的 2%），配额有限时给出预计用满天数
    const decorated = list.map((s) => {
      const dailyGrowthBytes = Math.round(s.usedBytes * 0.02);
      const daysUntilFull = s.quotaBytes && dailyGrowthBytes > 0 ? Math.max(0, Math.ceil((s.quotaBytes - s.usedBytes) / dailyGrowthBytes)) : null;
      return { ...s, dailyGrowthBytes, daysUntilFull };
    });
    return ok(paginate(decorated));
  }),
  mock(driveAdminContract.createDepartmentSpace, ({ body, ok }) => {
    if (mockDriveSpaces.some((s) => s.type === 'department' && s.departmentId === body.departmentId)) return badRequest('该部门已有部门空间', { status: 400 });
    const now = mockDateTime();
    const deptName = subjectName('department', body.departmentId);
    const space: DriveSpace = {
      id: getNextDriveSpaceId(), type: 'department', name: body.name || `${deptName} 部门空间`, description: null, icon: null, ownerId: null, ownerName: null,
      departmentId: body.departmentId, departmentName: deptName, defaultMemberRole: body.defaultMemberRole,
      quotaBytes: (body.quotaGb ?? mockDriveSettings.departmentQuotaGb) * 1024 ** 3, customQuotaBytes: body.quotaGb === null ? null : body.quotaGb * 1024 ** 3, usedBytes: 0,
      maxVersions: null, allowExternalShare: true, status: 'enabled', archivedAt: null, sort: 0, tenantId: null, myRole: 'manager', memberCount: 0, nodeCount: 0, createdAt: now, updatedAt: now,
    };
    mockDriveSpaces.push(space);
    return ok(space, '部门空间已创建');
  }),
  mock(driveAdminContract.recalcUsage, ({ ok }) => { recalcMockDriveUsage(); return ok(createImmediateMockTask({ taskType: 'drive-recalc-usage', title: '网盘容量重算', module: '企业网盘' })); }),
  mock(driveAdminContract.reindex, ({ ok }) => ok(createImmediateMockTask({ taskType: 'drive-reindex', title: '网盘索引补建', module: '企业网盘' }))),
  mock(driveAdminContract.updateSpace, ({ params, body, ok }) => {
    const space = requireItem(mockDriveSpaces, params.id, '空间不存在', { status: 404 });
    const { quotaGb, ownerId, ...rest } = body;
    Object.assign(space, rest, { updatedAt: mockDateTime() });
    if (quotaGb !== undefined) {
      space.customQuotaBytes = quotaGb === null ? null : quotaGb * 1024 ** 3;
      space.quotaBytes = (quotaGb ?? quotaFallbackGb(space.type)) * 1024 ** 3;
    }
    if (ownerId) { space.ownerId = ownerId; space.ownerName = subjectName('user', ownerId); }
    return ok(space, '更新成功');
  }),
  mock(driveAdminContract.handoff, ({ params, body, ok }) => {
    const source = requireItem(mockDriveSpaces, params.id, '源空间不存在');
    if (source.type !== 'personal' && !isOrphanedDriveSpace(source)) return badRequest('仅支持个人或待接管空间', { status: 400 });
    if (source.ownerId === body.recipientId && body.mode === 'merge') return badRequest('不能交接给原所有者', { status: 400 });
    let target = body.mode === 'merge' ? mockDriveSpaces.find((space) => space.type === 'personal' && space.ownerId === body.recipientId) : undefined;
    if (!target) {
      target = { ...source, id: getNextDriveSpaceId(), type: body.mode === 'merge' ? 'personal' : 'team',
        name: body.name ?? `${source.name}（已交接）`, ownerId: body.recipientId, ownerName: subjectName('user', body.recipientId),
        departmentId: null, departmentName: null, defaultMemberRole: null, usedBytes: 0, status: 'enabled' };
      mockDriveSpaces.push(target);
    }
    const nodes = mockDriveNodes.filter((node) => node.spaceId === source.id);
    remapMovedMockNodes(nodes, target.id);
    for (const root of nodes.filter((node) => node.parentId === null)) root.name = uniqueName(root.name, target.id, null, root.id);
    removeWhere(mockDriveSpaces, (space) => space.id === source.id);
    removeWhere(mockDriveMembers, (member) => member.spaceId === source.id);
    recalcMockDriveUsage();
    return ok(target, '已交接');
  }),
  mock(driveAdminContract.removeSpace, ({ params, ok }) => removeSpace(params.id) ?? ok(null, '删除成功')),
  mock(driveAdminContract.shareLinks, ({ query, ok, paginate }) => {
    let list = mockDriveShareLinks.map(withState);
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(l) => l.nodeName, (l) => l.remark, (l) => l.createdByName]);
    if (query.state) list = list.filter((l) => l.state === query.state);
    return ok(paginate(list));
  }),
  mock(driveAdminContract.revokeShareLink, ({ params, ok }) => (revokeShareLink(params.id) ? ok(null, '已撤销') : notFound('外链不存在', { status: 404 }))),
  mock(driveAdminContract.activities, ({ query, ok, paginate }) => {
    let list = [...mockDriveActivities].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(a) => a.nodeName]);
    if (query.spaceId) list = list.filter((a) => a.spaceId === query.spaceId);
    if (query.actorId) list = list.filter((a) => a.actorId === query.actorId);
    if (query.action) list = list.filter((a) => a.action === query.action);
    return ok(paginate(list));
  }),
  // ─── 合规治理 ────────────────────────────────────────────────────────────
  mock(driveAdminContract.shareAccessLogs, ({ query, ok, paginate }) => {
    let list = [...mockDriveShareAccessLogs].sort((a, b) => b.id - a.id).map((log) => {
      const node = findNode(log.nodeId);
      return { ...log, nodeName: node?.name ?? null, spaceId: node?.spaceId ?? null, spaceName: node ? spaceName(node.spaceId) : null };
    });
    if (query.shareId) list = list.filter((l) => l.shareId === query.shareId);
    if (query.spaceId) list = list.filter((l) => l.spaceId === query.spaceId);
    if (query.action) list = list.filter((l) => l.action === query.action);
    if (query.ok !== undefined) list = list.filter((l) => l.ok === query.ok);
    return ok(paginate(list));
  }),
  mock(driveAdminContract.legalHolds, ({ query, ok, paginate }) => {
    let list = [...mockLegalHolds].sort((a, b) => Number(b.active) - Number(a.active) || b.id - a.id);
    if (query.spaceId) list = list.filter((h) => h.spaceId === query.spaceId);
    if (query.nodeId) list = list.filter((h) => h.nodeId === query.nodeId);
    if (query.active !== undefined) list = list.filter((h) => h.active === query.active);
    return ok(paginate(list));
  }),
  mock(driveAdminContract.createLegalHold, ({ body, ok }) => {
    const node = requireItem(mockDriveNodes, body.nodeId, '文件或文件夹不存在', { status: 404 });
    if (mockLegalHolds.some((h) => h.active && h.nodeId === node.id)) return conflict('该节点已处于法律保留', { status: 409 });
    const hold: DriveLegalHold = {
      id: nextHoldId++, nodeId: node.id, nodeName: node.name, nodeType: node.type, spaceId: node.spaceId, spaceName: spaceName(node.spaceId) ?? '',
      reason: body.reason, active: true, createdBy: MOCK_USER.id, createdByName: MOCK_USER.name, createdAt: mockDateTime(),
      releasedBy: null, releasedByName: null, releasedAt: null, releaseNote: null,
    };
    mockLegalHolds.unshift(hold);
    logMockDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'legal_hold', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: { reason: body.reason } });
    return ok(hold, '已设置法律保留');
  }),
  mock(driveAdminContract.releaseLegalHold, ({ params, body, ok }) => {
    const hold = requireItem(mockLegalHolds, params.id, '法律保留记录不存在', { status: 404 });
    if (!hold.active) return badRequest('该保留已解除', { status: 400 });
    Object.assign(hold, { active: false, releasedBy: MOCK_USER.id, releasedByName: MOCK_USER.name, releasedAt: mockDateTime(), releaseNote: body.note?.trim() || null });
    logMockDriveActivity({ spaceId: hold.spaceId, nodeId: hold.nodeId, nodeName: hold.nodeName, nodeType: hold.nodeType, action: 'legal_release', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: null });
    return ok(hold, '已解除法律保留');
  }),
  mock(driveAdminContract.quotaRequests, ({ query, ok, paginate }) => {
    let list = [...mockQuotaRequests].sort((a, b) => Number(a.status !== 'pending') - Number(b.status !== 'pending') || b.id - a.id);
    if (query.status) list = list.filter((r) => r.status === query.status);
    if (query.spaceId) list = list.filter((r) => r.spaceId === query.spaceId);
    return ok(paginate(list));
  }),
  mock(driveAdminContract.decideQuotaRequest, ({ params, body, ok }) => {
    const request = requireItem(mockQuotaRequests, params.id, '扩容申请不存在', { status: 404 });
    if (request.status !== 'pending') return badRequest('该申请已处理', { status: 400 });
    const now = mockDateTime();
    const approvedGb = body.approve ? (body.quotaGb ?? request.requestedGb) : null;
    Object.assign(request, { status: body.approve ? 'approved' : 'rejected', approvedGb, decidedBy: MOCK_USER.id, decidedByName: MOCK_USER.name, decidedAt: now, decisionNote: body.note?.trim() || null, updatedAt: now });
    if (approvedGb !== null) {
      const space = mockDriveSpaces.find((s) => s.id === request.spaceId);
      if (space) { space.customQuotaBytes = approvedGb * 1024 ** 3; space.quotaBytes = approvedGb * 1024 ** 3; }
    }
    return ok(request, body.approve ? '已通过并写入配额' : '已拒绝');
  }),
  mock(driveAdminContract.openGrants, ({ query, ok }) => ok(mockOpenGrants.filter((g) => (!query.spaceId || g.spaceId === query.spaceId) && (!query.clientId || g.clientId === query.clientId)))),
  mock(driveAdminContract.createOpenGrant, ({ body, ok }) => {
    const space = requireItem(mockDriveSpaces, body.spaceId, '空间不存在', { status: 404 });
    if (space.type === 'personal') return badRequest('个人空间不能授权给开放应用', { status: 400 });
    const existing = mockOpenGrants.find((g) => g.clientId === body.clientId && g.spaceId === body.spaceId);
    if (existing) {
      Object.assign(existing, { role: body.role, remark: body.remark?.trim() || null, status: 'enabled' });
      return ok(existing, '已授权');
    }
    const grant: DriveOpenAppGrant = {
      id: nextGrantId++, clientId: body.clientId, appName: `应用 ${body.clientId.slice(0, 8)}`, spaceId: space.id, spaceName: space.name,
      role: body.role, status: 'enabled', remark: body.remark?.trim() || null, createdAt: mockDateTime(),
    };
    mockOpenGrants.unshift(grant);
    return ok(grant, '已授权');
  }),
  mock(driveAdminContract.removeOpenGrant, ({ params, ok }) => {
    requireItem(mockOpenGrants, params.id, '授权不存在', { status: 404 });
    removeWhere(mockOpenGrants, (g) => g.id === params.id);
    return ok(null, '已撤销授权');
  }),
];

const collaborationHandlers = [
  mock(driveCollaborationContract.profile, ({ params, ok }) => {
    requireItem(mockDriveNodes, params.id, '文件不存在');
    return ok(mockDriveProfiles.get(params.id) ?? { nodeId: params.id, description: null, metadata: {} });
  }),
  mock(driveCollaborationContract.saveProfile, ({ params, body, ok }) => {
    const node = requireItem(mockDriveNodes, params.id, '文件不存在');
    const profile = { nodeId: params.id, description: null, metadata: {}, ...mockDriveProfiles.get(params.id), ...body };
    mockDriveProfiles.set(params.id, profile);
    logMockDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'metadata_change', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: null });
    return ok(profile);
  }),
  mock(driveCollaborationContract.subscription, ({ params, ok }) => {
    requireItem(mockDriveNodes, params.id, '文件不存在');
    return ok(mockDriveSubscriptions.has(params.id));
  }),
  mock(driveCollaborationContract.subscribe, ({ params, body, ok }) => {
    requireItem(mockDriveNodes, params.id, '文件不存在');
    if (body.subscribed) mockDriveSubscriptions.add(params.id);
    else mockDriveSubscriptions.delete(params.id);
    return ok(body.subscribed);
  }),
  mock(driveCollaborationContract.editComment, ({ params, body, ok }) => {
    requireItem(mockDriveNodes, params.id, '文件不存在');
    const comment = requireItem(mockDriveComments, params.commentId, '评论不存在');
    if (comment.nodeId !== params.id) return notFound('评论不存在', { status: 404 });
    return ok(updateItem(mockDriveComments, comment.id, body, { notFoundMessage: '评论不存在', now: mockDateTime }));
  }),
  mock(driveCollaborationContract.spaceActivities, ({ params, query, ok, paginate }) => {
    requireItem(mockDriveSpaces, params.id, '空间不存在');
    const list = filterByKeyword(mockDriveActivities.filter((activity) => activity.spaceId === params.id), query.keyword, [(activity) => activity.nodeName])
      .filter((activity) => (!query.action || activity.action === query.action)
        && (!query.startTime || activity.createdAt >= query.startTime)
        && (!query.endTime || activity.createdAt <= (query.endTime.length === 10 ? `${query.endTime} 23:59:59` : query.endTime)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
    return ok(paginate(list));
  }),
];

export const driveHandlers = [
  ...spaceHandlers,
  ...nodeStaticHandlers,
  ...nodeItemHandlers,
  ...shareLinkHandlers,
  ...accessRequestHandlers,
  ...publicHandlers,
  ...tagHandlers,
  ...adminHandlers,
  ...collaborationHandlers,
];
