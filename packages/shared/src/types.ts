export type EntityStatus = 'enabled' | 'disabled';

// ─── 租户 ─────────────────────────────────────────────────────────────────────
export interface Tenant {
  id: number;
  name: string;
  code: string;
  logo?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  status: EntityStatus;
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
  phone?: string | null;
  avatar?: string;
  departmentId?: number | null;
  departmentName?: string | null;
  tenantId?: number | null;
  tenantName?: string | null;
  positionIds?: number[];
  positions?: Position[];
  roles: Role[];
  status: EntityStatus;
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
  status: EntityStatus;
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
  status: EntityStatus;
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
  leaderId?: number | null;
  leaderName?: string | null;
  phone?: string;
  email?: string;
  sort: number;
  status: EntityStatus;
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
  status: EntityStatus;
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
  status: EntityStatus;
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
  status: EntityStatus;
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
  status: EntityStatus;
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
  userAgent: string | null;
  status: 'success' | 'fail';
  message: string | null;
  createdAt: string;
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
  responseBody: string | null;
  durationMs: number | null;
  ip: string | null;
  userAgent: string | null;
  os: string | null;
  browser: string | null;
  createdAt: string;
}

export interface OperationLogStats {
  summary: {
    total: number;
    successCount: number;
    failCount: number;
    avgDurationMs: number | null;
    uniqueUsers: number;
  };
  moduleStats: { module: string; count: number }[];
  dailyStats: { date: string; count: number; successCount: number; failCount: number }[];
  userStats: { username: string; count: number }[];
  methodStats: { method: string; count: number }[];
  hourlyStats: { hour: number; count: number }[];
}

// ─── 公告 ──────────────────────────────────────────────────
export type AnnouncementPublishStatus = 'draft' | 'published' | 'recalled';
export type AnnouncementType = 'notice' | 'announcement' | 'warning';
export type AnnouncementPriority = 'low' | 'medium' | 'high';
export type AnnouncementTargetType = 'all' | 'specific';
export type AnnouncementRecipientType = 'user' | 'role' | 'dept';

export interface AnnouncementRecipient {
  recipientType: AnnouncementRecipientType;
  recipientId: number;
  recipientLabel?: string;
}

export interface Announcement {
  id: number;
  title: string;
  content: string;
  type: string;
  publishStatus: string;
  priority: string;
  targetType: AnnouncementTargetType;
  publishTime: string | null;
  createById: number | null;
  createByName: string | null;
  createdAt: string;
  updatedAt: string;
  recipients?: AnnouncementRecipient[];
  /** 已读人数（管理列表额外返回） */
  readCount?: number;
}

export interface AnnouncementReadStatsUser {
  id: number;
  username: string;
  nickname: string;
  avatar: string | null;
  /** 已读时间，仅 tab=read 时有值 */
  readAt?: string;
}

export interface AnnouncementReadStats {
  readCount: number;
  totalCount: number;
  list: AnnouncementReadStatsUser[];
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
  status: EntityStatus;
  description: string;
  retryCount: number;
  retryInterval: number;
  monitorTimeout: number | null;
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
  | { type: 'announcement:new'; payload: Announcement }
  | { type: 'announcement:updated'; payload: Announcement }
  | { type: 'announcement:deleted'; payload: { id: number } }
  | { type: 'announcement:read'; payload: { id: number } }
  | { type: 'announcement:read-all'; payload: Record<string, never> }
  | { type: 'in-app-message:new'; payload: InAppMessage }
  | { type: 'in-app-message:read'; payload: { id: number } }
  | { type: 'in-app-message:read-all'; payload: Record<string, never> }
  | { type: 'in-app-message:deleted'; payload: { id: number } }
  | { type: 'session:force-logout'; payload: { reason: string } }
  | { type: 'chat:message'; payload: ChatMessage }
  | { type: 'chat:recall'; payload: { conversationId: number; messageId: number } }
  | { type: 'chat:read'; payload: { conversationId: number; userId: number } }
  | { type: 'chat:member-join'; payload: { conversationId: number; user: { id: number; nickname: string; avatar: string | null } } }
  | { type: 'chat:member-leave'; payload: { conversationId: number; userId: number } }
  | { type: 'chat:group-update'; payload: { conversationId: number; name?: string | null; announcement?: string | null } }
  | { type: 'chat:typing'; payload: { conversationId: number; userId: number; nickname: string } }
  | { type: 'chat:reaction'; payload: { conversationId: number; messageId: number; reactions: ChatReactionGroup[] } }
  | { type: 'chat:edit'; payload: ChatMessage }
  | { type: 'chat:vote-update'; payload: { conversationId: number; messageId: number; voteData: ChatVoteData } };

// ─── 地区管理 ──────────────────────────────────────────────
export type RegionLevel = 'province' | 'city' | 'county';

export interface Region {
  id: number;
  code: string;
  name: string;
  level: RegionLevel;
  parentCode: string | null;
  sort: number;
  status: EntityStatus;
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
  status: EntityStatus;
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

// ─── 工作流引擎 ───────────────────────────────────────────────────────────────
export type WorkflowDefinitionStatus = 'draft' | 'published' | 'disabled';
export type WorkflowInstanceStatus = 'draft' | 'running' | 'approved' | 'rejected' | 'withdrawn';
export type WorkflowTaskStatus = 'pending' | 'approved' | 'rejected' | 'skipped';
export type WorkflowNodeType = 'start' | 'approve' | 'end' | 'exclusiveGateway' | 'parallelGateway' | 'ccNode';
export type WorkflowConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';

// 连线条件表达式（排他网关出边使用）
export interface WorkflowEdgeCondition {
  field: string;         // 表单字段 key
  operator: WorkflowConditionOperator;
  value: string | number | boolean;
}

// 流程节点配置（存在 flowData JSON 中）
export interface WorkflowNodeConfig {
  key: string;       // 节点唯一标识
  type: WorkflowNodeType;
  label: string;     // 显示名称
  assigneeId?: number | null;   // 审批人 ID（approve 节点）
  assigneeName?: string | null;
  assigneeIds?: number[] | null;  // 抄送节点：多个接收人 ID
  assigneeNames?: string[] | null;
  isDefault?: boolean;            // 排他网关：是否默认出口
}

// React Flow 数据结构（flowData JSON）
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  label?: string;
  condition?: WorkflowEdgeCondition | null;  // 排他网关出边的条件
}

export interface WorkflowFlowData {
  nodes: Array<{
    id: string;
    type?: string;
    position: { x: number; y: number };
    data: WorkflowNodeConfig;
  }>;
  edges: WorkflowEdge[];
  /** 钉钉/飞书风格流程树结构（新版设计器使用） */
  process?: Record<string, unknown>;
}

// 表单字段类型
export type WorkflowFormFieldType =
  | 'text'          // 单行文本
  | 'textarea'      // 多行文本
  | 'number'        // 数字
  | 'date'          // 日期
  | 'dateRange'     // 日期区间
  | 'select'        // 单选
  | 'multiSelect'   // 多选
  | 'amount'        // 金额
  | 'attachment'    // 附件
  | 'image'         // 图片
  | 'contact'       // 联系人（人员选择）
  | 'department'    // 部门选择
  | 'detail'        // 明细/表格
  | 'description'   // 说明文字
  | 'serialNumber'  // 流水号
  | 'row'           // 栅格行
  | 'divider'       // 分割线
  | 'group';        // 分组标题

// 字段显隐条件
export interface WorkflowFieldVisibilityCondition {
  field: string;
  operator: 'eq' | 'neq' | 'in' | 'contains';
  value: unknown;
}

export interface WorkflowFormFieldColumn {
  span: number;          // 1-24 grid span
  fields: WorkflowFormField[];
}

// 表单字段配置
export interface WorkflowFormField {
  key: string;
  label: string;
  type: WorkflowFormFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];              // select/multiSelect 的选项
  defaultValue?: unknown;
  visibilityCondition?: WorkflowFieldVisibilityCondition;
  children?: WorkflowFormField[];  // 明细子字段
  precision?: number;              // 数字/金额精度
  currency?: string;               // 金额币种
  dateFormat?: string;             // 日期格式
  maxCount?: number;               // 附件/图片限制数
  description?: string;            // 说明文字内容
  serialPrefix?: string;           // 流水号前缀
  // Layout fields
  columns?: WorkflowFormFieldColumn[];  // for 'row' type
  title?: string;                       // for 'group' type header
}

export interface WorkflowDefinition {
  id: number;
  name: string;
  description: string | null;
  flowData: WorkflowFlowData | null;
  formFields: WorkflowFormField[] | null;
  status: WorkflowDefinitionStatus;
  version: number;
  tenantId: number | null;
  createdBy: number | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTask {
  id: number;
  instanceId: number;
  nodeKey: string;
  nodeName: string;
  nodeType: WorkflowNodeType | null;
  assigneeId: number | null;
  assigneeName?: string | null;
  assigneeAvatar?: string | null;
  status: WorkflowTaskStatus;
  comment: string | null;
  actionAt: string | null;
  createdAt: string;
}

export interface WorkflowInstance {
  id: number;
  definitionId: number;
  definitionName?: string;
  title: string;
  formData: Record<string, unknown> | null;
  status: WorkflowInstanceStatus;
  currentNodeKey: string | null;
  initiatorId: number;
  initiatorName?: string | null;
  initiatorAvatar?: string | null;
  tenantId: number | null;
  tasks?: WorkflowTask[];
  createdAt: string;
  updatedAt: string;
}

// ─── 聊天 ─────────────────────────────────────────────────────────────────────
export type ChatConversationType = 'direct' | 'group';
export type ChatMessageType = 'text' | 'image' | 'file' | 'system' | 'forward' | 'vote';

export interface ChatVoteOption {
  id: string;
  label: string;
}

export interface ChatVoteRecord {
  userId: number;
  optionIds: string[];
  nickname: string;
}

export interface ChatVoteData {
  question: string;
  options: ChatVoteOption[];
  isMultiple: boolean;
  isAnonymous: boolean;
  expireAt: string | null;
  votes: ChatVoteRecord[];
  isClosed: boolean;
}
export type ChatMemberRole = 'owner' | 'member';

export interface ChatLinkPreview {
  url: string;
  title: string;
  description: string | null;
  siteName: string | null;
  image: string | null;
  favicon: string | null;
}

export interface ChatAssetMeta {
  kind: 'image' | 'file';
  name: string;
  size: number;
  mimeType: string | null;
  extension: string | null;
  width?: number | null;
  height?: number | null;
  thumbnailUrl?: string | null;
}

export interface ChatMention {
  userId: number;
  nickname: string;
}

export interface ChatAnnouncementHistoryMeta {
  announcement: string | null;
  operatorName: string | null;
}

export interface ChatForwardedItem {
  senderName: string | null;
  type: ChatMessageType;
  content: string;
  createdAt: string;
  asset?: ChatAssetMeta | null;
}

export interface ChatReactionGroup {
  emoji: string;
  count: number;
  userIds: number[];
}

export interface ChatMessageExtra {
  asset?: ChatAssetMeta | null;
  linkPreview?: ChatLinkPreview | null;
  mentions?: ChatMention[] | null;
  isFavorited?: boolean;
  isPinned?: boolean;
  announcementHistory?: ChatAnnouncementHistoryMeta | null;
  forwardedMessages?: ChatForwardedItem[] | null;
  forwardSourceConvName?: string | null;
  hiddenFor?: number[] | null;
  voteData?: ChatVoteData | null;
}

export interface ChatReplySnapshot {
  id: number;
  senderId: number | null;
  senderName: string | null;
  type: ChatMessageType;
  content: string;
  isRecalled: boolean;
  extra: ChatMessageExtra | null;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  senderId: number | null;
  senderName: string | null;
  senderAvatar: string | null;
  type: ChatMessageType;
  content: string;
  replyToId: number | null;
  replyToMessage: ChatReplySnapshot | null;
  isRecalled: boolean;
  isEdited: boolean;
  extra: ChatMessageExtra | null;
  reactions: ChatReactionGroup[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageSearchItem {
  message: ChatMessage;
  snippet: string;
}

export interface ChatMessageSearchResult {
  list: ChatMessageSearchItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ChatMessageContext {
  list: ChatMessage[];
  anchorMessageId: number;
  hasBefore: boolean;
  hasAfter: boolean;
}

export interface ChatGroupMember {
  id: number;
  nickname: string;
  username: string;
  avatar?: string | null;
  role: ChatMemberRole;
}

export interface ChatConversation {
  id: number;
  type: ChatConversationType;
  name: string | null;
  announcement?: string | null;
  targetUser?: {
    id: number;
    nickname: string;
    avatar: string | null;
    phone?: string | null;
    email?: string | null;
    departmentName?: string | null;
    positionNames?: string[];
  } | null;
  lastMessage: ChatMessage | null;
  unreadCount: number;
  /** 是否存在未读的 @我 消息 */
  hasMentionUnread: boolean;
  isPinned: boolean;
  isStarred: boolean;
  isMuted: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── 通知模块（邮件 / 短信 / 站内信）─────────────────────────────────────────
export type SendStatus = 'pending' | 'success' | 'failed';
export type SendSource = 'manual' | 'test' | 'system' | 'api';
export type SmsProvider = 'aliyun' | 'tencent';
export type InAppMessageType = 'info' | 'success' | 'warning' | 'error';

// 邮件模板
export interface EmailTemplate {
  id: number;
  name: string;
  code: string;
  subject: string;
  content: string;
  variables: string | null;
  status: EntityStatus;
  remark: string | null;
  tenantId?: number | null;
  createdAt: string;
  updatedAt: string;
}

// 邮件发送记录
export interface EmailSendLog {
  id: number;
  templateId: number | null;
  templateName?: string | null;
  toEmail: string;
  subject: string;
  content: string;
  status: SendStatus;
  errorMsg: string | null;
  source: SendSource;
  userId: number | null;
  userName?: string | null;
  ip: string | null;
  tenantId?: number | null;
  sentAt: string | null;
  createdAt: string;
}

// 短信服务商配置
export interface SmsConfig {
  id: number;
  name: string;
  provider: SmsProvider;
  accessKeyId: string;
  accessKeySecret?: string; // 列表/详情返回时可能脱敏
  region: string | null;
  signName: string;
  isDefault: boolean;
  status: EntityStatus;
  remark: string | null;
  tenantId?: number | null;
  createdAt: string;
  updatedAt: string;
}

// 短信模板
export interface SmsTemplate {
  id: number;
  name: string;
  code: string;
  templateCode: string;
  signName: string | null;
  content: string;
  variables: string | null;
  provider: SmsProvider;
  status: EntityStatus;
  remark: string | null;
  tenantId?: number | null;
  createdAt: string;
  updatedAt: string;
}

// 短信发送记录
export interface SmsSendLog {
  id: number;
  configId: number | null;
  templateId: number | null;
  templateName?: string | null;
  provider: SmsProvider;
  phone: string;
  content: string;
  status: SendStatus;
  errorMsg: string | null;
  bizId: string | null;
  deliveryStatus: string | null;
  deliveredAt: string | null;
  source: SendSource;
  userId: number | null;
  userName?: string | null;
  ip: string | null;
  tenantId?: number | null;
  sentAt: string | null;
  createdAt: string;
}

// 站内信模板
export interface InAppTemplate {
  id: number;
  name: string;
  code: string;
  title: string;
  content: string;
  type: InAppMessageType;
  variables: string | null;
  status: EntityStatus;
  remark: string | null;
  tenantId?: number | null;
  createdAt: string;
  updatedAt: string;
}

// 站内信收件记录
export interface InAppMessage {
  id: number;
  templateId: number | null;
  userId: number;
  userName?: string | null;
  title: string;
  content: string;
  type: InAppMessageType;
  isRead: boolean;
  readAt: string | null;
  source: SendSource;
  senderId: number | null;
  senderName?: string | null;
  tenantId?: number | null;
  createdAt: string;
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  groupName: string | null;
  description: string | null;
  status: EntityStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
