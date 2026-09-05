import { createLabelOptions } from '../core/enum-options';

// ─── 空间类型 ─────────────────────────────────────────────────────────────────
export const DRIVE_SPACE_TYPES = ['personal', 'department', 'team'] as const;

export type DriveSpaceType = (typeof DRIVE_SPACE_TYPES)[number];

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

// ─── 外链权限 ─────────────────────────────────────────────────────────────────
export const DRIVE_SHARE_PERMISSIONS = ['preview', 'download'] as const;

export type DriveSharePermission = (typeof DRIVE_SHARE_PERMISSIONS)[number];

export const DRIVE_SHARE_PERMISSION_LABELS: Record<DriveSharePermission, string> = {
  preview: '仅预览',
  download: '可下载',
};

export const DRIVE_SHARE_PERMISSION_OPTIONS: Array<{ value: DriveSharePermission; label: string }> =
  createLabelOptions(DRIVE_SHARE_PERMISSIONS, DRIVE_SHARE_PERMISSION_LABELS);

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
  'download', 'preview', 'share_create', 'share_update', 'share_revoke', 'share_access', 'save_from_share',
  'permission_change', 'inherit_change', 'version_restore', 'version_delete', 'lock', 'unlock', 'comment', 'tag',
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
  permission_change: '变更授权',
  inherit_change: '变更继承',
  version_restore: '版本回滚',
  version_delete: '删除版本',
  lock: '签出锁定',
  unlock: '解除锁定',
  comment: '评论',
  tag: '标签变更',
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

// ─── 全局设置（存 system_configs，drive_ 前缀）──────────────────────────────────
export const DRIVE_SETTING_KEYS = {
  personalQuotaGb: 'drive_personal_quota_gb',
  departmentQuotaGb: 'drive_department_quota_gb',
  teamQuotaGb: 'drive_team_quota_gb',
  departmentSpaceAutoCreate: 'drive_department_space_auto_create',
  recycleRetentionDays: 'drive_recycle_retention_days',
  maxVersions: 'drive_max_versions',
  quotaWarningPercent: 'drive_quota_warning_percent',
  externalShareEnabled: 'drive_external_share_enabled',
  externalShareMaxDays: 'drive_external_share_max_days',
  externalShareRequirePassword: 'drive_external_share_require_password',
  blockedExtensions: 'drive_blocked_extensions',
  thumbnailEnabled: 'drive_thumbnail_enabled',
  textIndexEnabled: 'drive_text_index_enabled',
} as const;

export type DriveSettingKey = (typeof DRIVE_SETTING_KEYS)[keyof typeof DRIVE_SETTING_KEYS];

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
