import { createLabelOptions } from '../core/enum-options';

// ─── 空间类型 ─────────────────────────────────────────────────────────────────
export const DRIVE_SPACE_TYPES = ['personal', 'department', 'team'] as const;

export type DriveSpaceType = (typeof DRIVE_SPACE_TYPES)[number];

export const DRIVE_HANDOFF_MODES = ['merge', 'team'] as const;
export const DRIVE_HANDOFF_MODE_LABELS = { merge: '并入接收人的个人空间', team: '转为独立协作空间' } as const;
export const DRIVE_HANDOFF_MODE_OPTIONS = createLabelOptions(DRIVE_HANDOFF_MODES, DRIVE_HANDOFF_MODE_LABELS);

export function isOrphanedDriveSpace(space: { type: DriveSpaceType; ownerId: number | null; departmentId: number | null }): boolean {
  return space.type === 'department' ? space.departmentId === null : space.ownerId === null;
}

export const DRIVE_SPACE_TYPE_LABELS: Record<DriveSpaceType, string> = {
  personal: '个人空间',
  department: '部门空间',
  team: '协作空间',
};

export const DRIVE_SPACE_TYPE_OPTIONS: Array<{ value: DriveSpaceType; label: string }> =
  createLabelOptions(DRIVE_SPACE_TYPES, DRIVE_SPACE_TYPE_LABELS);

// ─── 授权主体 ─────────────────────────────────────────────────────────────────
export const DRIVE_SUBJECT_TYPES = ['user', 'department', 'role', 'user_group'] as const;

export type DriveSubjectType = (typeof DRIVE_SUBJECT_TYPES)[number];

export const DRIVE_SUBJECT_TYPE_LABELS: Record<DriveSubjectType, string> = {
  user: '用户',
  department: '部门',
  role: '角色',
  user_group: '用户组',
};

export const DRIVE_SUBJECT_TYPE_OPTIONS: Array<{ value: DriveSubjectType; label: string }> =
  createLabelOptions(DRIVE_SUBJECT_TYPES, DRIVE_SUBJECT_TYPE_LABELS);

// ─── 角色（等级递增）───────────────────────────────────────────────────────────
export const DRIVE_ROLES = ['viewer', 'downloader', 'editor', 'manager'] as const;

export type DriveRole = (typeof DRIVE_ROLES)[number];

export const DRIVE_ROLE_LABELS: Record<DriveRole, string> = {
  viewer: '仅预览',
  downloader: '可下载',
  editor: '可编辑',
  manager: '管理者',
};

export const DRIVE_ROLE_DESCRIPTIONS: Record<DriveRole, string> = {
  viewer: '浏览目录、在线预览，不可下载',
  downloader: '预览 + 下载 / 打包下载',
  editor: '下载 + 上传、新建、重命名、移动、复制、删除到回收站、上传新版本',
  manager: '编辑 + 管理协作者授权、断开继承、彻底删除、外链管理',
};

export const DRIVE_ROLE_OPTIONS: Array<{ value: DriveRole; label: string }> =
  createLabelOptions(DRIVE_ROLES, DRIVE_ROLE_LABELS);

/** 角色等级：数值越大权限越高 */
export const DRIVE_ROLE_RANK: Record<DriveRole, number> = { viewer: 1, downloader: 2, editor: 3, manager: 4 };

export function driveRoleAtLeast(role: DriveRole | null | undefined, minRole: DriveRole): boolean {
  return !!role && DRIVE_ROLE_RANK[role] >= DRIVE_ROLE_RANK[minRole];
}

export function maxDriveRole(...roles: Array<DriveRole | null | undefined>): DriveRole | null {
  let best: DriveRole | null = null;
  for (const role of roles) {
    if (role && (!best || DRIVE_ROLE_RANK[role] > DRIVE_ROLE_RANK[best])) best = role;
  }
  return best;
}

// ─── 节点类型 ─────────────────────────────────────────────────────────────────
export const DRIVE_NODE_TYPES = ['folder', 'file'] as const;

export type DriveNodeType = (typeof DRIVE_NODE_TYPES)[number];

export const DRIVE_NODE_TYPE_LABELS: Record<DriveNodeType, string> = {
  folder: '文件夹',
  file: '文件',
};

export const DRIVE_NODE_TYPE_OPTIONS: Array<{ value: DriveNodeType; label: string }> =
  createLabelOptions(DRIVE_NODE_TYPES, DRIVE_NODE_TYPE_LABELS);

// ─── 外链能力位 / 种类 ────────────────────────────────────────────────────────
export const DRIVE_SHARE_CAPABILITIES = ['preview', 'download', 'upload'] as const;

export type DriveShareCapability = (typeof DRIVE_SHARE_CAPABILITIES)[number];

export function normalizeDriveShareCapabilities(capabilities: readonly DriveShareCapability[]): DriveShareCapability[] {
  return [...new Set<DriveShareCapability>(capabilities.includes('download') ? ['preview', ...capabilities] : capabilities)];
}

export const DRIVE_SHARE_CAPABILITY_LABELS: Record<DriveShareCapability, string> = {
  preview: '在线预览',
  download: '下载 / 转存',
  upload: '上传（文件收集）',
};

export const DRIVE_SHARE_CAPABILITY_OPTIONS: Array<{ value: DriveShareCapability; label: string }> =
  createLabelOptions(DRIVE_SHARE_CAPABILITIES, DRIVE_SHARE_CAPABILITY_LABELS);

export const DRIVE_SHARE_KINDS = ['share', 'collect'] as const;

export type DriveShareKind = (typeof DRIVE_SHARE_KINDS)[number];

export const DRIVE_SHARE_KIND_LABELS: Record<DriveShareKind, string> = {
  share: '分享',
  collect: '文件收集',
};

export const DRIVE_SHARE_KIND_OPTIONS: Array<{ value: DriveShareKind; label: string }> =
  createLabelOptions(DRIVE_SHARE_KINDS, DRIVE_SHARE_KIND_LABELS);

/** 能力位集合的简短标签：「仅预览」「可下载」「可上传」组合 */
export function describeShareCapabilities(capabilities: readonly DriveShareCapability[]): string {
  const set = new Set(capabilities);
  const parts: string[] = [];
  if (set.has('download')) parts.push('可下载');
  else if (set.has('preview')) parts.push('仅预览');
  if (set.has('upload')) parts.push('可上传');
  return parts.join(' · ') || '无权限';
}

// ─── 访问申请 ─────────────────────────────────────────────────────────────────
export const DRIVE_ACCESS_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

export type DriveAccessRequestStatus = (typeof DRIVE_ACCESS_REQUEST_STATUSES)[number];

export const DRIVE_ACCESS_REQUEST_STATUS_LABELS: Record<DriveAccessRequestStatus, string> = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已取消',
};

export const DRIVE_ACCESS_REQUEST_STATUS_OPTIONS: Array<{ value: DriveAccessRequestStatus; label: string }> =
  createLabelOptions(DRIVE_ACCESS_REQUEST_STATUSES, DRIVE_ACCESS_REQUEST_STATUS_LABELS);

/** 可申请的角色：manager 只能由管理者直接授予 */
export const DRIVE_REQUESTABLE_ROLES = ['viewer', 'downloader', 'editor'] as const;

/** 配额扩容申请状态（与访问申请同一组值） */
export const DRIVE_QUOTA_REQUEST_STATUSES = DRIVE_ACCESS_REQUEST_STATUSES;
export type DriveQuotaRequestStatus = DriveAccessRequestStatus;

/** 开放平台可订阅的网盘事件（由文件动态派生；at-least-once） */
export const DRIVE_OPEN_EVENTS = [
  'drive.node.created', 'drive.node.version_created', 'drive.node.updated', 'drive.node.deleted', 'drive.node.restored', 'drive.node.purged',
  'drive.share.created', 'drive.share.revoked', 'drive.collect.received',
] as const;

export type DriveOpenEvent = (typeof DRIVE_OPEN_EVENTS)[number];

export const DRIVE_OPEN_EVENT_LABELS: Record<DriveOpenEvent, string> = {
  'drive.node.created': '网盘文件上传',
  'drive.node.version_created': '网盘文件新版本',
  'drive.node.updated': '网盘文件变更（重命名 / 移动 / 属性）',
  'drive.node.deleted': '网盘文件删除到回收站',
  'drive.node.restored': '网盘文件还原',
  'drive.node.purged': '网盘文件彻底删除',
  'drive.share.created': '网盘外链创建',
  'drive.share.revoked': '网盘外链撤销',
  'drive.collect.received': '网盘收集到新文件',
};

/** 动态动作 → 开放平台事件；未列出的动作（预览 / 下载等高频事件）不对外投递 */
export const DRIVE_ACTIVITY_OPEN_EVENT: Partial<Record<DriveActivityAction, DriveOpenEvent>> = {
  upload: 'drive.node.created',
  new_version: 'drive.node.version_created',
  version_restore: 'drive.node.version_created',
  rename: 'drive.node.updated',
  move: 'drive.node.updated',
  metadata_change: 'drive.node.updated',
  tag: 'drive.node.updated',
  delete: 'drive.node.deleted',
  restore: 'drive.node.restored',
  purge: 'drive.node.purged',
  share_create: 'drive.share.created',
  share_revoke: 'drive.share.revoked',
  collect_upload: 'drive.collect.received',
};

/** 节点在线状态：心跳有效期与前端上报间隔（秒） */
export const DRIVE_PRESENCE_TTL_SECONDS = 60;
export const DRIVE_PRESENCE_HEARTBEAT_SECONDS = 25;

// ─── 渲染产物 ─────────────────────────────────────────────────────────────────
export const DRIVE_RENDITION_KINDS = ['thumbnail', 'text', 'pdf', 'preview'] as const;

export type DriveRenditionKind = (typeof DRIVE_RENDITION_KINDS)[number];

export const DRIVE_RENDITION_STATUSES = ['pending', 'ready', 'failed', 'skipped'] as const;

export type DriveRenditionStatus = (typeof DRIVE_RENDITION_STATUSES)[number];

// ─── 外链派生状态 ─────────────────────────────────────────────────────────────
export const DRIVE_SHARE_LINK_STATES = ['active', 'expired', 'exhausted', 'disabled', 'revoked'] as const;

export type DriveShareLinkState = (typeof DRIVE_SHARE_LINK_STATES)[number];

// ─── 同名冲突策略 ─────────────────────────────────────────────────────────────
export const DRIVE_UPLOAD_CONFLICT_POLICIES = ['rename', 'version', 'fail'] as const;

export type DriveUploadConflictPolicy = (typeof DRIVE_UPLOAD_CONFLICT_POLICIES)[number];

export const DRIVE_UPLOAD_CONFLICT_POLICY_LABELS: Record<DriveUploadConflictPolicy, string> = {
  rename: '保留两者（自动重命名）',
  version: '覆盖为新版本',
  fail: '跳过',
};

export const DRIVE_UPLOAD_CONFLICT_POLICY_OPTIONS: Array<{ value: DriveUploadConflictPolicy; label: string }> =
  createLabelOptions(DRIVE_UPLOAD_CONFLICT_POLICIES, DRIVE_UPLOAD_CONFLICT_POLICY_LABELS);

// ─── 动态动作 ─────────────────────────────────────────────────────────────────
export const DRIVE_ACTIVITY_ACTIONS = [
  'upload', 'new_version', 'create_folder', 'rename', 'move', 'copy', 'delete', 'restore', 'purge',
  'download', 'preview', 'share_create', 'share_update', 'share_revoke', 'share_access', 'save_from_share', 'collect_upload',
  'permission_change', 'inherit_change', 'version_restore', 'version_delete', 'lock', 'unlock', 'comment', 'tag', 'metadata_change',
  'legal_hold', 'legal_release', 'archive', 'unarchive',
] as const;

export type DriveActivityAction = (typeof DRIVE_ACTIVITY_ACTIONS)[number];

export const DRIVE_ACTIVITY_ACTION_LABELS: Record<DriveActivityAction, string> = {
  upload: '上传',
  new_version: '上传新版本',
  create_folder: '新建文件夹',
  rename: '重命名',
  move: '移动',
  copy: '复制',
  delete: '删除到回收站',
  restore: '还原',
  purge: '彻底删除',
  download: '下载',
  preview: '预览',
  share_create: '创建外链',
  share_update: '修改外链',
  share_revoke: '撤销外链',
  share_access: '外链访问',
  save_from_share: '外链转存',
  collect_upload: '收集上传',
  permission_change: '变更授权',
  inherit_change: '变更继承',
  version_restore: '版本回滚',
  version_delete: '删除版本',
  lock: '签出锁定',
  unlock: '解除锁定',
  comment: '评论',
  tag: '标签变更',
  metadata_change: '说明与属性变更',
  legal_hold: '设置法律保留',
  legal_release: '解除法律保留',
  archive: '归档空间',
  unarchive: '恢复归档',
};

export const DRIVE_ACTIVITY_ACTION_OPTIONS: Array<{ value: DriveActivityAction; label: string }> =
  createLabelOptions(DRIVE_ACTIVITY_ACTIONS, DRIVE_ACTIVITY_ACTION_LABELS);

// ─── 工作台视图 ───────────────────────────────────────────────────────────────
export const DRIVE_VIEWS = ['space', 'shared', 'starred', 'recent', 'recycle', 'links'] as const;

export type DriveView = (typeof DRIVE_VIEWS)[number];

export const DRIVE_VIEW_LABELS: Record<DriveView, string> = {
  space: '空间',
  shared: '与我共享',
  starred: '我的收藏',
  recent: '最近访问',
  recycle: '回收站',
  links: '我的外链',
};

/** 简单上传阈值：超过则走分片上传 */
export const DRIVE_SIMPLE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/** 客户端计算 SHA-256 的文件大小上限（超过不做秒传检查） */
export const DRIVE_CLIENT_HASH_MAX_BYTES = 512 * 1024 * 1024;

/** 同步打包下载上限：超过任一阈值改走任务中心 */
export const DRIVE_SYNC_ZIP_MAX_FILES = 50;
export const DRIVE_SYNC_ZIP_MAX_BYTES = 200 * 1024 * 1024;

/** 同步复制子树的节点数上限：超过改走任务中心 */
export const DRIVE_SYNC_COPY_MAX_NODES = 500;

/** 外链访问会话有效期（秒） */
export const DRIVE_SHARE_SESSION_TTL_SECONDS = 2 * 60 * 60;

/** 签出锁默认有效期（分钟） */
export const DRIVE_LOCK_DEFAULT_MINUTES = 60;
