import { HttpResponse } from 'msw';
import { fillPath } from '@zenith/shared/core';
import {
  DRIVE_SYNC_ZIP_MAX_FILES,
  driveAdminContract,
  driveNodeContract,
  drivePublicShareContract,
  driveShareLinkContract,
  driveSpaceContract,
  driveTagContract,
  type DriveNode,
  type DriveNodeDetail,
  type DriveNodeListResult,
  type DriveNodePermissionsResult,
  type DrivePublicNode,
  type DriveShareLink,
  type DriveShareLinkState,
  type DriveSpace,
  type DriveSubjectType,
  type DriveTag,
} from '@zenith/shared/drive';
import { mock } from '@/mocks/utils/contract';
import { badRequest, forbidden, notFound, unauthorized } from '@/mocks/utils/handlers';
import { mockDateTime } from '@/mocks/utils/date';
import { removeWhere } from '@/mocks/utils/array';
import { createImmediateMockTask } from './async-tasks';
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
  mockDriveActivities,
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
  };
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
  if (link.expireAt && link.expireAt < mockDateTime()) return 'expired';
  if (link.maxAccessCount && link.accessCount >= link.maxAccessCount) return 'exhausted';
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
}

function filterNodes<T extends DriveNode>(list: T[], q: NodeFilter): T[] {
  const keyword = q.keyword?.trim().toLowerCase();
  return list.filter((n) => (!keyword || n.name.toLowerCase().includes(keyword)) && (!q.spaceId || n.spaceId === q.spaceId) && (!q.type || n.type === q.type));
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
  mock(driveSpaceContract.my, ({ ok }) => { recalcMockDriveUsage(); return ok(mockDriveSpaces.filter((s) => s.status === 'enabled')); }),
  mock(driveSpaceContract.list, ({ query, ok, paginate }) => {
    const keyword = query.keyword?.trim();
    recalcMockDriveUsage();
    let list = mockDriveSpaces.filter((s) => s.type !== 'personal' || s.ownerId === MOCK_USER.id);
    if (keyword) list = list.filter((s) => s.name.includes(keyword) || (s.ownerName ?? '').includes(keyword));
    if (query.type) list = list.filter((s) => s.type === query.type);
    if (query.status) list = list.filter((s) => s.status === query.status);
    return ok(paginate(list));
  }),
  mock(driveSpaceContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const space: DriveSpace = {
      id: getNextDriveSpaceId(), type: 'team', name: body.name, description: body.description ?? null, icon: body.icon ?? null,
      ownerId: MOCK_USER.id, ownerName: MOCK_USER.name, departmentId: null, departmentName: null, defaultMemberRole: body.defaultMemberRole,
      quotaBytes: (body.quotaGb ?? mockDriveSettings.teamQuotaGb) * 1024 ** 3, customQuotaBytes: body.quotaGb === null ? null : body.quotaGb * 1024 ** 3,
      usedBytes: 0, maxVersions: body.maxVersions, allowExternalShare: body.allowExternalShare, status: body.status, sort: body.sort,
      tenantId: null, myRole: 'manager', memberCount: body.members.length, nodeCount: 0, createdAt: now, updatedAt: now,
    };
    mockDriveSpaces.push(space);
    for (const m of body.members) mockDriveMembers.push({ spaceId: space.id, ...m, subjectName: subjectName(m.subjectType, m.subjectId), createdAt: now });
    return ok(space, '创建成功');
  }),
  mock(driveSpaceContract.detail, ({ params, ok }) => {
    const space = mockDriveSpaces.find((s) => s.id === params.id);
    if (!space) return notFound('空间不存在', { status: 404 });
    recalcMockDriveUsage();
    return ok(space);
  }),
  mock(driveSpaceContract.update, ({ params, body, ok }) => {
    const space = mockDriveSpaces.find((s) => s.id === params.id);
    if (!space) return notFound('空间不存在', { status: 404 });
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
    const space = mockDriveSpaces.find((s) => s.id === params.id);
    if (!space) return notFound('空间不存在', { status: 404 });
    space.ownerId = body.ownerId; space.ownerName = subjectName('user', body.ownerId); space.updatedAt = mockDateTime();
    return ok(space, '已转让');
  }),
];

// ─── 节点：静态路径 ───────────────────────────────────────────────────────────

const nodeStaticHandlers = [
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
    const victims = new Set(body.ids.flatMap((id) => subtree(id).map((n) => n.id)));
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
    const list = liveNodes()
      .filter((n) => (!query.spaceId || n.spaceId === query.spaceId) && (!query.type || n.type === query.type))
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
    const space = mockDriveSpaces.find((s) => s.id === body.spaceId);
    if (!space) return notFound('空间不存在', { status: 404 });
    const existing = liveNodes().find((n) => n.spaceId === body.spaceId && n.parentId === body.parentId && n.name.toLowerCase() === body.fileName.toLowerCase());
    const remaining = space.quotaBytes ? space.quotaBytes - space.usedBytes : null;
    return ok({ conflict: !!existing, existingNodeId: existing?.id ?? null, quotaOk: remaining === null || remaining >= body.fileSize, quotaRemaining: remaining, instant: false, node: null });
  }),
  mock(driveNodeContract.upload, async ({ body, ok }) => {
    const file = body.get('file');
    if (!(file instanceof File)) return badRequest('缺少文件', { status: 400 });
    const spaceId = Number(body.get('spaceId'));
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
    const parent = body.parentId ? findNode(body.parentId) : null;
    if (body.parentId && !parent) return notFound('父目录不存在', { status: 404 });
    if (liveNodes().some((n) => n.spaceId === body.spaceId && n.parentId === body.parentId && n.name.toLowerCase() === body.name.toLowerCase())) {
      return badRequest('同一目录下已存在同名项目', { status: 400 });
    }
    const now = mockDateTime();
    const id = getNextDriveNodeId();
    const node: DriveNode = {
      id, spaceId: body.spaceId, parentId: body.parentId, ancestorIds: parent ? [...parent.ancestorIds, parent.id] : [], depth: parent ? parent.depth + 1 : 0,
      type: 'folder', name: body.name, extension: null, mimeType: null, fileId: null, size: 0, contentHash: null, currentVersion: 0, inheritPermissions: true,
      lockedBy: null, lockedByName: null, lockedAt: null, lockExpiresAt: null, thumbnailUrl: null, url: null, deletedAt: null, deletedBy: null, deletedByName: null,
      createdBy: MOCK_USER.id, createdByName: MOCK_USER.name, updatedBy: MOCK_USER.id, updatedByName: MOCK_USER.name, createdAt: now, updatedAt: now,
    };
    mockDriveNodes.push(node);
    logMockDriveActivity({ spaceId: node.spaceId, nodeId: id, nodeName: node.name, nodeType: 'folder', action: 'create_folder', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: null, detail: null });
    return ok(decorate(node), '文件夹已创建');
  }),
  mock(driveNodeContract.move, ({ body, ok }) => {
    const target = body.targetParentId ? findNode(body.targetParentId) : null;
    for (const id of body.ids) {
      const node = findNode(id);
      if (!node) continue;
      if (target && (target.id === id || target.ancestorIds.includes(id))) return badRequest('不能移动到自身或其子目录', { status: 400 });
      const oldDepth = node.ancestorIds.length;
      const newAncestors = target ? [...target.ancestorIds, target.id] : [];
      for (const n of subtree(id)) {
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
    const comment = { id: getNextDriveCommentId(), nodeId: node.id, parentId: body.parentId, content: body.content, authorId: MOCK_USER.id, authorName: MOCK_USER.name, createdAt: now, updatedAt: now };
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
    if (!mockDriveSettings.externalShareEnabled) return forbidden('管理员已关闭外链分享功能', { status: 403 });
    if (mockDriveSettings.externalShareRequirePassword && !body.password) return badRequest('管理员要求外链必须设置访问密码', { status: 400 });
    const now = mockDateTime();
    const id = getNextDriveShareId();
    const token = `demo-share-${id.toString().padStart(4, '0')}-${Math.random().toString(36).slice(2, 10)}`;
    const link: DriveShareLink = {
      id, nodeId: node.id, nodeName: node.name, nodeType: node.type, spaceId: node.spaceId, token, url: `/public/drive/${token}`,
      hasPassword: !!body.password, permission: body.permission, enabled: true, expireAt: body.expireAt, maxAccessCount: body.maxAccessCount,
      accessCount: 0, downloadCount: 0, revokedAt: null, remark: body.remark ?? null, state: 'active', createdBy: MOCK_USER.id, createdByName: MOCK_USER.name, createdAt: now, updatedAt: now,
    };
    if (body.password) mockDriveSharePasswords.set(id, body.password);
    mockDriveShareLinks.unshift(link);
    logMockDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'share_create', actorId: MOCK_USER.id, actorName: MOCK_USER.name, shareId: id, detail: null });
    return ok(withState(link), '外链已创建');
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
    if (query.keyword) list = list.filter((l) => l.nodeName.includes(query.keyword!) || (l.remark ?? '').includes(query.keyword!));
    if (query.state) list = list.filter((l) => l.state === query.state);
    return ok(paginate(list));
  }),
  mock(driveShareLinkContract.accessLogs, ({ params, ok, paginate }) =>
    ok(paginate(mockDriveShareAccessLogs.filter((l) => l.shareId === params.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))))),
  mock(driveShareLinkContract.revoke, ({ params, ok }) => (revokeShareLink(params.id) ? ok(null, '已撤销') : notFound('外链不存在', { status: 404 }))),
  mock(driveShareLinkContract.update, ({ params, body, ok }) => {
    const link = mockDriveShareLinks.find((l) => l.id === params.id);
    if (!link) return notFound('外链不存在', { status: 404 });
    if (link.revokedAt) return badRequest('外链已撤销，不能修改', { status: 400 });
    const { password, clearPassword, ...rest } = body;
    Object.assign(link, rest, { updatedAt: mockDateTime() });
    if (clearPassword) { mockDriveSharePasswords.delete(link.id); link.hasPassword = false; }
    if (password) { mockDriveSharePasswords.set(link.id, password); link.hasPassword = true; }
    return ok(withState(link), '已更新');
  }),
  mock(driveShareLinkContract.remove, ({ params, ok }) => {
    removeWhere(mockDriveShareLinks, (l) => l.id === params.id);
    return ok(null, '已删除');
  }),
];

// ─── 公开外链 ─────────────────────────────────────────────────────────────────

function shareByToken(token: string): DriveShareLink | undefined {
  return mockDriveShareLinks.find((l) => l.token === token);
}

/** 会话可经 header `session` 或查询串 `session` 携带 */
function sessionShare(request: Request, querySession: string | undefined, token: string): DriveShareLink | null {
  const session = request.headers.get('session') ?? querySession;
  if (!session) return null;
  const shareId = mockDriveShareSessions.get(session);
  const share = shareByToken(token);
  return share && share.id === shareId ? share : null;
}

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
      meta: { token: share.token, permission: share.permission, requirePassword: !!expected, node: toPublicNode(node, share.token), expireAt: share.expireAt, sharerName: share.createdByName },
    });
  }),
  mock(drivePublicShareContract.content, ({ params, query, request }) => {
    const share = sessionShare(request, query.session, params.token);
    if (!share) return unauthorized('访问会话已失效，请重新验证', { status: 401 });
    const download = !!query.download;
    if (download && share.permission !== 'download') return forbidden('该外链仅允许在线预览', { status: 403 });
    const node = findNode(params.nodeId);
    if (!node || node.type !== 'file' || (node.id !== share.nodeId && !node.ancestorIds.includes(share.nodeId))) return notFound('文件不存在', { status: 404 });
    if (download) share.downloadCount += 1;
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
    if (share.permission !== 'download') return forbidden('该外链仅允许在线预览，不能转存', { status: 403 });
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
    if (state !== 'active') return forbidden(SHARE_STATE_MESSAGES[state], { status: 403 });
    const querySession = url.searchParams.get('session') ?? undefined;
    const authed = sessionShare(request, querySession, params.token);
    const node = findNode(share.nodeId);
    const hasSessionParam = !!(request.headers.get('session') ?? querySession);
    if (hasSessionParam && !authed) return unauthorized('访问会话已失效，请重新验证', { status: 401 });
    return ok({ token: share.token, permission: share.permission, requirePassword: mockDriveSharePasswords.has(share.id), node: authed && node ? toPublicNode(node, share.token) : null, expireAt: share.expireAt, sharerName: share.createdByName });
  }),
];

// ─── 标签 ─────────────────────────────────────────────────────────────────────

const tagHandlers = [
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
    const tag = mockDriveTags.find((t) => t.id === params.id);
    if (!tag) return notFound('标签不存在', { status: 404 });
    Object.assign(tag, body, { updatedAt: mockDateTime() });
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
    if (keyword) list = list.filter((s) => s.name.includes(keyword) || (s.ownerName ?? '').includes(keyword) || (s.departmentName ?? '').includes(keyword));
    if (query.type) list = list.filter((s) => s.type === query.type);
    if (query.status) list = list.filter((s) => s.status === query.status);
    return ok(paginate(list));
  }),
  mock(driveAdminContract.createDepartmentSpace, ({ body, ok }) => {
    if (mockDriveSpaces.some((s) => s.type === 'department' && s.departmentId === body.departmentId)) return badRequest('该部门已有部门空间', { status: 400 });
    const now = mockDateTime();
    const deptName = subjectName('department', body.departmentId);
    const space: DriveSpace = {
      id: getNextDriveSpaceId(), type: 'department', name: body.name || `${deptName} 部门空间`, description: null, icon: null, ownerId: null, ownerName: null,
      departmentId: body.departmentId, departmentName: deptName, defaultMemberRole: body.defaultMemberRole,
      quotaBytes: (body.quotaGb ?? mockDriveSettings.departmentQuotaGb) * 1024 ** 3, customQuotaBytes: body.quotaGb === null ? null : body.quotaGb * 1024 ** 3, usedBytes: 0,
      maxVersions: null, allowExternalShare: true, status: 'enabled', sort: 0, tenantId: null, myRole: 'manager', memberCount: 0, nodeCount: 0, createdAt: now, updatedAt: now,
    };
    mockDriveSpaces.push(space);
    return ok(space, '部门空间已创建');
  }),
  mock(driveAdminContract.recalcUsage, ({ ok }) => { recalcMockDriveUsage(); return ok(createImmediateMockTask({ taskType: 'drive-recalc-usage', title: '网盘容量重算', module: '企业网盘' })); }),
  mock(driveAdminContract.reindex, ({ ok }) => ok(createImmediateMockTask({ taskType: 'drive-reindex', title: '网盘索引补建', module: '企业网盘' }))),
  mock(driveAdminContract.updateSpace, ({ params, body, ok }) => {
    const space = mockDriveSpaces.find((s) => s.id === params.id);
    if (!space) return notFound('空间不存在', { status: 404 });
    const { quotaGb, ownerId, ...rest } = body;
    Object.assign(space, rest, { updatedAt: mockDateTime() });
    if (quotaGb !== undefined) {
      space.customQuotaBytes = quotaGb === null ? null : quotaGb * 1024 ** 3;
      space.quotaBytes = (quotaGb ?? quotaFallbackGb(space.type)) * 1024 ** 3;
    }
    if (ownerId) { space.ownerId = ownerId; space.ownerName = subjectName('user', ownerId); }
    return ok(space, '更新成功');
  }),
  mock(driveAdminContract.removeSpace, ({ params, ok }) => removeSpace(params.id) ?? ok(null, '删除成功')),
  mock(driveAdminContract.shareLinks, ({ query, ok, paginate }) => {
    let list = mockDriveShareLinks.map(withState);
    if (query.keyword) list = list.filter((l) => l.nodeName.includes(query.keyword!) || (l.remark ?? '').includes(query.keyword!) || (l.createdByName ?? '').includes(query.keyword!));
    if (query.state) list = list.filter((l) => l.state === query.state);
    return ok(paginate(list));
  }),
  mock(driveAdminContract.revokeShareLink, ({ params, ok }) => (revokeShareLink(params.id) ? ok(null, '已撤销') : notFound('外链不存在', { status: 404 }))),
  mock(driveAdminContract.activities, ({ query, ok, paginate }) => {
    let list = [...mockDriveActivities].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (query.keyword) list = list.filter((a) => a.nodeName.includes(query.keyword!));
    if (query.spaceId) list = list.filter((a) => a.spaceId === query.spaceId);
    if (query.actorId) list = list.filter((a) => a.actorId === query.actorId);
    if (query.action) list = list.filter((a) => a.action === query.action);
    return ok(paginate(list));
  }),
  mock(driveAdminContract.settings, ({ ok }) => ok(mockDriveSettings)),
  mock(driveAdminContract.saveSettings, ({ body, ok }) => {
    Object.assign(mockDriveSettings, body);
    for (const s of mockDriveSpaces) {
      if (s.customQuotaBytes !== null) continue;
      s.quotaBytes = quotaFallbackGb(s.type) * 1024 ** 3;
    }
    return ok(mockDriveSettings, '设置已保存');
  }),
];

export const driveHandlers = [
  ...spaceHandlers,
  ...nodeStaticHandlers,
  ...nodeItemHandlers,
  ...shareLinkHandlers,
  ...publicHandlers,
  ...tagHandlers,
  ...adminHandlers,
];
