export const USER_ROLES = ['admin', 'user'] as const;

export const SUPER_ADMIN_CODE = 'super_admin';

export const TENANT_ADMIN_CODE = 'tenant_admin';

export const OAUTH_PROVIDERS = ['github', 'dingtalk', 'wechat_work', 'feishu'] as const;

export type OAuthProviderType = (typeof OAUTH_PROVIDERS)[number];

export const OAUTH_PROVIDER_LABELS: Record<OAuthProviderType, string> = {
  github: 'GitHub',
  dingtalk: '钉钉',
  wechat_work: '企业微信',
  feishu: '飞书',
};

// ─── 实体枚举（实体 schema 与校验 schema 共用的取值集合）──────────────────────
export const DEPARTMENT_CATEGORIES = ['group', 'company', 'department'] as const;

export type DepartmentCategory = (typeof DEPARTMENT_CATEGORIES)[number];

export const MENU_TYPES = ['directory', 'menu', 'button'] as const;

export type MenuType = (typeof MENU_TYPES)[number];

export const DATA_SCOPES = ['all', 'custom', 'dept_only', 'dept', 'self'] as const;

export type DataScope = (typeof DATA_SCOPES)[number];

/** 成员模式：static = 手工维护；dynamic = 按规则自动物化到成员表 */
export const USER_GROUP_MEMBER_MODES = ['static', 'dynamic'] as const;

export type UserGroupMemberMode = (typeof USER_GROUP_MEMBER_MODES)[number];

export const LOGIN_EVENT_TYPES = ['login', 'logout'] as const;

export type LoginEventType = (typeof LOGIN_EVENT_TYPES)[number];

export const LOGIN_STATUSES = ['success', 'fail'] as const;

export type LoginStatus = (typeof LOGIN_STATUSES)[number];

export const IDENTITY_PROVIDER_TYPES = ['oidc', 'saml', 'ldap', 'ad'] as const;

export type IdentityProviderType = (typeof IDENTITY_PROVIDER_TYPES)[number];

export const IDENTITY_PROVIDER_STATUSES = ['enabled', 'disabled'] as const;

export type IdentityProviderStatus = (typeof IDENTITY_PROVIDER_STATUSES)[number];

export const IDENTITY_PROVIDER_SYNC_STATUSES = ['success', 'failed', 'partial'] as const;

export type IdentityProviderSyncStatus = (typeof IDENTITY_PROVIDER_SYNC_STATUSES)[number];

/** 登录 MFA 挑战可用的验证方式 */
export const MFA_METHODS = ['totp', 'passkey'] as const;

export type MfaMethod = (typeof MFA_METHODS)[number];

export const MFA_FACTOR_TYPES = ['totp', 'passkey', 'recovery_code'] as const;

export type MfaFactorType = (typeof MFA_FACTOR_TYPES)[number];

export const MFA_FACTOR_STATUSES = ['pending', 'enabled', 'disabled'] as const;

export type MfaFactorStatus = (typeof MFA_FACTOR_STATUSES)[number];

export const MFA_MODES = ['off', 'optional', 'required'] as const;

export type MfaMode = (typeof MFA_MODES)[number];

export const LOGIN_RISK_LEVELS = ['low', 'medium', 'high'] as const;

export type LoginRiskLevel = (typeof LOGIN_RISK_LEVELS)[number];

export const LOGIN_RISK_ACTIONS = ['allow', 'challenge', 'block'] as const;

export type LoginRiskAction = (typeof LOGIN_RISK_ACTIONS)[number];

/** 新设备登录的风控动作（策略配置项） */
export const LOGIN_RISK_NEW_DEVICE_ACTIONS = ['allow', 'challenge'] as const;

export type LoginRiskNewDeviceAction = (typeof LOGIN_RISK_NEW_DEVICE_ACTIONS)[number];

// ─── 自 validation 上移（枚举 SSOT：供跨域 z.enum() 引用，避免 validation 间值环）───
export function isSafeOAuthRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:') {
      return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    }
    const unsafeProtocols = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:']);
    return !unsafeProtocols.has(url.protocol) && /^[a-z][a-z0-9+.-]*:$/i.test(url.protocol);
  } catch {
    return false;
  }
}

// ─── 通讯录同步 ──────────────────────────────────────────────────────
export const DIRECTORY_SYNC_SOURCE_TYPES = ['ldap', 'dingtalk', 'wechat_work', 'feishu', 'scim'] as const;

export type DirectorySyncSourceType = (typeof DIRECTORY_SYNC_SOURCE_TYPES)[number];

export const DIRECTORY_SYNC_SOURCE_TYPE_LABELS: Record<DirectorySyncSourceType, string> = {
  ldap: 'LDAP / AD',
  dingtalk: '钉钉',
  wechat_work: '企业微信',
  feishu: '飞书',
  scim: 'SCIM 2.0',
};

/** 拉取型源（支持定时/手动全量同步与连接测试）；SCIM 为 IdP 推送型 */
export const DIRECTORY_SYNC_PULL_TYPES = ['ldap', 'dingtalk', 'wechat_work', 'feishu'] as const;

/** 支持平台事件回调的源类型 */
export const DIRECTORY_SYNC_CALLBACK_TYPES = ['dingtalk', 'wechat_work', 'feishu'] as const;

/** 字段映射：可选的源侧标准字段 */
export const DIRECTORY_SYNC_MAPPABLE_SOURCE_FIELDS = ['username', 'nickname', 'email', 'phone'] as const;

export type DirectorySyncMappableSourceField = (typeof DIRECTORY_SYNC_MAPPABLE_SOURCE_FIELDS)[number];

export const DIRECTORY_SYNC_SOURCE_FIELD_LABELS: Record<DirectorySyncMappableSourceField, string> = {
  username: '登录名（username）',
  nickname: '姓名（nickname）',
  email: '邮箱（email）',
  phone: '手机号（phone）',
};

/** 字段映射取值：不同步该字段 */
export const DIRECTORY_SYNC_FIELD_IGNORE = '__ignore__';

export const DIRECTORY_SYNC_MATCH_KEYS = ['phone', 'email', 'username'] as const;

export type DirectorySyncMatchKey = (typeof DIRECTORY_SYNC_MATCH_KEYS)[number];

export const DIRECTORY_SYNC_MATCH_KEY_LABELS: Record<DirectorySyncMatchKey, string> = {
  phone: '手机号',
  email: '邮箱',
  username: '用户名',
};

export const DIRECTORY_SYNC_CONFLICT_POLICIES = ['source', 'local', 'suspend'] as const;

export type DirectorySyncConflictPolicy = (typeof DIRECTORY_SYNC_CONFLICT_POLICIES)[number];

export const DIRECTORY_SYNC_CONFLICT_POLICY_LABELS: Record<DirectorySyncConflictPolicy, string> = {
  source: '源优先（外部覆盖本地）',
  local: '本地优先（保留本地修改）',
  suspend: '挂起人工裁决',
};

export const DIRECTORY_SYNC_RUN_STATUSES = ['running', 'success', 'partial', 'failed', 'aborted'] as const;

export type DirectorySyncRunStatus = (typeof DIRECTORY_SYNC_RUN_STATUSES)[number];

export const DIRECTORY_SYNC_RUN_STATUS_LABELS: Record<DirectorySyncRunStatus, string> = {
  running: '同步中',
  success: '成功',
  partial: '部分失败',
  failed: '失败',
  aborted: '已熔断',
};

export const DIRECTORY_SYNC_TRIGGER_TYPES = ['schedule', 'manual', 'preview', 'callback'] as const;

export type DirectorySyncTriggerType = (typeof DIRECTORY_SYNC_TRIGGER_TYPES)[number];

export const DIRECTORY_SYNC_TRIGGER_TYPE_LABELS: Record<DirectorySyncTriggerType, string> = {
  schedule: '定时',
  manual: '手动',
  preview: '预览',
  callback: '回调',
};

export const DIRECTORY_SYNC_ITEM_ACTIONS = ['create', 'update', 'link', 'disable', 'skip', 'conflict', 'fail'] as const;

export type DirectorySyncItemAction = (typeof DIRECTORY_SYNC_ITEM_ACTIONS)[number];

export const DIRECTORY_SYNC_ITEM_ACTION_LABELS: Record<DirectorySyncItemAction, string> = {
  create: '新增',
  update: '更新',
  link: '绑定',
  disable: '禁用',
  skip: '跳过',
  conflict: '冲突',
  fail: '失败',
};

export const DIRECTORY_SYNC_ENTITY_TYPES = ['user', 'department'] as const;

export type DirectorySyncEntityType = (typeof DIRECTORY_SYNC_ENTITY_TYPES)[number];

export const DIRECTORY_SYNC_ENTITY_TYPE_LABELS: Record<DirectorySyncEntityType, string> = {
  user: '用户',
  department: '部门',
};

export const DIRECTORY_SYNC_CONFLICT_TYPES = ['multi_match', 'field_conflict'] as const;

export type DirectorySyncConflictType = (typeof DIRECTORY_SYNC_CONFLICT_TYPES)[number];

export const DIRECTORY_SYNC_CONFLICT_TYPE_LABELS: Record<DirectorySyncConflictType, string> = {
  multi_match: '匹配到多个本地账号',
  field_conflict: '两侧字段均有修改',
};

export const DIRECTORY_SYNC_CONFLICT_STATUSES = ['pending', 'resolved', 'ignored'] as const;

export type DirectorySyncConflictStatus = (typeof DIRECTORY_SYNC_CONFLICT_STATUSES)[number];

export const DIRECTORY_SYNC_CONFLICT_STATUS_LABELS: Record<DirectorySyncConflictStatus, string> = {
  pending: '待裁决',
  resolved: '已裁决',
  ignored: '已忽略',
};

export const DIRECTORY_SYNC_RESOLUTIONS = ['source', 'local', 'manual'] as const;

export type DirectorySyncResolution = (typeof DIRECTORY_SYNC_RESOLUTIONS)[number];
