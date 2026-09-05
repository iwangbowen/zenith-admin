import { fillPath } from '@zenith/shared/core';
import {
  driveNodeContract,
  type DriveActivity,
  type DriveFileVersion,
  type DriveNode,
  type DriveNodeComment,
  type DriveNodePermission,
  type DriveSettings,
  type DriveShareAccessLog,
  type DriveShareLink,
  type DriveSpace,
  type DriveSpaceMember,
  type DriveTag,
} from '@zenith/shared/drive';
import { mockDateTime } from '@/mocks/utils/date';
import { nextIdFrom } from '@/mocks/utils/handlers';

const SEED_DATE = '2026-01-20 10:00:00';

export const MOCK_USER = { id: 1, name: '管理员' };

const GB = 1024 ** 3;

/** 节点内容 / 缩略图 / 历史版本内容的鉴权地址（与服务端映射一致，由契约派生） */
export const mockDriveContentUrl = (nodeId: number) => fillPath(driveNodeContract.content.fullPath, { id: nodeId });
export const mockDriveThumbnailUrl = (nodeId: number) => fillPath(driveNodeContract.thumbnail.fullPath, { id: nodeId });
export const mockDriveVersionContentUrl = (nodeId: number, version: number) => fillPath(driveNodeContract.versionContent.fullPath, { id: nodeId, version });

export const mockDriveSpaces: DriveSpace[] = [
  {
    id: 1, type: 'personal', name: '管理员 的网盘', description: null, icon: null, ownerId: 1, ownerName: '管理员',
    departmentId: null, departmentName: null, defaultMemberRole: null, quotaBytes: 10 * GB, customQuotaBytes: null, usedBytes: 0,
    maxVersions: null, allowExternalShare: true, status: 'enabled', sort: 0, tenantId: null, myRole: 'manager', memberCount: 0, nodeCount: 0,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 2, type: 'department', name: '总部 部门空间', description: '部门共享资料', icon: null, ownerId: null, ownerName: null,
    departmentId: 1, departmentName: '总部', defaultMemberRole: 'editor', quotaBytes: 100 * GB, customQuotaBytes: null, usedBytes: 0,
    maxVersions: null, allowExternalShare: true, status: 'enabled', sort: 0, tenantId: null, myRole: 'manager', memberCount: 0, nodeCount: 0,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 3, type: 'team', name: '产品研发协作区', description: '产品、研发、测试共享的项目文档', icon: null, ownerId: 1, ownerName: '管理员',
    departmentId: null, departmentName: null, defaultMemberRole: 'downloader', quotaBytes: 50 * GB, customQuotaBytes: null, usedBytes: 0,
    maxVersions: null, allowExternalShare: true, status: 'enabled', sort: 0, tenantId: null, myRole: 'manager', memberCount: 2, nodeCount: 0,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const mockDriveMembers: DriveSpaceMember[] = [
  { spaceId: 3, subjectType: 'user', subjectId: 2, subjectName: '张三', role: 'editor', createdAt: SEED_DATE },
  { spaceId: 3, subjectType: 'department', subjectId: 2, subjectName: '研发部', role: 'downloader', createdAt: SEED_DATE },
];

function fileNode(partial: Pick<DriveNode, 'id' | 'spaceId' | 'parentId' | 'name' | 'size' | 'mimeType'> & Partial<DriveNode>): DriveNode {
  const ext = partial.name.includes('.') ? partial.name.split('.').pop()!.toLowerCase() : null;
  return {
    ancestorIds: [], depth: 0, type: 'file', extension: ext, fileId: `mock-file-${partial.id}`, contentHash: `hash-${partial.id}`.padEnd(64, '0'),
    currentVersion: 1, inheritPermissions: true, lockedBy: null, lockedByName: null, lockedAt: null, lockExpiresAt: null,
    thumbnailUrl: partial.mimeType?.startsWith('image/') ? mockDriveThumbnailUrl(partial.id) : null,
    url: mockDriveContentUrl(partial.id), deletedAt: null, deletedBy: null, deletedByName: null, isStarred: false, myRole: 'manager', tags: [],
    createdBy: 1, createdByName: '管理员', updatedBy: 1, updatedByName: '管理员', createdAt: SEED_DATE, updatedAt: SEED_DATE,
    ...partial,
  };
}

function folderNode(partial: Pick<DriveNode, 'id' | 'spaceId' | 'parentId' | 'name'> & Partial<DriveNode>): DriveNode {
  return fileNode({ ...partial, size: 0, mimeType: null, type: 'folder', extension: null, fileId: null, contentHash: null, thumbnailUrl: null, url: null });
}

export const mockDriveNodes: DriveNode[] = [
  folderNode({ id: 1, spaceId: 1, parentId: null, name: '项目资料' }),
  folderNode({ id: 2, spaceId: 1, parentId: null, name: '个人笔记' }),
  fileNode({ id: 3, spaceId: 1, parentId: 1, ancestorIds: [1], depth: 1, name: '需求说明.md', size: 2048, mimeType: 'text/markdown', isStarred: true }),
  fileNode({ id: 4, spaceId: 1, parentId: 1, ancestorIds: [1], depth: 1, name: '架构图.png', size: 184_320, mimeType: 'image/png' }),
  fileNode({ id: 5, spaceId: 1, parentId: null, name: '季度总结.pdf', size: 1_258_291, mimeType: 'application/pdf', currentVersion: 2 }),
  fileNode({ id: 6, spaceId: 1, parentId: 2, ancestorIds: [2], depth: 1, name: 'todo.txt', size: 512, mimeType: 'text/plain' }),
  folderNode({ id: 7, spaceId: 2, parentId: null, name: '规章制度' }),
  fileNode({ id: 8, spaceId: 2, parentId: 7, ancestorIds: [7], depth: 1, name: '员工手册.pdf', size: 3_145_728, mimeType: 'application/pdf', myRole: 'manager' }),
  fileNode({ id: 9, spaceId: 2, parentId: null, name: '组织架构.xlsx', size: 45_056, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  folderNode({ id: 10, spaceId: 3, parentId: null, name: '设计稿' }),
  fileNode({ id: 11, spaceId: 3, parentId: 10, ancestorIds: [10], depth: 1, name: '首页改版.png', size: 720_896, mimeType: 'image/png' }),
  fileNode({ id: 12, spaceId: 3, parentId: null, name: '迭代计划.md', size: 4096, mimeType: 'text/markdown', lockedBy: 2, lockedByName: '张三', lockedAt: SEED_DATE, lockExpiresAt: null }),
];

export const mockDriveTexts = new Map<number, string>([
  [3, '# 需求说明\n\n企业网盘需要完善的权限模型：空间成员、节点授权与继承。'],
  [6, '- 整理会议纪要\n- 更新迭代计划\n- 评审设计稿'],
  [12, '# 迭代计划\n\n本迭代交付网盘工作台、外链分享与治理页。'],
]);

export const mockDrivePermissions: DriveNodePermission[] = [
  { id: 1, nodeId: 1, subjectType: 'department', subjectId: 2, subjectName: '研发部', role: 'downloader', expireAt: null, createdBy: 1, createdByName: '管理员', createdAt: SEED_DATE, inheritedFrom: null },
  { id: 2, nodeId: 5, subjectType: 'user', subjectId: 2, subjectName: '张三', role: 'viewer', expireAt: null, createdBy: 1, createdByName: '管理员', createdAt: SEED_DATE, inheritedFrom: null },
];

export const mockDriveVersions: DriveFileVersion[] = [
  { id: 1, nodeId: 5, version: 1, fileId: 'mock-file-5-v1', size: 1_048_576, contentHash: null, comment: '初稿', authorId: 1, authorName: '管理员', isCurrent: false, url: mockDriveVersionContentUrl(5, 1), createdAt: '2026-01-05 10:00:00' },
  { id: 2, nodeId: 5, version: 2, fileId: 'mock-file-5', size: 1_258_291, contentHash: null, comment: '补充 Q1 数据', authorId: 1, authorName: '管理员', isCurrent: true, url: mockDriveVersionContentUrl(5, 2), createdAt: SEED_DATE },
];

export const mockDriveShareLinks: DriveShareLink[] = [
  {
    id: 1, nodeId: 5, nodeName: '季度总结.pdf', nodeType: 'file', spaceId: 1, token: 'demo-share-token-0001', url: '/public/drive/demo-share-token-0001',
    hasPassword: true, permission: 'download', enabled: true, expireAt: '2027-12-31 23:59:59', maxAccessCount: null, accessCount: 12, downloadCount: 4,
    revokedAt: null, remark: '发给合作伙伴', state: 'active', createdBy: 1, createdByName: '管理员', createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 2, nodeId: 10, nodeName: '设计稿', nodeType: 'folder', spaceId: 3, token: 'demo-share-token-0002', url: '/public/drive/demo-share-token-0002',
    hasPassword: false, permission: 'preview', enabled: true, expireAt: '2026-01-01 00:00:00', maxAccessCount: 50, accessCount: 50, downloadCount: 0,
    revokedAt: null, remark: null, state: 'expired', createdBy: 1, createdByName: '管理员', createdAt: '2025-12-01 09:00:00', updatedAt: '2025-12-01 09:00:00',
  },
];

/** 外链密码明文仅存在于 mock，用于演示密码门 */
export const mockDriveSharePasswords = new Map<number, string>([[1, '1234']]);

export const mockDriveShareAccessLogs: DriveShareAccessLog[] = [
  { id: 1, shareId: 1, nodeId: 5, action: 'access', clientIp: '203.0.113.7', ok: true, createdAt: '2026-01-20 09:12:00' },
  { id: 2, shareId: 1, nodeId: 5, action: 'download', clientIp: '203.0.113.7', ok: true, createdAt: '2026-01-20 09:13:20' },
  { id: 3, shareId: 1, nodeId: 5, action: 'access', clientIp: '198.51.100.23', ok: false, createdAt: '2026-01-21 15:40:05' },
];

export const mockDriveActivities: DriveActivity[] = [
  { id: 1, spaceId: 1, spaceName: '管理员 的网盘', nodeId: 5, nodeName: '季度总结.pdf', nodeType: 'file', action: 'new_version', actorId: 1, actorName: '管理员', shareId: null, detail: { size: 1_258_291, version: 2 }, clientIp: '127.0.0.1', createdAt: SEED_DATE },
  { id: 2, spaceId: 1, spaceName: '管理员 的网盘', nodeId: 5, nodeName: '季度总结.pdf', nodeType: 'file', action: 'share_create', actorId: 1, actorName: '管理员', shareId: 1, detail: null, clientIp: '127.0.0.1', createdAt: SEED_DATE },
  { id: 3, spaceId: 1, spaceName: '管理员 的网盘', nodeId: 5, nodeName: '季度总结.pdf', nodeType: 'file', action: 'share_access', actorId: null, actorName: null, shareId: 1, detail: null, clientIp: '203.0.113.7', createdAt: '2026-01-20 09:12:00' },
  { id: 4, spaceId: 1, spaceName: '管理员 的网盘', nodeId: 1, nodeName: '项目资料', nodeType: 'folder', action: 'permission_change', actorId: 1, actorName: '管理员', shareId: null, detail: null, clientIp: '127.0.0.1', createdAt: '2026-01-18 11:00:00' },
  { id: 5, spaceId: 3, spaceName: '产品研发协作区', nodeId: 12, nodeName: '迭代计划.md', nodeType: 'file', action: 'lock', actorId: 2, actorName: '张三', shareId: null, detail: null, clientIp: '10.0.0.8', createdAt: '2026-01-22 14:05:00' },
  { id: 6, spaceId: 3, spaceName: '产品研发协作区', nodeId: 11, nodeName: '首页改版.png', nodeType: 'file', action: 'upload', actorId: 2, actorName: '张三', shareId: null, detail: { size: 720_896 }, clientIp: '10.0.0.8', createdAt: '2026-01-22 13:58:00' },
];

export const mockDriveTags: DriveTag[] = [
  { id: 1, spaceId: 1, name: '重要', color: 'red', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, spaceId: 1, name: '待归档', color: 'grey', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, spaceId: 3, name: 'v2.0', color: 'blue', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const mockDriveNodeTags = new Map<number, number[]>([[5, [1]], [3, [2]], [11, [3]]]);

export const mockDriveComments: DriveNodeComment[] = [
  { id: 1, nodeId: 5, parentId: null, content: '第三页的同比数据请再核对一下。', authorId: 2, authorName: '张三', createdAt: '2026-01-19 16:20:00', updatedAt: '2026-01-19 16:20:00' },
  { id: 2, nodeId: 5, parentId: null, content: '已在 v2 修正。', authorId: 1, authorName: '管理员', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const mockDriveStars = new Set<number>([3]);

export const mockDriveRecent: Array<{ nodeId: number; lastAccessAt: string; lastAction: DriveActivity['action'] }> = [
  { nodeId: 5, lastAccessAt: SEED_DATE, lastAction: 'new_version' },
  { nodeId: 3, lastAccessAt: '2026-01-19 10:30:00', lastAction: 'preview' },
  { nodeId: 11, lastAccessAt: '2026-01-22 13:58:00', lastAction: 'upload' },
];

export const mockDriveSettings: DriveSettings = {
  personalQuotaGb: 10, departmentQuotaGb: 100, teamQuotaGb: 50, departmentSpaceAutoCreate: true,
  recycleRetentionDays: 30, maxVersions: 20, quotaWarningPercent: 90,
  externalShareEnabled: true, externalShareMaxDays: 365, externalShareRequirePassword: false,
  blockedExtensions: 'exe,bat,cmd,com,msi,scr,ps1,vbs,jar,sh', thumbnailEnabled: true, textIndexEnabled: true,
};

/** 演示会话：token → 外链 id */
export const mockDriveShareSessions = new Map<string, number>();

let nextNodeId = nextIdFrom(mockDriveNodes);
export const getNextDriveNodeId = () => nextNodeId++;
let nextSpaceId = nextIdFrom(mockDriveSpaces);
export const getNextDriveSpaceId = () => nextSpaceId++;
let nextShareId = nextIdFrom(mockDriveShareLinks);
export const getNextDriveShareId = () => nextShareId++;
let nextPermissionId = nextIdFrom(mockDrivePermissions);
export const getNextDrivePermissionId = () => nextPermissionId++;
let nextVersionId = nextIdFrom(mockDriveVersions);
export const getNextDriveVersionId = () => nextVersionId++;
let nextCommentId = nextIdFrom(mockDriveComments);
export const getNextDriveCommentId = () => nextCommentId++;
let nextTagId = nextIdFrom(mockDriveTags);
export const getNextDriveTagId = () => nextTagId++;
let nextActivityId = nextIdFrom(mockDriveActivities);

export function logMockDriveActivity(input: Omit<DriveActivity, 'id' | 'createdAt' | 'clientIp' | 'spaceName'> & { spaceName?: string | null }): void {
  const space = mockDriveSpaces.find((s) => s.id === input.spaceId);
  mockDriveActivities.unshift({ ...input, id: nextActivityId++, spaceName: input.spaceName ?? space?.name ?? null, clientIp: '127.0.0.1', createdAt: mockDateTime() });
}

/** 重算空间用量与节点数（mock 内容变化后调用） */
export function recalcMockDriveUsage(): void {
  for (const space of mockDriveSpaces) {
    const nodes = mockDriveNodes.filter((n) => n.spaceId === space.id);
    space.usedBytes = nodes.filter((n) => n.type === 'file').reduce((sum, n) => sum + n.size, 0)
      + mockDriveVersions.filter((v) => !v.isCurrent && nodes.some((n) => n.id === v.nodeId)).reduce((sum, v) => sum + v.size, 0);
    space.nodeCount = nodes.filter((n) => !n.deletedAt).length;
    space.memberCount = mockDriveMembers.filter((m) => m.spaceId === space.id).length;
  }
}

recalcMockDriveUsage();
