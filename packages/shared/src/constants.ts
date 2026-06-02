export const API_PREFIX = '/api';
export const TOKEN_KEY = 'zenith_token';
export const REFRESH_TOKEN_KEY = 'zenith_refresh_token';
export const PREFERENCES_KEY = 'zenith_preferences';
export const TABS_STORAGE_KEY = 'zenith_tabs';
export const USER_ROLES = ['admin', 'user'] as const;
export const USER_STATUSES = ['enabled', 'disabled'] as const;
export const SUPER_ADMIN_CODE = 'super_admin';
export const TENANT_ADMIN_CODE = 'tenant_admin';
export const FILE_STORAGE_PROVIDERS = ['local', 'oss', 's3', 'cos'] as const;
export const CONFIG_TYPES = ['string', 'number', 'boolean', 'json'] as const;
export const CRON_JOB_STATUSES = ['enabled', 'disabled'] as const;
export const CRON_RUN_STATUSES = ['success', 'fail', 'running'] as const;
export const OAUTH_PROVIDERS = ['github', 'dingtalk', 'wechat_work'] as const;
export const BACKUP_TYPES = ['pg_dump', 'drizzle_export'] as const;
export const BACKUP_STATUSES = ['pending', 'running', 'success', 'failed'] as const;
export const BUSINESS_TYPES = ['announcement'] as const;
export type BusinessType = typeof BUSINESS_TYPES[number];
export const WORKFLOW_DEFINITION_STATUSES = ['draft', 'published', 'disabled'] as const;
export const WORKFLOW_INSTANCE_STATUSES = ['draft', 'running', 'approved', 'rejected', 'withdrawn'] as const;
export const WORKFLOW_TASK_STATUSES = ['pending', 'approved', 'rejected', 'skipped'] as const;
export const WORKFLOW_NODE_TYPES = ['start', 'approve', 'end', 'exclusiveGateway', 'parallelGateway', 'ccNode'] as const;
export const WORKFLOW_CONDITION_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'] as const;

// OAuth2 服务端常量
export const OAUTH2_GRANT_TYPES = ['authorization_code', 'client_credentials', 'implicit', 'refresh_token'] as const;
export type OAuth2GrantType = typeof OAUTH2_GRANT_TYPES[number];

export const OAUTH2_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;
export type OAuth2Scope = typeof OAUTH2_SCOPES[number];

export const OAUTH2_SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: '确认您的身份（用户 ID）',
  profile: '读取您的基本信息（昵称、头像）',
  email: '读取您的邮箱地址',
  offline_access: '允许在您离线时保持访问（续签令牌）',
};

export const OAUTH2_CODE_CHALLENGE_METHODS = ['S256', 'plain'] as const;
export type OAuth2CodeChallengeMethod = typeof OAUTH2_CODE_CHALLENGE_METHODS[number];

export const OAUTH2_TOKEN_EXPIRY = {
  accessToken: 2 * 60 * 60, // 2 小时（秒）
  refreshToken: 30 * 24 * 60 * 60, // 30 天（秒）
  authorizationCode: 10 * 60, // 10 分钟（秒）
} as const;
