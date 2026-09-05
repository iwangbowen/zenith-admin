import * as z from 'zod';
import { dateTimeStringSchema, httpUrl, partialForUpdate } from '../core/validation';
import { tenantPackageQuotasSchema } from '../licensing/validation';
import { MP_OAUTH_SCOPES } from '../mp/constants';
import {
  DATA_SCOPES,
  DEPARTMENT_CATEGORIES,
  DIRECTORY_SYNC_SOURCE_TYPES, DIRECTORY_SYNC_MATCH_KEYS,
  DIRECTORY_SYNC_CONFLICT_POLICIES, DIRECTORY_SYNC_RESOLUTIONS,
  OAUTH_PROVIDERS,
} from './constants';

export const loginDeviceInfoSchema = z.object({
  screenWidth: z.number().int().min(0).max(32767).optional(),
  screenHeight: z.number().int().min(0).max(32767).optional(),
  devicePixelRatio: z.string().max(32).optional(),
  gpu: z.string().max(256).optional(),
  cpuCores: z.number().int().min(0).max(32767).optional(),
  memoryGb: z.string().max(32).optional(),
});


export const loginSchema = z.object({
  username: z.string().min(2, '用户名/手机号至少2个字符').max(32),
  password: z.string().min(6, '密码至少6个字符').max(64),
  captchaId: z.string().optional(),
  captchaCode: z.string().optional(),
  tenantCode: z.string().max(50).optional(),
  deviceInfo: loginDeviceInfoSchema.optional(),
  deviceId: z.string().max(128).optional(),
  rememberDevice: z.boolean().optional(),
});


export const registerSchema = z.object({
  username: z.string().min(2, '用户名至少2个字符').max(32),
  nickname: z.string().min(1, '昵称不能为空').max(32),
  email: z.email('邮箱格式不正确'),
  password: z.string().min(6, '密码至少6个字符').max(64),
});


export const createUserSchema = z.object({
  username: z.string().min(2).max(32),
  nickname: z.string().min(1).max(32),
  email: z.preprocess(
    (value) => (value === '' ? null : value),
    z.email('邮箱格式不正确').nullable().optional()
  ),
  password: z.string().min(6).max(64),
  phone: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().regex(/^1[3-9]\d{9}$/, '请输入正确的手机号码').optional()
  ),
  gender: z.string().max(20).nullable().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  positionIds: z.array(z.number().int().positive()).default([]),
  roleIds: z.array(z.number().int()).default([]),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});


export const updateUserSchema = partialForUpdate(createUserSchema).omit({ password: true }).extend({
  avatar: z.string().max(512).nullable().optional(),
});


export const changePasswordSchema = z.object({
  oldPassword: z.string().min(6, '原密码至少6个字符').max(64),
  newPassword: z.string().min(6, '新密码至少6个字符').max(64),
});


export const forgotPasswordSchema = z.object({
  email: z.email('邮箱格式不正确'),
});


export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'token 不能为空'),
  newPassword: z.string().min(6, '新密码至少6个字符').max(64),
});


export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;


export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;


export const resetUserPasswordSchema = z.object({
  password: z.string().min(6, '新密码至少6个字符').max(64),
});


export const updateProfileSchema = z.object({
  nickname: z.string().min(1, '昵称不能为空').max(32).optional(),
  email: z.email('邮箱格式不正确').optional(),
  phone: z.preprocess(
    (value) => (value === '' ? null : value),
    z.string().regex(/^1[3-9]\d{9}$/, '请输入正确的手机号码').nullable().optional()
  ),
  gender: z.string().max(20).nullable().optional(),
  avatar: z.string().max(256).nullish(),
});


// ─── 菜单 Schema ──────────────────────────────────────────────────────────────
export const createMenuSchema = z.object({
  parentId: z.coerce.number().int().default(0),
  title: z.string().min(1, '菜单标题不能为空').max(64),
  name: z.string().max(64).optional(),
  path: z.string().max(256).optional(),
  component: z.string().max(256).optional(),
  icon: z.string().max(64).optional(),
  type: z.enum(['directory', 'menu', 'button']).default('menu'),
  permission: z.string().max(128).optional(),
  query: z.string().max(512).nullish(),
  isExternal: z.boolean().default(false),
  embed: z.boolean().default(false),
  keepAlive: z.boolean().default(false),
  sort: z.coerce.number().int().default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  visible: z.boolean().default(true),
});


export const updateMenuSchema = partialForUpdate(createMenuSchema);


// ─── 角色 Schema ──────────────────────────────────────────────────────────────
export const createRoleSchema = z.object({
  name: z.string().min(1, '角色名称不能为空').max(64),
  code: z.string().min(1, '角色编码不能为空').max(64).regex(/^[a-z_]+$/, '角色编码只能包含小写字母和下划线'),
  description: z.string().max(256).optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  dataScope: z.enum(['all', 'custom', 'dept_only', 'dept', 'self']).default('all'),
  deptScopeIds: z.array(z.number().int().positive()).optional().nullable(),
});


export const updateRoleSchema = partialForUpdate(createRoleSchema);


export const assignRoleMenusSchema = z.object({
  menuIds: z.array(z.number().int()),
});


export const assignRoleUsersSchema = z.object({
  userIds: z.array(z.number().int()),
});


// ─── 部门 Schema ──────────────────────────────────────────────────────────────
export const createDepartmentSchema = z.object({
  parentId: z.number().int().min(0).default(0),
  name: z.string().min(1, '部门名称不能为空').max(64),
  code: z.string().min(1, '部门编码不能为空').max(64).regex(/^\w+$/, '部门编码只能包含字母、数字和下划线'),
  category: z.enum(DEPARTMENT_CATEGORIES).default('department'),
  leaderId: z.number().int().nullable().optional(),
  phone: z.string().max(32).optional(),
  email: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.email('邮箱格式不正确').optional()
  ),
  sort: z.number().int().default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});


export const updateDepartmentSchema = partialForUpdate(createDepartmentSchema);


// ─── 岗位 Schema ──────────────────────────────────────────────────────────────
export const createPositionSchema = z.object({
  name: z.string().min(1, '岗位名称不能为空').max(64),
  code: z.string().min(1, '岗位编码不能为空').max(64).regex(/^\w+$/, '岗位编码只能包含字母、数字和下划线'),
  sort: z.coerce.number().int().default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});


export const updatePositionSchema = partialForUpdate(createPositionSchema);


// ─── 用户组 Schema ────────────────────────────────────────────────────────

/** 动态组成员规则：dynamic 模式下至少要有一个条件或强制包含名单 */
export const userGroupMemberRuleSchema = z.strictObject({
  departmentIds: z.array(z.number().int().positive()).max(200).optional(),
  includeSubDepartments: z.boolean().optional(),
  positionIds: z.array(z.number().int().positive()).max(200).optional(),
  includeUserIds: z.array(z.number().int().positive()).max(500).optional(),
  excludeUserIds: z.array(z.number().int().positive()).max(500).optional(),
});

const userGroupBaseSchema = z.object({
  name: z.string().min(1, '用户组名称不能为空').max(64),
  code: z.string().min(1, '用户组编码不能为空').max(64).regex(/^\w+$/, '用户组编码只能包含字母、数字和下划线'),
  description: z.string().max(256).optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  memberMode: z.enum(['static', 'dynamic']).default('static'),
  memberRule: userGroupMemberRuleSchema.nullable().optional(),
});

/** dynamic 模式的规则完整性校验（更新走 partial，合并态校验在服务层再做一次） */
export function validateUserGroupRulePresence(memberMode: string, rule: UserGroupMemberRuleInput | null | undefined): boolean {
  if (memberMode !== 'dynamic') return true;
  return Boolean(
    rule && ((rule.departmentIds?.length ?? 0) > 0 || (rule.positionIds?.length ?? 0) > 0 || (rule.includeUserIds?.length ?? 0) > 0),
  );
}

export type UserGroupMemberRuleInput = z.infer<typeof userGroupMemberRuleSchema>;

export const createUserGroupSchema = userGroupBaseSchema.superRefine((val, ctx) => {
  if (!validateUserGroupRulePresence(val.memberMode, val.memberRule)) {
    ctx.addIssue({ code: 'custom', path: ['memberRule'], message: '动态用户组至少需要一个部门/岗位条件或强制包含名单' });
  }
});


export const updateUserGroupSchema = partialForUpdate(userGroupBaseSchema);


export type LoginInput = z.infer<typeof loginSchema>;


export type RegisterInput = z.infer<typeof registerSchema>;


export type CreateUserInput = z.infer<typeof createUserSchema>;


export type UpdateUserInput = z.infer<typeof updateUserSchema>;


export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;


export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;


export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;


export type CreateMenuInput = z.infer<typeof createMenuSchema>;


export type UpdateMenuInput = z.infer<typeof updateMenuSchema>;


export type CreateRoleInput = z.infer<typeof createRoleSchema>;


export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;


export type AssignRoleMenusInput = z.infer<typeof assignRoleMenusSchema>;


export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;


export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;


export type CreatePositionInput = z.infer<typeof createPositionSchema>;


export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;


export type CreateUserGroupInput = z.infer<typeof createUserGroupSchema>;


export type UpdateUserGroupInput = z.infer<typeof updateUserGroupSchema>;


// ─── OAuth 配置 Schema ─────────────────────────────────────────────────────
/**
 * 整体替换语义：后台配置表单每次提交全部字段，服务端 upsert。
 * `clientId` / `enabled` 必填；`clientSecret` 省略或传掩码 `******` 时保留库中原值。
 */
export const updateOauthConfigSchema = z.object({
  clientId: z.string().max(256),
  clientSecret: z.string().max(512).optional(),
  agentId: z.string().max(128).nullable().optional(),
  corpId: z.string().max(128).nullable().optional(),
  enabled: z.boolean(),
  /** 登录时按提供方断言的已验证邮箱自动关联既有本地账号（平台超管永不自动关联） */
  autoLinkByEmail: z.boolean(),
});

/** 第三方登录 / 绑定回调：`state` 必须原样带回，服务端单次消费并与发起时的 provider / 意图 / 用户比对 */
export const oauthCallbackSchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(128),
  deviceId: z.string().max(128).optional(),
});

export const oauthBindSchema = z.object({
  provider: z.enum(OAUTH_PROVIDERS),
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(128),
});


// ─── 企业身份源 Schema ───────────────────────────────────────────────────
export const identityProviderAttributeMappingSchema = z.object({
  subject: z.string().max(64).optional(),
  email: z.string().max(64).optional(),
  username: z.string().max(64).optional(),
  nickname: z.string().max(64).optional(),
  phone: z.string().max(64).optional(),
  department: z.string().max(64).optional(),
});


export const createTenantIdentityProviderSchema = z.object({
  /** 归属租户：仅平台管理员可指定（null = 平台级）；其他调用者由服务端强制落到自身租户 */
  tenantId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1, '身份源名称不能为空').max(100),
  code: z.string().min(1, '身份源编码不能为空').max(64).regex(/^[a-z][a-z0-9_-]*$/, '编码只能包含小写字母、数字、中划线和下划线，且以字母开头'),
  type: z.enum(['oidc', 'saml', 'ldap', 'ad']),
  status: z.enum(['enabled', 'disabled']).default('disabled'),
  issuer: z.string().max(512).nullable().optional(),
  authorizationEndpoint: z.string().max(512).nullable().optional(),
  tokenEndpoint: z.string().max(512).nullable().optional(),
  userinfoEndpoint: z.string().max(512).nullable().optional(),
  jwksUri: z.string().max(512).nullable().optional(),
  clientId: z.string().max(256).nullable().optional(),
  clientSecret: z.string().max(1024).optional(),
  scopes: z.string().max(256).default('openid profile email'),
  samlSsoUrl: z.string().max(512).nullable().optional(),
  samlEntityId: z.string().max(512).nullable().optional(),
  samlCertificate: z.string().max(4096).optional(),
  ldapUrl: z.string().max(512).nullable().optional(),
  ldapStartTls: z.boolean().default(false),
  ldapSkipTlsVerify: z.boolean().default(false),
  ldapBaseDn: z.string().max(512).nullable().optional(),
  ldapBindDn: z.string().max(512).nullable().optional(),
  ldapBindPassword: z.string().max(1024).optional(),
  ldapUserFilter: z.string().max(1000).nullable().optional(),
  ldapUserSearchFilter: z.string().max(1000).nullable().optional(),
  ldapSyncFilter: z.string().max(1000).nullable().optional(),
  ldapGroupBaseDn: z.string().max(512).nullable().optional(),
  ldapGroupFilter: z.string().max(1000).nullable().optional(),
  ldapTimeoutMs: z.number().int().min(1000).max(60000).default(5000),
  attributeMapping: identityProviderAttributeMappingSchema.default({
    subject: 'sub',
    email: 'email',
    username: 'preferred_username',
    nickname: 'name',
    phone: 'phone_number',
    department: 'department',
  }),
  jitEnabled: z.boolean().default(false),
  /** 登录时按 IdP 断言的已验证邮箱自动关联既有本地账号（默认关闭；平台超管永不自动关联） */
  autoLinkByEmail: z.boolean().default(false),
  defaultRoleIds: z.array(z.number().int().positive()).default([]),
  remark: z.string().max(500).nullable().optional(),
});


export const updateTenantIdentityProviderSchema = partialForUpdate(createTenantIdentityProviderSchema);


export type CreateTenantIdentityProviderInput = z.infer<typeof createTenantIdentityProviderSchema>;


export type UpdateTenantIdentityProviderInput = z.infer<typeof updateTenantIdentityProviderSchema>;


export const searchIdentityProviderUsersSchema = z.object({
  keyword: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});


export const syncIdentityProviderUsersSchema = z.object({
  limit: z.number().int().min(1).max(5000).default(500),
});


export const enterpriseLdapLoginSchema = z.object({
  providerId: z.number().int().positive(),
  username: z.string().min(1, '请输入目录账号').max(128),
  password: z.string().min(1, '请输入目录密码').max(512),
  redirectTo: z.string().max(512).nullable().optional(),
  deviceInfo: z.record(z.string(), z.unknown()).optional(),
  /** 可信设备标识（与密码登录一致，用于 MFA 新设备风控） */
  deviceId: z.string().max(128).optional(),
});


// ─── 租户 Schema ────────────────────────────────────────────────────────────
export const createTenantSchema = z.object({
  name: z.string().min(1, '租户名称不能为空').max(100),
  code: z.string().min(1, '租户编码不能为空').max(50).regex(/^[a-z][a-z0-9_]*$/, '租户编码只能包含小写字母、数字和下划线，且以字母开头'),
  logo: z.string().max(500).optional(),
  contactName: z.string().max(50).optional(),
  contactPhone: z.string().max(20).optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  expireAt: dateTimeStringSchema.optional().nullable(),
  maxUsers: z.number().int().positive().optional().nullable(),
  packageId: z.number().int().positive().optional().nullable(),
  remark: z.string().max(500).optional(),
  adminUsername: z.string().min(2, '管理员用户名至少 2 个字符').max(64).optional().describe('初始管理员用户名；不传则跳过自动初始化'),
  adminPassword: z.string().min(6, '管理员密码至少 6 个字符').max(64).optional().describe('初始管理员密码；不传则自动生成并在响应中一次性返回'),
  adminNickname: z.string().max(64).optional(),
  adminEmail: z.email('管理员邮箱格式不正确').max(128).optional(),
});


export const updateTenantSchema = partialForUpdate(createTenantSchema
  .omit({ adminUsername: true, adminPassword: true, adminNickname: true, adminEmail: true }));


export const switchTenantSchema = z.object({
  tenantId: z.number().int().positive().nullable(),
});


export type CreateTenantInput = z.infer<typeof createTenantSchema>;


export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;


export type SwitchTenantInput = z.infer<typeof switchTenantSchema>;


// ─── 租户套餐 ────────────────────────────────────────────────────────────────
export const createTenantPackageSchema = z.object({
  name: z.string().min(1, '套餐名称不能为空').max(100),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).optional(),
  quotas: tenantPackageQuotasSchema.optional().nullable(),
});


export const updateTenantPackageSchema = partialForUpdate(createTenantPackageSchema);


export type CreateTenantPackageInput = z.infer<typeof createTenantPackageSchema>;


export type UpdateTenantPackageInput = z.infer<typeof updateTenantPackageSchema>;


export type UpdateOauthConfigInput = z.infer<typeof updateOauthConfigSchema>;
export type OAuthCallbackInput = z.infer<typeof oauthCallbackSchema>;
export type OAuthBindInput = z.infer<typeof oauthBindSchema>;



export const buildMpOAuthUrlSchema = z.object({
  accountId: z.number().int().positive(),
  redirectUri: httpUrl('回调地址需为合法的 http(s) URL').max(1024),
  scope: z.enum(MP_OAUTH_SCOPES).default('snsapi_base'),
  state: z.string().max(128).optional(),
});


export type BuildMpOAuthUrlInput = z.infer<typeof buildMpOAuthUrlSchema>;


// ─── 通讯录同步 Schema ────────────────────────────────────────────────────────
export const directorySyncLifecycleSchema = z.object({
  disableOnLeave: z.boolean().default(true),
  kickSessions: z.boolean().default(true),
  defaultRoleIds: z.array(z.number().int().positive()).max(20).default([]),
});

export const directorySyncScopeSchema = z.object({
  deptExternalIds: z.array(z.string().min(1).max(256)).max(200).optional(),
  excludeUserExternalIds: z.array(z.string().min(1).max(256)).max(1000).optional(),
});

export const createDirectorySyncSourceSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  type: z.enum(DIRECTORY_SYNC_SOURCE_TYPES),
  status: z.enum(['enabled', 'disabled']).default('disabled'),
  tenantId: z.number().int().positive().nullable().optional(),
  identityProviderId: z.number().int().positive().nullable().optional(),
  oauthProvider: z.string().max(32).nullable().optional(),
  matchKey: z.enum(DIRECTORY_SYNC_MATCH_KEYS).default('phone'),
  fieldMapping: z.record(z.string(), z.string().max(64)).default({}),
  scopeConfig: directorySyncScopeSchema.default({}),
  conflictPolicy: z.enum(DIRECTORY_SYNC_CONFLICT_POLICIES).default('suspend'),
  lifecycle: directorySyncLifecycleSchema.default({ disableOnLeave: true, kickSessions: true, defaultRoleIds: [] }),
  syncDepartments: z.boolean().default(true),
  cronExpression: z.string().max(64).nullable().optional(),
  circuitBreakerPercent: z.number().int().min(0, '熔断阈值最小为 0').max(100, '熔断阈值最大为 100').default(30),
  /** 企业微信通讯录 Secret（独立于应用 Secret；写入后不回显） */
  contactSecret: z.string().max(256).nullable().optional(),
  /** 平台回调 Token / SCIM Bearer Token（写入后不回显） */
  callbackToken: z.string().max(256).nullable().optional(),
  /** 平台回调 AES Key（钉钉/企微必填 43 位；飞书 Encrypt Key 可选；写入后不回显） */
  callbackAesKey: z.string().max(256).nullable().optional(),
  remark: z.string().max(500).nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.type === 'ldap' && !v.identityProviderId) {
    ctx.addIssue({ code: 'custom', path: ['identityProviderId'], message: 'LDAP/AD 源必须绑定企业身份源' });
  }
  if ((v.type === 'dingtalk' || v.type === 'wechat_work' || v.type === 'feishu') && !v.oauthProvider) {
    ctx.addIssue({ code: 'custom', path: ['oauthProvider'], message: '平台 API 源必须绑定 OAuth 配置' });
  }
  if (v.type === 'wechat_work' && !v.contactSecret?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['contactSecret'], message: '企业微信源必须填写通讯录 Secret' });
  }
  if (v.type === 'scim' && !v.callbackToken?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['callbackToken'], message: 'SCIM 源必须设置 Bearer Token' });
  }
});

export const updateDirectorySyncSourceSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100).optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
  tenantId: z.number().int().positive().nullable().optional(),
  identityProviderId: z.number().int().positive().nullable().optional(),
  oauthProvider: z.string().max(32).nullable().optional(),
  matchKey: z.enum(DIRECTORY_SYNC_MATCH_KEYS).optional(),
  fieldMapping: z.record(z.string(), z.string().max(64)).optional(),
  scopeConfig: directorySyncScopeSchema.optional(),
  conflictPolicy: z.enum(DIRECTORY_SYNC_CONFLICT_POLICIES).optional(),
  lifecycle: directorySyncLifecycleSchema.optional(),
  syncDepartments: z.boolean().optional(),
  cronExpression: z.string().max(64).nullable().optional(),
  circuitBreakerPercent: z.number().int().min(0).max(100).optional(),
  /** 缺省保持不变；空串视为不修改，null 显式清除 */
  contactSecret: z.string().max(256).nullable().optional(),
  callbackToken: z.string().max(256).nullable().optional(),
  callbackAesKey: z.string().max(256).nullable().optional(),
  remark: z.string().max(500).nullable().optional(),
});

export const resolveDirectorySyncConflictSchema = z.object({
  resolution: z.enum(DIRECTORY_SYNC_RESOLUTIONS),
  /** multi_match 裁决为 source 时必须指定绑定的本地用户 */
  targetUserId: z.number().int().positive().optional(),
});

export type CreateDirectorySyncSourceInput = z.infer<typeof createDirectorySyncSourceSchema>;
export type UpdateDirectorySyncSourceInput = z.infer<typeof updateDirectorySyncSourceSchema>;
export type ResolveDirectorySyncConflictInput = z.infer<typeof resolveDirectorySyncConflictSchema>;

// ─── 认证 / 会话 Schema ───────────────────────────────────────────────────────
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const mfaVerifySchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().min(6).max(8),
  rememberDevice: z.boolean().optional(),
});

export const verifyTotpSetupSchema = z.object({
  factorId: z.number().int().positive(),
  code: z.string().min(6).max(8),
});

export const verifyPasswordSchema = z.object({
  password: z.string().min(1),
});

export const saveFavoriteMenusSchema = z.object({
  menuIds: z.array(z.number().int()),
});

/** 偏好设置为自由结构的键值对，整体替换保存 */
export const userPreferencesInputSchema = z.record(z.string(), z.unknown());

export const createApiTokenSchema = z.object({
  name: z.string(),
  expiresAt: z.string().optional(),
});

export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;

// ─── 企业身份源登录 Schema ────────────────────────────────────────────────────
export const enterpriseOidcCallbackSchema = z.object({
  code: z.string(),
  state: z.string(),
  deviceId: z.string().max(128).optional(),
});

export const enterpriseSamlExchangeSchema = z.object({
  ticket: z.string(),
});

// ─── 用户授权 / 批量操作 Schema ────────────────────────────────────────────────
export const batchResetUsersPasswordSchema = z.object({
  ids: z.array(z.number().int()),
  password: z.string().min(6).max(64),
});

export const batchUpdateUserStatusSchema = z.object({
  ids: z.array(z.number().int()),
  status: z.enum(['enabled', 'disabled']),
});

export const assignUserRolesSchema = z.object({
  roleIds: z.array(z.number().int()),
});

export const assignUserMenusSchema = z.object({
  menuIds: z.array(z.number().int()),
});

export const updateUserDataPermissionSchema = z.object({
  dataScope: z.enum(DATA_SCOPES).nullable(),
  deptScopeIds: z.array(z.number().int()),
});

export type UpdateUserDataPermissionInput = z.infer<typeof updateUserDataPermissionSchema>;

// ─── 成员 / 角色分配 Schema（岗位、用户组共用）───────────────────────────────
export const scopeUserIdsSchema = z.object({
  userIds: z.array(z.number().int().positive()),
});

export const userGroupRoleIdsSchema = z.object({
  roleIds: z.array(z.number().int().positive()),
});

export const userGroupRulePreviewSchema = z.object({
  groupId: z.number().int().positive().optional(),
  memberRule: userGroupMemberRuleSchema,
});

export type UserGroupRulePreviewInput = z.infer<typeof userGroupRulePreviewSchema>;

