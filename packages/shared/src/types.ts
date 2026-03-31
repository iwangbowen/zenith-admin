// ─── 租户 ─────────────────────────────────────────────────────────────────────
export interface Tenant {
  id: number;
  name: string;
  code: string;
  logo?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  status: 'active' | 'disabled';
  expireAt?: string | null;
  maxUsers?: number | null;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: number;
  username: string;
  nickname: string;
  email: string;
  avatar?: string;
  departmentId?: number | null;
  departmentName?: string | null;
  tenantId?: number | null;
  tenantName?: string | null;
  positionIds?: number[];
  positions?: Position[];
  roles: Role[];
  status: 'active' | 'disabled';
  passwordUpdatedAt: string;
  requirePasswordChange?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export interface PaginatedResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LoginResponse {
  user: Omit<User, 'password'> & { requirePasswordChange?: boolean };
  token: AuthTokens;
  requirePasswordChange?: boolean;
}

// ─── JWT Payload ──────────────────────────────────────────────────────────────
export interface JwtPayload {
  userId: number;
  username: string;
  roles: string[];
  tenantId: number | null;
  /** 超管切换租户视角时，存放目标租户 ID */
  viewingTenantId?: number | null;
  jti?: string;
}

// ─── 菜单 ─────────────────────────────────────────────────────────────────────
export type MenuType = 'directory' | 'menu' | 'button';

export interface Menu {
  id: number;
  parentId: number;
  title: string;
  name?: string;
  path?: string;
  component?: string;
  icon?: string;
  type: MenuType;
  permission?: string;
  sort: number;
  status: 'active' | 'disabled';
  visible: boolean;
  createdAt: string;
  updatedAt: string;
  children?: Menu[];
}

// ─── 角色 ─────────────────────────────────────────────────────────────────────
export type DataScope = 'all' | 'dept' | 'self';

export interface Role {
  id: number;
  name: string;
  code: string;
  description?: string;
  dataScope: DataScope;
  tenantId?: number | null;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
  menuIds?: number[];
}

// ─── 部门 ─────────────────────────────────────────────────────────────────────
export interface Department {
  id: number;
  parentId: number;
  name: string;
  code: string;
  leader?: string;
  phone?: string;
  email?: string;
  sort: number;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
  children?: Department[];
}

// ─── 岗位 ─────────────────────────────────────────────────────────────────────
export interface Position {
  id: number;
  name: string;
  code: string;
  sort: number;
  status: 'active' | 'disabled';
  remark?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── 字典 ─────────────────────────────────────────────────────────────────────
export interface Dict {
  id: number;
  name: string;
  code: string;
  description?: string;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export interface DictItem {
  id: number;
  dictId: number;
  label: string;
  value: string;
  color?: string;
  sort: number;
  status: 'active' | 'disabled';
  remark?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── 文件管理 ─────────────────────────────────────────────────────────────────
export type FileStorageProvider = 'local' | 'oss' | 's3' | 'cos';

export interface FileStorageConfig {
  id: number;
  name: string;
  provider: FileStorageProvider;
  status: 'active' | 'disabled';
  isDefault: boolean;
  basePath?: string;
  localRootPath?: string;
  // 阿里云 OSS
  ossRegion?: string;
  ossEndpoint?: string;
  ossBucket?: string;
  ossAccessKeyId?: string;
  ossAccessKeySecret?: string;
  // S3 兼容存储
  s3Region?: string;
  s3Endpoint?: string;
  s3Bucket?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle?: boolean;
  // 腾讯云 COS
  cosRegion?: string;
  cosBucket?: string;
  cosSecretId?: string;
  cosSecretKey?: string;
  remark?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedFile {
  id: number;
  storageConfigId: number;
  storageName: string;
  provider: FileStorageProvider;
  originalName: string;
  objectKey: string;
  size: number;
  mimeType?: string;
  extension?: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Login Logs ──────────────────────────────────────────
export interface LoginLog {
  id: number;
  userId: number | null;
  username: string;
  ip: string | null;
  browser: string | null;
  os: string | null;
  status: 'success' | 'fail';
  message: string | null;
  createdAt: Date;
}

// ─── Operation Logs ──────────────────────────────────────
export interface OperationLog {
  id: number;
  userId: number | null;
  username: string | null;
  module: string | null;
  description: string;
  method: string;
  path: string;
  requestBody: string | null;
  beforeData: string | null;
  afterData: string | null;
  responseCode: number | null;
  durationMs: number | null;
  ip: string | null;
  userAgent: string | null;
  os: string | null;
  browser: string | null;
  createdAt: string;
}

export interface OperationLogStats {
  moduleStats: { module: string; count: number }[];
  dailyStats: { date: string; count: number }[];
  userStats: { username: string; count: number }[];
}

// ─── 通知公告 ──────────────────────────────────────────────
export type NoticePublishStatus = 'draft' | 'published' | 'recalled';
export type NoticeType = 'notice' | 'announcement' | 'warning';
export type NoticePriority = 'low' | 'medium' | 'high';
export type NoticeTargetType = 'all' | 'specific';
export type NoticeRecipientType = 'user' | 'role' | 'dept';

export interface NoticeRecipient {
  recipientType: NoticeRecipientType;
  recipientId: number;
  recipientLabel?: string;
}

export interface Notice {
  id: number;
  title: string;
  content: string;
  type: string;
  publishStatus: string;
  priority: string;
  targetType: NoticeTargetType;
  publishTime: string | null;
  createById: number | null;
  createByName: string | null;
  createdAt: string;
  updatedAt: string;
  recipients?: NoticeRecipient[];
  /** 已读人数（管理列表额外返回） */
  readCount?: number;
}

export interface NoticeReadStatsUser {
  id: number;
  username: string;
  nickname: string;
  avatar: string | null;
  /** 已读时间，仅 tab=read 时有值 */
  readAt?: string;
}

export interface NoticeReadStats {
  readCount: number;
  totalCount: number;
  list: NoticeReadStatsUser[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── 系统参数配置 ──────────────────────────────────────────
export type ConfigType = 'string' | 'number' | 'boolean' | 'json';

export interface SystemConfig {
  id: number;
  configKey: string;
  configValue: string;
  configType: ConfigType;
  description: string;
  createdAt: string;
  updatedAt: string;
}

// ─── 定时任务 ──────────────────────────────────────────────
export type CronRunStatus = 'success' | 'fail' | 'running';

export interface CronJob {
  id: number;
  name: string;
  cronExpression: string;
  handler: string;
  params: string | null;
  status: 'active' | 'disabled';
  description: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunStatus: CronRunStatus | null;
  lastRunMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── 在线用户 ──────────────────────────────────────────────
export interface OnlineUser {
  tokenId: string;
  userId: number;
  username: string;
  nickname: string;
  tenantId?: number | null;
  ip: string;
  browser: string;
  os: string;
  loginAt: string;
}

// ─── 验证码 ──────────────────────────────────────────────
export interface CaptchaResponse {
  captchaId: string;
  captchaImage: string;
}

// ─── WebSocket 消息类型 ──────────────────────────────────────────────────────
export type WsMessage =
  | { type: 'notice:new'; payload: Notice }
  | { type: 'session:force-logout'; payload: { reason: string } };

// ─── 地区管理 ──────────────────────────────────────────────
export type RegionLevel = 'province' | 'city' | 'county';

export interface Region {
  id: number;
  code: string;
  name: string;
  level: RegionLevel;
  parentCode: string | null;
  sort: number;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
  children?: Region[];
}

// ─── 邮件配置 ──────────────────────────────────────────────────────────────
export type EmailEncryption = 'none' | 'ssl' | 'tls';

export interface EmailConfig {
  id: number;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword?: string;
  fromName: string;
  fromEmail: string;
  encryption: EmailEncryption;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

// ─── OAuth 第三方账号 ───────────────────────────────────────────────────────
export type OAuthProviderType = 'github' | 'dingtalk' | 'wechat_work';

export interface OAuthAccount {
  id: number;
  userId: number;
  provider: OAuthProviderType;
  openId: string;
  unionId?: string | null;
  nickname?: string | null;
  avatar?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OAuthProviderInfo {
  key: OAuthProviderType;
  label: string;
  icon: string;
}

export interface OAuthConfig {
  id: number;
  provider: OAuthProviderType;
  clientId: string;
  clientSecret: string;
  agentId?: string | null;
  corpId?: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── 数据库备份 ────────────────────────────────────────────────────────────
export type BackupType = 'pg_dump' | 'drizzle_export';
export type BackupStatus = 'pending' | 'running' | 'success' | 'failed';

export interface DbBackup {
  id: number;
  name: string;
  type: BackupType;
  fileId: number | null;
  fileSize: number | null;
  status: BackupStatus;
  tables: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  createdBy: number | null;
  createdByName?: string | null;
  createdAt: string;
}

// ─── 个人会话 ──────────────────────────────────────────────────────────────────
export interface UserSession {
  tokenId: string;
  ip: string;
  browser: string;
  os: string;
  loginAt: string;
  lastActiveAt: string;
  isCurrent: boolean;
}

// ─── 个人 API Token ────────────────────────────────────────────────────────────
export interface UserApiToken {
  id: number;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface UserApiTokenCreated {
  id: number;
  name: string;
  token: string; // 完整 token，仅创建时返回
  createdAt: string;
}

// ─── 消息模板 ─────────────────────────────────────────────────────────────────
export type MessageChannelType = 'email' | 'sms' | 'in_app';

export interface MessageTemplate {
  id: number;
  name: string;
  code: string;
  channel: MessageChannelType;
  subject: string | null;
  content: string;
  variables: string | null;
  status: 'active' | 'disabled';
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}
