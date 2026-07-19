import type { AiProvider, AiAgentStatus, OAuthProviderType, PaymentChannel, PaymentMethod, PaymentOrderStatus, PaymentRefundStatus, PaymentRefundApprovalStatus, PaymentReconStatus, PaymentReconResult, PaymentReconHandleStatus, PaymentWebhookDeliveryStatus, PaymentLedgerDirection, PaymentLedgerType, PaymentSettlementStatus, PaymentSharingReceiverType, PaymentSharingOrderStatus, PaymentLinkStatus, PaymentRiskScope, PaymentRiskAction, PaymentRiskDimension, PaymentRiskReviewStatus, PaymentTransferStatus, PaymentDeductPeriod, PaymentContractStatus, PaymentDisputeType, PaymentDisputeStatus, PaymentPreauthStatus, MemberStatus, PointTxType, WalletTxType, CouponType, CouponValidType, CouponTemplateStatus, MemberCouponStatus, WorkflowFormType } from './constants';
import { REPORT_DASHBOARD_LIFECYCLE_STATUSES, REPORT_DASHBOARD_VERSION_SOURCES } from './constants';

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
  packageId?: number | null;
  packageName?: string | null;
  userCount?: number;
  remark?: string | null;
  /** 自动初始化的租户管理员账号（仅创建响应返回，password 一次性可见） */
  initialAdmin?: { username: string; email: string; password: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantStats {
  id: number;
  name: string;
  code: string;
  status: EntityStatus;
  userCount: number;
  maxUsers: number | null;
  departmentCount: number;
  roleCount: number;
  positionCount: number;
  packageId: number | null;
  packageName: string | null;
  packageMenuCount: number;
  expireAt: string | null;
  /** 距到期天数；null=永不过期，负数=已过期 */
  daysToExpire: number | null;
}

export interface TenantPackage {
  id: number;
  name: string;
  status: EntityStatus;
  remark?: string | null;
  /** 关联的菜单 ID（详情接口返回）*/
  menuIds?: number[];
  /** 已关联菜单数量（列表接口返回）*/
  menuCount?: number;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: number;
  username: string;
  nickname: string;
  email: string | null;
  phone?: string | null;
  gender?: string | null;
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
  isLocked?: boolean;
  isOnline?: boolean;
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  lastLoginLocation?: string | null;
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

export interface MfaLoginChallenge {
  mfaRequired: true;
  challengeId: string;
  methods: ('totp' | 'passkey')[];
  expiresAt: number;
  reason?: string | null;
}

export type LoginResult = LoginResponse | MfaLoginChallenge;

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
  query?: string | null;
  isExternal?: boolean;
  /** 外链打开方式：false=新窗口，true=系统内 iframe 内嵌 */
  embed?: boolean;
  /** 页面缓存：多页签模式下切走保留组件状态（React Activity） */
  keepAlive?: boolean;
  sort: number;
  status: EntityStatus;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
  children?: Menu[];
}

// ─── 角色 ─────────────────────────────────────────────────────────────────────
export type DataScope = 'all' | 'custom' | 'dept_only' | 'dept' | 'self';

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
  deptScopeIds?: number[];
  userCount?: number;
  userPreview?: Array<{ id: number; nickname: string; avatar?: string | null }>;
}

// ─── 部门 ─────────────────────────────────────────────────────────────────────
export interface Department {
  id: number;
  parentId: number;
  name: string;
  code: string;
  category?: string;
  leaderId?: number | null;
  leaderName?: string | null;
  phone?: string;
  email?: string;
  sort: number;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
  children?: Department[];
  userCount?: number;
  userPreview?: Array<{ id: number; nickname: string; avatar: string | null }>;
}

// ─── 岗位 ─────────────────────────────────────────────────────────────────────
export interface Position {
  id: number;
  name: string;
  code: string;
  sort: number;
  status: EntityStatus;
  remark?: string;
  userCount?: number;
  userPreview?: Array<{ id: number; nickname: string; avatar?: string | null }>;
  createdAt: string;
  updatedAt: string;
}
// ─── 用户组 ────────────────────────────────────────────────────────────
export interface UserGroup {
  id: number;
  name: string;
  code: string;
  description?: string | null;
  ownerId?: number | null;
  ownerName?: string | null;
  departmentId?: number | null;
  departmentName?: string | null;
  memberCount?: number;
  memberPreview?: Array<{ id: number; nickname: string; avatar?: string | null }>;
  roleCount?: number;
  status: EntityStatus;
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
  parentId?: number | null;
  label: string;
  value: string;
  color?: string;
  sort: number;
  status: EntityStatus;
  remark?: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  children?: DictItem[];
}

// ─── 文件管理 ─────────────────────────────────────────────────────────────────
export type FileStorageProvider = 'local' | 'oss' | 's3' | 'cos' | 'obs' | 'kodo' | 'bos' | 'azure' | 'sftp';

/** 对象读写权限（canned ACL）；default = 继承 Bucket */
export type FileObjectAcl = 'default' | 'private' | 'public-read' | 'public-read-write';

/** 文件访问 URL 策略；proxy=服务端代理，public=永久公开直链，presigned=临时签名直链 */
export type FileUrlStrategy = 'proxy' | 'public' | 'presigned';

/** access-url 接口返回的文件访问地址（presigned 每次返回新鲜签名，禁止长期缓存） */
export interface FileAccessUrl {
  url: string;
  strategy: FileUrlStrategy;
  /** 签名过期时间（YYYY-MM-DD HH:mm:ss）；public/proxy 为 null */
  expiresAt: string | null;
}

export interface FileStorageConfig {
  id: number;
  name: string;
  provider: FileStorageProvider;
  status: EntityStatus;
  isDefault: boolean;
  basePath?: string;
  /** 对象读写权限（仅 oss/s3/cos/obs/bos 生效）；default = 继承 Bucket */
  objectAcl?: FileObjectAcl;
  /** 文件访问 URL 策略 */
  urlStrategy: FileUrlStrategy;
  /** 自定义访问域名（CDN/加速域名），public 策略优先使用 */
  publicBaseUrl?: string;
  /** 临时签名有效期（秒） */
  presignedExpirySeconds: number;
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
  // 华为云 OBS
  obsEndpoint?: string;
  obsBucket?: string;
  obsAccessKeyId?: string;
  obsSecretAccessKey?: string;
  // 七牛云 Kodo
  kodoAccessKey?: string;
  kodoSecretKey?: string;
  kodoBucket?: string;
  kodoRegion?: string;
  kodoEndpoint?: string;
  // 百度云 BOS
  bosEndpoint?: string;
  bosBucket?: string;
  bosAccessKeyId?: string;
  bosSecretAccessKey?: string;
  // Azure Blob Storage
  azureAccountName?: string;
  azureAccountKey?: string;
  azureContainerName?: string;
  azureEndpoint?: string;
  // SFTP
  sftpHost?: string;
  sftpPort?: number;
  sftpUsername?: string;
  sftpPassword?: string;
  sftpPrivateKey?: string;
  sftpRootPath?: string;
  sftpBaseUrl?: string;
  remark?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedFile {
  id: string;
  storageConfigId: number;
  storageName: string;
  provider: FileStorageProvider;
  originalName: string;
  objectKey: string;
  size: number;
  mimeType?: string;
  extension?: string;
  /** 稳定代理路径 /api/files/{id}/content：可持久化、永不失效 */
  url: string;
  /** public 策略的永久公开直链；仅渲染用，禁止持久化 */
  directUrl?: string | null;
  uploaderName?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Export Center ───────────────────────────────────────────────────────

export const EXPORT_JOB_FORMATS = ['xlsx', 'csv', 'pdf', 'docx'] as const;
export type ExportJobFormat = typeof EXPORT_JOB_FORMATS[number];
export type ExportJobStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'expired';
export type ExportJobExecutionMode = 'sync' | 'async';
export type ExportJobRequestMode = 'sync' | 'async' | 'auto';
export type ExportJobDeleteReason = 'expired' | 'manual' | 'file_missing';

export interface ExportColumnMeta {
  key: string;
  header: string;
  width?: number;
  type?: 'string' | 'number' | 'datetime' | 'date' | 'enum' | 'money' | 'boolean';
  sensitive?: boolean;
  children?: ExportColumnMeta[];
}

export interface ExportEntityMeta {
  entity: string;
  moduleName: string;
  filenamePrefix: string;
  sourcePath?: string;
  formats: ExportJobFormat[];
  renderMode: 'table' | 'layout' | 'custom';
  columns: ExportColumnMeta[];
  sensitive: boolean;
  execution: {
    mode: ExportJobRequestMode;
    syncMaxRows: number;
    forceAsyncWhenSensitive: boolean;
    forceAsyncWhenRaw: boolean;
    syncModeOverridesAsyncPolicies: boolean;
  };
  permissions: {
    export: string;
    exportRaw?: string;
    requireExportRawPermission?: boolean;
  };
}

export interface ExportJob {
  id: number;
  entity: string;
  moduleName: string;
  format: ExportJobFormat;
  status: ExportJobStatus;
  executionMode: ExportJobExecutionMode;
  query: Record<string, unknown>;
  columns: string[] | null;
  rowCount: number | null;
  fileId: string | null;
  filename: string | null;
  fileSize: number | null;
  raw: boolean;
  masked: boolean;
  sensitive: boolean;
  watermark: boolean;
  errorMessage: string | null;
  expiresAt: string | null;
  fileDeletedAt: string | null;
  deleteReason: ExportJobDeleteReason | null;
  downloadCount: number;
  lastDownloadedAt: string | null;
  tenantId: number | null;
  createdBy: number | null;
  createdByName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportJobCreateResult {
  mode: ExportJobExecutionMode;
  job: ExportJob;
}

export interface ExportJobDownload {
  id: number;
  jobId: number;
  downloadedBy: number | null;
  downloadedByName: string | null;
  tenantId: number | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

// ─── Storage Browse ──────────────────────────────────────
export interface FolderEntry {
  name: string;
  path: string;
}

export interface StorageBrowseResult {
  folders: FolderEntry[];
  files: ManagedFile[];
  currentPath: string;
  basePath: string;
}

// ─── File Stats ───────────────────────────────────────────────────────
export interface FileStats {
  summary: {
    totalFiles: number;
    totalSize: number;
    imageCount: number;
    docCount: number;
    videoCount: number;
    audioCount: number;
    todayCount: number;
    thisMonthCount: number;
  };
  typeStats: { type: string; label: string; count: number; size: number }[];
  providerStats: { provider: string; count: number; size: number }[];
  monthlyStats: { month: string; count: number }[];
  uploaderStats: { username: string; count: number; size: number }[];
  sizeRangeStats: { range: string; count: number }[];
}

// ─── Login Logs ──────────────────────────────────────────
export type LoginEventType = 'login' | 'logout';

export interface LoginLog {
  id: number;
  userId: number | null;
  username: string;
  ip: string | null;
  location: string | null;
  browser: string | null;
  os: string | null;
  userAgent: string | null;
  eventType: LoginEventType;
  status: 'success' | 'fail';
  message: string | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  devicePixelRatio?: string | null;
  gpu?: string | null;
  cpuCores?: number | null;
  memoryGb?: string | null;
  createdAt: string;
}

// ─── Maintenance Logs ────────────────────────────────────
export type MaintenanceLogStatus = 'ongoing' | 'completed';

export interface MaintenanceLog {
  id: number;
  message: string;
  estimatedEndAt: string | null;
  startedAt: string | null;
  startedByName: string | null;
  endedAt: string | null;
  endedByName: string | null;
  durationSeconds: number | null;
  status: MaintenanceLogStatus;
  createdAt: string;
}

// ─── IP Access Logs ──────────────────────────────────────
export interface IpAccessLog {
  id: number;
  ip: string;
  path: string;
  method: string;
  blockType: 'blacklist' | 'whitelist';
  userAgent: string | null;
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
  location?: string | null;
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
  moduleTimingStats: { module: string; avgMs: number; maxMs: number; count: number }[];
  dailyStats: { date: string; count: number; successCount: number; failCount: number }[];
  userStats: { username: string; count: number }[];
  methodStats: { method: string; count: number }[];
  hourlyStats: { hour: number; count: number }[];
}

export interface LoginLogStats {
  summary: {
    total: number;
    successCount: number;
    failCount: number;
    uniqueUsers: number;
  };
  dailyStats: { date: string; count: number; successCount: number; failCount: number }[];
  userStats: { username: string; count: number }[];
  ipStats: { ip: string; count: number }[];
  ipFailStats: { ip: string; count: number }[];
  browserStats: { browser: string; count: number }[];
  osStats: { os: string; count: number }[];
  hourlyStats: { hour: number; count: number }[];
}

export interface MemberLoginLog {
  id: number;
  memberId: number | null;
  memberNickname?: string | null;
  ip: string | null;
  location: string | null;
  browser: string | null;
  os: string | null;
  userAgent: string | null;
  status: 'success' | 'fail';
  message: string | null;
  createdAt: string;
}

export interface MemberRecharge {
  id: number;
  orderNo: string;
  outTradeNo: string;
  channelTradeNo: string | null;
  memberId: number | null;
  memberNickname: string | null;
  memberPhone: string | null;
  subject: string;
  amount: number;
  channel: PaymentChannel;
  payMethod: PaymentMethod;
  status: PaymentOrderStatus;
  paidAmount: number | null;
  paidAt: string | null;
  expiredAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface MemberStatsOverview {
  totalMembers: number;
  todayNewMembers: number;
  monthNewMembers: number;
  activeMembers30d: number;
  totalPoints: number;
  totalWalletBalance: number;
  todayCheckins: number;
  todayCheckinRate: number;
  availableCoupons: number;
}

export interface MemberStatsCharts {
  registerTrend: { date: string; count: number }[];
  levelDistribution: { name: string; value: number }[];
  pointTrend: { date: string; earned: number; spent: number }[];
  checkinTrend: { date: string; count: number }[];
  /** 活跃分层（按最后登录时间：7天/30天/90天/沉睡/从未登录）*/
  activitySegments: { name: string; value: number }[];
  /** 充值能力分层（按累计充值金额分档）*/
  rechargeSegments: { name: string; value: number }[];
}

// ─── 用户行为分析 ────────────────────────────────────────────
export type UserBehaviorEventType =
  | 'page_view' | 'page_leave' | 'feature_use' | 'area_click'
  | 'custom' | 'perf' | 'api_request' | 'identify';

export interface PageStatItem {
  pagePath: string;
  pageTitle: string | null;
  visits: number;
  avgMs: number | null;
  medianMs: number | null;
  p90Ms: number | null;
}

export interface PageStats {
  items: PageStatItem[];
  totalVisits: number;
  avgDwellMs: number | null;
}

export interface FeatureStatItem {
  pagePath: string;
  elementKey: string;
  elementLabel: string | null;
  componentArea: string | null;
  count: number;
}

export interface FeatureStats {
  items: FeatureStatItem[];
  totalEvents: number;
}

export interface HeatmapPoint {
  x: number;
  y: number;
  value: number;
}

export interface HeatmapData {
  pagePath: string;
  componentArea: string;
  points: HeatmapPoint[];
  total: number;
}

export interface HeatmapPageListItem {
  pagePath: string;
  pageTitle: string | null;
  areas: string[];
}

export interface UserStatItem {
  userId: number | null;
  username: string | null;
  totalEvents: number;
  pageViews: number;
  uniquePages: number;
  featureUses: number;
  totalDwellMs: number | null;
  lastActiveAt: string | null;
}

export interface UserStats {
  items: UserStatItem[];
  totalUsers: number;
}

// ─── 前端错误监控（Issue 模型）──────────────────────────────────────────────
export type FrontendErrorType =
  | 'js_error' | 'promise_rejection' | 'resource_error' | 'console_error'
  | 'http_error' | 'white_screen' | 'crash';
export type ErrorLevel = 'fatal' | 'error' | 'warning' | 'info';
export type ErrorStatus = 'unresolved' | 'resolved' | 'ignored' | 'muted';
export type ErrorAlertCondition = 'new_error' | 'threshold' | 'spike';

/** 错误分组（Issue） */
export interface ErrorGroup {
  id: number;
  fingerprint: string;
  errorType: FrontendErrorType;
  level: ErrorLevel;
  message: string;
  status: ErrorStatus;
  assigneeId: number | null;
  assigneeName: string | null;
  release: string | null;
  note: string | null;
  count: number;
  affectedUsers: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  /** 近 7 日每日发生次数（列表迷你趋势） */
  trend?: number[];
}

/** 单次错误事件 */
export interface ErrorEvent {
  id: number;
  groupId: number;
  fingerprint: string;
  errorType: FrontendErrorType;
  level: ErrorLevel;
  message: string;
  stack: string | null;
  sourceUrl: string | null;
  lineNo: number | null;
  colNo: number | null;
  pageUrl: string | null;
  release: string | null;
  userAgent: string | null;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  deviceType: AnalyticsDeviceType | null;
  userId: number | null;
  username: string | null;
  sessionId: string | null;
  breadcrumbs: ErrorBreadcrumb[] | null;
  context: Record<string, unknown> | null;
  httpStatus: number | null;
  httpMethod: string | null;
  httpUrl: string | null;
  /** 事件来源平台 */
  source: AnalyticsEventSource;
  /** 应用标识 */
  appId: string;
  /** 采集环境 */
  environment: AnalyticsEnvironment;
  /** 会员身份（前台错误上报），与 userId（后台管理员）互斥 */
  memberId: number | null;
  createdAt: string;
}

export interface ErrorBreadcrumb {
  type: 'navigation' | 'click' | 'http' | 'console' | 'custom';
  message: string;
  level?: ErrorLevel;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface ErrorOverview {
  totalGroups: number;
  unresolved: number;
  totalOccurrences: number;
  affectedUsers: number;
  newToday: number;
  byType: { errorType: FrontendErrorType; groups: number; occurrences: number }[];
  byLevel: { level: ErrorLevel; groups: number; occurrences: number }[];
  trend: { date: string; occurrences: number; groups: number }[];
  topIssues: ErrorGroup[];
}

export interface SourceMapItem {
  id: number;
  release: string;
  fileName: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

export interface ErrorAlertRule {
  id: number;
  name: string;
  errorType: FrontendErrorType | null;
  level: ErrorLevel | null;
  condition: ErrorAlertCondition;
  thresholdCount: number;
  windowMinutes: number;
  channels: string[];
  webhookUrl: string | null;
  recipients: string[];
  enabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ErrorAlertLog {
  id: number;
  ruleId: number | null;
  ruleName: string;
  condition: ErrorAlertCondition;
  detail: string;
  channels: string[];
  source: string;
  createdAt: string;
}

// ─── 系统监控告警 ─────────────────────────────────────────────────────────────
export type MonitorMetric =
  | 'cpu' | 'memory' | 'disk' | 'swap' | 'load1' | 'procCpu' | 'heap'
  | 'loopLag' | 'qps' | 'errorRate' | 'netRxBps' | 'netTxBps' | 'diskReadBps' | 'diskWriteBps'
  | 'workflowHealth' | 'workflowBacklog' | 'workflowDeadLetter' | 'workflowFailureRate' | 'workflowStuckRunning';
export type MonitorAlertOperator = 'gt' | 'gte' | 'lt' | 'lte';
export type MonitorAlertLevel = 'info' | 'warning' | 'critical';
export type MonitorAlertState = 'ok' | 'firing';
export type MonitorAlertEventStatus = 'firing' | 'resolved';

export interface MonitorAlertRule {
  id: number;
  name: string;
  metric: MonitorMetric;
  operator: MonitorAlertOperator;
  threshold: number;
  durationMinutes: number;
  level: MonitorAlertLevel;
  channels: string[];
  webhookUrl: string | null;
  recipients: string[];
  silenceMinutes: number;
  enabled: boolean;
  state: MonitorAlertState;
  lastTriggeredAt: string | null;
  lastValue: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorAlertEvent {
  id: number;
  ruleId: number | null;
  ruleName: string;
  metric: MonitorMetric;
  level: MonitorAlertLevel;
  operator: MonitorAlertOperator;
  threshold: number;
  value: number;
  status: MonitorAlertEventStatus;
  message: string;
  triggeredAt: string;
  resolvedAt: string | null;
}

export interface MonitorHistoryPoint {
  t: string;
  cpu: number;
  memory: number;
  disk: number;
  swap: number;
  load1: number;
  procCpu: number;
  heap: number;
  loopLag: number;
  qps: number;
  errorRate: number;
  netRxBps: number;
  netTxBps: number;
  diskReadBps: number;
  diskWriteBps: number;
}

export interface MonitorHistory {
  range: string;
  bucketSec: number;
  points: MonitorHistoryPoint[];
}

// ─── 用户行为采集（埋点）──────────────────────────────────────────────────────
export type AnalyticsDeviceType = 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';

/** 事件来源平台：后台管理端 SPA / 会员前台 SPA / 服务端埋点 */
export type AnalyticsEventSource = 'web_admin' | 'web_member' | 'server';

/** 采集环境（与 DB varchar 列对应，取值受校验层约束，允许后续扩展） */
export type AnalyticsEnvironment = 'production' | 'staging' | 'development';

/** 身份归属类型：后台管理员 / 前台会员 / 匿名访客 */
export type AnalyticsIdentityType = 'admin' | 'member' | 'anonymous';

/** 单条上报事件（客户端 → 服务端） */
export interface TrackEventInput {
  /** 客户端生成的稳定事件 ID；旧离线队列可暂不携带。 */
  eventId?: string;
  sessionId: string;
  anonymousId?: string;
  distinctId?: string;
  eventType: UserBehaviorEventType;
  eventName?: string;
  pagePath: string;
  pageTitle?: string;
  elementKey?: string;
  elementLabel?: string;
  componentArea?: string;
  clickX?: number;
  clickY?: number;
  scrollDepth?: number;
  durationMs?: number;
  properties?: Record<string, unknown>;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  screenW?: number;
  screenH?: number;
  language?: string;
  metricName?: string;
  metricValue?: number;
  /** 客户端事件时间戳（epoch ms），离线重放时保留真实时间 */
  ts?: number;
  /** 事件来源平台；未携带时由服务端按接入方式默认推断（历史行为兼容 web_admin） */
  source?: AnalyticsEventSource;
  /** 应用标识（多 App 场景预留） */
  appId?: string;
  /** 采集环境 */
  environment?: AnalyticsEnvironment;
  /** 采集 SDK 版本 */
  sdkVersion?: string;
}

/** SDK 远程配置 */
export interface AnalyticsSettings {
  id: number;
  enabled: boolean;
  sampleRate: number;
  trackPageviews: boolean;
  trackClicks: boolean;
  trackPerformance: boolean;
  trackErrors: boolean;
  trackApi: boolean;
  maskInputs: boolean;
  respectDnt: boolean;
  anonymizeIp: boolean;
  blacklistPaths: string[];
  retentionDays: number;
  errorRetentionDays: number;
  sessionTimeoutMinutes: number;
  createdAt: string;
  updatedAt: string;
}

/** SDK 公开配置（无需鉴权可获取的精简版） */
export interface AnalyticsPublicConfig {
  enabled: boolean;
  sampleRate: number;
  trackPageviews: boolean;
  trackClicks: boolean;
  trackPerformance: boolean;
  trackErrors: boolean;
  trackApi: boolean;
  maskInputs: boolean;
  respectDnt: boolean;
  blacklistPaths: string[];
  sessionTimeoutMinutes: number;
  siteId?: number;
  appId?: string;
}

export type AnalyticsEventMetaStatus = 'active' | 'deprecated' | 'blocked';
/** Tracking Plan 属性类型（阶段 1 支持的最小类型集） */
export type AnalyticsEventPropertyType = 'string' | 'number' | 'boolean' | 'datetime' | 'object' | 'array';
export interface AnalyticsEventPropertyDef {
  key: string;
  type: AnalyticsEventPropertyType;
  description?: string;
  /** 是否为必填属性（严格模式下用于质量校验） */
  required?: boolean;
  /** 枚举取值范围（仅对 string 类型有效） */
  enumValues?: string[];
  /** 是否含个人敏感信息，供采集/导出侧脱敏参考 */
  pii?: boolean;
}
export interface AnalyticsEventMeta {
  id: number;
  eventName: string;
  displayName: string | null;
  category: string | null;
  description: string | null;
  propertySchema: AnalyticsEventPropertyDef[] | null;
  status: AnalyticsEventMetaStatus;
  eventCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /** Tracking Plan 契约版本号，结构性变更时递增 */
  version: number;
  /** 契约负责人（平台侧用户） */
  ownerId: number | null;
  ownerName: string | null;
  /** 严格模式：开启后对不符合 propertySchema 的属性做质量记录 */
  strictMode: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── 行为分析（聚合结果）──────────────────────────────────────────────────────
export interface AnalyticsOverview {
  pv: number;
  uv: number;
  sessions: number;
  events: number;
  newUsers: number;
  avgSessionMs: number;
  bounceRate: number;
  avgPagesPerSession: number;
  pvDelta: number;
  uvDelta: number;
  sessionsDelta: number;
  bounceRateDelta: number;
  activeNow: number;
}

export interface TrendSeries {
  dates: string[];
  series: { key: string; name: string; data: number[] }[];
  compare?: { dates: string[]; series: { key: string; name: string; data: number[] }[] };
}

export interface SessionListItem {
  id: number;
  sessionId: string;
  userId: number | null;
  username: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  pageCount: number;
  eventCount: number;
  entryPage: string | null;
  exitPage: string | null;
  referrer: string | null;
  browser: string | null;
  os: string | null;
  deviceType: AnalyticsDeviceType | null;
  region: string | null;
  isBounce: boolean;
  memberId: number | null;
  source: AnalyticsEventSource;
  appId: string;
  environment: AnalyticsEnvironment;
}

export interface FunnelStepInput {
  eventType?: UserBehaviorEventType;
  eventName?: string;
  pagePath?: string;
  elementKey?: string;
  label: string;
  /** 该步骤的属性过滤（最多 5 条，AND 语义） */
  properties?: AnalyticsSegmentPropertyFilter[];
}
export interface FunnelStepResult {
  label: string;
  users: number;
  conversionRate: number;
  stepConversionRate: number;
  dropoff: number;
  /** 相对上一步的平均转化耗时（毫秒），首步为 null */
  averageConversionMs: number | null;
}
export interface FunnelResult {
  steps: FunnelStepResult[];
  totalUsers: number;
  overallConversionRate: number;
}

/** 漏斗查询：有序转化（严格步骤先后顺序 + 转化窗口） */
export interface FunnelQuery {
  days: number;
  steps: FunnelStepInput[];
  /** 转化窗口（小时），首步到末步必须在该窗口内完成，默认 72，范围 1~720 */
  conversionWindowHours?: number;
  /** 仅统计指定分群内成员（先按分群成员过滤 distinctId 再计算漏斗） */
  segmentId?: number;
}

/** 留存计算口径：first_seen = 全历史真实首访；window_first = 当前统计窗口内首次出现 */
export type AnalyticsRetentionMode = 'first_seen' | 'window_first';

export interface RetentionResult {
  cohorts: {
    cohortDate: string;
    cohortSize: number;
    values: (number | null)[];
  }[];
  periods: number[];
  mode: AnalyticsRetentionMode;
}

export interface PathNode { id: string; label: string; value: number }
export interface PathLink { source: string; target: string; value: number }
export interface PathResult { nodes: PathNode[]; links: PathLink[] }

export interface UserTimelineEvent {
  id: number;
  eventType: UserBehaviorEventType;
  eventName: string | null;
  pagePath: string;
  pageTitle: string | null;
  elementLabel: string | null;
  componentArea: string | null;
  durationMs: number | null;
  sessionId: string | null;
  properties: Record<string, unknown> | null;
  createdAt: string;
}
export interface UserTimeline {
  userId: number | null;
  username: string | null;
  totalEvents: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  items: UserTimelineEvent[];
}

export interface SessionTimelineEvent {
  id: number;
  eventType: UserBehaviorEventType;
  eventName: string | null;
  pagePath: string;
  pageTitle: string | null;
  elementLabel: string | null;
  componentArea: string | null;
  durationMs: number | null;
  properties: Record<string, unknown> | null;
  createdAt: string;
}
export interface SessionTimeline {
  sessionId: string;
  username: string | null;
  userId: number | null;
  startedAt: string | null;
  durationMs: number | null;
  entryPage: string | null;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
  items: SessionTimelineEvent[];
}

export interface AnalyticsSavedReport {
  id: number;
  name: string;
  reportType: string;
  config: Record<string, unknown>;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
}

export interface DimensionBreakdownItem { name: string; value: number; percent: number }
export interface DimensionBreakdown {
  dimension: string;
  total: number;
  items: DimensionBreakdownItem[];
}

export interface DimensionCross {
  dim1: string;
  dim2: string;
  columns: string[];
  rows: { name: string; total: number; values: number[] }[];
}

export interface PerfStatItem {
  metricName: string;
  count: number;
  avg: number | null;
  p75: number | null;
  p90: number | null;
  p99: number | null;
  rating: 'good' | 'needs-improvement' | 'poor';
}
export interface PerfStats {
  items: PerfStatItem[];
}

export interface RealtimeStats {
  activeUsers: number;
  pageViewsLast30Min: number;
  eventsLastMinute: number;
  topPages: { pagePath: string; pageTitle: string | null; active: number }[];
  recentEvents: {
    eventType: UserBehaviorEventType;
    eventName: string | null;
    pagePath: string;
    username: string | null;
    createdAt: string;
  }[];
  perMinute: { minute: string; events: number }[];
}

export interface EventListItem {
  id: number;
  userId: number | null;
  username: string | null;
  eventType: UserBehaviorEventType;
  eventName: string | null;
  pagePath: string;
  pageTitle: string | null;
  elementKey: string | null;
  elementLabel: string | null;
  componentArea: string | null;
  durationMs: number | null;
  browser: string | null;
  os: string | null;
  deviceType: AnalyticsDeviceType | null;
  region: string | null;
  sessionId: string | null;
  createdAt: string;
  memberId: number | null;
  source: AnalyticsEventSource;
  appId: string;
  environment: AnalyticsEnvironment;
}
export interface EventDetail extends EventListItem {
  distinctId: string | null;
  anonymousId: string | null;
  scrollDepth: number | null;
  properties: Record<string, unknown> | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  browserVersion: string | null;
  osVersion: string | null;
  screenW: number | null;
  screenH: number | null;
  language: string | null;
  userAgent: string | null;
  ip: string | null;
  country: string | null;
  city: string | null;
  metricName: string | null;
  metricValue: number | null;
  sdkVersion: string | null;
}

export interface AnalyticsRollupItem {
  statDate: string;
  pv: number;
  uv: number;
  sessions: number;
  events: number;
  bounceSessions: number;
  totalDwellMs: number;
}

// ─── 行为中心阶段 1：租户级事件启停覆盖 ───────────────────────────────────────
export type AnalyticsEventOverrideStatus = 'enabled' | 'disabled';

export interface AnalyticsEventOverride {
  id: number;
  tenantId: number;
  eventName: string;
  status: AnalyticsEventOverrideStatus;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── 行为中心阶段 2：站点模型 ──────────────────────────────────────────────────

export interface AnalyticsSite {
  id: number;
  tenantId: number | null;
  tenantName?: string | null;
  siteKey: string;
  name: string;
  appId: string;
  allowedOrigins: string[] | null;
  dailyEventQuota: number | null;
  todayUsage: number | null;
  status: AnalyticsEventOverrideStatus;
  remark: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

// ─── 行为中心阶段 1：埋点质量日聚合 ────────────────────────────────────────────
export type AnalyticsQualityIssueType = 'missing_required' | 'type_mismatch' | 'invalid_enum' | 'event_disabled' | 'origin_rejected' | 'quota_exceeded';

export interface AnalyticsQualityDaily {
  id: number;
  tenantId: number;
  statDate: string;
  eventName: string;
  issueType: AnalyticsQualityIssueType;
  count: number;
  sample: Record<string, unknown> | null;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

/** 埋点质量看板查询结果：按日/事件/问题类型明细 + 汇总 */
export interface AnalyticsQualityQueryResult {
  items: AnalyticsQualityDaily[];
  totals: Array<{ issueType: AnalyticsQualityIssueType; count: number }>;
  totalCount: number;
}

// ─── 行为中心阶段 1：事件调试流 ────────────────────────────────────────────────
export interface AnalyticsDebugEvent {
  id: number;
  eventId: string | null;
  eventType: UserBehaviorEventType;
  eventName: string | null;
  source: AnalyticsEventSource;
  appId: string;
  environment: AnalyticsEnvironment;
  distinctId: string | null;
  memberId: number | null;
  userId: number | null;
  pagePath: string;
  properties: Record<string, unknown> | null;
  createdAt: string;
  /** 当日该事件命中的质量问题类型（去重） */
  issueTypes: AnalyticsQualityIssueType[];
}

// ─── 行为中心阶段 1：统一用户画像 ──────────────────────────────────────────────
export interface AnalyticsUserProfile {
  id: number;
  tenantId: number | null;
  distinctId: string;
  identityType: AnalyticsIdentityType;
  userId: number | null;
  memberId: number | null;
  displayName: string | null;
  properties: Record<string, unknown> | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

// ─── 行为中心阶段 1：用户分群 ──────────────────────────────────────────────────
/** 分群条件比较运算符 */
export type AnalyticsSegmentCompareOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';

export interface AnalyticsSegmentPropertyFilter {
  key: string;
  op: AnalyticsSegmentCompareOp;
  value: unknown;
}

/** 事件型条件：过滤最近 N 天内触发过指定事件（可选属性过滤 / 最小次数）的用户 */
export interface AnalyticsSegmentEventCondition {
  type: 'event';
  eventName: string;
  /** 统计窗口（天） */
  days: number;
  /** 最小触发次数，默认 1 */
  minCount?: number;
  properties?: AnalyticsSegmentPropertyFilter[];
}

/** 属性型条件：过滤画像属性（identityType / userId / memberId / properties.xxx） */
export interface AnalyticsSegmentAttributeCondition {
  type: 'attribute';
  /** 'identityType' | 'userId' | 'memberId' | `property.<key>` */
  field: string;
  op: AnalyticsSegmentCompareOp;
  value: unknown;
}

/** 分群条件：本阶段仅支持 event / attribute 两种原子条件，不支持 cohort 嵌套 */
export type AnalyticsSegmentCondition = AnalyticsSegmentEventCondition | AnalyticsSegmentAttributeCondition;

export interface AnalyticsSegmentRule {
  operator: 'AND' | 'OR';
  /** 条件数组，长度限制 1~10 */
  conditions: AnalyticsSegmentCondition[];
}

export interface AnalyticsUserSegment {
  id: number;
  tenantId: number | null;
  name: string;
  description: string | null;
  rules: AnalyticsSegmentRule;
  status: AnalyticsEventOverrideStatus;
  estimatedSize: number;
  snapshotAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 分群成员物化快照（定时任务重算） */
export interface AnalyticsSegmentMember {
  id: number;
  segmentId: number;
  tenantId: number | null;
  distinctId: string;
  identityType: AnalyticsIdentityType;
  userId: number | null;
  memberId: number | null;
  snapshotAt: string;
}


// ─── 行为中心阶段 2：A/B 实验 ─────────────────────────────────────────────────
export type AnalyticsExperimentStatus = 'draft' | 'running' | 'paused' | 'completed';

export interface AnalyticsExperimentVariant {
  key: string;
  name: string;
  weight: number;
}

export interface AnalyticsExperiment {
  id: number;
  tenantId: number | null;
  tenantName?: string | null;
  expKey: string;
  name: string;
  description: string | null;
  status: AnalyticsExperimentStatus;
  trafficAllocation: number;
  variants: AnalyticsExperimentVariant[];
  metricEventName: string;
  startAt: string | null;
  endAt: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnalyticsExperimentAssignment {
  expKey: string;
  variantKey: string;
}

export interface AnalyticsExperimentReportVariant {
  variantKey: string;
  exposures: number;
  conversions: number;
  conversionRate: number;
}

export interface AnalyticsExperimentReport {
  experimentId: number;
  expKey: string;
  metricEventName: string;
  variants: AnalyticsExperimentReportVariant[];
}

// ─── 行为中心阶段 2：分群触达 ──────────────────────────────────────────────────
export type AnalyticsCampaignChannel = 'email' | 'in_app' | 'webhook';
export type AnalyticsCampaignStatus = 'draft' | 'running' | 'completed' | 'failed';

export interface AnalyticsSegmentCampaign {
  id: number;
  tenantId: number | null;
  segmentId: number;
  segmentName?: string | null;
  name: string;
  channel: AnalyticsCampaignChannel;
  templateId: number | null;
  webhookUrl: string | null;
  status: AnalyticsCampaignStatus;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  lastRunAt: string | null;
  lastError: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

// ─── 行为中心阶段 1：通用事件分析工作台 ────────────────────────────────────────
/** 事件分析可分组维度白名单：禁止任意列/原始 SQL，仅允许以下预置维度 */
export type AnalyticsEventQueryGroupByField =
  | 'date' | 'eventName' | 'pagePath' | 'source' | 'appId' | 'environment'
  | 'browser' | 'os' | 'deviceType' | 'region';

/** 统计指标：事件次数 / 去重用户数（distinctId） */
export type AnalyticsEventQueryMetric = 'events' | 'uv';

export interface AnalyticsEventQueryInput {
  /** 自定义区间起止日（YYYY-MM-DD），优先于 days */
  startDate?: string;
  endDate?: string;
  /** 未提供 startDate/endDate 时，最近 N 天，默认 30 */
  days?: number;
  /** 事件名过滤（最多 20 个，OR 语义） */
  eventNames?: string[];
  source?: AnalyticsEventSource;
  appId?: string;
  environment?: AnalyticsEnvironment;
  deviceType?: AnalyticsDeviceType;
  /** 事件属性过滤（最多 10 条，AND 语义） */
  propertyFilters?: AnalyticsSegmentPropertyFilter[];
  /** 仅统计指定分群内成员 */
  segmentId?: number;
  /** 分组维度（1~2 维，来自白名单） */
  groupBy?: AnalyticsEventQueryGroupByField[];
  metric?: AnalyticsEventQueryMetric;
  /** 结果行数上限，默认 100，最大 200 */
  limit?: number;
}

export interface AnalyticsEventQueryRow {
  dimensions: Record<string, string>;
  value: number;
}

export interface AnalyticsEventQueryResult {
  rows: AnalyticsEventQueryRow[];
  total: number;
  queryMeta: {
    metric: AnalyticsEventQueryMetric;
    groupBy: AnalyticsEventQueryGroupByField[];
    startDate: string;
    endDate: string;
  };
}

// ─── 公告 ──────────────────────────────────────────────────
export type AnnouncementPublishStatus = 'draft' | 'published' | 'recalled' | 'scheduled';
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
  attachments?: AnnouncementAttachment[];
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

// ─── 公告附件 ──────────────────────────────────────────────

export interface AnnouncementAttachment {
  id: number;
  fileId: string;
  file: {
    id: string;
    originalName: string;
    size: number;
    mimeType: string | null;
    extension: string | null;
    url: string;
    directUrl?: string | null;
  };
  sortOrder: number;
  createdAt: string;
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

export interface IdentitySecurityPolicy {
  password: {
    minLength: number;
    requireUppercase: boolean;
    requireSpecialChar: boolean;
    expiryEnabled: boolean;
    expiryDays: number;
  };
  lockout: {
    maxAttempts: number;
    durationMinutes: number;
  };
  mfa: {
    enabled: boolean;
    mode: 'off' | 'optional' | 'required';
    rememberDeviceDays: number;
  };
  risk: {
    enabled: boolean;
    newDeviceAction: 'allow' | 'challenge';
  };
}

export interface MfaFactor {
  id: number;
  type: 'totp' | 'passkey' | 'recovery_code';
  name: string;
  status: 'pending' | 'enabled' | 'disabled';
  verifiedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface TotpSetupResult {
  factorId: number;
  secret: string;
  otpauthUrl: string;
}

export interface TrustedDevice {
  id: number;
  deviceName: string | null;
  ip: string | null;
  userAgent: string | null;
  trustedUntil: string;
  lastSeenAt: string;
  createdAt: string;
}

export interface LoginRiskEvent {
  id: number;
  userId: number | null;
  username: string;
  tenantId: number | null;
  riskLevel: 'low' | 'medium' | 'high';
  reason: string;
  action: 'allow' | 'challenge' | 'block';
  ip: string | null;
  location: string | null;
  userAgent: string | null;
  createdAt: string;
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
  /** 重试间隔，单位：秒 */
  retryInterval: number;
  retryBackoff: boolean;
  monitorTimeout: number | null;
  lastRunAt: string | null;
  lastRunStatus: CronRunStatus | null;
  lastRunMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CronJobStatsPerJob {
  jobId: number;
  jobName: string;
  totalRuns: number;
  successCount: number;
  failCount: number;
  successRate: number;
  avgDurationMs: number | null;
  /** P95 耗时（长尾性能），无已完成执行时为 null */
  p95DurationMs: number | null;
  /** 近 10 次执行状态（旧 → 新） */
  recentResults: CronRunStatus[];
  /** 当前连续失败次数（最近一次成功后归零） */
  consecutiveFails: number;
  lastRunStatus: CronRunStatus | null;
  lastRunAt: string | null;
}

export interface CronJobDailyStat {
  date: string;
  total: number;
  successCount: number;
  failCount: number;
  /** 当日已完成执行的平均耗时 */
  avgDurationMs: number | null;
}

export interface CronJobHourlyStat {
  /** 0-23 */
  hour: number;
  total: number;
  failCount: number;
}

export interface CronJobRecentLog {
  id: number;
  jobId: number;
  jobName: string;
  status: CronRunStatus;
  durationMs: number | null;
  startedAt: string;
  executionCount: number;
  output: string | null;
}

export interface CronJobStats {
  totalJobs: number;
  enabledJobs: number;
  runningJobs: number;
  todayRuns: number;
  todaySuccesses: number;
  todayFails: number;
  todayAvgDurationMs: number | null;
  perJob: CronJobStatsPerJob[];
  dailyStats: CronJobDailyStat[];
  /** 近 7 天按小时执行分布（识别调度高峰） */
  hourlyStats: CronJobHourlyStat[];
  recentLogs: CronJobRecentLog[];
}

// ─── 系统调度 ──────────────────────────────────────────────
export type SystemSchedulerTaskType = 'recurring' | 'queue';
export type SystemSchedulerRunStatus = 'running' | 'success' | 'failed';
export type SystemSchedulerTriggerType = 'schedule' | 'manual' | 'queue';
export type SystemSchedulerAlertChannel = 'inapp' | 'email' | 'webhook';

/** 系统调度任务注册信息基础字段（任务中心与工作流引擎诊断共用） */
export interface SystemSchedulerTaskBase {
  name: string;
  title: string;
  module: string;
  description: string | null;
  taskType: SystemSchedulerTaskType;
  cronExpression: string | null;
  registeredAt: string;
  registeredNodeId: string;
  registeredHostname: string;
  registeredPid: number;
  allowManualRun: boolean;
  enabled: boolean;
  logRetentionDays: number;
  logRetentionRuns: number;
  timeoutMs: number | null;
  failureAlertThreshold: number;
  alertEnabled: boolean;
  alertChannels: SystemSchedulerAlertChannel[];
  alertUserIds: number[];
  alertEmails: string[];
  alertWebhookUrl: string | null;
  manualSingleton: boolean;
  lastRunAt: string | null;
  lastRunStatus: SystemSchedulerRunStatus | null;
  lastRunMessage: string | null;
  lastDurationMs: number | null;
}

export interface SystemSchedulerTask extends SystemSchedulerTaskBase {
  nextRunAt: string | null;
  running: boolean;
  totalRuns: number;
  successCount: number;
  failedCount: number;
  alertCount: number;
  lastAlertAt: string | null;
  lastAlertMessage: string | null;
  queueQueuedCount: number;
  queueActiveCount: number;
  queueDeferredCount: number;
  queueTotalCount: number;
  queueFailedCount: number;
  queueCompletedCount: number;
  queueStateCounts: Record<string, number>;
}

export interface SystemSchedulerRun {
  id: number;
  taskName: string;
  taskTitle: string;
  taskType: SystemSchedulerTaskType;
  module: string;
  triggerType: SystemSchedulerTriggerType;
  status: SystemSchedulerRunStatus;
  jobId: string | null;
  nodeId: string | null;
  nodeHostname: string | null;
  nodePid: number | null;
  triggeredBy: number | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  resultMessage: string | null;
  errorMessage: string | null;
  alertedAt: string | null;
  alertMessage: string | null;
  alertSentAt: string | null;
  alertChannels: SystemSchedulerAlertChannel[];
  alertAckAt: string | null;
  alertAckBy: number | null;
  alertAckByName: string | null;
  alertAckNote: string | null;
  createdAt: string;
}

export interface SystemSchedulerNode {
  nodeId: string;
  hostname: string;
  pid: number;
  version: string | null;
  startedAt: string;
  lastHeartbeatAt: string;
  registeredTaskCount: number;
  runningJobCount: number;
  active: boolean;
  stale: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export interface OnlineUser {
  tokenId: string;
  userId: number;
  username: string;
  nickname: string;
  tenantId?: number | null;
  ip: string;
  location?: string | null;
  browser: string;
  os: string;
  loginAt: string;
}

// ─── 验证码 ──────────────────────────────────────────────
export interface CaptchaResponse {
  captchaId: string;
  captchaImage: string;
}

// ─── WebRTC 音视频通话 ───────────────────────────────────────────────────────
export type RtcCallType = 'audio' | 'video';
export type RtcCallMode = 'p2p' | 'group';

/** 通话参与者基本信息 */
export interface RtcPeerInfo {
  userId: number;
  nickname: string;
  avatar: string | null;
}

/** 与 RTCIceCandidateInit 对齐的可序列化 ICE candidate（避免 DOM 类型依赖） */
export interface RtcIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface RtcInvitePayload {
  callId: string;
  conversationId: number;
  callType: RtcCallType;
  mode: RtcCallMode;
  from: RtcPeerInfo;
  /** 单聊定向邀请的目标用户；群聊为空（广播给会话成员） */
  to?: number;
  /** 会话展示名（来电界面用） */
  conversationName?: string | null;
}

/** ICE 服务器配置（前端 RTCPeerConnection 用） */
export interface RtcIceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface RtcConfig {
  iceServers: RtcIceServerConfig[];
}

// ─── WebSocket 消息类型 ──────────────────────────────────────────────────────
// ─── 任务中心（通用异步任务）────────────────────────────────────────────
export type AsyncTaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

export interface AsyncTask {
  id: number;
  taskType: string;
  title: string;
  module: string | null;
  status: AsyncTaskStatus;
  payload: Record<string, unknown>;
  /** 总量；不可枚举的任务为 null（前端显示不定进度条） */
  totalCount: number | null;
  processedCount: number;
  failedCount: number;
  progressNote: string | null;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  cancelRequested: boolean;
  attempts: number;
  /** 最大执行次数（提交时从类型策略快照；失败自动重试直到用尽） */
  maxAttempts: number;
  /** 下次自动重试时间（退避中）；null = 无待定重试 */
  nextRunAt: string | null;
  createdBy: number | null;
  createdByName: string | null;
  tenantId: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 任务类型元信息（注册默认值 + 运行时策略合并后的生效值） */
export interface AsyncTaskTypeMeta {
  taskType: string;
  title: string;
  module: string;
  description: string | null;
  /** false：同一用户存在未结束任务时禁止重复提交 */
  allowConcurrent: boolean;
  /** false：暂停新提交 */
  enabled: boolean;
  maxAttempts: number;
  /** 重试退避基数（毫秒），实际延迟 = retryDelayMs * 2^(attempts-1) */
  retryDelayMs: number;
  /** 已结束任务保留天数；null = 跟随全局 */
  retentionDays: number | null;
}

export type AsyncTaskItemStatus = 'pending' | 'success' | 'failed' | 'skipped';

/** 任务项明细（行级处理状态） */
export interface AsyncTaskItem {
  id: number;
  taskId: number;
  itemKey: string;
  label: string | null;
  status: AsyncTaskItemStatus;
  message: string | null;
  data: Record<string, unknown> | null;
  attempt: number;
  createdAt: string;
  updatedAt: string;
}

/** 任务中心统计概览 */
export interface AsyncTaskStats {
  total: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  cancelled: number;
  /** 近 24 小时完成任务平均耗时（毫秒）；无数据为 null */
  avgDurationMs: number | null;
  /** 近 7 天每日提交/失败数（date: YYYY-MM-DD） */
  daily: Array<{ date: string; submitted: number; failed: number }>;
}

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
  | { type: 'chat:read'; payload: { conversationId: number; userId: number; readAt: string } }
  | { type: 'chat:member-join'; payload: { conversationId: number; user: { id: number; nickname: string; avatar: string | null } } }
  | { type: 'chat:member-leave'; payload: { conversationId: number; userId: number } }
  | { type: 'chat:group-update'; payload: { conversationId: number; name?: string | null; announcement?: string | null; muteAll?: boolean } }
  | { type: 'chat:member-update'; payload: { conversationId: number } }
  | { type: 'chat:typing'; payload: { conversationId: number; userId: number; nickname: string } }
  | { type: 'chat:reaction'; payload: { conversationId: number; messageId: number; reactions: ChatReactionGroup[] } }
  | { type: 'chat:edit'; payload: ChatMessage }
  | { type: 'chat:vote-update'; payload: { conversationId: number; messageId: number; voteData: ChatVoteData } }
  | { type: 'chat:presence'; payload: { userId: number; online: boolean; lastSeen: string | null } }
  | { type: 'channel:message'; payload: ChannelMessage }
  | { type: 'channel:message-retract'; payload: { channelId: number; messageId: number } }
  | { type: 'channel:cs-message'; payload: { channelId: number } }
  | { type: 'rtc:invite'; payload: RtcInvitePayload }
  | { type: 'rtc:accept'; payload: { callId: string; to: number; from: RtcPeerInfo } }
  | { type: 'rtc:reject'; payload: { callId: string; to: number; reason?: string } }
  | { type: 'rtc:busy'; payload: { callId: string; to: number } }
  | { type: 'rtc:cancel'; payload: { callId: string; conversationId: number; to?: number } }
  | { type: 'rtc:join'; payload: { callId: string; conversationId: number; from: RtcPeerInfo } }
  | { type: 'rtc:room-participants'; payload: { callId: string; participants: RtcPeerInfo[] } }
  | { type: 'rtc:leave'; payload: { callId: string; conversationId: number; from: number; to?: number } }
  | { type: 'rtc:offer'; payload: { callId: string; to: number; from: number; sdp: string } }
  | { type: 'rtc:answer'; payload: { callId: string; to: number; from: number; sdp: string } }
  | { type: 'rtc:ice'; payload: { callId: string; to: number; from: number; candidate: RtcIceCandidateInit } }
  | { type: 'workflow:taskCreated'; payload: { instanceId: number; taskId: number; instanceTitle: string; nodeName: string } }
  | { type: 'workflow:taskFinished'; payload: { instanceId: number; taskId: number; decision: 'approved' | 'rejected' | 'skipped' } }
  | { type: 'workflow:instanceFinished'; payload: { instanceId: number; status: WorkflowInstanceStatus; title: string } }
  | { type: 'payment:success'; payload: { orderNo: string; bizType: string; bizId: string; amount: number } }
  | { type: 'payment:closed'; payload: { orderNo: string; bizType: string; bizId: string } }
  | { type: 'payment:failed'; payload: { orderNo: string; bizType: string; bizId: string } }
  | { type: 'payment:refunded'; payload: { orderNo: string; refundNo: string; refundAmount: number } }
  | { type: 'payment:refund-failed'; payload: { orderNo: string; refundNo: string; refundAmount: number } }
  | { type: 'task:progress'; payload: AsyncTask }
  | { type: 'mp-kf:session-new'; payload: MpKfSession }
  | { type: 'mp-kf:session-update'; payload: MpKfSession }
  | { type: 'mp-kf:session-message'; payload: { sessionId: number; accountId: number; openid: string; direction: MpMessageDirection; msgType: MpMessageType; content: string | null; createdAt: string } }
  | { type: 'analytics:ingest'; payload: { count: number } }
  | { type: 'analytics:config-updated'; payload: { tenantId: number | null } };

/** Terminal WebSocket 消息（独立端点 /api/ws/terminal） */
export type TerminalMessage =
  | { type: 'terminal:input'; data: string }
  | { type: 'terminal:output'; data: string }
  | { type: 'terminal:cwd'; cwd: string }
  | { type: 'terminal:resize'; cols: number; rows: number }
  | { type: 'terminal:close' }
  | { type: 'terminal:exit' }
  | { type: 'terminal:error'; message: string };

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

// ─── 企业身份源 ───────────────────────────────────────────────────────────
export type IdentityProviderType = 'oidc' | 'saml' | 'ldap' | 'ad';
export type IdentityProviderStatus = 'enabled' | 'disabled';

export interface IdentityProviderAttributeMapping {
  subject?: string;
  email?: string;
  username?: string;
  nickname?: string;
  phone?: string;
  department?: string;
}

export interface TenantIdentityProvider {
  id: number;
  tenantId: number | null;
  tenantName?: string | null;
  name: string;
  code: string;
  type: IdentityProviderType;
  status: IdentityProviderStatus;
  issuer?: string | null;
  authorizationEndpoint?: string | null;
  tokenEndpoint?: string | null;
  userinfoEndpoint?: string | null;
  jwksUri?: string | null;
  clientId?: string | null;
  clientSecret?: string;
  scopes: string;
  samlSsoUrl?: string | null;
  samlEntityId?: string | null;
  samlCertificate?: string;
  ldapUrl?: string | null;
  ldapStartTls: boolean;
  ldapSkipTlsVerify: boolean;
  ldapBaseDn?: string | null;
  ldapBindDn?: string | null;
  ldapBindPassword?: string;
  ldapUserFilter?: string | null;
  ldapUserSearchFilter?: string | null;
  ldapSyncFilter?: string | null;
  ldapGroupBaseDn?: string | null;
  ldapGroupFilter?: string | null;
  ldapTimeoutMs: number;
  attributeMapping: IdentityProviderAttributeMapping;
  jitEnabled: boolean;
  defaultRoleIds: number[];
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantIdentityProviderSummary {
  id: number;
  name: string;
  code: string;
  type: IdentityProviderType;
}

export interface EnterpriseIdentityDiscovery {
  tenantCode?: string | null;
  providers: TenantIdentityProviderSummary[];
}

export interface CreateTenantIdentityProviderInput {
  tenantId?: number | null;
  name: string;
  code: string;
  type: IdentityProviderType;
  status?: IdentityProviderStatus;
  issuer?: string | null;
  authorizationEndpoint?: string | null;
  tokenEndpoint?: string | null;
  userinfoEndpoint?: string | null;
  jwksUri?: string | null;
  clientId?: string | null;
  clientSecret?: string;
  scopes?: string;
  samlSsoUrl?: string | null;
  samlEntityId?: string | null;
  samlCertificate?: string;
  ldapUrl?: string | null;
  ldapStartTls?: boolean;
  ldapSkipTlsVerify?: boolean;
  ldapBaseDn?: string | null;
  ldapBindDn?: string | null;
  ldapBindPassword?: string;
  ldapUserFilter?: string | null;
  ldapUserSearchFilter?: string | null;
  ldapSyncFilter?: string | null;
  ldapGroupBaseDn?: string | null;
  ldapGroupFilter?: string | null;
  ldapTimeoutMs?: number;
  attributeMapping?: IdentityProviderAttributeMapping;
  jitEnabled?: boolean;
  defaultRoleIds?: number[];
  remark?: string | null;
}
export type UpdateTenantIdentityProviderInput = Partial<CreateTenantIdentityProviderInput>;

export interface LdapDirectoryUser {
  dn: string;
  subject: string;
  email?: string | null;
  username: string;
  nickname: string;
  phone?: string | null;
  department?: string | null;
}

export interface IdentityProviderConnectionTestResult {
  ok: boolean;
  message: string;
  sampleUsers: LdapDirectoryUser[];
}

export interface IdentityProviderSyncResult {
  logId: number;
  status: 'success' | 'failed' | 'partial';
  total: number;
  created: number;
  linked: number;
  updated: number;
  skipped: number;
  failed: number;
  message: string;
}

export interface IdentityProviderSyncLog {
  id: number;
  providerId: number;
  status: 'success' | 'failed' | 'partial';
  triggerType: string;
  total: number;
  created: number;
  linked: number;
  updated: number;
  skipped: number;
  failed: number;
  message?: string | null;
  errorMessage?: string | null;
  startedAt: string;
  completedAt?: string | null;
  createdAt: string;
}

// ─── 数据库备份 ────────────────────────────────────────────────────────────
export type BackupType = 'pg_dump' | 'drizzle_export';
export type BackupStatus = 'pending' | 'running' | 'success' | 'failed';

export interface DbBackup {
  id: number;
  name: string;
  type: BackupType;
  fileId: string | null;
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
  location?: string | null;
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
export type WorkflowInstanceStatus = 'draft' | 'running' | 'suspended' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled';
export type WorkflowTaskStatus = 'pending' | 'approved' | 'rejected' | 'skipped' | 'waiting';
export type WorkflowTaskExternalDispatchStatus = 'pending' | 'dispatched' | 'failed' | 'fallback';
export type WorkflowNodeType =
  | 'start'
  | 'approve'
  | 'handler'
  | 'end'
  | 'exclusiveGateway'
  | 'parallelGateway'
  | 'inclusiveGateway'
  | 'routeGateway'
  | 'ccNode'
  | 'delay'
  | 'trigger'
  | 'subProcess'
  | 'catchNode';
export type WorkflowConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'contains' | 'isEmpty' | 'isNotEmpty' | 'between' | 'withinDays' | 'beforeDays';

/** 子流程调用模式 */
export type WorkflowSubProcessMode = 'single' | 'multi';
/** 子流程多实例执行方式 */
export type WorkflowSubProcessExecution = 'parallel' | 'serial';
/** 子流程多实例下，某个子实例驳回时的处理策略 */
export type WorkflowSubProcessChildRejectPolicy = 'abort' | 'continue';
/** 子流程子实例发起人来源 */
export type WorkflowSubProcessInitiator = 'parentInitiator' | 'formField' | 'specifiedUser';

// 连线条件表达式（排他网关出边使用）
export interface WorkflowEdgeCondition {
  field: string;         // source='form' 时为表单字段 key；source='starter' 时为 'user'|'dept'|'role'|'post'
  operator: WorkflowConditionOperator;
  value: string | number | boolean;
  /** 条件来源：'form'(默认)=按表单字段；'starter'=按发起人维度（本人/部门/角色/岗位） */
  source?: 'form' | 'starter';
  /** 明细子表聚合：对 field（数组型明细字段）按 aggregateField 列做聚合后再比较 */
  aggregate?: 'sum' | 'count' | 'avg';
  /** 聚合列 key（aggregate 设置时生效；count 可不填） */
  aggregateField?: string;
}

/**
 * 发起人运行时上下文快照，供条件分支「发起人维度」求值。
 * deptIds 含发起人所在部门及其全部上级部门（实现「选父部门即覆盖子部门」语义）。
 */
export interface WorkflowStarterContext {
  userId: number;
  deptIds: number[];
  roleIds: number[];
  postIds: number[];
}

export interface WorkflowConditionGroup {
  type: 'and' | 'or';
  rules: WorkflowEdgeCondition[];
}

/** 审批人来源类型 */
export type WorkflowAssigneeType =
  | 'user'                       // 指定成员
  | 'role'                       // 指定角色
  | 'department'                 // 部门负责人
  | 'userGroup'                  // 用户组
  | 'post'                       // 指定岗位
  | 'deptMember'                 // 指定部门成员（可选包含子部门）
  | 'initiator'                  // 发起人本人
  | 'initiatorLeader'            // 发起人上级（兼容旧字段）
  | 'initiatorDept'              // 发起人部门主管（兼容旧字段）
  | 'startUserDeptResponsible'   // 发起人部门分管领导
  | 'manager'                    // 直属主管（支持多层级 managerLevel）
  | 'multiLevelManager'          // 连续多级上级
  | 'multiLevelDeptHead'         // 连续多级部门负责人
  | 'formUser'                   // 表单内联系人字段
  | 'formDepartment'             // 表单内部门字段
  | 'nodeApprover'               // 节点审批人（关联前序节点）
  | 'initiatorSelect'            // 发起人自选（在发起时已经填到 userIds 中）
  | 'initiatorSelectScope'       // 发起人自选指定范围
  | 'approverSelect'             // 上一节点审批人自选
  | 'decision'                   // 审批人矩阵：决策表输出来源类型+id
  | 'expression';                // 流程表达式

/** 审批方式 */
/**
 * 审批方式（**设计态**意图，存于 flowData 节点配置）。
 * 其中 `random`/`auto` 不是落库的多人审批方式，而是更高层的派发意图：
 * - `auto`：节点自动通过（引擎在创建任务前即生成 approved 任务并续接，等价 approvalType='autoApprove'）
 * - `random`：在候选审批人中随机指派一人（落库时退化为单人 → 运行态方式为 or）
 * 运行态/落库的方式仅 {@link WorkflowResolvedApproveMethod} 四种，二者由
 * `resolveRuntimeApproveMethod()` 在任务展开时显式转换，避免「设计态 6 值 / 运行态 4 值」隐性错配。
 */
export type WorkflowApproveMethod =
  | 'and'         // 会签：所有人通过
  | 'or'          // 或签：任一人通过
  | 'sequential'  // 顺序会签：按顺序逐一通过
  | 'ratio'       // 比例会签：达到指定百分比通过即可
  | 'random'      // 随机挑选一人审批（系统在候选人中随机指派一人）
  | 'auto';       // 自动通过

/**
 * 运行态/落库的多人审批方式（workflow_tasks.approve_method 列与 DB pg enum 一致，4 值）。
 * 设计态的 `random`/`auto` 经 `resolveRuntimeApproveMethod()` 解析后只会落到这 4 个值之一。
 */
export type WorkflowResolvedApproveMethod = Exclude<WorkflowApproveMethod, 'random' | 'auto'>;

export type WorkflowApprovalType = 'manual' | 'autoApprove' | 'autoReject';
export type WorkflowEmptyAssigneeStrategy = 'autoApprove' | 'assignToAdmin' | 'reject' | 'assignTo';
export type WorkflowSameInitiatorStrategy = 'selfApprove' | 'autoSkip' | 'toDirectManager' | 'toDeptHead';
export type WorkflowDeduplicateStrategy = 'autoSkip' | 'repeatApprove';
/** 流程级「自动去重」模式：同一审批人在流程中重复出现时的处理方式 */
export type WorkflowApproverDedupMode =
  | 'none'         // 不自动通过
  | 'all'          // 仅审批一次，后续重复的审批节点均自动通过
  | 'consecutive'; // 仅针对连续审批的节点自动通过
export type WorkflowOperationPermission =
  | 'approve'
  | 'reject'
  | 'comment'
  | 'signature'
  | 'opinionRequired';
export type WorkflowFieldPermission = 'read' | 'edit' | 'hidden';

/** 审批操作按钮 key（运行时支持的任务动作） */
export type WorkflowActionButtonKey =
  | 'approve'    // 通过
  | 'reject'     // 拒绝
  | 'transfer'   // 转办
  | 'delegate'   // 委派
  | 'addSign'    // 加签
  | 'reduceSign' // 减签
  | 'return';    // 退回

/**
 * 附件配置（执行此动作时的附件上传策略）：
 * - hidden：不显示附件上传区（默认）
 * - optional：显示附件上传区，选填
 * - required：显示附件上传区，必填
 */
export type WorkflowActionUploadMode = 'hidden' | 'optional' | 'required';

/** 单个操作按钮的配置 */
export interface WorkflowActionButtonConfig {
  /** 是否启用此按钮 */
  enabled: boolean;
  /** 按钮显示名称（覆盖默认文案） */
  displayName?: string;
  /** 审批意见输入框的标签文案 */
  opinionName?: string;
  /** 跳转配置：拒绝/退回时跳转到目标节点 key（仅 reject / return 生效） */
  jumpToNodeKey?: string;
  /** 附件配置：执行此动作时的附件上传策略（不显示/选填/必填），默认 hidden */
  uploadMode?: WorkflowActionUploadMode;
}

export interface WorkflowTimeoutConfig {
  enabled: boolean;
  duration: number;
  /** 时间单位（默认 hours，向后兼容） */
  unit?: 'minutes' | 'hours' | 'days';
  action: 'remind' | 'autoApprove' | 'autoReject';
  remindCount?: number;
  /**
   * 当 action='remind' 且提醒次数耗尽仍未处理时的升级动作。
   * 'none'(默认)=保持挂起；'autoApprove'/'autoReject'=自动同意/拒绝；
   * 'transferToManager'=转交给当前处理人的上级（按 escalateManagerLevel 取上级层级）。
   */
  escalateAction?: 'none' | 'autoApprove' | 'autoReject' | 'transferToManager';
  /** escalateAction='transferToManager' 时的上级层级（1=直属上级，默认 1） */
  escalateManagerLevel?: number;
  /**
   * transferToManager 找不到上级、部门负责人、管理员时的最终兜底策略。
   * 默认 none = 保持挂起但停止重复扫描；也可配置为自动同意/拒绝。
   */
  escalateFallbackAction?: 'none' | 'autoApprove' | 'autoReject';
}

/** 审批节点被驳回时的处理策略 */
export type WorkflowRejectStrategy =
  | 'terminate'      // 终止流程
  | 'returnPrev'     // 退回上一审批节点
  | 'returnStart'    // 退回发起人（从头开始）
  | 'returnToNode';  // 退回到指定节点（由 rejectToNodeKey 指定）

// 流程节点配置（存在 flowData JSON 中）
export interface WorkflowNodeConfig {
  key: string;       // 节点唯一标识
  type: WorkflowNodeType;
  label: string;     // 显示名称
  assigneeId?: number | null;   // 审批人 ID（approve 节点单人）
  assigneeName?: string | null;
  assigneeIds?: number[] | null;  // 抄送节点 / 多人配置：多个接收人 ID
  assigneeNames?: string[] | null;
  isDefault?: boolean;            // 排他网关：是否默认出口
  /** 审批人来源类型（人工节点） */
  assigneeType?: WorkflowAssigneeType;
  approvalType?: WorkflowApprovalType;
  excludeFromStats?: boolean;
  /** 当 assigneeType = 'user' 时指定的成员 IDs */
  userIds?: number[] | null;
  /** 当 assigneeType = 'role' 时指定的角色 IDs */
  roleIds?: number[] | null;
  /** 当 assigneeType = 'department' 时指定的部门 IDs */
  deptIds?: number[] | null;
  /** 当 assigneeType = 'userGroup' 时指定的用户组 IDs */
  userGroupIds?: number[] | null;
  /** 当 assigneeType = 'post' 时指定的岗位 IDs */
  postIds?: number[] | null;
  postNames?: string[] | null;
  /** 当 assigneeType = 'deptMember' 时指定的部门 IDs（成员为这些部门下的所有用户） */
  deptMemberDeptIds?: number[] | null;
  deptMemberDeptNames?: string[] | null;
  /** deptMember：是否包含子部门成员（默认 false） */
  deptMemberIncludeChildren?: boolean;
  /** 自选范围类型（approverSelect / initiatorSelectScope 时生效） */
  selectScopeType?: 'user' | 'role' | 'department' | 'userGroup';
  /** 自选范围 IDs（与 selectScopeType 对应） */
  selectScopeIds?: number[] | null;
  /** 流程表达式（assigneeType = 'expression' 时生效，返回用户 ID 数组或单值） */
  assigneeExpression?: string;
  /** 审批方式（人工节点，多人时生效） */
  approveMethod?: WorkflowApproveMethod;
  /** 比例会签阈值（百分比 1-100，仅 approveMethod='ratio' 时生效） */
  approveRatio?: number;
  emptyStrategy?: WorkflowEmptyAssigneeStrategy;
  /** @deprecated 使用 emptyAssignToIds 替代，保留以兼容旧数据 */
  emptyAssignTo?: number;
  /** @deprecated 使用 emptyAssignToNames 替代，保留以兼容旧数据 */
  emptyAssignToName?: string;
  /** 空审批人策略=assignTo 时的转交人 ID 列表（多人时会签） */
  emptyAssignToIds?: number[] | null;
  emptyAssignToNames?: string[] | null;
  sameInitiatorStrategy?: WorkflowSameInitiatorStrategy;
  deduplicateStrategy?: WorkflowDeduplicateStrategy;
  operations?: WorkflowOperationPermission[];
  /** 操作按钮配置：每个 key 对应一个按钮的显示/启用/上传/跳转设置 */
  actionButtons?: Partial<Record<WorkflowActionButtonKey, WorkflowActionButtonConfig>>;
  fieldPermissions?: Record<string, WorkflowFieldPermission>;
  timeout?: WorkflowTimeoutConfig;
  /** manager / multiLevelManager 的层级（1 = 直属上级） */
  managerLevel?: number;
  /** 多级模式的终点类型 */
  multiLevelEndType?: 'topLevel' | 'level' | 'role';
  multiLevelEndLevel?: number;
  multiLevelEndRoleId?: number;
  /** formUser 策略：表单中联系人字段的 key */
  formUserField?: string;
  /** formDepartment 策略：表单中部门字段的 key */
  formDeptField?: string;
  formDeptHeadLevel?: number;
  /** nodeApprover 策略：关联前序节点 ID */
  nodeApproverNodeId?: string;
  /** 审批被驳回时的处理策略（仅 approve / handler 节点有意义；缺省视为 terminate） */
  rejectStrategy?: WorkflowRejectStrategy;
  /** 当 rejectStrategy = 'returnToNode' 时，目标节点的 key */
  rejectToNodeKey?: string;
  /** 触发器节点配置（type === 'trigger' 时生效） */
  triggerConfig?: WorkflowTriggerNodeConfig;
  /** 外部审批配置（type === 'approve' 时生效） */
  externalApproval?: WorkflowExternalApprovalConfig;
  onlyOnApprove?: boolean;
  subProcessId?: number;
  subProcessName?: string;
  /** 子流程：父实例字段映射到子实例 formData（key=子字段 key，value 支持 {{form.x}} / {{item}} 模板） */
  subProcessFieldMapping?: Record<string, string>;
  /** 子流程：子实例结束后回填父实例 formData（key=父字段 key，value=子字段 key；多实例时聚合为数组） */
  subProcessOutputMapping?: Record<string, string>;
  /** 子流程：是否等待子实例结束才推进父流程（默认 true） */
  subProcessWaitChild?: boolean;
  /** 子流程：调用模式 —— single 单实例（默认） / multi 多实例（遍历集合字段，逐项发起子流程） */
  subProcessMode?: WorkflowSubProcessMode;
  /** 子流程（multi）：循环数据源 —— 父表单中数组型字段 key（multiSelect/checkbox/tags/userSelect/deptSelect 等） */
  subProcessMultiSource?: string;
  /** 子流程（multi）：多实例执行方式 —— parallel 并行（默认） / serial 串行 */
  subProcessMultiExecution?: WorkflowSubProcessExecution;
  /** 子流程（multi）：将当前循环项的值写入子实例 formData 的字段 key（亦可在映射中用 {{item}} 引用） */
  subProcessMultiItemKey?: string;
  /** 子流程（multi）：某个子实例被驳回时 —— abort 中止整个节点（默认） / continue 忽略并继续其余实例 */
  subProcessOnChildReject?: WorkflowSubProcessChildRejectPolicy;
  /** 子流程：子实例发起人 —— parentInitiator 父流程发起人（默认） / formField 取表单字段 / specifiedUser 指定成员 */
  subProcessInitiator?: WorkflowSubProcessInitiator;
  /** 子流程：subProcessInitiator='formField' 时，存放用户 ID 的父表单字段 key */
  subProcessInitiatorField?: string;
  /** 子流程：subProcessInitiator='specifiedUser' 时，指定的用户 ID */
  subProcessInitiatorUserId?: number;
  /** 子流程：子实例被驳回时是否忽略并按通过继续父流程（默认 false，遵循 rejectStrategy） */
  subProcessIgnoreReject?: boolean;
  isAsync?: boolean;
  /** 延迟节点：延迟类型 */
  delayType?: 'fixed' | 'toDate';
  /** 延迟节点（fixed）：时长数值 */
  delayValue?: number;
  /** 延迟节点（fixed）：时长单位 */
  delayUnit?: 'minute' | 'hour' | 'day';
  /** 延迟节点（toDate）：表单中目标日期字段的 key */
  targetDate?: string;
  /** 节点级事件监听器（独立于定义级订阅，按节点配置在设计器中维护） */
  nodeListeners?: NodeListenerConfig[];
  /** 退回模式（approve/handler）：reexecute 重新执行后续路径（默认）/ backToOrigin 被退回节点通过后直接跳回发起退回的节点 */
  returnMode?: 'reexecute' | 'backToOrigin';
  /** 异常捕获节点（type='catchNode'）的动作 */
  catchAction?: 'toAdmin' | 'notify' | 'terminate';
  /** catchAction='notify' 时额外通知的用户 ID（默认通知发起人+管理员） */
  catchNotifyUserIds?: number[] | null;
  /** routeGateway：决策表 key，运行时进入网关前求值并把输出并入 formData，供出边条件选支 */
  decisionRuleKey?: string | null;
  /** 统一失败策略（外部副作用节点 trigger/subProcess/externalApproval 等；设置后优先于 legacy onFailure/catch 语义） */
  failurePolicy?: WorkflowNodeFailurePolicy;
}

/** 节点监听器触发事件 */
export type NodeListenerEvent = 'onCreate' | 'onApprove' | 'onReject';

/** 节点级事件监听器（webhook） */
export interface NodeListenerConfig {
  type: 'webhook';
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  events: NodeListenerEvent[];
}

/** 触发器节点配置 */
export interface WorkflowTriggerNodeConfig {
  triggerType: WorkflowTriggerType;
  /** 经连接器调用：引用流程连接器 id（设置后由连接器提供基础地址/鉴权/超时/重试/熔断，webhookUrl 退化为相对路径） */
  connectorId?: number;
  /** webhook / callback：目标 URL（设置 connectorId 时作为相对 connector baseUrl 的路径，可空） */
  webhookUrl?: string;
  httpMethod?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  /** 请求体模板（支持 {{form.field}} 占位） */
  bodyTemplate?: string;
  /** updateData / deleteData：操作的表单字段 key 列表 */
  fieldKeys?: string[];
  /** updateData：字段 key → 新值（支持 {{form.field}} 占位） */
  fieldValues?: Record<string, string>;
  /** 失败策略 */
  onFailure?: 'continue' | 'retry' | 'block';
  maxRetries?: number;
  timeoutMs?: number;
  /** callback 类型回调验签模式（默认 hmacSha256；历史流程显式 none 时才不验签） */
  callbackSignMode?: 'none' | 'hmacSha256';
  /** callback 类型 HMAC 密钥（callbackSignMode='hmacSha256' 时必填） */
  callbackSecret?: string;
}

/** 外部审批配置 */
export interface WorkflowExternalApprovalConfig {
  enabled: boolean;
  /** 经连接器调用：引用 http 连接器 id（设置后 url 退化为相对连接器基础地址的路径） */
  connectorId?: number;
  url: string;
  secret: string;
  signMode?: WorkflowEventSignMode;
  timeoutMs?: number;
  /** 调用外部 URL 失败时的兜底策略 */
  fallbackStrategy?: 'manual' | 'autoApprove' | 'autoReject';
}

/**
 * 副作用节点失败时的统一处理动作（Saga / 补偿）。
 * - continue：忽略失败，继续流程
 * - retry：按 maxRetries 重试（复用作业引擎指数退避）
 * - compensate：执行反向 / 补偿动作（撤单、解锁库存等）并生成补偿工单
 * - fallback：跳转备用节点 或 执行备选动作（如通知失败改发短信）
 * - notify：通知管理员并挂起为「待人工修复」补偿工单
 * - terminate：终止流程实例
 */
export type WorkflowNodeFailureAction =
  | 'continue'
  | 'retry'
  | 'compensate'
  | 'fallback'
  | 'notify'
  | 'terminate';

/** 补偿 / 反向 / 兜底动作类型 */
export type WorkflowCompensationActionType =
  | 'none'
  | 'http'
  | 'connector'
  | 'sms'
  | 'email'
  | 'updateData';

/**
 * 补偿 / 反向动作配置（可复用于 compensate 反向动作与 fallback 备选动作）。
 * 占位符统一支持：{{form.字段}} / {{instanceId}} / {{nodeKey}} / {{error}}。
 */
export interface WorkflowCompensationAction {
  type: WorkflowCompensationActionType;
  /** connector：引用流程连接器 id（设置后 url 退化为相对连接器基础地址的路径） */
  connectorId?: number;
  /** http / connector：目标 URL */
  url?: string;
  httpMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  /** 请求体模板（支持占位符） */
  bodyTemplate?: string;
  /** sms / email：模板 id */
  templateId?: number;
  /** sms / email：收件人（手机号 / 邮箱，支持占位符）；留空回退发起人 */
  recipients?: string[];
  /** updateData：要回填 / 回滚的父实例表单字段 key 列表 */
  fieldKeys?: string[];
  /** updateData：字段 key → 新值（支持占位符） */
  fieldValues?: Record<string, string>;
  /** 幂等键模板（默认 compensate:{{instanceId}}:{{nodeKey}}） */
  idempotencyKeyTemplate?: string;
  /** 反向动作自身失败时的最大重试次数（默认 3） */
  maxRetries?: number;
  timeoutMs?: number;
}

/** 节点级统一失败策略（附加在任意外部副作用节点，设置后优先于 legacy 语义） */
export interface WorkflowNodeFailurePolicy {
  action: WorkflowNodeFailureAction;
  /** action='retry' 时最大重试次数 */
  maxRetries?: number;
  /** action='fallback' 时跳转的备用节点 key（与 fallbackAction 二选一） */
  fallbackNodeKey?: string;
  /** action='fallback' 时执行的备选动作（与 fallbackNodeKey 二选一） */
  fallbackAction?: WorkflowCompensationAction;
  /** action='compensate' 时执行的反向动作 */
  compensation?: WorkflowCompensationAction;
  /** action='notify' 时额外通知的用户 ID */
  notifyUserIds?: number[] | null;
  /** 补偿 / 兜底动作完成后是否继续推进流程（默认按 action 语义：compensate/notify 挂起、fallback 继续） */
  continueAfter?: boolean;
  /**
   * Saga 反序回滚：本节点失败时，是否触发对该实例此前所有已成功副作用的反序补偿（默认 false）。
   * 开启后引擎按副作用成功顺序倒序逐个执行各节点配置的 compensation。
   */
  sagaRollback?: boolean;
}

// React Flow 数据结构（flowData JSON）
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  label?: string;
  condition?: WorkflowEdgeCondition | null;  // 排他网关出边的条件
  conditions?: WorkflowConditionGroup[] | null;
  isDefault?: boolean;
  /** 异常边：当 source 节点执行异常时走向 target（通常指向 catchNode） */
  isException?: boolean;
}

/** 业务编号 / 流水号生成规则 */
/** 业务编号日期段格式（均为标准 dayjs 模板串，可直接用于格式化） */
export type WorkflowSerialDateFormat =
  | 'none'
  | 'YYYYMMDD'
  | 'YYYY-MM-DD'
  | 'YYYY/MM/DD'
  | 'YYYYMM'
  | 'YYYY-MM'
  | 'YYYY'
  | 'YY'
  | 'YYYYMMDDHHmmss';

/** 业务编号序号重置周期 */
export type WorkflowSerialResetPeriod = 'never' | 'daily' | 'monthly' | 'yearly';

/** 业务编号配置模式：structured=分项配置（默认）；template=自定义模板 */
export type WorkflowSerialNoMode = 'structured' | 'template';

export interface WorkflowSerialNoConfig {
  enabled: boolean;
  /** 配置模式，缺省视为 structured（向后兼容旧数据） */
  mode?: WorkflowSerialNoMode;
  /** 固定前缀，如 'BX-'（structured 模式） */
  prefix?: string;
  /** 固定后缀（structured 模式） */
  suffix?: string;
  /** 日期段与序号段之间的分隔符（structured 模式），默认空 */
  separator?: string;
  /** 日期段格式（structured 模式，拼接在前缀后） */
  dateFormat?: WorkflowSerialDateFormat;
  /** 序号位数（左补零），默认 4 */
  seqLength?: number;
  /** 序号起始值，默认 1 */
  seqStart?: number;
  /** 序号递增步长，默认 1 */
  seqStep?: number;
  /** 自定义模板串（template 模式），含占位符，如 'BX-{YYYYMMDD}-{SEQ:4}' */
  template?: string;
  /** 序号重置周期 */
  resetPeriod?: WorkflowSerialResetPeriod;
}

export interface WorkflowAdvancedSettings {
  allowWithdraw: boolean;
  allowResubmit: boolean;
  notifyInitiator: boolean;
  /** 流程级「自动去重」模式（同一审批人在流程中重复出现时的处理方式） */
  approverDedupMode?: WorkflowApproverDedupMode;
  /** @deprecated 已被 approverDedupMode 取代，仅用于读取旧数据（true→all / false→none） */
  autoApproveIfSameUser?: boolean;
  /** @deprecated 全局超时处理已废弃，请使用节点级 timeout 配置 */
  timeoutAction?: 'none' | 'auto-approve' | 'auto-reject' | 'notify';
  /** 是否允许在实例下自由评论（默认 true） */
  allowComment?: boolean;
  /** 待办/列表摘要字段（≤3 个表单字段 key，钉钉式卡片摘要） */
  summaryFields?: string[];
  /** 业务编号生成规则 */
  serialNo?: WorkflowSerialNoConfig;
  /** 待办/结果的多渠道通知（站内信始终开启；email/sms 可选） */
  notifyChannels?: WorkflowNotifyChannels;
}

/** 多渠道通知配置 */
export interface WorkflowNotifyChannels {
  /** 邮件通知（向处理人/发起人发送自由内容邮件） */
  email?: boolean;
  /** 短信通知（需指定短信模板 ID） */
  sms?: boolean;
  /** 短信模板 ID（sms=true 时生效） */
  smsTemplateId?: number;
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
  settings?: WorkflowAdvancedSettings;
}

/** 待办/实例列表摘要项（由 summaryFields 配置 + 表单快照解析得到） */
export interface WorkflowInstanceSummaryItem {
  key: string;
  label: string;
  value: string;
}

/** 任务转办明细（转办/委派/管理员改派/离职交接/超时升级留痕） */
export interface WorkflowTaskTransfer {
  id: number;
  fromUserId: number | null;
  fromUserName?: string | null;
  toUserId: number;
  toUserName?: string | null;
  action: 'transfer' | 'delegate' | 'reassign' | 'handover' | 'timeout';
  reason?: string | null;
  operatorName?: string | null;
  createdAt: string;
}

/** 离职交接影响范围预览 */
export interface WorkflowHandoverPreview {
  fromUserName: string;
  pendingTaskCount: number;
  waitingTaskCount: number;
  /** 交接人名下启用中的审批代理规则数 */
  delegationCount: number;
  /** 已发布定义中将其写死为「指定成员」审批人的节点清单（仅提示，需人工调整定义） */
  affectedDefinitions: Array<{ id: number; name: string; nodeNames: string[] }>;
}

/** 离职交接执行结果（逐条改派互不阻断） */
export interface WorkflowHandoverResult {
  taskTotal: number;
  succeeded: number;
  failed: number;
  delegationsDisabled: number;
  results: Array<{ taskId: number; title: string; nodeName: string; success: boolean; message?: string }>;
}

// 表单字段类型
export type WorkflowFormFieldType =
  | 'text'          // 单行文本
  | 'textarea'      // 多行文本
  | 'number'        // 数字
  | 'date'          // 日期
  | 'dateRange'     // 日期区间
  | 'time'          // 时间
  | 'select'        // 单选下拉
  | 'multiSelect'   // 多选下拉
  | 'autoComplete'  // 自动完成（带建议的输入）
  | 'radio'         // 单选框组
  | 'checkbox'      // 复选框组
  | 'switch'        // 开关
  | 'slider'        // 滑块
  | 'tags'          // 标签录入
  | 'colorPicker'   // 颜色选择器
  | 'amount'        // 金额
  | 'phone'         // 手机号
  | 'email'         // 邮箱
  | 'idCard'        // 身份证
  | 'url'           // 网址
  | 'password'      // 密码
  | 'pinCode'       // PIN 码 / 验证码
  | 'rate'          // 评分
  | 'formula'       // 公式计算
  | 'attachment'    // 附件
  | 'image'         // 图片
  | 'region'        // 省市区联动
  | 'signature'     // 手写签名
  | 'richtext'      // 富文本
  | 'userSelect'    // 用户选择器（系统集成）
  | 'deptSelect'    // 部门选择器（系统集成）
  | 'dictSelect'    // 数据字典选择器（系统集成）
  | 'cascader'      // 级联选择（树形选项，自定义层级）
  | 'nps'           // NPS 净推荐值量表（0-10 打分）
  | 'matrix'        // 矩阵量表（多行同一组选项打分/选择）
  | 'location'      // 定位（经纬度 + 地址文本）
  | 'detail'        // 明细/表格
  | 'description'   // 说明文字
  | 'serialNumber'  // 流水号
  | 'relation'      // 关联审批单（引用其他流程实例）
  | 'row'           // 栅格行
  | 'divider'       // 分割线
  | 'group'         // 分组标题
  | 'tabs'          // 标签页容器（多面板切换）
  | 'steps';        // 分步容器（向导式分页）

// 字段显隐条件
export interface WorkflowFieldVisibilityCondition {
  field: string;
  operator: 'eq' | 'neq' | 'in' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'isEmpty' | 'notEmpty';
  value: unknown;
}

/** 规则组条目：单条条件，或嵌套子组（支持「A 且 (B 或 C)」结构） */
export type WorkflowFieldVisibilityRule = WorkflowFieldVisibilityCondition | WorkflowFieldVisibilityRuleGroup;

/** 字段级高级联动：多条件 and/or 组合显隐（rules 可含嵌套子组） */
export interface WorkflowFieldVisibilityRuleGroup {
  logic: 'and' | 'or';
  rules: WorkflowFieldVisibilityRule[];
}

export interface WorkflowFormFieldColumn {
  span: number;          // 1-24 grid span
  fields: WorkflowFormField[];
}

/** 增强选项项（select/multiSelect/radio/checkbox）：支持独立 value/label、颜色、禁用 */
export interface WorkflowFormFieldOptionItem {
  value: string;
  label?: string;        // 显示文案，缺省取 value
  color?: string;        // 选项标签颜色（十六进制，如 #1677ff）
  disabled?: boolean;    // 是否禁用该选项
  imageUrl?: string;     // 选项配图 URL（radio 渲染为图片卡片单选）
}

/** 跨字段比较校验规则：当前字段值与目标字段值比较，不满足时报错 */
export interface WorkflowFormFieldCompareRule {
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
  field: string;         // 目标字段 key
  message?: string;      // 校验失败提示
}

/** tabs/steps 容器的单个面板（标签页 / 步骤） */
export interface WorkflowFormFieldPane {
  title: string;
  fields: WorkflowFormField[];
}

/** 级联选择（cascader）树形选项节点 */
export interface WorkflowFormCascaderNode {
  value: string;
  label?: string;        // 显示文案，缺省取 value
  children?: WorkflowFormCascaderNode[];
}

// 表单字段配置
export interface WorkflowFormField {
  key: string;
  label: string;
  type: WorkflowFormFieldType;
  required?: boolean;
  placeholder?: string;
  helpText?: string;               // 帮助提示（label 下方/旁边的说明）
  options?: string[];              // select/multiSelect 的选项（值列表，作为规范数据源）
  optionItems?: WorkflowFormFieldOptionItem[];  // 增强选项（value/label/颜色/禁用）；与 options 并存，options 始终镜像其 value
  allowOther?: boolean;            // select/radio：允许填写「其他」自定义值
  defaultValue?: unknown;
  visibilityCondition?: WorkflowFieldVisibilityCondition;
  visibilityRules?: WorkflowFieldVisibilityRuleGroup;   // 高级联动：多条件 and/or 显隐
  requiredRules?: WorkflowFieldVisibilityRuleGroup;     // 条件必填：满足规则时必填
  readOnlyRules?: WorkflowFieldVisibilityRuleGroup;     // 条件只读：满足规则时只读
  children?: WorkflowFormField[];  // 明细子字段
  precision?: number;              // 数字/金额精度
  step?: number;                   // 数字步长
  unit?: string;                   // 数字/金额单位（如 "元" "天" "件"）
  currency?: string;               // 金额币种
  amountInWords?: boolean;         // 金额字段：联动显示人民币中文大写
  dateFormat?: string;             // 日期格式
  maxCount?: number;               // 附件/图片限制数
  description?: string;            // 说明文字内容
  serialPrefix?: string;           // 流水号前缀
  rateMax?: number;                // 评分上限（默认 5）
  formula?: string;                // 公式表达式，如 "{amount} * {days}"
  defaultFormula?: string;         // 默认值公式：表单初始渲染时按各字段默认值求值一次（如 "{price}*{qty}"、CONCAT）
  validationFormula?: string;      // 自定义校验公式：求值结果为真通过（如 "{end} > {start}"）
  validationMessage?: string;      // 校验公式失败时的提示文案
  detailSummary?: boolean;         // 明细子列：是否在底部显示合计
  detailColumnWidth?: number;      // 明细子列：列宽（px，缺省自动均分）
  // 校验规则
  minLength?: number;              // 文本最小长度
  maxLength?: number;              // 文本最大长度
  min?: number;                    // 数字/金额最小值
  max?: number;                    // 数字/金额最大值
  pattern?: string;                // 正则表达式
  patternMessage?: string;         // 正则不匹配时的提示
  unique?: boolean;                // 唯一性校验：明细列内行级查重（标量字段则标记，供提交时校验）
  compareRules?: WorkflowFormFieldCompareRule[];  // 跨字段比较校验（number/amount/date）
  dateLimit?: 'none' | 'noPast' | 'noFuture' | 'custom';  // 日期可选范围模式（date/dateRange）
  minDate?: string;                // dateLimit='custom' 时最早可选日期（YYYY-MM-DD）
  maxDate?: string;                // dateLimit='custom' 时最晚可选日期（YYYY-MM-DD）
  accept?: string;                 // 附件/图片允许的文件类型（如 '.pdf,.docx,image/*'）
  maxSize?: number;                // 附件/图片单文件大小上限（MB）
  // 字段联动
  daysFromKey?: string;            // 数字字段：从指定 dateRange 字段自动计算天数
  optionsFrom?: {                  // select/multiSelect：依据父字段值动态生成选项
    sourceKey: string;             // 父字段 key
    mapping: Record<string, string[]>; // 父值 -> 子选项数组
  };
  autoFill?: {                     // select：选中某选项时自动填充其它字段
    targets: string[];             // 受控目标字段 key 列表
    byOption: Record<string, Record<string, string>>; // 选项值 -> { 目标key: 填充值 }（静态映射模式）
    dataSourceFieldMap?: Record<string, string>;      // 目标key -> 数据源记录字段名（远程数据源模式，选中后按记录回填）
  };
  dataSourceId?: number;           // select：选项来自登记的远程数据源（设置后忽略静态 options）
  // Layout fields
  columns?: WorkflowFormFieldColumn[];  // for 'row' type
  panes?: WorkflowFormFieldPane[];      // for 'tabs' / 'steps' type（标签页 / 分步面板）
  title?: string;                       // for 'group' type header
  collapsible?: boolean;                // group：是否可折叠
  defaultCollapsed?: boolean;           // group：默认折叠
  // 响应式列宽（飞书风格自动并排）：24=整行, 12=半列, 8=三分之一, 6=四分之一
  columnSpan?: number;
  // 字段状态
  readOnly?: boolean;                   // 只读（展示但不可编辑）
  hidden?: boolean;                     // 默认隐藏
  // 类型特定
  timeFormat?: string;                  // time 字段时间格式（默认 HH:mm）
  regionLevel?: 'province' | 'city' | 'district';  // region 字段选择层级深度
  // 系统集成选择器（userSelect/deptSelect/dictSelect）
  dictCode?: string;                    // dictSelect：绑定的数据字典 code
  multiple?: boolean;                   // userSelect/deptSelect/dictSelect：是否允许多选
  // relation 关联审批单
  relationDefinitionId?: number;        // 关联的目标流程定义 id（为空则可关联任意流程）
  relationDisplayField?: string;        // 关联记录展示用的表单字段 key（默认显示标题）
  // slider 滑块
  sliderMarks?: boolean;                // 是否显示刻度标记
  // cascader 级联选择
  cascaderOptions?: WorkflowFormCascaderNode[];  // 树形选项
  cascaderChangeOnSelect?: boolean;              // 允许选中任意层级（默认仅叶子可选）
  // nps 量表
  npsMinLabel?: string;                 // 左端说明（如「完全不推荐」）
  npsMaxLabel?: string;                 // 右端说明（如「强烈推荐」）
  // matrix 矩阵量表
  matrixRows?: string[];                // 行（题目）列表
  matrixColumns?: string[];             // 列（选项）列表，各行共用
  // colorPicker 颜色选择器
  alpha?: boolean;                      // 是否支持透明度（rgba）
  // 字段级标签设置（覆盖表单级 settings）
  labelPosition?: 'top' | 'left' | 'inset';   // 字段级标签位置
  labelAlign?: 'left' | 'right';               // 字段级标签对齐
  labelWidth?: number;                          // 字段级标签宽度
}

// ─── 表单库 ─────────────────────────────────────────────────────────────────

/** 表单级设置 */
export interface WorkflowFormSettings {
  description?: string;                 // 表单顶部说明
  submitButtonText?: string;            // 提交按钮文案
  labelPosition?: 'top' | 'left' | 'inset';  // 标签位置
  labelAlign?: 'left' | 'right';        // 标签对齐方式
  labelWidth?: number;                  // 左侧标签宽度（labelPosition='left'/'inset' 时）
}

/** 表单 schema：字段 + 表单级设置 */
export interface WorkflowFormSchema {
  fields: WorkflowFormField[];
  settings?: WorkflowFormSettings;
}

export type WorkflowFormStatus = 'enabled' | 'disabled';

/** 表单远程数据源（登记式外部接口，供 select 字段拉取选项） */
export interface WorkflowDataSource {
  id: number;
  name: string;
  method: 'GET' | 'POST';
  url: string;
  /** 附加请求头（服务端 AES-256-GCM 加密存储；API 返回时值统一脱敏为 ******，更新时传 ****** 表示沿用旧值） */
  headers?: Record<string, string> | null;
  itemsPath?: string | null;
  valueField: string;
  labelField: string;
  keywordParam?: string | null;
  status: 'enabled' | 'disabled';
  remark?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 远程数据源返回的选项 */
export interface WorkflowDataSourceOption {
  value: string;
  label: string;
}

// ── 流程连接器 ──
export type WorkflowConnectorType = 'http' | 'webhook' | 'email' | 'sms' | 'wecom' | 'dingtalk' | 'feishu' | 'mq' | 'database';

export type WorkflowConnectorBreakerState = 'closed' | 'open' | 'halfOpen';

/** HTTP 连接器调用配置（存于 connector.config） */
export interface WorkflowConnectorHttpConfig {
  baseUrl: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  query?: Record<string, string>;
  contentType?: 'json' | 'form';
  authType?: 'none' | 'bearer' | 'basic' | 'apiKey';
  /** apiKey 模式：放入请求头的键名（默认 X-API-Key） */
  apiKeyHeader?: string;
}

/** 连接器凭据明文（落库前整体 AES 加密，绝不回传） */
export interface WorkflowConnectorCredentials {
  token?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

export interface WorkflowConnector {
  id: number;
  name: string;
  code: string;
  description: string | null;
  type: WorkflowConnectorType;
  config: Record<string, unknown>;
  timeoutMs: number;
  retryMax: number;
  circuitBreakerEnabled: boolean;
  failureThreshold: number;
  cooldownSec: number;
  /** 限流开关（与熔断并列） */
  rateLimitEnabled: boolean;
  /** 限流：滑动时间窗（秒） */
  rateLimitWindowSec: number;
  /** 限流：窗口内最大调用次数（<=0 不限制） */
  rateLimitMax: number;
  status: 'enabled' | 'disabled';
  /** 是否已配置凭据（脱敏，不回传明文） */
  hasCredentials: boolean;
  /** 熔断实时状态（来自 Redis） */
  breakerState: WorkflowConnectorBreakerState;
  tenantId: number | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 连接器调用 / 测试结果 */
export interface WorkflowConnectorInvokeResult {
  ok: boolean;
  /** HTTP 状态码（网络层失败为 null） */
  status: number | null;
  durationMs: number;
  /** 截断的响应体（测试用） */
  responseSnippet: string | null;
  error: string | null;
}

export type WorkflowConnectorInvocationSource = 'test' | 'trigger' | 'external' | 'webhook' | 'manual';

/** 连接器调用统计（按时间窗聚合） */
export interface WorkflowConnectorStats {
  connectorId: number;
  windowDays: number;
  total: number;
  success: number;
  failed: number;
  /** 成功率 0~1 */
  successRate: number;
  avgDurationMs: number;
}

/** 连接器单次调用记录 */
export interface WorkflowConnectorInvocation {
  id: number;
  source: WorkflowConnectorInvocationSource;
  ok: boolean;
  status: number | null;
  durationMs: number;
  requestUrl: string | null;
  error: string | null;
  createdAt: string;
}

/** 表单库实体 */
export interface WorkflowForm {
  id: number;
  name: string;
  code: string | null;
  description: string | null;
  categoryId: number | null;
  categoryName?: string | null;
  schema: WorkflowFormSchema | null;
  status: WorkflowFormStatus;
  /** 乐观锁版本号（每次更新 +1，更新时回传 expectedRevision 做并发冲突检测） */
  revision: number;
  /** 被多少个流程定义引用（列表场景返回） */
  usageCount?: number;
  tenantId: number | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 自定义业务表单暴露给流程的变量声明（驱动条件分支 / 按字段指定审批人） */
export interface WorkflowCustomFormVariable {
  /** 前端渲染用唯一标识（不持久化） */
  id?: string;
  /** 变量 key（业务页提交时写入 formData 的字段名） */
  key: string;
  /** 显示名称 */
  label: string;
  /** 变量类型 */
  type: 'string' | 'number' | 'boolean' | 'date' | 'user' | 'dept';
}

/** 自定义业务表单 / 业务系统主导流程配置（formType='custom' 或 'external' 时有效） */
export interface WorkflowCustomFormConfig {
  /** 创建/填写页组件路径（相对 packages/web/src/pages，如 'biz/leave/LeaveForm'；external 可为空） */
  createComponent: string;
  /** 查看页组件路径，缺省时复用 createComponent 以只读模式渲染 */
  viewComponent?: string | null;
  /** 多页签图标（lucide 图标名，预留给整页打开时使用） */
  icon?: string | null;
  /** 暴露给流程的变量声明 */
  variables?: WorkflowCustomFormVariable[];
}

/** 实例发起时冻结的表单快照；兼容旧数据中直接存 WorkflowFormField[] 的形态 */
export interface WorkflowInstanceFormSnapshot {
  formType?: WorkflowFormType;
  formId?: number | null;
  formName?: string | null;
  fields: WorkflowFormField[];
  settings?: WorkflowFormSettings | null;
  customForm?: WorkflowCustomFormConfig | null;
}

/** 实例发起时冻结的流程定义快照（详情渲染优先使用，避免定义后续修改影响历史实例） */
export interface WorkflowDefinitionSnapshot {
  id: number;
  name: string;
  description: string | null;
  categoryId: number | null;
  categoryName?: string | null;
  categoryColor?: string | null;
  categoryIcon?: string | null;
  flowData: WorkflowFlowData | null;
  formId: number | null;
  formName?: string | null;
  formFields?: WorkflowFormField[] | null;
  formSettings?: WorkflowFormSettings | null;
  formType: WorkflowFormType;
  customForm: WorkflowCustomFormConfig | null;
  status?: WorkflowDefinitionStatus;
  version?: number;
  tenantId?: number | null;
}

export interface WorkflowDefinition {
  id: number;
  name: string;
  description: string | null;
  categoryId: number | null;
  /** 发起人范围：all=全员, users=指定用户, departments=指定部门, roles=指定角色 */
  initiatorScopeType: 'all' | 'users' | 'departments' | 'roles';
  /** 发起人范围 ID 列表（当 initiatorScopeType !== 'all' 时生效） */
  initiatorScopeIds: number[] | null;
  categoryName?: string | null;
  categoryColor?: string | null;
  categoryIcon?: string | null;
  flowData: WorkflowFlowData | null;
  /** 绑定的表单 ID（实时引用最新表单） */
  formId: number | null;
  formName?: string | null;
  /** 由 formId 解析得到的表单字段（派生字段，设计/发起时使用最新表单内容） */
  formFields: WorkflowFormField[] | null;
  /** 由 formId 解析得到的表单级设置（派生字段） */
  formSettings?: WorkflowFormSettings | null;
  /** 表单类型：designer=表单库，custom=自定义业务页面，external=业务系统主导 */
  formType: WorkflowFormType;
  /** 自定义业务表单配置（formType='custom' 或 'external' 时有效） */
  customForm: WorkflowCustomFormConfig | null;
  status: WorkflowDefinitionStatus;
  version: number;
  tenantId: number | null;
  createdBy: number | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowCategory {
  id: number;
  name: string;
  code: string | null;
  icon: string | null;
  color: string | null;
  sort: number;
  description: string | null;
  tenantId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowDefinitionVersion {
  id: number;
  definitionId: number;
  version: number;
  name: string;
  description: string | null;
  flowData: WorkflowFlowData | null;
  formId: number | null;
  formName?: string | null;
  formFields: WorkflowFormField[] | null;
  formType: WorkflowFormType;
  customForm: WorkflowCustomFormConfig | null;
  publishedAt: string;
  publishedBy: number | null;
  publishedByName?: string | null;
  tenantId: number | null;
}

export type WorkflowAutomationTrigger = 'approved' | 'rejected' | 'withdrawn' | 'created';

export interface WorkflowAutomationActionStartWorkflow {
  type: 'startWorkflow';
  definitionId: number;
  titleTemplate?: string;
  formMapping?: Record<string, string>;
}

export interface WorkflowAutomationActionSendMessage {
  type: 'sendMessage';
  title: string;
  content: string;
  messageType?: 'info' | 'success' | 'warning' | 'error';
  recipients?: 'initiator' | { userIds: number[] };
  buttons?: Array<{ text: string; url: string }>;
}

export interface WorkflowAutomationActionWebhook {
  type: 'webhook';
  url: string;
  method?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  bodyTemplate?: string;
}

export interface WorkflowAutomationActionUpdateField {
  type: 'updateField';
  fields: Record<string, string>;
}

export type WorkflowAutomationAction =
  | WorkflowAutomationActionStartWorkflow
  | WorkflowAutomationActionSendMessage
  | WorkflowAutomationActionWebhook
  | WorkflowAutomationActionUpdateField;

export interface WorkflowAutomation {
  id: number;
  definitionId: number;
  definitionName?: string | null;
  name: string;
  trigger: WorkflowAutomationTrigger;
  actions: WorkflowAutomationAction[];
  status: 'enabled' | 'disabled';
  sort: number;
  tenantId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 流程定时发起规则 */
export interface WorkflowSchedule {
  id: number;
  definitionId: number;
  definitionName?: string | null;
  name: string;
  cronExpression: string;
  /** IANA 时区（如 Asia/Shanghai）；null = 默认 Asia/Shanghai */
  timezone: string | null;
  initiatorId: number;
  initiatorName?: string | null;
  titleTemplate: string | null;
  formData: Record<string, unknown> | null;
  status: 'enabled' | 'disabled';
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunMessage: string | null;
  nextRunAt: string | null;
  tenantId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 列表保存视图 */
export interface WorkflowSavedView {
  id: number;
  userId: number;
  pageKey: string;
  name: string;
  filters: Record<string, unknown>;
  isDefault: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

/** 提交前审批链路预览节点 */
export interface WorkflowApproverPreviewNode {
  nodeKey: string;
  nodeName: string;
  nodeType: WorkflowNodeType | string;
  /** 解析出的处理人（已转换为真实姓名） */
  approvers: Array<{ id: number; name: string }>;
  /** 发起人/审批人自选节点的可选候选人 */
  selectableApprovers?: Array<{ id: number; name: string }>;
  /** 自选审批人选择是否必填 */
  selectionRequired?: boolean;
  /** 多人审批方式（and/or/sequential/ratio） */
  approveMethod?: string | null;
  /** 所在分支标签（条件/并行分支时） */
  branchLabel?: string | null;
  /** 审批人为空（需按节点空处理策略兜底） */
  empty?: boolean;
}

/**
 * 审批时「下一节点审批人自选」的候选分组：
 * 每个紧邻的下一 approverSelect 节点一组，候选人已按节点配置的范围（成员/角色/部门/用户组）在服务端解析收窄。
 */
export interface WorkflowSelectableNextApproverGroup {
  /** approverSelect 节点 key */
  nodeKey: string;
  /** 节点显示名 */
  label: string;
  /** 该节点可供当前审批人挑选的候选人（已按 selectScope 收窄） */
  selectableApprovers: Array<{ id: number; name: string }>;
}

/** 流程仿真中对指定节点预设的处理动作 */
export interface WorkflowSimulationDecision {
  nodeKey: string;
  action: 'approve' | 'reject' | 'skip' | 'wait';
  assigneeId?: number;
  reason?: string;
  formPatch?: Record<string, unknown>;
}

/** 已保存的仿真用例（测试场景：表单数据 + 决策 + 发起人，按定义归档，供回归仿真复用） */
export interface WorkflowSimulationCase {
  id: number;
  definitionId: number;
  name: string;
  starterUserId: number | null;
  formData: Record<string, unknown>;
  decisions: WorkflowSimulationDecision[];
  tenantId: number | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 流程仿真选项 */
export interface WorkflowSimulationOptions {
  maxSteps?: number;
  mockDelay?: boolean;
  mockTrigger?: boolean;
  expandSubProcess?: boolean;
}

export type WorkflowSimulationResultStatus = 'finished' | 'rejected' | 'waiting' | 'blocked' | 'invalid' | 'stepLimit';
export type WorkflowSimulationTimelineStatus = 'entered' | 'waiting' | 'approved' | 'rejected' | 'autoApproved' | 'skipped' | 'blocked';
export type WorkflowSimulationNodeStateStatus = 'pending' | 'active' | 'done' | 'skipped' | 'error';
export type WorkflowSimulationHealthLevel = 'error' | 'warning' | 'info';

/** 流程仿真时间线节点 */
export interface WorkflowSimulationTimelineItem {
  step: number;
  nodeKey: string;
  nodeName: string;
  nodeType: WorkflowNodeType | string;
  status: WorkflowSimulationTimelineStatus;
  assignees?: Array<{ id: number; name: string }>;
  decision?: 'approve' | 'reject' | 'skip' | 'wait' | 'auto';
  reason?: string;
  detail?: string;
  nextNodeKeys?: string[];
  /** 该步骤预估耗时（分钟），自动/瞬时节点为 0 */
  estimatedMinutes?: number;
}

/** 流程仿真连线命中结果 */
export interface WorkflowSimulationEdgeResult {
  edgeId: string;
  source: string;
  target: string;
  sourceKey?: string;
  targetKey?: string;
  label?: string | null;
  taken: boolean;
  reason?: string;
  conditionMatched?: boolean | null;
  conditionSummary?: string | null;
  actualValue?: string | null;
}

/** 流程仿真节点状态 */
export interface WorkflowSimulationNodeState {
  status: WorkflowSimulationNodeStateStatus;
  message?: string;
}

/** 流程仿真体检问题 */
export interface WorkflowSimulationHealthIssue {
  level: WorkflowSimulationHealthLevel;
  scope: 'flow' | 'node' | 'edge';
  nodeKey?: string;
  edgeId?: string;
  message: string;
  suggestion?: string;
}

/** 流程仿真阻塞点（人工审批 / 延时 / 外部回调 / 子流程 / 死锁） */
export interface WorkflowSimulationBlockingPoint {
  nodeKey: string;
  nodeName: string;
  kind: 'humanTask' | 'delay' | 'external' | 'subProcess' | 'blocked';
  reason: string;
  /** 该阻塞点预估等待时长（分钟） */
  estimatedMinutes: number;
}

/** 流程仿真结果 */
export interface WorkflowSimulationResult {
  valid: boolean;
  warnings: string[];
  result: WorkflowSimulationResultStatus;
  timeline: WorkflowSimulationTimelineItem[];
  edgeResults: WorkflowSimulationEdgeResult[];
  nodeStates: Record<string, WorkflowSimulationNodeState>;
  healthIssues: WorkflowSimulationHealthIssue[];
  pathSignature: string[];
  /** 路径预估总耗时（分钟，各步骤累加） */
  estimatedDurationMinutes: number;
  /** 阻塞点汇总 */
  blockingPoints: WorkflowSimulationBlockingPoint[];
}

/** 关联审批单可选项（relation 字段检索结果） */
export interface WorkflowRelationOption {
  instanceId: number;
  title: string;
  serialNo: string | null;
  definitionName: string | null;
  status: WorkflowInstanceStatus;
  createdAt: string;
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
  /** 手写签名（data URL / 图片地址） */
  signature?: string | null;
  /** 审批附件（审批通过时上传，{name,url,size}[]） */
  attachments?: Array<{ name: string; url: string; size?: number }>;
  /** 该任务所属节点是否要求手写签名（派生字段，由节点 operations 计算） */
  signatureRequired?: boolean;
  actionAt: string | null;
  /** 任务原始处理人（创建时快照，转办/委派不会修改） */
  originalAssigneeId?: number | null;
  /** 转办明细（详情场景填充：转办/委派/改派/交接/超时升级留痕，含双方与操作人姓名） */
  transfers?: WorkflowTaskTransfer[] | null;
  /** 委派来源（仅委派期间设置；回执任务为 null） */
  delegatedFromId?: number | null;
  /** 外部审批回调 ID（task.status='waiting' + externalApproval 启用时生效；派发/恢复由 workflow_jobs 接管） */
  externalCallbackId?: string | null;
  /** 当前节点配置中的操作按钮设置（仅审批节点） */
  actionButtons?: Partial<Record<WorkflowActionButtonKey, WorkflowActionButtonConfig>> | null;
  createdAt: string;
}

export interface WorkflowTaskUrge {
  id: number;
  taskId: number;
  instanceId: number;
  urgerId: number | null;
  urgerName: string | null;
  message: string | null;
  createdAt: string;
}

export type WorkflowInstancePriority = 'low' | 'normal' | 'high' | 'urgent';

export interface WorkflowInstance {
  id: number;
  definitionId: number;
  definitionName?: string;
  categoryId?: number | null;
  categoryName?: string | null;
  title: string;
  /** 业务编号/流水号（按流程定义编号规则在发起时生成） */
  serialNo?: string | null;
  /** 加急/优先级 */
  priority?: WorkflowInstancePriority;
  /** 是否允许发起人撤回（来自流程定义高级设置，运行中申请用于控制撤回按钮） */
  allowWithdraw?: boolean;
  /** 是否允许驳回后重新提交（来自流程定义高级设置，列表/详情用于控制按钮） */
  allowResubmit?: boolean;
  /** 是否允许流程中评论（来自流程定义高级设置） */
  allowComment?: boolean;
  formData: Record<string, unknown> | null;
  /** 发起时的表单结构快照（冻结历史，渲染只读/审批表单时使用） */
  formSnapshot?: WorkflowFormField[] | WorkflowInstanceFormSnapshot | null;
  /** 发起时的流程定义快照（详情场景返回） */
  definitionSnapshot?: WorkflowDefinitionSnapshot | null;
  status: WorkflowInstanceStatus;
  currentNodeKey: string | null;
  /** 当前所有活动节点 key（并行分支可能有多个；未提供时兼容 currentNodeKey） */
  currentNodeKeys?: string[];
  /** 当前所处节点名称（由流程快照解析，仅列表/监控场景填充） */
  currentNodeName?: string | null;
  /** 当前所有活动节点名称（并行分支可能有多个） */
  currentNodeNames?: string[];
  initiatorId: number;
  initiatorName?: string | null;
  initiatorAvatar?: string | null;
  tenantId: number | null;
  /** 子流程：父实例 ID（本实例由父实例 subProcess 节点发起时填充） */
  parentInstanceId?: number | null;
  /** 子流程：父实例中触发本子流程的任务 ID */
  parentTaskId?: number | null;
  /** 子流程多实例：父任务下循环项幂等 key */
  parentTaskItemKey?: string | null;
  /** 子流程多实例：父任务下循环项序号（0-based） */
  parentTaskItemIndex?: number | null;
  /** 业务实体接入：业务类型（如 biz_leave），普通流程为空 */
  bizType?: string | null;
  /** 业务实体接入：业务记录主键（与 bizType 组成 businessKey） */
  bizId?: string | null;
  /** 挂起时间（status=suspended 时有值） */
  suspendedAt?: string | null;
  /** 挂起原因 */
  suspendReason?: string | null;
  /** 子流程：本实例发起的子实例摘要列表（仅详情场景填充） */
  childInstances?: WorkflowChildInstanceSummary[] | null;
  tasks?: WorkflowTask[];
  /** 沟通评论（仅详情场景填充） */
  comments?: WorkflowComment[];
  /** 协办意见（仅详情场景填充） */
  consults?: WorkflowTaskConsult[];
  /** 已办视图：我在该实例处理过的任务状态（approved/rejected/...） */
  myTaskStatus?: WorkflowTaskStatus | null;
  /** 已办视图：我处理的时间 */
  myActionAt?: string | null;
  /** 抄送视图：抄送给我的任务 ID */
  ccTaskId?: number | null;
  /** 抄送视图：已读时间（null=未读） */
  ccReadAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 流程评论 / 沟通时间线条目 */
export interface WorkflowComment {
  id: number;
  instanceId: number;
  taskId?: number | null;
  /** 回复引用的父评论 ID（一层引用） */
  parentId?: number | null;
  /** 父评论摘要（展示引用块用：作者 + 内容截断） */
  parentSummary?: { userName: string | null; content: string } | null;
  userId: number;
  userName?: string | null;
  userAvatar?: string | null;
  content: string;
  /** @ 提及的用户 ID */
  mentions: number[];
  /** @ 提及的用户名（展示用） */
  mentionNames?: string[] | null;
  attachments: Array<{ name: string; url: string; size?: number }>;
  createdAt: string;
}

/** 审批意见常用语 */
export interface WorkflowQuickPhrase {
  id: number;
  /** null = 系统预置（所有人可见） */
  userId: number | null;
  content: string;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

/** 流程模板 */
export interface WorkflowTemplate {
  id: number;
  name: string;
  code: string | null;
  description: string | null;
  categoryName: string | null;
  icon: string | null;
  color: string | null;
  flowData: WorkflowFlowData | null;
  formSchema: WorkflowFormSchema | null;
  sort: number;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 审批协办状态 */
export type WorkflowTaskConsultStatus = 'pending' | 'replied' | 'revoked';

/** 审批协办 / 邀请处理意见 */
export interface WorkflowTaskConsult {
  id: number;
  taskId: number;
  instanceId: number;
  nodeName?: string | null;
  inviterId: number;
  inviterName?: string | null;
  consulteeId: number;
  consulteeName?: string | null;
  consulteeAvatar?: string | null;
  question: string | null;
  opinion: string | null;
  status: WorkflowTaskConsultStatus;
  repliedAt?: string | null;
  createdAt: string;
}

/** 审批代理 / 离岗委托规则 */
export interface WorkflowDelegation {
  id: number;
  principalId: number;
  principalName?: string | null;
  delegateId: number;
  delegateName?: string | null;
  /** null = 对全部流程生效 */
  definitionId: number | null;
  definitionName?: string | null;
  reason?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  enabled: boolean;
  /** 当前是否处于生效区间（由后端计算） */
  active?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── 流程数据分析 ─────────────────────────────────────────────────────────────
export interface WorkflowAnalyticsStatusCount {
  status: WorkflowInstanceStatus;
  count: number;
}

export interface WorkflowAnalyticsDefinitionStat {
  definitionId: number;
  definitionName: string;
  total: number;
  running: number;
  approved: number;
  rejected: number;
  /** 已完结实例的平均耗时（秒） */
  avgDurationSec: number | null;
}

export interface WorkflowAnalyticsNodeBottleneck {
  definitionId: number;
  definitionName: string;
  nodeKey: string;
  nodeName: string;
  /** 该节点已完成任务的平均处理时长（秒） */
  avgHandleSec: number | null;
  /** 当前仍挂起的任务数 */
  pendingCount: number;
  /** 已完成任务数 */
  doneCount: number;
}

export interface WorkflowAnalyticsApproverWorkload {
  userId: number;
  userName: string;
  pendingCount: number;
  /** 已处理任务数（已通过 + 已驳回） */
  handledCount: number;
  /** 最早待办的等待时长（秒） */
  oldestPendingSec: number | null;
}

export interface WorkflowAnalyticsTrendPoint {
  date: string;
  created: number;
  completed: number;
  /** 当日积压（运行中实例估算，按 created-completed 累计回推） */
  pending?: number;
}

export interface WorkflowAnalytics {
  statusCounts: WorkflowAnalyticsStatusCount[];
  total: number;
  /** 全部已完结实例平均耗时（秒） */
  avgDurationSec: number | null;
  /** 当前挂起任务总数 */
  pendingTaskCount: number;
  /** 已超时（timeoutAt < now）仍挂起的任务数 */
  overdueTaskCount: number;
  /** 即将超时（24h 内到期）的挂起任务数 */
  dueSoonTaskCount: number;
  /** 近 7 天发起数 */
  recentCreated: number;
  /** 驳回率：已驳回实例 / (已通过 + 已驳回)，0-1，无已决实例时为 null */
  rejectionRate: number | null;
  /** 超时率：已超时待办 / 当前待办，0-1，无待办时为 null */
  timeoutRate: number | null;
  definitionStats: WorkflowAnalyticsDefinitionStat[];
  nodeBottlenecks: WorkflowAnalyticsNodeBottleneck[];
  approverWorkloads: WorkflowAnalyticsApproverWorkload[];
  automation: {
    jobsTotal: number; jobsFailed: number; jobsDead: number; jobFailRate: number | null;
    webhookTotal: number; webhookSuccessRate: number | null;
    subprocessTotal: number; subprocessFailRate: number | null;
  };
  trend: WorkflowAnalyticsTrendPoint[];
}

/** 超时待办预警条目 */
export interface WorkflowOverdueTask {
  taskId: number;
  instanceId: number;
  instanceTitle: string;
  serialNo?: string | null;
  definitionName: string;
  nodeName: string;
  assigneeId: number | null;
  assigneeName: string | null;
  timeoutAt: string;
  /** 已超时秒数（正数=已超时；负数=距到期剩余） */
  overdueSec: number;
}

/** 批量审批结果（逐条返回成功/失败） */
export interface WorkflowBatchActionResult {
  taskId: number;
  success: boolean;
  message?: string;
}

/** 实例级批量操作结果（批量撤回/批量催办） */
export interface WorkflowInstanceBatchActionResult {
  instanceId: number;
  success: boolean;
  message?: string;
}

/** 批量恢复结果汇总（批量推进卡死实例等运营恢复动作） */
export interface WorkflowRecoveryBatchResult {
  /** 命中的候选数量 */
  total: number;
  /** 成功恢复数量 */
  success: number;
  /** 失败数量（按候选逐个隔离，失败不影响其它） */
  failed: number;
}

/** 子流程子实例摘要（用于父实例详情展示与跳转） */
export interface WorkflowChildInstanceSummary {
  id: number;
  title: string;
  status: WorkflowInstanceStatus;
  /** 触发该子实例的父任务节点 key */
  parentTaskNodeKey?: string | null;
  createdAt: string;
}

// ─── 流程事件总线 ─────────────────────────────────────────────────────────────
export type WorkflowEventType =
  | 'instance.created'
  | 'instance.approved'
  | 'instance.rejected'
  | 'instance.withdrawn'
  | 'node.entered'
  | 'node.left'
  | 'task.created'
  | 'task.assigned'
  | 'task.approved'
  | 'task.rejected'
  | 'task.skipped'
  | 'task.transferred'
  | 'task.addSigned'
  | 'task.reduceSigned'
  | 'task.urged';

export interface WorkflowEventActor {
  userId: number;
  name?: string | null;
}

export interface WorkflowEventBase {
  /** 唯一事件 ID（uuid），用于外部系统幂等 */
  eventId: string;
  type: WorkflowEventType;
  /** ISO 时间戳（YYYY-MM-DD HH:mm:ss） */
  occurredAt: string;
  instanceId: number;
  definitionId: number;
  tenantId: number | null;
  actor?: WorkflowEventActor;
}

export interface WorkflowInstanceEventPayload extends WorkflowEventBase {
  type: 'instance.created' | 'instance.approved' | 'instance.rejected' | 'instance.withdrawn';
  instance: WorkflowInstance;
}

export interface WorkflowNodeEventPayload extends WorkflowEventBase {
  type: 'node.entered' | 'node.left';
  nodeKey: string;
  nodeName: string;
  nodeType: WorkflowNodeType | null;
}

export interface WorkflowTaskEventPayload extends WorkflowEventBase {
  type: 'task.created' | 'task.assigned' | 'task.approved' | 'task.rejected' | 'task.skipped' | 'task.transferred' | 'task.addSigned' | 'task.reduceSigned' | 'task.urged';
  task: WorkflowTask;
  comment?: string | null;
}

export type WorkflowEvent =
  | WorkflowInstanceEventPayload
  | WorkflowNodeEventPayload
  | WorkflowTaskEventPayload;

// ─── 业务接入示例：请假（业务模块自有实体，通过 businessKey 关联工作流）────────────
export type BizLeaveStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface BizLeave {
  id: number;
  /** 请假类型：annual=年假, sick=病假, personal=事假, marriage=婚假, other=其他 */
  leaveType: string;
  /** 开始日期 YYYY-MM-DD */
  startDate: string;
  /** 结束日期 YYYY-MM-DD */
  endDate: string;
  days: number;
  reason: string | null;
  status: BizLeaveStatus;
  /** 关联的工作流实例 ID（提交审批后回填） */
  workflowInstanceId: number | null;
  /** 冗余的工作流状态，便于列表展示 */
  workflowStatus: WorkflowInstanceStatus | null;
  /** 申请人（= createdBy） */
  applicantId: number | null;
  applicantName?: string | null;
  tenantId: number | null;
  createdAt: string;
  updatedAt: string;
}

// ─── 业务接入示例：支付接入（演示业务模块如何对接支付中心）─────────────────────
export type BizPayDemoStatus = 'pending' | 'paying' | 'paid' | 'closed';

export interface BizPayDemo {
  id: number;
  /** 示例事项 / 商品名称 */
  subject: string;
  /** 金额（分） */
  amount: number;
  /** 发起支付时记录的支付方式（下单前为 null） */
  payMethod: PaymentMethod | null;
  status: BizPayDemoStatus;
  /** 关联支付中心订单号（发起支付后回填） */
  paymentOrderNo: string | null;
  /** 支付成功时间 YYYY-MM-DD HH:mm:ss */
  paidAt: string | null;
  /** 履约备注（支付成功后自动发放示例权益） */
  fulfillRemark: string | null;
  tenantId: number | null;
  createdAt: string;
  updatedAt: string;
}
export type WorkflowEventSignMode = 'hmacSha256' | 'none';
export type WorkflowEventDeliveryStatus = 'pending' | 'success' | 'failed' | 'retrying';

export interface WorkflowEventSubscription {
  id: number;
  name: string;
  description: string | null;
  /** null = 全局（订阅所有流程定义） */
  definitionId: number | null;
  definitionName?: string | null;
  events: WorkflowEventType[];
  url: string;
  /** 列表/详情只返回脱敏值；明文通过 secret 专用接口按需获取 */
  secretMasked: string | null;
  signMode: WorkflowEventSignMode;
  headers: Record<string, string> | null;
  /** 经连接器投递：引用 http 连接器 id（设置后 url 退化为相对路径） */
  connectorId: number | null;
  enabled: boolean;
  tenantId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowEventDelivery {
  id: number;
  subscriptionId: number;
  subscriptionName?: string | null;
  instanceId: number | null;
  taskId: number | null;
  eventId: string;
  eventType: WorkflowEventType;
  payload: WorkflowEvent | null;
  attempt: number;
  status: WorkflowEventDeliveryStatus;
  requestUrl: string | null;
  requestHeaders: Record<string, string> | null;
  responseStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  nextRetryAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  tenantId: number | null;
  createdAt: string;
}

// ─── 触发器节点执行 ──────────────────────────────────────────────────────────
export type WorkflowTriggerExecutionStatus = 'pending' | 'running' | 'success' | 'failed' | 'retrying';
export type WorkflowTriggerType = 'webhook' | 'callback' | 'updateData' | 'deleteData';

export interface WorkflowTriggerExecution {
  id: number;
  instanceId: number;
  taskId: number | null;
  nodeKey: string;
  nodeName: string | null;
  triggerType: WorkflowTriggerType;
  status: WorkflowTriggerExecutionStatus;
  attempt: number;
  requestUrl: string | null;
  requestMethod: string | null;
  requestBody: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  tenantId: number | null;
  createdAt: string;
}

// ─── 统一作业账本（workflow_jobs）────────────────────────────────────────────
export type WorkflowJobType =
  | 'delay_wake' | 'task_timeout' | 'trigger_dispatch' | 'external_dispatch'
  | 'subprocess_spawn' | 'subprocess_join' | 'event_dispatch' | 'webhook_delivery'
  | 'compensation_action';

export type WorkflowJobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'dead' | 'canceled';
export type WorkflowJobExecutionStatus = 'running' | 'succeeded' | 'failed';

export interface WorkflowJob {
  id: number;
  jobType: WorkflowJobType;
  status: WorkflowJobStatus;
  instanceId: number | null;
  instanceTitle: string | null;
  definitionName: string | null;
  taskId: number | null;
  nodeKey: string | null;
  idempotencyKey: string | null;
  traceId: string | null;
  payload: Record<string, unknown>;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  result: Record<string, unknown> | null;
  tenantId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowJobExecution {
  id: number;
  jobId: number;
  jobType: WorkflowJobType;
  attempt: number;
  status: WorkflowJobExecutionStatus;
  requestUrl: string | null;
  requestMethod: string | null;
  requestBody: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  tenantId: number | null;
  createdAt: string;
}

/** 链路视图：同一 traceId 关联的全部作业（一次操作的完整异步 fan-out）+ 执行明细 + 状态统计 */
export interface WorkflowJobChain {
  traceId: string;
  jobs: (WorkflowJob & { executions: WorkflowJobExecution[] })[];
  stats: {
    total: number;
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
    dead: number;
    canceled: number;
    /** 链路涉及的实例 ID（跨实例/子流程时 > 1） */
    instanceIds: number[];
  };
}

/** 按作业类型聚合的状态计数（作业账本 Tab 徽标） */
export interface WorkflowJobSummaryItem {
  jobType: WorkflowJobType;
  total: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  dead: number;
  canceled: number;
}

export interface WorkflowJobBatchResult {
  total: number;
  success: number;
  skipped: number;
}

/** 待办 SLA 紧急度：none=未配置超时, safe=充裕, warning=临近, overdue=已超时 */
export type WorkflowSlaLevel = 'none' | 'safe' | 'warning' | 'overdue';

// ─── 发布前健康评分 / 分支覆盖分析 ──────────────────────────────────────────
export type WorkflowDefinitionHealthSeverity = 'info' | 'warning' | 'critical';

export interface WorkflowDefinitionHealthIssue {
  severity: WorkflowDefinitionHealthSeverity;
  message: string;
  suggestion: string | null;
  nodeKey: string | null;
  nodeName: string | null;
}

export interface WorkflowDefinitionHealthCheckItem {
  key: 'structure' | 'approver' | 'branch' | 'timeout' | 'expression';
  title: string;
  status: 'pass' | 'warn' | 'fail';
  /** 该维度得分 0-100 */
  score: number;
  /** 该维度在总分中的权重 0-1 */
  weight: number;
  summary: string;
  issues: WorkflowDefinitionHealthIssue[];
}

/** 单个网关的分支覆盖分析 */
export interface WorkflowDefinitionBranchCoverageItem {
  nodeKey: string;
  nodeName: string;
  nodeType: string;
  branchCount: number;
  hasDefault: boolean;
  issues: WorkflowDefinitionHealthIssue[];
}

export interface WorkflowDefinitionHealthReport {
  /** 总分 0-100（各维度加权） */
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  /** 结构是否硬性合法（来自 validateFlowData） */
  valid: boolean;
  checks: WorkflowDefinitionHealthCheckItem[];
  branchCoverage: WorkflowDefinitionBranchCoverageItem[];
  generatedAt: string;
}

// ─── 版本 diff 细化 ─────────────────────────────────────────────────────────
export interface WorkflowVersionDiffSide {
  version: number;
  name: string;
  label: string;
  flowData: WorkflowFlowData | null;
  publishedAt: string | null;
}

export interface WorkflowVersionFieldChange {
  field: string;
  before: string;
  after: string;
}

export interface WorkflowVersionNodeChange {
  kind: 'added' | 'removed' | 'modified';
  nodeKey: string;
  nodeName: string;
  nodeType: string;
  /** modified 时的字段级变更 */
  fields: WorkflowVersionFieldChange[];
}

export interface WorkflowVersionEdgeChange {
  kind: 'added' | 'removed' | 'modified';
  from: string;
  to: string;
  /** 条件摘要变化（modified 时 before/after 均有值） */
  before: string | null;
  after: string | null;
}

export interface WorkflowVersionDiffSummary {
  nodesAdded: number;
  nodesRemoved: number;
  nodesModified: number;
  edgesAdded: number;
  edgesRemoved: number;
  edgesModified: number;
}

export interface WorkflowVersionDiff {
  left: WorkflowVersionDiffSide;
  right: WorkflowVersionDiffSide;
  summary: WorkflowVersionDiffSummary;
  nodeChanges: WorkflowVersionNodeChange[];
  edgeChanges: WorkflowVersionEdgeChange[];
}


// ─── 运行轨迹 / 引擎解释（实例可观测性）─────────────────────────────────────
export type WorkflowEngineExplanationState = 'running' | 'blocked' | 'completed' | 'rejected' | 'canceled' | 'withdrawn' | 'draft';

/** 引擎解释：当前实例「为什么停在这里 / 在等谁 / 等什么」的单条阻塞项 */
export interface WorkflowEngineExplanationBlocker {
  kind: 'task' | 'job';
  severity: WorkflowRuntimeIssueSeverity;
  title: string;
  detail: string;
  taskId: number | null;
  jobId: number | null;
  jobType: WorkflowJobType | null;
  nodeName: string | null;
  /** 任务已等待分钟数（task 类阻塞） */
  waitingMinutes: number | null;
  /** 下次重试 / 计划执行时间（job 类阻塞） */
  nextRetryAt: string | null;
}

/** 引擎解释：实例当前运行态的人话总结 */
export interface WorkflowEngineExplanation {
  state: WorkflowEngineExplanationState;
  /** 一句话总结 */
  headline: string;
  /** 阻塞 / 等待项（按严重度排序） */
  blockers: WorkflowEngineExplanationBlocker[];
  /** 最近一次失败描述 */
  lastError: string | null;
  /** 下一个待执行作业的计划时间 */
  nextWakeAt: string | null;
  pendingJobCount: number;
  failedJobCount: number;
}

/** 运行轨迹条目内的单次作业执行尝试 */
export interface WorkflowEngineTraceExecution {
  attempt: number;
  status: WorkflowJobExecutionStatus;
  requestUrl: string | null;
  requestMethod: string | null;
  responseStatus: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  finishedAt: string | null;
}

/** 运行轨迹：合并任务流转 + 异步作业的时间线条目 */
export interface WorkflowEngineTraceEntry {
  key: string;
  kind: 'task' | 'job' | 'token';
  /** 主时间戳（YYYY-MM-DD HH:mm:ss） */
  at: string;
  traceId: string | null;
  title: string;
  status: string;
  nodeName: string | null;
  // task 类
  assigneeName: string | null;
  comment: string | null;
  // job 类
  jobId: number | null;
  jobType: WorkflowJobType | null;
  attempts: number | null;
  maxAttempts: number | null;
  runAt: string | null;
  nextRetryAt: string | null;
  lastError: string | null;
  executions: WorkflowEngineTraceExecution[];
}

export interface WorkflowInstanceTrace {
  instanceId: number;
  title: string;
  explanation: WorkflowEngineExplanation;
  trace: WorkflowEngineTraceEntry[];
  generatedAt: string;
}


export type WorkflowRuntimeIssueSeverity = 'info' | 'warning' | 'critical';

export interface WorkflowRuntimeIssue {
  severity: WorkflowRuntimeIssueSeverity;
  title: string;
  description: string;
  source: 'instance' | 'task' | 'trigger' | 'outbox' | 'token';
  taskId?: number | null;
  nodeKey?: string | null;
}

export interface WorkflowRuntimeOutboxEvent {
  id: number;
  eventId: string;
  eventType: string;
  taskId: number | null;
  status: string;
  attempts: number;
  errorMessage: string | null;
  nextRetryAt: string | null;
  processedAt: string | null;
  createdAt: string;
}

/** 显式执行 Token（活动路径 / 网关汇聚的权威单元，用于运行态可观测/重放） */
export interface WorkflowExecutionToken {
  id: number;
  nodeKey: string;
  nodeName: string | null;
  status: 'active' | 'consumed' | 'dead';
  /** 是否 parked 在网关 join 节点（active 且停在并行/包容汇聚节点，等待兄弟分支） */
  parkedAtJoin: boolean;
  /** 分支栈：每帧 { id: fork 组 id, index: 组内序号, total: 组内分支数 }，空数组=主路径 */
  branchPath: Array<{ id: string; index: number; total: number }>;
  /** 分支深度（branchPath 长度） */
  depth: number;
  /** fork 处被消费的前驱 token（血缘） */
  parentTokenId: number | null;
  /** 子流程/多实例项作用域（如 sub:{父实例}:{父任务}:{循环项}），主流程为 null */
  scopeKey: string | null;
  createdAt: string;
  consumedAt: string | null;
}

/** 实例执行 Token 视图（GET /instances/:id/tokens 与诊断复用） */
export interface WorkflowExecutionTokenView {
  instanceId: number;
  /** 活动 frontier token 数（不含 parked join） */
  activeCount: number;
  /** parked 在 join 的 token 数 */
  parkedCount: number;
  /** 已消费 token 数 */
  consumedCount: number;
  /** 已终止 token 数 */
  deadCount: number;
  tokens: WorkflowExecutionToken[];
  generatedAt: string;
}

export interface WorkflowRuntimeDiagnostics {
  instance: WorkflowInstance;
  tasks: WorkflowTask[];
  activeTasks: WorkflowTask[];
  triggerExecutions: WorkflowTriggerExecution[];
  outboxEvents: WorkflowRuntimeOutboxEvent[];
  issues: WorkflowRuntimeIssue[];
  /** 显式执行 Token 列表（活动路径 + 血缘，按 id 升序） */
  tokens: WorkflowExecutionToken[];
  snapshot: {
    formData: Record<string, unknown> | null;
    formSnapshot: unknown;
    definitionSnapshot: unknown;
  };
  generatedAt: string;
}

export type WorkflowEngineComponentStatus = 'healthy' | 'warning' | 'critical';

export type WorkflowEngineComponentKey =
  | 'dagExecutor'
  | 'taskMaterializer'
  | 'delayScheduler'
  | 'timeoutProcessor'
  | 'triggerDispatcher'
  | 'externalApprover'
  | 'subProcessRecovery'
  | 'eventBus'
  | 'outbox'
  | 'scheduler';

export type WorkflowEngineQueueKey =
  | 'humanTasks'
  | 'delayWakeups'
  | 'timeouts'
  | 'triggerDispatch'
  | 'externalApprovals'
  | 'subProcessJoin'
  | 'eventOutbox';

export interface WorkflowEngineMetric {
  label: string;
  value: number | string;
  unit?: string | null;
  hint?: string | null;
  status?: WorkflowEngineComponentStatus | null;
}

export interface WorkflowEngineComponent {
  key: WorkflowEngineComponentKey;
  name: string;
  status: WorkflowEngineComponentStatus;
  description: string;
  metrics: WorkflowEngineMetric[];
  internals?: Record<string, unknown> | null;
}

export interface WorkflowEngineQueueSnapshot {
  key: WorkflowEngineQueueKey;
  name: string;
  status: WorkflowEngineComponentStatus;
  ready: number;
  running: number;
  delayed: number;
  failed: number;
  oldestAgeMinutes: number | null;
  details?: Record<string, number | string | null> | null;
}

export interface WorkflowEngineDefinitionValidationItem {
  definitionId: number;
  name: string;
  status: WorkflowDefinitionStatus;
  version: number;
  errors: string[];
}

export interface WorkflowEngineDefinitionSnapshot {
  total: number;
  published: number;
  invalid: number;
  invalidPublished: number;
  nodeTypeCounts: Record<string, number>;
  edgeCount: number;
  invalidDefinitions: WorkflowEngineDefinitionValidationItem[];
}

export interface WorkflowEngineEventBusSnapshot {
  totalListenerCount: number;
  listeners: Array<{ eventType: WorkflowEventType | '__any__'; listenerCount: number }>;
}

/** 工作流引擎诊断视角的系统调度任务（与任务中心共用基础字段） */
export type WorkflowEngineSystemSchedulerTask = SystemSchedulerTaskBase;

export interface WorkflowEngineSchedulerSnapshot {
  initialized: boolean;
  runningJobCount: number;
  node: { id: string; hostname: string; pid: number };
  registeredHandlers: string[];
  systemRecurringJobs: Array<WorkflowEngineSystemSchedulerTask & { taskType: 'recurring'; cronExpression: string }>;
  systemQueueWorkers: Array<WorkflowEngineSystemSchedulerTask & { taskType: 'queue'; cronExpression: null; allowManualRun: false }>;
  wip: Array<{ name: string; count: number }>;
}

export interface WorkflowEngineRuntimeTask {
  queue: WorkflowEngineQueueKey;
  taskId: number;
  instanceId: number;
  instanceTitle: string;
  serialNo: string | null;
  definitionId: number;
  definitionName: string;
  nodeKey: string;
  nodeName: string;
  nodeType: WorkflowNodeType | null;
  status: WorkflowTaskStatus;
  assigneeId: number | null;
  assigneeName: string | null;
  priority: WorkflowInstancePriority;
  externalCallbackId: string | null;
  externalDispatchStatus: WorkflowTaskExternalDispatchStatus | null;
  triggerDispatchStatus: WorkflowTriggerExecutionStatus | null;
  triggerAttempt: number;
  triggerNextRetryAt: string | null;
  triggerLastError: string | null;
  timeoutAt: string | null;
  wakeAt: string | null;
  ageMinutes: number;
  createdAt: string;
}

export interface WorkflowEngineOutboxEvent {
  id: number;
  eventId: string;
  eventType: string;
  instanceId: number | null;
  instanceTitle: string | null;
  taskId: number | null;
  status: string;
  attempts: number;
  errorMessage: string | null;
  nextRetryAt: string | null;
  processedAt: string | null;
  ageMinutes: number;
  createdAt: string;
}

export interface WorkflowEngineTriggerExecution extends WorkflowTriggerExecution {
  instanceTitle: string | null;
}

export interface WorkflowEngineRuntimeIssue {
  id: string;
  severity: WorkflowRuntimeIssueSeverity;
  component: WorkflowEngineComponentKey;
  title: string;
  description: string;
  refType?: 'definition' | 'instance' | 'task' | 'triggerExecution' | 'outbox' | 'scheduler' | null;
  refId?: number | null;
  ageMinutes?: number | null;
  createdAt?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface WorkflowEngineRuntimeSnapshot {
  runningInstances: number;
  /** 平台内运行实例的活动执行 Token 总数（in-flight 执行路径） */
  activeTokens: number;
  runningWithoutActiveTasks: Array<{
    instanceId: number;
    title: string;
    serialNo: string | null;
    definitionId: number;
    definitionName: string | null;
    currentNodeKey: string | null;
    ageMinutes: number;
    createdAt: string;
  }>;
  taskQueue: WorkflowEngineRuntimeTask[];
  triggerExecutions: WorkflowEngineTriggerExecution[];
  outboxEvents: WorkflowEngineOutboxEvent[];
}

/** 时间窗口内的事件处理计数（吞吐 / 错误黄金信号） */
export interface WorkflowEngineThroughputWindow {
  total: number;
  success: number;
  failed: number;
}

/** 单个小时桶的事件吞吐（用于近 24h 趋势 sparkline） */
export interface WorkflowEngineEventBucket {
  /** 小时桶起点，格式 YYYY-MM-DD HH:mm:ss */
  hour: string;
  total: number;
  success: number;
  failed: number;
}

/** 单个小时桶的实例生命周期吞吐（发起 / 完结） */
export interface WorkflowEngineInstanceBucket {
  /** 小时桶起点，格式 YYYY-MM-DD HH:mm:ss */
  hour: string;
  created: number;
  completed: number;
}

/** 健康分扣分归因项（让健康分可解释） */
export interface WorkflowEngineScoreFactor {
  /** 扣分原因 */
  reason: string;
  /** 扣分值（正数，表示从 100 中扣减多少） */
  delta: number;
  /** 关联严重级别 */
  severity: 'warning' | 'critical';
}

/** 延迟 / 耗时分布直方图桶 */
export interface WorkflowEngineHistogramBucket {
  /** 桶标签，如 "<50ms" / "50-100ms" / "≥1s" */
  label: string;
  /** 桶下界（毫秒，含） */
  min: number;
  /** 桶上界（毫秒，不含）；null 表示无上界 */
  max: number | null;
  count: number;
}

/** Apdex 满意度（基于事件处理延迟，T = 满意阈值，4T = 容忍阈值） */
export interface WorkflowEngineApdex {
  /** Apdex 分值 0-1；样本为 0 时为 null */
  score: number | null;
  /** 满意阈值 T（毫秒） */
  thresholdMs: number;
  satisfied: number;
  tolerating: number;
  frustrated: number;
  total: number;
}

/** 可配置阈值（来自 system_configs，回显给前端用于解释判定口径） */
export interface WorkflowEngineThresholds {
  healthWarn: number;
  healthCritical: number;
  backlogWarn: number;
  backlogCritical: number;
  errorRateWarn: number;
  errorRateCritical: number;
}

/**
 * 引擎遥测指标（借鉴 Camunda/Zeebe/Temporal 内省端点对外暴露的吞吐 / 延迟 / 生命周期信号）。
 * 仅承载“只能由后端计算”的数据；饱和度、积压、SLA 分布等展示聚合由前端从其它字段派生。
 */
export interface WorkflowEngineTelemetry {
  /** 引擎健康分 0-100（规范化健康度，越高越好） */
  healthScore: number;
  /** 健康分扣分归因（解释 healthScore 为何不是满分） */
  scoreBreakdown: WorkflowEngineScoreFactor[];
  /** 事件处理 Apdex 满意度 */
  apdex: WorkflowEngineApdex;
  /** 事件派发吞吐 + 延迟（Traffic / Errors / Latency） */
  events: {
    last1h: WorkflowEngineThroughputWindow;
    last24h: WorkflowEngineThroughputWindow;
    /** 前一个 24h 窗口（24-48h 前），用于同比 delta */
    prev24h: WorkflowEngineThroughputWindow;
    /** 当前 pending/retrying 待重放事件数 */
    pendingRetry: number;
    /** 近 24h 成功事件的平均处理延迟（processedAt - createdAt，毫秒） */
    avgLatencyMs: number | null;
    /** 近 24h 成功事件处理延迟 P95（毫秒） */
    p95LatencyMs: number | null;
    /** 近 24h 成功事件处理延迟 P99（毫秒） */
    p99LatencyMs: number | null;
    /** 近 24h 成功事件处理延迟分布直方图 */
    latencyHistogram: WorkflowEngineHistogramBucket[];
    /** 近 24h 按小时聚合的吞吐趋势（24 个桶，缺口补 0） */
    series24h: WorkflowEngineEventBucket[];
  };
  /** 触发器执行吞吐 + 延迟 */
  triggers: {
    last24h: { total: number; success: number; failed: number; retrying: number };
    /** 前一个 24h 窗口（24-48h 前）总数，用于同比 delta */
    prev24h: { total: number; success: number; failed: number; retrying: number };
    /** 近 24h 触发器平均耗时（毫秒） */
    avgDurationMs: number | null;
    /** 近 24h 成功触发器耗时 P95（毫秒） */
    p95DurationMs: number | null;
    /** 近 24h 成功触发器耗时 P99（毫秒） */
    p99DurationMs: number | null;
    /** 近 24h 成功触发器耗时分布直方图 */
    durationHistogram: WorkflowEngineHistogramBucket[];
  };
  /** 流程实例生命周期吞吐 */
  instances: {
    running: number;
    createdLast24h: number;
    completedLast24h: number;
    canceledLast24h: number;
    /** 前一个 24h 窗口（24-48h 前）发起 / 完结，用于同比 delta */
    createdPrev24h: number;
    completedPrev24h: number;
    /** 近 24h 按小时聚合的发起 / 完结趋势（24 个桶，缺口补 0） */
    series24h: WorkflowEngineInstanceBucket[];
  };
  /** 系统周期任务及下次执行时间（cron 解析） */
  recurringJobs: Array<{
    name: string;
    cronExpression: string;
    registeredAt: string;
    nextRunAt: string | null;
  }>;
}

export interface WorkflowEngineIntrospection {
  healthy: boolean;
  generatedAt: string;
  thresholdMinutes: number;
  /** 可配置阈值口径回显 */
  thresholds: WorkflowEngineThresholds;
  telemetry: WorkflowEngineTelemetry;
  components: WorkflowEngineComponent[];
  queues: WorkflowEngineQueueSnapshot[];
  definitions: WorkflowEngineDefinitionSnapshot;
  eventBus: WorkflowEngineEventBusSnapshot;
  scheduler: WorkflowEngineSchedulerSnapshot;
  runtime: WorkflowEngineRuntimeSnapshot;
  issues: WorkflowEngineRuntimeIssue[];
}

/** 健康历史趋势单点（由定时任务 platform-wide 采集） */
export interface WorkflowEngineHealthPoint {
  /** 采集时间，格式 YYYY-MM-DD HH:mm:ss */
  capturedAt: string;
  healthScore: number;
  severity: WorkflowEngineComponentStatus;
  backlog: number;
  /** 事件错误率 0-1 */
  errorRate: number;
  criticalCount: number;
  warningCount: number;
  runningInstances: number;
}

export interface WorkflowEngineHealthHistory {
  /** 时间升序排列的健康趋势点 */
  points: WorkflowEngineHealthPoint[];
  /** 阈值口径，便于前端在趋势图上画警戒线 */
  thresholds: WorkflowEngineThresholds;
}

/** 引擎运维动作（复用现有恢复函数；全部为幂等的恢复扫描） */
export type WorkflowEngineActionKey =
  | 'replay-outbox'
  | 'recover-delays'
  | 'recover-subprocess'
  | 'process-timeouts'
  | 'recover-triggers'
  | 'recover-webhooks';

export interface WorkflowEngineActionResult {
  action: WorkflowEngineActionKey;
  ok: boolean;
  /** 人类可读结果摘要 */
  message: string;
  /** 各动作返回的原始计数（scanned/dispatched/resumed 等） */
  detail: Record<string, number>;
}

/** 引擎运维动作的筛选条件（jobType 每个动作固定，此处为附加维度） */
export interface WorkflowEngineActionFilter {
  /** 仅处理指定实例的作业 */
  instanceId?: number;
  /** 仅处理入库超过 N 分钟的作业（避开刚失败还在退避窗内的） */
  olderThanMinutes?: number;
  /** 单次处理上限（条数） */
  limit?: number;
}

/** 运维动作预览的作业样本行 */
export interface WorkflowEngineActionSampleJob {
  id: number;
  jobType: WorkflowJobType;
  status: WorkflowJobStatus;
  instanceId: number | null;
  traceId: string | null;
  attempts: number;
  runAt: string;
  createdAt: string;
  lastError: string | null;
}

/** 运维动作预览结果：筛选后将被处理的作业统计 + 样本，供执行前确认。 */
export interface WorkflowEngineActionPreview {
  action: WorkflowEngineActionKey;
  /** 动作可读名称 */
  label: string;
  /** 该动作固定对应的作业类型 */
  jobTypes: WorkflowJobType[];
  /** pending 且已到期（runAt<=now）——将被处理 */
  duePending: number;
  /** running 卡死——将被回收重跑 */
  stuckRunning: number;
  /** pending 但未到期（runAt>now）——本次不处理，仅提示 */
  scheduledLater: number;
  /** 本次将实际处理的总数（duePending + stuckRunning，受 limit 约束） */
  matched: number;
  /** 生效的单次上限 */
  limit: number;
  /** 样本行（默认前 10 条） */
  sample: WorkflowEngineActionSampleJob[];
}

export type WorkflowHealthIssueType =
  | 'external_dispatch_failed'
  | 'external_dispatch_pending'
  | 'trigger_waiting_no_execution'
  | 'trigger_execution_failed'
  | 'subprocess_waiting'
  | 'delay_overdue'
  | 'delay_missing_wake_job'
  | 'task_timeout_overdue'
  | 'workflow_event_outbox_failed'
  | 'workflow_event_outbox_pending'
  | 'waiting_task_stuck'
  | 'instance_stalled';

export interface WorkflowHealthIssue {
  id: string;
  type: WorkflowHealthIssueType;
  severity: 'warning' | 'critical';
  title: string;
  description: string;
  instanceId: number | null;
  instanceTitle?: string | null;
  taskId?: number | null;
  nodeKey?: string | null;
  nodeName?: string | null;
  status?: string | null;
  ageMinutes: number;
  createdAt: string;
}

export interface WorkflowHealthSummary {
  healthy: boolean;
  checkedAt: string;
  thresholdMinutes: number;
  stats: {
    total: number;
    critical: number;
    warning: number;
    externalFailed: number;
    triggerStuck: number;
    subProcessStuck: number;
    outboxFailed: number;
  };
  issues: WorkflowHealthIssue[];
}

// ─── 聊天 ─────────────────────────────────────────────────────────────────────
export type ChatConversationType = 'direct' | 'group';
export type ChatMessageType = 'text' | 'image' | 'file' | 'system' | 'forward' | 'vote' | 'voice' | 'card' | 'video';

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
export type ChatMemberRole = 'owner' | 'admin' | 'member';

export interface ChatLinkPreview {
  url: string;
  title: string;
  description: string | null;
  siteName: string | null;
  image: string | null;
  favicon: string | null;
}

export interface ChatAssetMeta {
  kind: 'image' | 'file' | 'voice' | 'video';
  name: string;
  size: number;
  mimeType: string | null;
  extension: string | null;
  /** 托管文件 ID，用于服务端预览接口认证（可选，虚拟消息不填） */
  fileId?: string | null;
  width?: number | null;
  height?: number | null;
  thumbnailUrl?: string | null;
  /** 语音消息时长（秒），仅 kind='voice' 有效 */
  duration?: number | null;
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

/** 卡片消息字段（键值对展示） */
export interface ChatCardField {
  label: string;
  value: string;
}

/** 卡片消息动作按钮 */
export interface ChatCardAction {
  /** 动作唯一标识 */
  key: string;
  label: string;
  /** 按钮样式 */
  theme?: 'primary' | 'secondary' | 'danger' | 'tertiary';
  /** 动作类型：调用工作流审批接口 / 打开链接 / 仅展示 */
  action: 'workflow:approve' | 'workflow:reject' | 'link' | 'none';
  /** workflow:* 动作关联的任务 ID */
  taskId?: number | null;
  /** link 动作的跳转地址（站内 path 或外链） */
  url?: string | null;
  /** 是否要求填写评论（如驳回） */
  requireComment?: boolean;
}

/** 卡片消息内容（工作流审批 / 系统告警 / Webhook 推送） */
export interface ChatCard {
  title: string;
  text?: string | null;
  /** 图文消息封面图 URL（频道图文群发使用，工作流卡片不设） */
  cover?: string | null;
  fields?: ChatCardField[] | null;
  actions?: ChatCardAction[] | null;
  /** 来源标识（如「工作流」「系统告警」「监控」） */
  source?: string | null;
  /** 卡片状态：pending 可操作，done 已处理（按钮置灰） */
  status?: 'pending' | 'done' | null;
  /** 已处理后的结果文案 */
  statusText?: string | null;
  /** 关联的工作流实例 ID（工作流卡片点击可打开流程详情抽屉） */
  instanceId?: number | null;
}

/** 机器人/系统发送者身份（senderId 为 null 的消息携带） */
export interface ChatBotMeta {
  name: string;
  avatar?: string | null;
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
  card?: ChatCard | null;
  bot?: ChatBotMeta | null;
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
  /** 被禁言至（null = 未禁言；9999 年 = 永久） */
  mutedUntil?: string | null;
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
  /** 会话归档（收进「已归档」折叠分组） */
  isArchived?: boolean;
  /** 全员禁言开关（群聊） */
  muteAll?: boolean;
  /** 入群审批开关（群聊，开启后邀请入群需审批） */
  joinApproval?: boolean;
  /** 我在该会话中的角色 */
  myRole?: ChatMemberRole;
  /** 我被禁言至（null = 未禁言） */
  myMutedUntil?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 会话成员的已读状态（用于已读回执） */
export interface ChatReadState {
  userId: number;
  nickname: string;
  avatar: string | null;
  /** 最后已读时间，null 表示从未读过 */
  lastReadAt: string | null;
}

/** 用户在线状态（用于在线状态指示） */
export interface ChatPresence {
  userId: number;
  online: boolean;
  /** 最近在线时间，online=true 时为 null */
  lastSeen: string | null;
}

/** 组织架构选人：部门节点 */
export interface ChatOrgDepartment {
  id: number;
  name: string;
  parentId: number;
}

/** 组织架构选人：用户节点 */
export interface ChatOrgUser {
  id: number;
  nickname: string;
  username: string;
  avatar: string | null;
  departmentId: number | null;
}

/** 组织架构选人数据（部门 + 用户扁平列表，前端组树） */
export interface ChatOrgData {
  departments: ChatOrgDepartment[];
  users: ChatOrgUser[];
}

/** 个人快捷回复（常用语） */
export interface ChatQuickReply {
  id: number;
  content: string;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export type ChatScheduledStatus = 'pending' | 'sent' | 'canceled' | 'failed';

/** 定时消息 */
export interface ChatScheduledMessage {
  id: number;
  conversationId: number;
  /** 目标会话展示名（群名或对方昵称） */
  conversationName: string | null;
  type: ChatMessageType;
  content: string;
  extra: ChatMessageExtra | null;
  scheduledAt: string;
  status: ChatScheduledStatus;
  failReason: string | null;
  sentMessageId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 自定义表情（个人收藏贴图） */
export interface ChatCustomEmoji {
  id: number;
  url: string;
  fileId: string | null;
  name: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
}

/** 群邀请链接 */
export interface ChatGroupInvite {
  id: number;
  conversationId: number;
  token: string;
  /** 过期时间（null = 永久有效） */
  expiresAt: string | null;
  maxUses: number | null;
  usedCount: number;
  enabled: boolean;
  createdAt: string;
}

/** 邀请链接落地信息（加入前展示） */
export interface ChatInviteInfo {
  conversationId: number;
  groupName: string | null;
  memberCount: number;
  /** 是否需要群主/管理员审批 */
  joinApproval: boolean;
  /** 当前用户是否已在群内 */
  alreadyMember: boolean;
}

export type ChatJoinRequestStatus = 'pending' | 'approved' | 'rejected';

/** 入群申请 */
export interface ChatGroupJoinRequest {
  id: number;
  conversationId: number;
  userId: number;
  nickname: string;
  avatar: string | null;
  message: string | null;
  status: ChatJoinRequestStatus;
  createdAt: string;
}

/** 聊天入站 Webhook 机器人 */
export interface ChatWebhook {
  id: number;
  name: string;
  avatar: string | null;
  description: string | null;
  conversationId: number;
  conversationName: string | null;
  enabled: boolean;
  /** 完整入站推送地址 */
  webhookUrl: string;
  /** 令牌（仅创建/重置时返回明文，列表中为脱敏） */
  token: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Channel（站内公众号 / 系统号）────────────────────────────────────────────
export type ChannelType = 'system' | 'business';
export type ChannelAudienceType = 'broadcast' | 'targeted';
export type ChannelMessageType = 'text' | 'card' | 'image' | 'news';
/** 消息状态：sent=已发；draft=草稿；scheduled=定时待发 */
export type ChannelMessageStatus = 'sent' | 'draft' | 'scheduled';
/** 群发受众范围：all=全员；users=指定用户；departments=按部门；roles=按角色 */
export type ChannelPublishAudienceMode = 'all' | 'users' | 'departments' | 'roles';
/** 群发发送方式：now=立即；scheduled=定时；draft=存草稿 */
export type ChannelSendMode = 'now' | 'scheduled' | 'draft';
/** 消息方向：out=频道→用户（群发/客服/自动回复）；in=用户→频道（用户主动发送） */
export type ChannelMessageDirection = 'out' | 'in';
/** 公众号底部菜单类型：click=点击触发关键词；view=跳转链接 */
export type ChannelMenuType = 'click' | 'view';
/** 自动回复匹配类型：subscribe=关注欢迎语；keyword=关键词；default=兜底 */
export type ChannelAutoReplyMatchType = 'subscribe' | 'keyword' | 'default';
/** 关键词匹配模式：exact=完全匹配；contains=包含 */
export type ChannelAutoReplyKeywordMode = 'exact' | 'contains';
/** 客服会话状态：open=待处理；processing=处理中；resolved=已解决 */
export type ChannelConversationStatus = 'open' | 'processing' | 'resolved';

/** 频道内一条消息（卡片复用 ChatMessageExtra.card / 身份用 extra.bot） */
export interface ChannelMessage {
  id: number;
  channelId: number;
  audienceType: ChannelAudienceType;
  type: ChannelMessageType;
  title: string | null;
  content: string;
  extra: ChatMessageExtra | null;
  publishedById: number | null;
  /** 消息方向（双向客服） */
  direction: ChannelMessageDirection;
  /** in 消息=发送用户；out 客服回复=客服用户；自动回复/群发为 null */
  senderUserId: number | null;
  /** 发送者展示名（in=用户昵称，out 客服=客服昵称） */
  senderUserName: string | null;
  /** 当前用户视角是否已读 */
  isRead: boolean;
  /** 消息状态（管理端消息记录：sent 已发 / draft 草稿 / scheduled 定时待发） */
  status: ChannelMessageStatus;
  /** 定时发送时间（status=scheduled 时有值） */
  scheduledAt: string | null;
  /** 客服会话视角：该 out 定向消息是否已被目标用户读取（null=非定向/不适用） */
  readByTarget?: boolean | null;
  /** 是否已撤回（F：撤回后内容置空，前端显示占位） */
  isRetracted?: boolean;
  retractedAt?: string | null;
  createdAt: string;
}

/** 公众号底部菜单节点（最多 3 个一级，每个一级下最多 5 个二级） */
export interface ChannelMenu {
  id: number;
  channelId: number;
  parentId: number | null;
  name: string;
  type: ChannelMenuType;
  /** click=关键词文案；view=跳转 URL；含子菜单的一级菜单可为空 */
  value: string | null;
  sort: number;
  children?: ChannelMenu[];
}

/** 富内容自动回复的扩展数据（replyType=image/news 时使用） */
export interface ChannelRichReplyExtra {
  /** 图片消息：图片 URL */
  imageUrl?: string | null;
  /** 图文消息：标题 / 封面 / 摘要 / 跳转链接 */
  title?: string | null;
  cover?: string | null;
  summary?: string | null;
  linkUrl?: string | null;
}

/** 频道自动回复规则 */
export interface ChannelAutoReply {
  id: number;
  channelId: number;
  matchType: ChannelAutoReplyMatchType;
  /** 关键词（matchType=keyword 时必填） */
  keyword: string | null;
  keywordMode: ChannelAutoReplyKeywordMode;
  /** 回复内容类型（text/image/news；H 富内容） */
  replyType: ChannelMessageType;
  replyContent: string;
  /** 富内容扩展（image/news 时） */
  replyExtra: ChannelRichReplyExtra | null;
  /** 命中次数（H 统计） */
  hitCount: number;
  status: EntityStatus;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

/** 客服快捷回复（channelId 为 null 表示全局，所有运营号通用） */
export interface ChannelQuickReply {
  id: number;
  channelId: number | null;
  channelName: string | null;
  title: string;
  content: string;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

/** 客服工作台中的一条会话（按用户聚合） */
export interface ChannelConversation {
  channelId: number;
  userId: number;
  userName: string;
  userAvatar: string | null;
  /** 最近一条消息内容预览 */
  lastMessage: string;
  /** 最近一条消息方向 */
  lastDirection: ChannelMessageDirection;
  lastMessageAt: string;
  /** 待客服回复的用户消息数（最近一条客服回复之后的用户消息） */
  unreadCount: number;
  /** 会话内消息总数 */
  messageCount: number;
  /** 会话状态（待处理 / 处理中 / 已解决） */
  status: ChannelConversationStatus;
  /** 指派的客服 userId（null=未指派，开放协作） */
  assigneeId: number | null;
  /** 指派客服展示名 */
  assigneeName: string | null;
  /** 会话标签 */
  tags: string[];
  /** 解决时间 */
  resolvedAt: string | null;
  /** 用户评价（1-5 星，null=未评价） */
  rating: number | null;
  ratingComment: string | null;
  ratedAt: string | null;
}

/** 频道订阅者（订阅者管理） */
export interface ChannelSubscriber {
  userId: number;
  name: string;
  avatar: string | null;
  /** 订阅时间（系统号全员为 null） */
  subscribedAt: string | null;
  isMuted: boolean;
}

/** 群发消息模板 */
export interface ChannelMessageTemplate {
  id: number;
  name: string;
  type: ChannelMessageType;
  title: string | null;
  content: string;
  extra: ChatMessageExtra | null;
  createdAt: string;
  updatedAt: string;
}

/** 客服绩效（按客服聚合） */
export interface ChannelCsPerformance {
  agentId: number;
  agentName: string;
  /** 回复消息数 */
  replyCount: number;
  /** 标记解决会话数 */
  resolvedCount: number;
  /** 平均首次响应时长（分钟，null=无数据） */
  avgResponseMinutes: number | null;
  /** 平均评分（1-5，null=无评分） */
  avgRating: number | null;
}

/** 可指派的客服（拥有 channel:cs 权限的用户） */
export interface ChannelCsAgent {
  id: number;
  name: string;
  avatar: string | null;
}

/** 频道数据看板（I） */
export interface ChannelDashboardOverview {
  /** 运营号数量 */
  businessChannelCount: number;
  /** 订阅总数（运营号订阅关系） */
  subscriptionCount: number;
  /** 消息总数（已发送 out） */
  messageCount: number;
  /** 今日推送数 */
  todayPushCount: number;
  /** 待处理会话数 */
  openConversationCount: number;
  /** 平均首次响应时长（分钟，用户首条 in → 首条人工 out） */
  avgResponseMinutes: number | null;
}

/** 近 N 天消息量趋势点 */
export interface ChannelDashboardTrendPoint {
  date: string;
  /** 用户来信数 */
  inbound: number;
  /** 频道发出数（群发+客服回复） */
  outbound: number;
}

/** 会话状态分布 */
export interface ChannelDashboardStatusDist {
  open: number;
  processing: number;
  resolved: number;
}

/** 热门自动回复（按命中次数） */
export interface ChannelDashboardTopReply {
  id: number;
  channelName: string;
  keyword: string | null;
  matchType: ChannelAutoReplyMatchType;
  hitCount: number;
}

/** 运营号消息排行 */
export interface ChannelDashboardChannelRank {
  channelId: number;
  channelName: string;
  messageCount: number;
  subscriberCount: number;
}

/** 频道数据看板聚合结果 */
export interface ChannelDashboard {
  overview: ChannelDashboardOverview;
  trend: ChannelDashboardTrendPoint[];
  statusDist: ChannelDashboardStatusDist;
  /** 群发定向消息已读率（0-100） */
  readRate: number;
  topReplies: ChannelDashboardTopReply[];
  channelRank: ChannelDashboardChannelRank[];
}

/** 公众号 / 系统号（在聊天会话列表中以只读频道形式呈现） */
export interface Channel {
  id: number;
  code: string;
  name: string;
  avatar: string | null;
  description: string | null;
  type: ChannelType;
  builtin: boolean;
  status: EntityStatus;
  /** 当前用户未读数 */
  unreadCount: number;
  lastMessage: ChannelMessage | null;
  isMuted: boolean;
  isSubscribed: boolean;
  tenantId?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 频道管理后台视图（含订阅数 / 消息数） */
export interface ChannelAdmin {
  id: number;
  code: string;
  name: string;
  avatar: string | null;
  description: string | null;
  type: ChannelType;
  builtin: boolean;
  status: EntityStatus;
  subscriberCount: number;
  messageCount: number;
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
  /** 深链地址（站内路由，点击消息跳转） */
  link?: string | null;
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

// ─── AI 对话模块 ──────────────────────────────────────────────────────────────

export type AiMessageRole = 'system' | 'user' | 'assistant';

/** 模型能力标签 */
export interface AiModelCapabilities {
  /** 支持图片理解（vision） */
  vision?: boolean;
  /** 支持函数调用（function calling） */
  tools?: boolean;
  /** 上下文窗口长度（token） */
  contextWindow?: number;
}

export interface AiProviderConfig {
  id: number;
  name: string;
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 附加可选模型列表（同一服务商多模型） */
  models: string[] | null;
  /** 模型能力标签 */
  capabilities: AiModelCapabilities | null;
  systemPrompt: string | null;
  maxTokens: number;
  temperature: string;
  /** 输入单价（分 / 百万 token），null = 未配置不计成本 */
  priceInputPerM: number | null;
  /** 输出单价（分 / 百万 token），null = 未配置不计成本 */
  priceOutputPerM: number | null;
  isDefault: boolean;
  isEnabled: boolean;
  /** 主备切换降级配置 ID */
  fallbackConfigId: number | null;
  /** 并发流上限（null/0 = 不限） */
  maxConcurrent: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 聊天模型选择器条目（/api/ai/models 轻量列表，不含敏感字段）；一个配置可展开多个模型条目 */
export interface AiChatModel {
  id: number;
  name: string;
  model: string;
  provider: AiProvider;
  isDefault: boolean;
  capabilities: AiModelCapabilities | null;
}

/** 用户级 AI 个性化指令（Custom Instructions） */
export interface AiUserPreference {
  aboutMe: string | null;
  replyStyle: string | null;
  isEnabled: boolean;
}

/** 对话分享信息 */
export interface AiConversationShare {
  token: string;
  url: string;
  expiresAt: string | null;
  createdAt: string;
}

/** 知识库 */
export interface AiKnowledgeBase {
  id: number;
  name: string;
  description: string | null;
  userId: number;
  embeddingModel: string | null;
  documentCount: number;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 知识库文档 */
export interface AiKbDocument {
  id: number;
  kbId: number;
  name: string;
  /** 网页抓取来源 URL */
  sourceUrl: string | null;
  status: 'ready' | 'processing' | 'failed';
  chunkCount: number;
  charCount: number;
  error: string | null;
  createdAt: string;
}

/** 知识库检索引用（SSE references 事件） */
export interface AiKbReference {
  docName: string;
  content: string;
  score: number;
}

export interface AiConversation {
  id: number;
  userId: number;
  tenantId: number | null;
  title: string;
  providerSnapshot: { provider: string; model: string; configId?: number } | null;
  isArchived: boolean;
  isPinned: boolean;
  systemPromptOverride: string | null;
  /** 挂载的知识库 ID */
  knowledgeBaseId: number | null;
  /** 关联的智能体 ID */
  agentId: number | null;
  /** 用户自定义标签 */
  tags: string[];
  /** 分支树当前激活叶子消息 ID（null = 线性对话） */
  activeLeafMsgId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 生成调用链 trace 步骤 */
export interface AiTraceStep {
  type: 'retrieval' | 'tool_call' | 'llm_round' | 'failover';
  label: string;
  durationMs: number;
  meta?: Record<string, unknown>;
}

export interface AiMessage {
  id: number;
  conversationId: number;
  /** 分支树父消息 ID（null = 根消息） */
  parentId: number | null;
  role: AiMessageRole;
  content: string;
  /** 推理模型的思维链内容（reasoning_content） */
  reasoning: string | null;
  model: string | null;
  tokensInput: number;
  tokensOutput: number;
  /** 首字延迟（毫秒） */
  ttftMs: number | null;
  /** 本次生成总耗时（毫秒） */
  durationMs: number | null;
  /** 1 = 点赞, -1 = 点踩, null = 未反馈 */
  feedback: number | null;
  feedbackReason: string | null;
  feedbackStatus: AiFeedbackStatus | null;
  feedbackRemark: string | null;
  feedbackHandledAt: string | null;
  /** 生成调用链 trace（assistant 消息） */
  trace: AiTraceStep[] | null;
  createdAt: string;
}

export type AiFeedbackStatus = 'pending' | 'resolved' | 'ignored';

// ─── P3：自定义智能体 ─────────────────────────────────────────────────────────

export interface AiAgent {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  avatar: string;
  systemPrompt: string;
  /** 指定服务商配置（null = 系统默认） */
  configId: number | null;
  /** 指定模型（null = 配置默认） */
  model: string | null;
  temperature: string | null;
  knowledgeBaseId: number | null;
  /** 启用的工具名集合 */
  tools: string[];
  openingMessage: string | null;
  suggestedQuestions: string[];
  status: AiAgentStatus;
  clonedFromId: number | null;
  usageCount: number;
  isEnabled: boolean;
  /** 市场展示：创建者名称 */
  ownerName?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── P3：HTTP API 工具 ────────────────────────────────────────────────────────

export interface AiHttpToolParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
  location: 'query' | 'body' | 'path';
}

export interface AiHttpTool {
  id: number;
  name: string;
  description: string;
  method: string;
  urlTemplate: string;
  headers: Record<string, string> | null;
  params: AiHttpToolParam[];
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 工具选择器条目（内置 + HTTP 工具统一视图） */
export interface AiToolInfo {
  name: string;
  description: string;
  source: 'builtin' | 'http';
}

// ─── P3：提示词模板版本 ───────────────────────────────────────────────────────

export interface AiPromptTemplateVersion {
  id: number;
  templateId: number;
  version: number;
  name: string;
  content: string;
  createdBy: number | null;
  creatorName: string | null;
  createdAt: string;
}

// ─── P3：评测集 ───────────────────────────────────────────────────────────────

export interface AiEvalItem {
  question: string;
  expected?: string;
}

export interface AiEvalSet {
  id: number;
  name: string;
  description: string | null;
  items: AiEvalItem[];
  createdAt: string;
  updatedAt: string;
}

export interface AiEvalResult {
  question: string;
  expected?: string;
  answer: string;
  durationMs: number;
  tokensInput: number;
  tokensOutput: number;
  error?: string;
}

export interface AiEvalRun {
  id: number;
  setId: number;
  setName?: string | null;
  configId: number | null;
  model: string;
  status: 'running' | 'done' | 'failed';
  results: AiEvalResult[] | null;
  avgDurationMs: number | null;
  totalTokens: number | null;
  createdAt: string;
}

/** 管理端反馈列表条目：消息 + 反馈人 / 会话 / 前置提问上下文 */
export interface AiFeedbackItem extends AiMessage {
  userId: number | null;
  username: string | null;
  nickname: string | null;
  conversationTitle: string | null;
  /** 该条 AI 回复之前最近一条用户提问 */
  question: string | null;
}

export interface UserAiConfig {
  id: number;
  userId: number;
  name: string | null;
  provider: AiProvider;
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  temperature: string | null;
  maxTokens: number | null;
  systemPrompt: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AiPromptScope = 'system' | 'user';

export interface AiPromptTemplate {
  id: number;
  name: string;
  content: string;
  description: string | null;
  category: string | null;
  scope: AiPromptScope;
  userId: number | null;
  isBuiltin: boolean;
  sort: number;
  /** 被应用为对话角色的累计次数 */
  usageCount: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── 数据脱敏配置 ─────────────────────────────────────────────────────────────

export type MaskType = 'phone' | 'email' | 'id_card' | 'name' | 'bank_card' | 'custom';

export interface CustomMaskRule {
  prefixKeep: number;
  suffixKeep: number;
  maskChar?: string;
}

export interface DataMaskConfig {
  id: number;
  entity: string;
  field: string;
  label: string;
  maskType: MaskType;
  customRule?: CustomMaskRule | null;
  exemptRoleCodes: string[];
  enabled: boolean;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SensitiveField {
  tableName: string;
  columnName: string;
  dataType: string;
  suggestedMaskType: MaskType;
  suggestedLabel: string;
  hasRule: boolean;
}

// ─── OAuth2 服务端 ─────────────────────────────────────────────────────────

export interface OAuth2Client {
  id: number;
  clientId: string;
  clientSecretPrefix?: string | null;
  name: string;
  description?: string | null;
  logoUrl?: string | null;
  redirectUris: string[];
  allowedScopes: string[];
  grantTypes: string[];
  isPublic: boolean;
  /** 开放平台：绑定的限流套餐 ID */
  ratePlanId?: number | null;
  /** 开放平台：调用开放 API 时是否强制 HMAC 签名验签 */
  signEnabled?: boolean;
  /** 开放 API 来源 IP/CIDR 白名单；空数组表示不限制 */
  ipAllowlist: string[];
  environment: 'production' | 'sandbox';
  reviewStatus: 'draft' | 'pending' | 'approved' | 'rejected';
  reviewComment?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: number | null;
  previousSecretExpiresAt?: string | null;
  status: 'enabled' | 'disabled';
  ownerId?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 创建应用时一次性返回，包含明文 secret */
export interface OAuth2ClientCreated extends OAuth2Client {
  clientSecret: string;
}

export interface OAuth2Token {
  id: number;
  tokenType: 'access' | 'refresh';
  tokenPrefix?: string | null;
  clientId: string;
  userId?: number | null;
  scopes: string[];
  expiresAt?: string | null;
  revoked: boolean;
  createdAt: string;
}

export interface OAuth2UserGrant {
  id: number;
  userId: number;
  username: string | null;
  nickname: string | null;
  clientId: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OAuth2UserGrant {
  id: number;
  userId: number;
  clientId: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── 开放平台 / 开发者门户 ────────────────────────────────────────────────────

/** API Scope 注册表项 */
export interface ApiScope {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  scopeGroup: string;
  status: 'enabled' | 'disabled';
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 限流套餐（Rate Plan / Tier） */
export interface RatePlan {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  /** 每秒请求上限（QPS），0=不限 */
  qpsLimit: number;
  /** 每日调用配额，0=不限 */
  dailyQuota: number;
  /** 每月调用配额，0=不限 */
  monthlyQuota: number;
  isDefault: boolean;
  status: 'enabled' | 'disabled';
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 开放 API 调用日志 */
export interface OpenApiCallLog {
  id: number;
  clientId: string;
  appName?: string | null;
  method: string;
  path: string;
  statusCode: number;
  success: boolean;
  durationMs: number;
  ip?: string | null;
  userAgent?: string | null;
  scope?: string | null;
  errorMessage?: string | null;
  requestId?: string | null;
  environment: 'production' | 'sandbox';
  createdAt: string;
}

export interface OpenAppQuotaUsageItem {
  used: number;
  limit: number;
  percentage: number;
}

export interface OpenAppQuotaUsage {
  clientId: string;
  environment: 'production' | 'sandbox';
  planCode: string | null;
  planName: string | null;
  qps: OpenAppQuotaUsageItem;
  daily: OpenAppQuotaUsageItem;
  monthly: OpenAppQuotaUsageItem;
}

export interface OpenApiDebugResult {
  requestUrl: string;
  method: string;
  requestHeaders: Record<string, string>;
  stringToSign?: string;
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseBody: string;
  durationMs: number;
}

/** 调用统计总览 */
export interface OpenApiStatsOverview {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  successRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  percentilesPartial: boolean;
  percentileRetentionDays: number;
  activeApps: number;
  todayCalls: number;
}

/** 调用趋势点（按小时/天聚合） */
export interface OpenApiStatsTrendPoint {
  time: string;
  total: number;
  success: number;
  failed: number;
}

/** 按应用/端点聚合统计项 */
export interface OpenApiStatsGroupItem {
  key: string;
  label: string;
  total: number;
  success: number;
  failed: number;
  avgDurationMs: number;
}

/** 签名验签结果 */
export interface OpenSignatureResult {
  signature: string;
  stringToSign: string;
  matched?: boolean;
}

/** 应用级 Webhook 订阅 */
export interface AppWebhookSubscription {
  id: number;
  clientId: string;
  name: string;
  url: string;
  signMode: 'hmacSha256' | 'none';
  events: string[];
  headers?: Record<string, string> | null;
  status: 'enabled' | 'disabled';
  /** 是否已配置签名密钥 */
  hasSecret: boolean;
  /** 密钥掩码（仅展示前后各 4 位） */
  secretMasked?: string | null;
  lastDeliveryAt?: string | null;
  consecutiveFailures: number;
  autoDisabledAt?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 创建/重置时一次性返回明文 secret */
export interface AppWebhookSubscriptionCreated extends AppWebhookSubscription {
  secret: string;
}

/** Webhook 投递记录 */
export interface AppWebhookDelivery {
  id: number;
  subscriptionId: number;
  clientId: string;
  eventType: string;
  eventId: string;
  status: 'pending' | 'success' | 'failed' | 'retrying';
  attempt: number;
  requestUrl?: string | null;
  responseStatus?: number | null;
  responseBody?: string | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  nextRetryAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
}

/** 事件类型元数据（供订阅界面选择） */
export interface OpenWebhookEventMeta {
  code: string;
  label: string;
}

/** /api/oauth2/token 响应体（标准 OAuth2 格式）*/
export interface OAuth2TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

/** /api/oauth2/userinfo 响应体 */
export interface OAuth2UserInfo {
  sub: string;
  name?: string;
  nickname?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
}

/** /api/oauth2/token/introspect 响应体 */
export interface OAuth2IntrospectResponse {
  active: boolean;
  scope?: string;
  client_id?: string;
  username?: string;
  exp?: number;
  iat?: number;
  sub?: string;
  token_type?: string;
}

/** 前端 /oauth2/authorize 页面所需的应用信息 */
export interface OAuth2AuthorizeInfo {
  clientId: string;
  name: string;
  logoUrl?: string | null;
  description?: string | null;
  requestedScopes: string[];
  alreadyGranted: boolean;
}

// ─── 进程管理 ───────────────────────────────────────────────────────────────
export interface ProcessNetConn {
  localAddr: string;
  localPort: number;
  remoteAddr: string;
  remotePort: number;
  state: string;
  protocol: string; // 'tcp' | 'udp'
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  /** 'running' | 'sleeping' | 'disk-sleep' | 'stopped' | 'zombie' | 'idle' | 'unknown' */
  status: string;
  /** CPU usage percentage (instantaneous on Linux/macOS; cumulative seconds on Windows) */
  cpu: number;
  /** RSS memory in bytes */
  memory: number;
  /** Memory usage percentage */
  memoryPercent: number;
  startTime: string | null;
  /** Full command line or process name */
  command: string;
  user: string;
  threads: number;
  /** Nice value -20~19 (Linux/macOS), null on Windows */
  nice: number | null;
  /** Windows priority class, null on Unix */
  priorityClass: string | null;
  /** Listening port numbers (comma-separated string, from cached netstat) */
  ports: string | null;
  /** Full connection list (only populated in detail view) */
  connections: ProcessNetConn[] | null;
  /** Working directory (Linux only, detail view, may be null if no permission) */
  cwd?: string | null;
  /** Environment variables (Linux only, detail view, may be null if no permission) */
  env?: Record<string, string> | null;
}

export interface ProcessListResponse {
  /** OS platform: 'linux' | 'darwin' | 'win32' */
  platform: string;
  processes: ProcessInfo[];
  total: number;
  timestamp: string;
}

// ─── SQL 收藏夹 ──────────────────────────────────────────────────────────────
export interface DbQueryFavorite {
  id: number;
  name: string;
  sql: string;
  description: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── 支付中心 ────────────────────────────────────────────────────────
export interface PaymentChannelConfig {
  id: number;
  name: string;
  channel: PaymentChannel;
  status: EntityStatus;
  isDefault: boolean;
  sandbox: boolean;
  notifyUrl?: string | null;
  // 微信（密钥字段以掩码/布尔位返回，永不返回明文）
  wechatAppId?: string | null;
  wechatMchId?: string | null;
  wechatSerialNo?: string | null;
  wechatPlatformCert?: string | null;
  hasWechatApiV3Key?: boolean;
  hasWechatPrivateKey?: boolean;
  // 支付宝
  alipayAppId?: string | null;
  alipayPublicKey?: string | null;
  alipaySignType?: string | null;
  alipayGateway?: string | null;
  hasAlipayPrivateKey?: boolean;
  // 云闪付（银联全渠道）
  unionpayMerId?: string | null;
  unionpayCertId?: string | null;
  unionpayPublicKey?: string | null;
  unionpayGateway?: string | null;
  hasUnionpayPrivateKey?: boolean;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentOrder {
  id: number;
  orderNo: string;
  outTradeNo: string;
  channelTradeNo?: string | null;
  bizType: string;
  bizId: string;
  subject: string;
  body?: string | null;
  amount: number; // 分
  currency: string;
  channel: PaymentChannel;
  channelConfigId?: number | null;
  payMethod: PaymentMethod;
  status: PaymentOrderStatus;
  userId?: number | null;
  openId?: string | null;
  clientIp?: string | null;
  departmentId?: number | null;
  paidAmount?: number | null;
  feeAmount?: number | null;
  netAmount?: number | null;
  /** 优惠前原价（分），null=无优惠 */
  originalAmount?: number | null;
  /** 优惠立减金额（分） */
  discountAmount?: number | null;
  /** 支付使用的会员券 id */
  memberCouponId?: number | null;
  paidAt?: string | null;
  expiredAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRefund {
  id: number;
  refundNo: string;
  outRefundNo: string;
  orderNo: string;
  orderId?: number | null;
  channelRefundNo?: string | null;
  channel: PaymentChannel;
  refundAmount: number; // 分
  totalAmount: number; // 分
  reason?: string | null;
  status: PaymentRefundStatus;
  approvalStatus: PaymentRefundApprovalStatus;
  appliedById?: number | null;
  approverId?: number | null;
  approvedAt?: string | null;
  approvalRemark?: string | null;
  operatorId?: number | null;
  refundedAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentReconBatch {
  id: number;
  batchNo: string;
  channel: PaymentChannel;
  billDate: string;
  status: PaymentReconStatus;
  localCount: number;
  localAmount: number;
  channelCount: number;
  channelAmount: number;
  matchedCount: number;
  diffCount: number;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentReconItem {
  id: number;
  batchId: number;
  orderNo?: string | null;
  channelTradeNo?: string | null;
  localAmount?: number | null;
  channelAmount?: number | null;
  localStatus?: string | null;
  channelStatus?: string | null;
  result: PaymentReconResult;
  /** 差异处理状态：null=无需处理（一致项） */
  handleStatus?: PaymentReconHandleStatus | null;
  handleRemark?: string | null;
  handledAt?: string | null;
  remark?: string | null;
  createdAt: string;
}

export interface PaymentWebhookEndpoint {
  id: number;
  name: string;
  url: string;
  bizType?: string | null;
  events: string[];
  status: 'enabled' | 'disabled';
  hasSecret?: boolean;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentWebhookDelivery {
  id: number;
  endpointId: number;
  endpointName?: string | null;
  eventType: string;
  orderNo?: string | null;
  payload?: string | null;
  status: PaymentWebhookDeliveryStatus;
  attempts: number;
  httpStatus?: number | null;
  responseBody?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentLedgerEntry {
  id: number;
  entryNo: string;
  direction: PaymentLedgerDirection;
  type: PaymentLedgerType;
  amount: number;
  orderNo?: string | null;
  refundNo?: string | null;
  channel?: PaymentChannel | null;
  bizType?: string | null;
  remark?: string | null;
  createdAt: string;
}

export interface PaymentLedgerSummary {
  inAmount: number;
  outAmount: number;
  netAmount: number;
  count: number;
}

export interface PaymentOutboxEvent {
  id: number;
  type: string;
  orderNo: string;
  status: 'pending' | 'done' | 'failed';
  attempts: number;
  lastError?: string | null;
  createdAt: string;
  processedAt?: string | null;
}

// ─── 支付中心扩展 · B 档 ──────────────────────────────────────────────────────
export interface PaymentFeeRule {
  id: number;
  name: string;
  channel: PaymentChannel;
  payMethod?: PaymentMethod | null;
  rateBps: number; // 万分比
  fixedFee: number; // 分
  minFee?: number | null; // 分
  maxFee?: number | null; // 分
  status: 'enabled' | 'disabled';
  priority: number;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSettlementBatch {
  id: number;
  batchNo: string;
  channel: PaymentChannel;
  periodStart: string;
  periodEnd: string;
  status: PaymentSettlementStatus;
  orderCount: number;
  grossAmount: number; // 分
  feeAmount: number; // 分
  refundAmount: number; // 分
  netAmount: number; // 分
  settledAt?: string | null;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSharingReceiver {
  id: number;
  name: string;
  receiverType: PaymentSharingReceiverType;
  account: string;
  ratioBps?: number | null; // 万分比
  /** 自动分账：支付成功后按 ratioBps 自动发起分账 */
  autoShare: boolean;
  status: 'enabled' | 'disabled';
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSharingOrder {
  id: number;
  sharingNo: string;
  orderNo: string;
  receiverId: number;
  receiverName?: string | null;
  amount: number; // 分
  status: PaymentSharingOrderStatus;
  channelSharingNo?: string | null;
  finishedAt?: string | null;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentTransfer {
  id: number;
  transferNo: string;
  outTransferNo: string;
  channel: PaymentChannel;
  receiverAccount: string;
  receiverName?: string | null;
  amount: number; // 分
  remark?: string | null;
  status: PaymentTransferStatus;
  channelTransferNo?: string | null;
  failReason?: string | null;
  attempts: number;
  bizType?: string | null;
  bizId?: string | null;
  finishedAt?: string | null;
  operatorName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentApp {
  id: number;
  name: string;
  appKey: string;
  status: 'enabled' | 'disabled';
  wechatConfigId?: number | null;
  wechatConfigName?: string | null;
  alipayConfigId?: number | null;
  alipayConfigName?: string | null;
  unionpayConfigId?: number | null;
  unionpayConfigName?: string | null;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentDeductPlan {
  id: number;
  name: string;
  period: PaymentDeductPeriod;
  customDays?: number | null;
  amount: number; // 分
  maxRetries: number;
  status: 'enabled' | 'disabled';
  remark?: string | null;
  /** 引用本计划的协议数（列表页展示/删除预检） */
  contractCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentContract {
  id: number;
  contractNo: string;
  channel: PaymentChannel;
  channelConfigId?: number | null;
  planId: number;
  planName?: string | null;
  planPeriod?: PaymentDeductPeriod | null;
  planAmount?: number | null; // 分
  signerAccount: string;
  signerName?: string | null;
  status: PaymentContractStatus;
  channelContractNo?: string | null;
  bizType: string;
  bizId: string;
  nextDeductAt?: string | null;
  lastDeductAt?: string | null;
  failCount: number;
  totalDeductCount: number;
  lastOrderNo?: string | null;
  signedAt?: string | null;
  terminatedAt?: string | null;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 会员端自动续费视图（当前协议 + VIP 状态） */
export interface MemberRenewalInfo {
  vipExpireAt?: string | null;
  contract?: PaymentContract | null;
  renewals: MemberVipRenewal[];
}

export interface MemberVipRenewal {
  id: number;
  orderNo: string;
  contractNo?: string | null;
  amount: number; // 分
  vipExpireAfter: string;
  createdAt: string;
}

/** 交易投诉/争议工单 */
export interface PaymentDispute {
  id: number;
  disputeNo: string;
  channelDisputeNo?: string | null;
  channel: PaymentChannel;
  orderNo: string;
  complainant?: string | null;
  complainantPhone?: string | null;
  type: PaymentDisputeType;
  content: string;
  amount: number; // 分
  status: PaymentDisputeStatus;
  deadline?: string | null;
  /** 是否已超时（未完结且已过处理时效） */
  overdue: boolean;
  refundNo?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentDisputeReply {
  id: number;
  author: 'merchant' | 'user' | 'system';
  content: string;
  operatorName?: string | null;
  createdAt: string;
}

export interface PaymentDisputeDetail extends PaymentDispute {
  replies: PaymentDisputeReply[];
  /** 关联订单摘要 */
  order?: { orderNo: string; subject: string; amount: number; status: PaymentOrderStatus; paidAt?: string | null } | null;
}

export interface PaymentDisputeStats {
  /** 未完结工单数 */
  open: number;
  /** 超时未完结工单数 */
  overdue: number;
  /** 近 30 天投诉单量 */
  last30dCount: number;
  /** 近 30 天投诉率（投诉数 / 成功订单数，百分比数值，如 1.25 表示 1.25%） */
  last30dRate: number;
  /** 平均处理时长（小时，仅统计已完结） */
  avgResolveHours: number;
}

export interface PaymentLink {
  id: number;
  linkNo: string;
  token: string;
  subject: string;
  amount?: number | null; // 分，null=用户填写
  payMethod?: PaymentMethod | null;
  bizType: string;
  maxUses?: number | null;
  usedCount: number;
  expiredAt?: string | null;
  status: PaymentLinkStatus;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 支付链接公开视图（C 端展示，不含敏感/审计字段） */
export interface PaymentLinkPublic {
  token: string;
  subject: string;
  amount?: number | null; // 分
  payMethod?: PaymentMethod | null;
  bizType: string;
  status: PaymentLinkStatus;
  expiredAt?: string | null;
  remainingUses?: number | null;
}

export interface PaymentRiskRule {
  id: number;
  name: string;
  scope: PaymentRiskScope;
  channel?: PaymentChannel | null;
  bizType?: string | null;
  singleLimit?: number | null; // 分
  dailyLimit?: number | null; // 分
  dailyCountLimit?: number | null;
  blocklist: string[];
  /** 白名单（openid / 用户ID / IP），命中则跳过本规则 */
  allowlist: string[];
  /** 命中动作：block=直接拦截，review=挂起人工审核 */
  action: PaymentRiskAction;
  status: 'enabled' | 'disabled';
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 风控命中留痕 */
export interface PaymentRiskHit {
  id: number;
  ruleId?: number | null;
  ruleName: string;
  action: PaymentRiskAction;
  dimension: PaymentRiskDimension;
  dimensionValue?: string | null;
  channel: PaymentChannel;
  bizType: string;
  bizId: string;
  orderNo?: string | null;
  amount: number; // 分
  openId?: string | null;
  userId?: number | null;
  clientIp?: string | null;
  createdAt: string;
}

/** 人工审核单（review 动作挂起的可疑交易） */
export interface PaymentRiskReview {
  id: number;
  reviewNo: string;
  hitId?: number | null;
  orderNo: string;
  channel: PaymentChannel;
  bizType: string;
  bizId: string;
  amount: number; // 分
  reason: string;
  status: PaymentRiskReviewStatus;
  reviewerName?: string | null;
  reviewedAt?: string | null;
  reviewRemark?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 商户资金账户（渠道维度余额快照） */
export interface PaymentAccount {
  id: number;
  channel: PaymentChannel;
  pendingSettle: number; // 分，待结算
  available: number; // 分，可用
  frozen: number; // 分，冻结
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** 余额核对结果（快照 vs 流水聚合） */
export interface PaymentAccountCheckRow {
  channel: PaymentChannel;
  pendingSettleSnapshot: number;
  pendingSettleComputed: number;
  availableSnapshot: number;
  availableComputed: number;
  /** 冻结余额快照（口径：进行中预授权冻结金额之和） */
  frozenSnapshot: number;
  frozenComputed: number;
  match: boolean;
}

/** 预授权单（资金冻结/解冻/转支付） */
export interface PaymentPreauth {
  id: number;
  preauthNo: string;
  channel: PaymentChannel;
  channelConfigId?: number | null;
  channelPreauthNo?: string | null;
  bizType: string;
  bizId: string;
  subject: string;
  payerAccount: string;
  frozenAmount: number; // 分
  capturedAmount?: number | null; // 分
  captureOrderNo?: string | null;
  status: PaymentPreauthStatus;
  errorMessage?: string | null;
  frozenAt?: string | null;
  finishedAt?: string | null;
  remark?: string | null;
  operatorName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentMethodConfig {
  id: number;
  method: PaymentMethod;
  channel: PaymentChannel;
  label: string;
  icon?: string | null;
  enabled: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentReportRow {
  key: string;
  label: string;
  gross: number; // 分
  fee: number; // 分
  refund: number; // 分
  net: number; // 分
  count: number;
}

export interface PaymentNotifyLog {
  id: number;
  channel: PaymentChannel;
  scene: string;
  orderNo?: string | null;
  signatureValid: boolean;
  result?: string | null;
  message?: string | null;
  ip?: string | null;
  /** 原始回调 body（最多 8000 字节），用于排查验签/对账争议 */
  rawBody?: string | null;
  /** 回调请求头（JSON 字符串），用于排查验签/来源 */
  headers?: string | null;
  createdAt: string;
}

/** 支付统计概览（金额单位：分） */
export interface PaymentStats {
  /** 累计成功金额（分） */
  totalAmount: number;
  /** 今日成功金额（分） */
  todayAmount: number;
  /** 今日成功订单数 */
  todayCount: number;
  /** 订单总数 */
  orderCount: number;
  /** 成功订单数（含退款中/已退款） */
  successCount: number;
  /** 累计退款金额（分） */
  refundAmount: number;
  /** 退款笔数（成功） */
  refundCount: number;
  /** 支付成功率（0-100，保留 1 位小数） */
  successRate: number;
  /** 退款率（退款金额/成功金额，0-100） */
  refundRate: number;
  /** 成功订单笔均金额（分） */
  avgAmount: number;
  byChannel: { channel: string; count: number; amount: number }[];
  byStatus: { status: string; count: number }[];
}

/** 收款趋势单点（按天） */
export interface PaymentTrendPoint {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 当日成功金额（分） */
  amount: number;
  /** 当日成功订单数 */
  count: number;
  /** 当日退款金额（分） */
  refundAmount: number;
}

/** 下单返回给前端的支付参数（按支付方式不同而不同） */
export interface CreatePaymentResult {
  orderNo: string;
  payMethod: PaymentMethod;
  channel: PaymentChannel;
  /** 微信 native：二维码内容 */
  codeUrl?: string;
  /** 跳转链接（支付宝 page/wap、微信 h5） */
  payUrl?: string;
  /** 支付宝 page 可返回自动提交表单 HTML */
  formHtml?: string;
  /** 微信 JSAPI：调起支付所需参数 */
  jsapiParams?: Record<string, string>;
  /** APP 支付：客户端调起字符串 */
  appOrderStr?: string;
  expiredAt?: string;
}

// ─── 会员中心（Member Center）────────────────────────────────────────
export interface MemberLevel {
  id: number;
  name: string;
  level: number;
  growthThreshold: number;
  /** 折扣百分比（100=原价，95=95折）*/
  discount: number;
  icon?: string | null;
  benefits: string[];
  description?: string | null;
  sort: number;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  id: number;
  username?: string | null;
  phone?: string | null;
  email?: string | null;
  nickname: string;
  avatar?: string | null;
  gender?: string | null;
  birthday?: string | null;
  status: MemberStatus;
  levelId?: number | null;
  levelName?: string | null;
  /** 付费会员（VIP）到期时间，null = 未开通 */
  vipExpireAt?: string | null;
  growthValue: number;
  experience: number;
  registerSource: string;
  registerIp?: string | null;
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  remark?: string | null;
  /** 是否已设置登录密码 */
  hasPassword?: boolean;
  /** 积分余额（关联查询时附加）*/
  pointBalance?: number;
  /** 钱包余额（分，关联查询时附加）*/
  walletBalance?: number;
  /** 会员标签（后台列表/详情附加）*/
  tags?: MemberTagBrief[];
  createdAt: string;
  updatedAt: string;
}

/** 会员标签（运营分群）*/
export interface MemberTag {
  id: number;
  name: string;
  color?: string | null;
  description?: string | null;
  sort: number;
  status: EntityStatus;
  /** 绑定会员数（列表附加）*/
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** 会员身上的标签摘要 */
export interface MemberTagBrief {
  id: number;
  name: string;
  color: string | null;
}

/** 会员站内通知 */
export interface MemberNotification {
  id: number;
  memberId: number;
  type: string;
  title: string;
  content?: string | null;
  readAt?: string | null;
  createdAt: string;
}

/** 会员权益（等级折扣与升级进度）*/
export interface MemberBenefits {
  growthValue: number;
  /** 折扣百分比（100 = 原价）*/
  discount: number;
  levelId: number | null;
  levelName: string | null;
  benefits: string[];
  nextLevel: {
    id: number;
    name: string;
    growthThreshold: number;
    discount: number;
    /** 距升级还差的成长值 */
    growthGap: number;
  } | null;
}

/** 会员邀请汇总 */
export interface MemberInviteSummary {
  inviteCode: string;
  invitedCount: number;
  totalRewardPoints: number;
  recentInvitees: { id: number; nickname: string; createdAt: string }[];
}

/** 会员轻量下拉选项（积分/钱包调整、发券搜索选择）*/
export interface MemberOption {
  id: number;
  nickname: string;
  phone?: string | null;
  username?: string | null;
  levelName?: string | null;
}

export interface MemberPointAccount {
  memberId: number;
  balance: number;
  frozen: number;
  totalEarned: number;
  totalSpent: number;
}

export interface MemberWallet {
  memberId: number;
  /** 余额（分）*/
  balance: number;
  frozen: number;
  totalRecharge: number;
  totalConsume: number;
}

export interface MemberPointTransaction {
  id: number;
  memberId: number;
  type: PointTxType;
  amount: number;
  balanceAfter: number;
  bizType?: string | null;
  bizId?: string | null;
  remark?: string | null;
  createdAt: string;
}

export interface MemberWalletTransaction {
  id: number;
  memberId: number;
  type: WalletTxType;
  /** 金额变动（分）*/
  amount: number;
  balanceAfter: number;
  bizType?: string | null;
  bizId?: string | null;
  remark?: string | null;
  createdAt: string;
}

export interface Coupon {
  id: number;
  name: string;
  type: CouponType;
  /** amount 型为减免金额（分）；percent 型为折扣百分比 */
  faceValue: number;
  threshold: number;
  maxDiscount?: number | null;
  totalQuantity: number;
  issuedQuantity: number;
  perLimit: number;
  validType: CouponValidType;
  validStart?: string | null;
  validEnd?: string | null;
  validDays?: number | null;
  /** 积分兑换所需积分（0 = 不可积分兑换）*/
  exchangePoints?: number;
  status: CouponTemplateStatus;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberCoupon {
  id: number;
  couponId: number;
  memberId: number;
  code: string;
  status: MemberCouponStatus;
  receivedAt: string;
  usedAt?: string | null;
  expireAt?: string | null;
  coupon?: Coupon;
  /** 后台列表展示用：会员昵称/标识 */
  memberName?: string;
  createdAt: string;
}

/** 会员登录结果 */
export interface MemberLoginResult {
  member: Member;
  token: { accessToken: string; refreshToken: string };
}

export interface CheckinRule {
  id: number;
  dayNumber: number;
  points: number;
  experience: number;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberCheckin {
  id: number;
  memberId: number;
  memberNickname?: string | null;
  checkinDate: string;
  consecutiveDays: number;
  pointsAwarded: number;
  experienceAwarded: number;
  isMakeup?: boolean;
  /** 备注（管理端补签原因）*/
  remark?: string | null;
  createdAt: string;
}

export interface MemberCheckinStatus {
  checkedToday: boolean;
  consecutiveDays: number;
  totalDays: number;
  todayPoints: number;
  todayExperience: number;
  nextDayPoints: number;
  nextDayExperience: number;
  thisMonthDates: string[];
}

export type CheckinMilestoneRewardType = 'points' | 'coupon';

export interface CheckinSettings {
  makeupEnabled: boolean;
  makeupCostPoints: number;
  makeupMaxDays: number;
  updatedAt: string;
}

export interface CheckinMilestone {
  id: number;
  title: string;
  cumulativeDays: number;
  rewardType: CheckinMilestoneRewardType;
  rewardPoints: number;
  couponId?: number | null;
  couponName?: string | null;
  enabled: boolean;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberMilestoneStatusItem {
  id: number;
  title: string;
  cumulativeDays: number;
  rewardType: CheckinMilestoneRewardType;
  rewardPoints: number;
  couponName?: string | null;
  achieved: boolean;
  achievedAt?: string | null;
}

export interface MemberMilestoneStatus {
  totalDays: number;
  milestones: MemberMilestoneStatusItem[];
}

export interface MakeupCheckinResult {
  checkinDate: string;
  pointsAwarded: number;
  experienceAwarded: number;
  costPoints: number;
  consecutiveDays: number;
}

export interface SslCertificate {
  id: number;
  name: string;
  domain: string;
  type: 'self_signed' | 'uploaded' | 'letsencrypt';
  certPath: string | null;
  keyPath: string | null;
  issuer: string | null;
  subject: string | null;
  validFrom: string | null;
  validTo: string | null;
  fingerprint: string | null;
  serialNumber: string | null;
  status: 'valid' | 'expiring' | 'expired' | 'invalid';
  autoRenew: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateSelfSignedCertInput {
  name: string;
  domain: string;
  days?: number;
  country?: string;
  organization?: string;
  outputDir?: string;
}

export interface UploadCertInput {
  name: string;
  domain: string;
  certContent: string;
  keyContent: string;
}

// ─── 公众号管理 ────────────────────────────────────────────────────────────────
export type MpAccountType = 'subscribe' | 'service' | 'test';
export type MpEncryptMode = 'plaintext' | 'compatible' | 'safe';

export interface MpAccount {
  id: number;
  name: string;
  account: string | null;
  appId: string;
  /** 列表/详情返回时脱敏 */
  appSecret?: string;
  token: string;
  encodingAesKey: string | null;
  encryptMode: MpEncryptMode;
  type: MpAccountType;
  qrCodeUrl: string | null;
  isDefault: boolean;
  autoCreateMember: boolean;
  contentCheckEnabled: boolean;
  status: EntityStatus;
  remark: string | null;
  tenantId?: number | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export type MpFanSubscribe = 'subscribed' | 'unsubscribed';

export interface MpTag {
  id: number;
  accountId: number;
  wechatTagId: number | null;
  name: string;
  fansCount: number;
  tenantId?: number | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MpFan {
  id: number;
  accountId: number;
  openid: string;
  nickname: string | null;
  avatar: string | null;
  /** 0 未知 / 1 男 / 2 女 */
  sex: number;
  country: string | null;
  province: string | null;
  city: string | null;
  language: string | null;
  subscribe: MpFanSubscribe;
  subscribeTime: string | null;
  remark: string | null;
  tagIds: number[];
  unionid: string | null;
  memberId: number | null;
  blacklisted: boolean;
  tenantId?: number | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export type MpMessageDirection = 'in' | 'out';
export type MpMessageType = 'text' | 'image' | 'voice' | 'video' | 'shortvideo' | 'location' | 'link' | 'event';
export type MpMessageStatus = 'received' | 'sent' | 'failed';

export interface MpMessage {
  id: number;
  accountId: number;
  openid: string;
  direction: MpMessageDirection;
  msgType: MpMessageType;
  content: string | null;
  mediaId: string | null;
  mediaUrl: string | null;
  event: string | null;
  msgId: string | null;
  status: MpMessageStatus;
  errorMsg: string | null;
  createdAt: string;
}

/** 会话（按 openid 聚合，含最后一条消息摘要） */
export interface MpConversation {
  openid: string;
  nickname: string | null;
  avatar: string | null;
  lastContent: string | null;
  lastMsgType: MpMessageType;
  lastDirection: MpMessageDirection;
  lastTime: string;
  messageCount: number;
}

export type MpAutoReplyType = 'subscribe' | 'keyword' | 'default';
export type MpAutoReplyMatch = 'exact' | 'contain' | 'regex';
export type MpReplyContentType = 'text' | 'image' | 'voice' | 'video' | 'news';

export interface MpReplyArticle {
  title: string;
  description?: string;
  picUrl?: string;
  url: string;
}

export interface MpAutoReply {
  id: number;
  accountId: number;
  replyType: MpAutoReplyType;
  keyword: string | null;
  matchType: MpAutoReplyMatch;
  contentType: MpReplyContentType;
  content: string | null;
  mediaId: string | null;
  newsArticles: MpReplyArticle[] | null;
  transferToKf: boolean;
  status: EntityStatus;
  sort: number;
  tenantId?: number | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MpUnmatchedKeyword {
  id: number;
  accountId: number;
  keyword: string;
  count: number;
  lastAt: string;
}

export type MpMenuStatus = 'draft' | 'published';

/** 微信自定义菜单按钮（可嵌套二级 sub_button） */
export interface MpMenuButton {
  name: string;
  type?: string;
  key?: string;
  url?: string;
  appid?: string;
  pagepath?: string;
  media_id?: string;
  article_id?: string;
  sub_button?: MpMenuButton[];
}

export interface MpMenu {
  id: number;
  accountId: number;
  buttons: MpMenuButton[];
  status: MpMenuStatus;
  publishedAt: string | null;
  tenantId?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 个性化菜单匹配规则（字段值均为字符串，对齐微信 matchrule） */
export interface MpMenuMatchRule {
  tagId?: string;
  sex?: string;
  country?: string;
  province?: string;
  city?: string;
  clientPlatformType?: string;
  language?: string;
}

export interface MpConditionalMenu {
  id: number;
  accountId: number;
  name: string;
  buttons: MpMenuButton[];
  matchRule: MpMenuMatchRule;
  menuId: string | null;
  status: MpMenuStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MpMaterialType = 'image' | 'voice' | 'video' | 'thumb';

export interface MpMaterial {
  id: number;
  accountId: number;
  type: MpMaterialType;
  name: string;
  wechatMediaId: string | null;
  url: string | null;
  fileSize: number | null;
  tenantId?: number | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 图文消息单篇文章 */
export interface MpArticle {
  title: string;
  author?: string;
  digest?: string;
  content: string;
  thumbUrl?: string;
  thumbMediaId?: string;
  contentSourceUrl?: string;
  showCoverPic?: boolean;
}

export type MpDraftStatus = 'draft' | 'published';

export interface MpDraft {
  id: number;
  accountId: number;
  title: string;
  articles: MpArticle[];
  wechatMediaId: string | null;
  status: MpDraftStatus;
  tenantId?: number | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MpMessageTemplate {
  id: number;
  accountId: number;
  templateId: string;
  title: string;
  content: string | null;
  example: string | null;
  tenantId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export type MpTemplateSendStatus = 'success' | 'failed';

export interface MpTemplateSendLog {
  id: number;
  accountId: number;
  templateId: string;
  openid: string;
  data: Record<string, unknown> | null;
  url: string | null;
  status: MpTemplateSendStatus;
  errorMsg: string | null;
  msgId: string | null;
  createdAt: string;
}

/** 公众号数据统计（本地聚合） */
export interface MpStats {
  fanTotal: number;
  fanSubscribed: number;
  fanUnsubscribed: number;
  tagTotal: number;
  materialTotal: number;
  draftTotal: number;
  messageIn: number;
  messageOut: number;
  autoReplyTotal: number;
  fanTrend: { date: string; count: number }[];
  messageTrend: { date: string; in: number; out: number }[];
}

export interface MpDatacube {
  beginDate: string;
  endDate: string;
  userSummary: { refDate: string; newUser: number; cancelUser: number }[];
  userCumulate: { refDate: string; cumulateUser: number }[];
  upstreamMsg: { refDate: string; msgUser: number; msgCount: number }[];
  articleSummary: { refDate: string; pageReadCount: number }[];
  userShare: { refDate: string; shareCount: number; shareUser: number }[];
  interfaceSummary: { refDate: string; callbackCount: number; failCount: number; totalTimeCost: number; maxTimeCost: number }[];
}

// ─── 公众号群发消息 ──────────────────────────────────────────────────────────
export type MpBroadcastType = 'text' | 'image' | 'mpnews';
export type MpBroadcastTarget = 'all' | 'tag';
export type MpBroadcastStatus = 'draft' | 'sent' | 'failed';

export interface MpBroadcast {
  id: number;
  accountId: number;
  msgType: MpBroadcastType;
  target: MpBroadcastTarget;
  tagId: number | null;
  content: string | null;
  mediaId: string | null;
  status: MpBroadcastStatus;
  wechatMsgId: string | null;
  scheduledAt: string | null;
  errorMsg: string | null;
  sentAt: string | null;
  tenantId?: number | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MpBroadcastResult {
  msgStatus: string;
  totalCount?: number;
  filterCount?: number;
  sentCount?: number;
  errorCount?: number;
}

export interface MpTemplateIndustry {
  primaryIndustry: { firstClass: string; secondClass: string } | null;
  secondaryIndustry: { firstClass: string; secondClass: string } | null;
}

export interface MpJsConfig {
  appId: string;
  timestamp: number;
  nonceStr: string;
  signature: string;
}

// ─── 公众号带参数二维码 ───────────────────────────────────────────────────────
export type MpQrcodeType = 'temporary' | 'permanent';

export interface MpQrcode {
  id: number;
  accountId: number;
  type: MpQrcodeType;
  sceneStr: string;
  name: string;
  ticket: string | null;
  url: string | null;
  expireSeconds: number | null;
  scanCount: number;
  rewardPoints: number;
  tenantId?: number | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

// ─── 公众号多客服账号 ─────────────────────────────────────────────────────────
export interface MpKfAccount {
  id: number;
  accountId: number;
  kfAccount: string;
  nickname: string;
  avatar: string | null;
  kfId: string | null;
  inviteStatus: string;
  inviteWx: string | null;
  status: EntityStatus;
  tenantId?: number | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

// ─── 多客服会话治理（实时状态机）──────────────────────────────────────────────
export type MpKfSessionStatus = 'waiting' | 'active' | 'closed';
export type MpKfSessionCloseReason = 'manual' | 'wait_timeout' | 'idle_timeout' | 'system';
export type MpKfRoutingStrategy = 'manual' | 'round_robin' | 'least_active';
export type MpKfSessionEventType = 'create' | 'assign' | 'accept' | 'transfer' | 'reroute' | 'close';

export interface MpKfSession {
  id: number;
  accountId: number;
  openid: string;
  kfId: number | null;
  /** 承接客服昵称（联表） */
  kfNickname: string | null;
  /** 粉丝昵称（联表） */
  fanNickname: string | null;
  fanAvatar: string | null;
  status: MpKfSessionStatus;
  priority: number;
  source: string | null;
  unreadCount: number;
  lastFanMsgAt: string | null;
  lastKfMsgAt: string | null;
  lastMsgAt: string | null;
  waitingSince: string | null;
  acceptedAt: string | null;
  closedAt: string | null;
  closeReason: MpKfSessionCloseReason | null;
  rating: number | null;
  ratingRemark: string | null;
  remark: string | null;
  /** 已等待秒数（waiting 时由后端计算） */
  waitSeconds?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MpKfSessionEvent {
  id: number;
  sessionId: number;
  accountId: number;
  type: MpKfSessionEventType;
  fromKfId: number | null;
  toKfId: number | null;
  fromKfNickname: string | null;
  toKfNickname: string | null;
  operatorId: number | null;
  operatorName: string | null;
  detail: string | null;
  createdAt: string;
}

export interface MpKfSessionDetail extends MpKfSession {
  events: MpKfSessionEvent[];
  messages: MpMessage[];
}

export interface MpKfRoutingConfig {
  id: number;
  accountId: number;
  enabled: boolean;
  strategy: MpKfRoutingStrategy;
  maxConcurrent: number;
  waitTimeoutMinutes: number;
  idleTimeoutMinutes: number;
  autoCloseEnabled: boolean;
  welcomeText: string | null;
  updatedAt: string;
}

export interface MpKfAgentLoad {
  kfId: number;
  kfAccount: string;
  nickname: string;
  status: EntityStatus;
  activeCount: number;
}

export interface MpKfSessionStats {
  waiting: number;
  active: number;
  closedToday: number;
  /** 今日已结束会话平均等待接入秒数 */
  avgWaitSeconds: number;
  /** 今日已结束会话平均满意度评分（1-5） */
  avgRating: number;
  agents: MpKfAgentLoad[];
}

export interface MpKfSessionReportItem {
  date: string;
  created: number;
  closed: number;
  avgWaitSeconds: number;
  avgRating: number;
}

// ════════════════════════════════════════════════════════════════════════════
// 报表中心（Report Center）—— 通用报表设计器 / 数据大屏
// ════════════════════════════════════════════════════════════════════════════

/** 数据源类型清单（单一来源，派生 type/zod/DTO，防止"半加一个类型"漂移） */
export const REPORT_DATASOURCE_TYPES = ['api', 'sql', 'mysql', 'postgresql', 'sqlserver', 'static'] as const;
/** 数据源类型：api=远程 HTTP；sql=内置只读主库；mysql/postgresql/sqlserver=外部数据库；static=静态/文件 */
export type ReportDatasourceType = typeof REPORT_DATASOURCE_TYPES[number];
export const REPORT_RESOURCE_TYPES = [
  'datasource', 'dataset', 'dashboard', 'metric', 'print_template', 'fill_template', 'asset_template',
] as const;
export type ReportResourceType = typeof REPORT_RESOURCE_TYPES[number];

export const REPORT_METRIC_TYPES = ['simple', 'ratio', 'composite'] as const;
export type ReportMetricType = typeof REPORT_METRIC_TYPES[number];
export const REPORT_METRIC_LIFECYCLE_STATUSES = ['draft', 'published', 'deprecated'] as const;
export type ReportMetricLifecycleStatus = typeof REPORT_METRIC_LIFECYCLE_STATUSES[number];
export const REPORT_ACL_SUBJECT_TYPES = ['user', 'role', 'department', 'user_group'] as const;
export type ReportAclSubjectType = typeof REPORT_ACL_SUBJECT_TYPES[number];
export const REPORT_ACL_ROLES = ['viewer', 'editor', 'owner'] as const;
export type ReportAclRole = typeof REPORT_ACL_ROLES[number];
export const REPORT_APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type ReportApprovalStatus = typeof REPORT_APPROVAL_STATUSES[number];
export const REPORT_TRANSFER_STATUSES = ['pending', 'accepted', 'rejected', 'cancelled'] as const;
export type ReportTransferStatus = typeof REPORT_TRANSFER_STATUSES[number];
export const REPORT_ENVIRONMENT_KINDS = ['development', 'testing', 'staging', 'production'] as const;
export type ReportEnvironmentKind = typeof REPORT_ENVIRONMENT_KINDS[number];
export const REPORT_PROMOTION_STATUSES = [
  'pending', 'approved', 'deploying', 'succeeded', 'failed', 'cancelled', 'rolled_back',
] as const;
export type ReportPromotionStatus = typeof REPORT_PROMOTION_STATUSES[number];
export const REPORT_DQ_RULE_TYPES = [
  'not_null', 'uniqueness', 'range', 'pattern', 'freshness', 'row_count', 'custom_sql',
] as const;
export type ReportDqRuleType = typeof REPORT_DQ_RULE_TYPES[number];
export const REPORT_DQ_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type ReportDqSeverity = typeof REPORT_DQ_SEVERITIES[number];
export const REPORT_DQ_RUN_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type ReportDqRunStatus = typeof REPORT_DQ_RUN_STATUSES[number];
export const REPORT_DQ_ANOMALY_STATUSES = ['open', 'acknowledged', 'resolved', 'ignored'] as const;
export type ReportDqAnomalyStatus = typeof REPORT_DQ_ANOMALY_STATUSES[number];
export const REPORT_MATERIALIZATION_STRATEGIES = ['full', 'incremental'] as const;
export type ReportMaterializationStrategy = typeof REPORT_MATERIALIZATION_STRATEGIES[number];
export const REPORT_SNAPSHOT_STATUSES = ['pending', 'building', 'ready', 'failed', 'expired', 'deleted'] as const;
export type ReportSnapshotStatus = typeof REPORT_SNAPSHOT_STATUSES[number];
export const REPORT_QUOTA_SCOPES = ['tenant', 'user'] as const;
export type ReportQuotaScope = typeof REPORT_QUOTA_SCOPES[number];
export const REPORT_SLA_TYPES = ['freshness', 'query_latency_p95', 'availability', 'dq_score'] as const;
export type ReportSlaType = typeof REPORT_SLA_TYPES[number];
export const REPORT_SLA_VIOLATION_STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export type ReportSlaViolationStatus = typeof REPORT_SLA_VIOLATION_STATUSES[number];
export const REPORT_ASSET_TEMPLATE_TYPES = ['dashboard', 'widget', 'print', 'semantic_model'] as const;
export type ReportAssetTemplateType = typeof REPORT_ASSET_TEMPLATE_TYPES[number];
export const REPORT_CHATBI_SESSION_STATUSES = ['active', 'archived'] as const;
export type ReportChatbiSessionStatus = typeof REPORT_CHATBI_SESSION_STATUSES[number];
export const REPORT_CHATBI_MESSAGE_ROLES = ['user', 'assistant', 'system', 'tool'] as const;
export type ReportChatbiMessageRole = typeof REPORT_CHATBI_MESSAGE_ROLES[number];
export const REPORT_FILL_TEMPLATE_STATUSES = ['draft', 'published', 'disabled'] as const;
export type ReportFillTemplateStatus = typeof REPORT_FILL_TEMPLATE_STATUSES[number];
export const REPORT_FILL_RECORD_STATUSES = [
  'draft', 'submitted', 'in_review', 'approved', 'rejected', 'cancelled',
] as const;
export type ReportFillRecordStatus = typeof REPORT_FILL_RECORD_STATUSES[number];
export const REPORT_FILL_SYNC_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;
export type ReportFillSyncStatus = typeof REPORT_FILL_SYNC_STATUSES[number];

/** 外部数据库类型（凭据加密 + 走外部连接池取数） */
export const EXTERNAL_DB_TYPES = ['mysql', 'postgresql', 'sqlserver'] as const;
/** 以 SQL 文本取数的类型（内置主库 + 外部库），统一驱动 SQL 编辑 / 系统变量解析 */
export const SQL_DATASET_TYPES = ['sql', 'mysql', 'postgresql', 'sqlserver'] as const;
/** 是否外部数据库类型 */
export function isExternalDbType(t: ReportDatasourceType): boolean {
  return (EXTERNAL_DB_TYPES as readonly string[]).includes(t);
}
/** 是否以 SQL 取数（内置主库或外部库） */
export function isSqlLikeType(t: ReportDatasourceType): boolean {
  return (SQL_DATASET_TYPES as readonly string[]).includes(t);
}

/** 数据集字段（列）数据类型 */
export type ReportFieldType = 'string' | 'number' | 'date' | 'boolean';
/** 仪表盘组件类型清单（单一来源） */
export const REPORT_WIDGET_TYPES = [
  'kpi', 'table', 'pivot', 'text',
  'bar', 'line', 'area', 'dualAxis',
  'pie', 'scatter', 'radar', 'funnel', 'gauge', 'treemap',
  'flipper', 'scrollList', 'map',
  'sankey', 'wordCloud', 'liquid', 'heatmap',
  'image', 'iframe',
] as const;
/** 仪表盘组件类型 */
export type ReportWidgetType = typeof REPORT_WIDGET_TYPES[number];

/** API 数据源连接配置 */
export interface ReportApiDatasourceConfig {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string> | null;
}
/** SQL 数据源连接配置（内置只读主库） */
export interface ReportSqlDatasourceConfig {
  connection: 'internal';
}
/** 外部数据库连接配置（mysql / postgresql）；password 仅写入，读取时脱敏 */
export interface ReportExternalDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string | null;
  /** 是否启用 SSL */
  ssl?: boolean;
  /** 读取时返回的脱敏标记（service 注入，前端只读）*/
  hasPassword?: boolean;
}
export type ReportDatasourceConfig =
  | ReportApiDatasourceConfig
  | ReportSqlDatasourceConfig
  | ReportExternalDbConfig
  | Record<string, never>;

export interface ReportDatasource {
  id: number;
  name: string;
  ownerId?: number | null;
  ownerName?: string | null;
  folderId?: number | null;
  folderName?: string | null;
  type: ReportDatasourceType;
  config: ReportDatasourceConfig;
  status: 'enabled' | 'disabled';
  lastTestAt?: string | null;
  lastTestStatus?: 'success' | 'failed' | 'unknown' | null;
  lastTestLatencyMs?: number | null;
  lastTestError?: string | null;
  consecutiveFailures?: number;
  remark?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 数据集字段（列）定义 */
export interface ReportField {
  /** 列名（SQL 列名 / API 字段名） */
  name: string;
  /** 显示名 */
  label: string;
  type: ReportFieldType;
  /** 显示格式化（语义层）：数字/百分比/货币/日期/字典翻译 */
  format?: ReportFieldFormat;
}

/** 字段显示格式化（语义层 lite） */
export interface ReportFieldFormat {
  kind: 'number' | 'percent' | 'currency' | 'date' | 'datetime' | 'dict';
  /** number/percent/currency：小数位 */
  decimals?: number;
  /** number/currency：千分位 */
  thousands?: boolean;
  /** currency：货币符号前缀（默认 ¥） */
  currencySymbol?: string;
  /** 通用前缀/后缀 */
  prefix?: string;
  suffix?: string;
  /** dict：字典编码（取字典项 value→label 翻译） */
  dictCode?: string;
}

/** 计算字段（衍生列）：在取数结果上用表达式计算 */
export interface ReportComputedField {
  name: string;
  label: string;
  /** 表达式，引用其他列用 row.列名（如 row.gross - row.fee）*/
  expression: string;
  type?: ReportFieldType;
}

export type ReportSortOrder = 'asc' | 'desc';

export interface ReportDatasetQueryOptions {
  limit?: number;
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: ReportSortOrder;
  timeoutMs?: number;
  maxRows?: number;
  maxBytes?: number;
  concurrencyKey?: string;
  quotaKey?: string;
}

/** 可视化建模：指标（聚合列） */
export interface ReportVisualMetric {
  field: string;
  aggregate: 'sum' | 'avg' | 'max' | 'min' | 'count';
  alias?: string;
}
/** 可视化建模：筛选条件 */
export interface ReportVisualFilter {
  field: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like';
  value: string;
}
export interface ReportVisualJoin {
  type: 'inner' | 'left';
  table: string;
  alias?: string;
  sourceAlias?: string;
  sourceField: string;
  targetField: string;
}
/** 可视化建模模型（选表拖字段生成 SQL，内置库专用） */
export interface ReportVisualModel {
  table: string;
  alias?: string;
  joins?: ReportVisualJoin[];
  /** 维度列（GROUP BY） */
  dimensions: string[];
  /** 指标列（聚合） */
  metrics: ReportVisualMetric[];
  filters?: ReportVisualFilter[];
  orderBy?: { field: string; order: ReportSortOrder } | null;
  limit?: number | null;
}

/** 可视化建模：内置库列元数据 */
export interface ReportMetaColumn {
  name: string;
  type: string;
}

/** SQL 数据集内容 */
export interface ReportSqlDatasetContent {
  sql: string;
  /** 可视化建模模型（回显编辑用；SQL 为最终执行内容） */
  visual?: ReportVisualModel | null;
}
/** API 数据集内容 */
export interface ReportApiDatasetContent {
  /** 响应中数组所在路径，点分隔（如 data.list），留空表示根即数组 */
  itemsPath?: string | null;
  /** 附加查询参数 */
  params?: Record<string, string> | null;
}
/** 静态数据集内容（内联 JSON / 文件上传解析结果） */
export interface ReportStaticDatasetContent {
  /** 数据行 */
  data: Record<string, unknown>[];
  /** 列顺序（可空，缺省按首行键） */
  columns?: string[];
}
export type ReportDatasetContent =
  | ReportSqlDatasetContent
  | ReportApiDatasetContent
  | ReportStaticDatasetContent
  | Record<string, never>;

export interface ReportDataset {
  id: number;
  name: string;
  ownerId?: number | null;
  ownerName?: string | null;
  folderId?: number | null;
  folderName?: string | null;
  datasourceId: number;
  /** JOIN 冗余：数据源名称 */
  datasourceName?: string | null;
  /** 从数据源继承的类型 */
  type: ReportDatasourceType;
  content: ReportDatasetContent;
  fields: ReportField[];
  /** 参数定义（SQL ${name} 占位 / API 注入） */
  params: ReportDatasetParam[];
  /** 计算字段（衍生列） */
  computedFields: ReportComputedField[];
  /** 结果缓存 TTL（秒），0=不缓存 */
  cacheTtl: number;
  /** 物化快照配置（定时刷新到持久层，给大屏降压） */
  materialize?: ReportDatasetMaterialize;
  /** 行级权限规则（仅 SQL 型数据集生效） */
  rowRules?: ReportRowRule[];
  status: 'enabled' | 'disabled';
  remark?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 数据集行级权限规则（仅 SQL 型数据集生效）。
 * 取数时：登录用户命中的规则（角色匹配）以 OR 拼接为 WHERE 包裹原查询；
 * 未命中任何规则 = 不受限；超级管理员与无用户上下文场景（Cron/公开分享）跳过。
 */
export interface ReportRowRule {
  /** 生效角色 code 列表；空/缺省 = 对所有登录用户生效 */
  roles?: string[];
  /** WHERE 片段（不含 WHERE 关键字），可引用 ${__userId} 等系统变量与数据集参数；禁止分号 */
  where: string;
  enabled?: boolean;
  remark?: string;
}

/** 数据集物化快照配置 */
export interface ReportDatasetMaterialize {
  /** 是否启用物化（启用后取数优先返回快照，忽略运行时参数） */
  enabled: boolean;
  /** 刷新 Cron（留空=仅手动刷新） */
  cron?: string;
  /** full=全量替换；incremental=按 keyField 与增量窗口合并 */
  strategy?: ReportMaterializationStrategy;
  keyField?: string | null;
  deltaWindowMinutes?: number | null;
  /** 最近刷新时间（展示用，只读，服务端注入） */
  refreshedAt?: string | null;
  /** 最近刷新时间戳（epoch 毫秒，调度比较用，避免展示串再解析的时区歧义） */
  refreshedAtMs?: number | null;
}

/** 数据集取数结果 */
export interface ReportResultField extends ReportField {
  source?: 'declared' | 'computed' | 'inferred';
}

export interface ReportDataResult {
  columns: string[];
  fields: ReportResultField[];
  rows: Record<string, unknown>[];
  total?: number | null;
  bytes?: number | null;
  truncated?: boolean;
  truncatedReason?: string | null;
  quotaRemaining?: number | null;
  costUnits?: number | null;
  queueDurationMs?: number | null;
}

export interface ReportWidgetDataError {
  code: number;
  message: string;
}

export interface ReportWidgetDataResult {
  data: ReportDataResult | null;
  error: ReportWidgetDataError | null;
  durationMs: number;
  cacheHit: boolean;
}

export interface ReportDashboardDataRequest {
  filters?: Record<string, unknown>;
  limit?: number;
  widgetQueries?: Record<string, ReportDatasetQueryOptions>;
}

export interface ReportDatasetExecutionLog {
  id: number;
  datasetId: number | null;
  datasetName?: string | null;
  datasourceId: number | null;
  datasourceName?: string | null;
  userId: number | null;
  username?: string | null;
  tenantId: number | null;
  scene: string;
  sourceRefId?: string | null;
  durationMs: number;
  rowCount: number | null;
  bytes?: number | null;
  truncated?: boolean;
  slow?: boolean;
  cacheHit: boolean;
  success: boolean;
  errorCode?: number | null;
  errorMessage?: string | null;
  paramKeys?: string[];
  executedAt: string;
}

export interface ReportLookupOption {
  id: number;
  name: string;
  status?: 'enabled' | 'disabled' | null;
  type?: ReportDatasourceType | null;
  categoryId?: number | null;
  categoryName?: string | null;
  datasourceId?: number | null;
  datasourceName?: string | null;
  dashboardCount?: number;
}

export interface ReportBatchStatusInput {
  ids: number[];
  status: 'enabled' | 'disabled';
}

export interface ReportCloneInput {
  name?: string;
}

export interface ReportRuntimeGovernance {
  slowQueryMs: number;
  dashboardMaxConcurrent: number;
  datasetMaxRows: number;
  datasetMaxBytes: number;
  tenantMaxConcurrent?: number;
  userMaxConcurrent?: number;
  tenantDailyQueryLimit?: number;
  userDailyQueryLimit?: number;
  tenantDailyCostLimit?: number;
  userDailyCostLimit?: number;
}

export interface ReportExecutionStatsSlowItem {
  datasetId: number | null;
  datasetName?: string | null;
  datasourceId: number | null;
  datasourceName?: string | null;
  scene: string;
  count: number;
  avgDurationMs: number;
  maxDurationMs: number;
  lastExecutedAt: string | null;
}

export interface ReportExecutionStats {
  total: number;
  successCount: number;
  successRate: number;
  p95DurationMs: number;
  avgDurationMs: number;
  cacheHitRate: number;
  slowCount: number;
  truncatedCount: number;
  governance: ReportRuntimeGovernance;
  capacity: {
    globalLimit: number;
    running: number;
    queueDepth: number;
    datasourceQueues: number;
  };
  series: Array<{
    bucket: string;
    queries: number;
    rows: number;
    bytes: number;
    costUnits: number;
    avgDurationMs: number;
    queueMs: number;
  }>;
  topSlowQueries: ReportExecutionStatsSlowItem[];
}

/** 网格布局项（对齐 react-grid-layout 的 Layout item） */
export interface ReportGridItem {
  /** 与 widget.i 对应 */
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

/** 自由画布定位项（绝对像素，用于大屏 canvas 模式） */
export interface ReportCanvasItem {
  /** 与 widget.i 对应 */
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 层级 */
  z?: number;
}

/** 组件字段映射 + 图表选项 */
export interface ReportWidgetOptions {
  /** 柱/线/饼：分类（x 轴）字段 */
  categoryField?: string;
  /** 柱/线/饼：指标（y 轴）字段，可多列 */
  valueFields?: string[];
  /** 指标卡：取值列 */
  valueField?: string;
  /** 指标卡：聚合方式 */
  aggregate?: 'sum' | 'avg' | 'max' | 'min' | 'count' | 'first';
  /** 指标卡：单位后缀 */
  unit?: string;
  /** 表格：展示列（留空=全部字段） */
  columns?: ReportField[];
  // ── 图表通用 ──
  /** 折线/面积：平滑曲线 */
  smooth?: boolean;
  /** 柱/面积：堆叠 */
  stack?: boolean;
  /** 柱/面积：百分比堆叠 */
  percent?: boolean;
  /** 柱：水平条形 */
  horizontal?: boolean;
  /** 是否显示数据标签 */
  showLabel?: boolean;
  // ── 组合图（双轴）──
  /** 右轴（次坐标）指标字段 */
  secondaryFields?: string[];
  /** 右轴渲染为折线（否则柱） */
  secondaryAsLine?: boolean;
  // ── 排序 / TopN ──
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  topN?: number;
  // ── 指标卡增强 ──
  /** 对比字段（环比/同比基准） */
  compareField?: string;
  /** 目标值（常量） */
  targetValue?: number;
  /** 迷你趋势字段（按 categoryField 排列） */
  trendField?: string;
  // ── 数值格式 ──
  decimals?: number;
  prefix?: string;
  // ── 表格增强 ──
  /** 分页大小（0=不分页） */
  pageSize?: number;
  /** 显示合计行 */
  showSummary?: boolean;
  /** 条件格式规则 */
  conditionalFormats?: ReportConditionalFormat[];
  // ── 透视表 ──
  pivotRows?: string[];
  pivotColumns?: string[];
  pivotValueField?: string;
  pivotAggregate?: 'sum' | 'avg' | 'max' | 'min' | 'count';
  // ── 文本组件 ──
  /** 文本内容（支持 ${filterId} 占位） */
  text?: string;
  // ── 仪表盘 gauge / 雷达 ──
  min?: number;
  max?: number;
  // ── 大屏：数字翻牌器 flipper ──
  /** 翻牌固定位数（不足补 0） */
  flipDigits?: number;
  // ── 大屏：滚动榜单 scrollList ──
  /** 滚动速度（行/秒），0=不滚动 */
  scrollSpeed?: number;
  /** 显示排名序号 */
  showRank?: boolean;
  // ── 大屏：地图 map ──
  /** geojson 地图数据 URL（懒加载注册） */
  mapGeojsonUrl?: string;
  /** 已注册地图名称（默认取 URL 推导） */
  mapName?: string;
  /** 区域名字段（匹配 geojson 的 name） */
  areaField?: string;
  // ── 桑基图 sankey ──
  /** 源节点字段 */
  sourceField?: string;
  /** 目标节点字段 */
  targetField?: string;
  // ── 词云 wordCloud ──
  /** 词语字段（沿用 categoryField 亦可） */
  wordField?: string;
  // ── 热力图 heatmap ──
  /** 热力图 X 字段（沿用 categoryField）、Y 字段 */
  yField?: string;
  // ── 水波球 liquid ──（沿用 valueField + max）
  // ── 媒体：图片 image / 内嵌 iframe ──
  /** 资源 URL（image 图片地址 / iframe 内嵌地址；支持 ${filterId} 占位） */
  src?: string;
  /** 图片填充方式 */
  fit?: 'contain' | 'cover' | 'fill';
}

/** 仪表盘组件配置 */
export interface ReportWidget {
  /** 组件 id（与 layout item 的 i 对应） */
  i: string;
  type: ReportWidgetType;
  title: string;
  datasetId?: number | null;
  /** 语义指标来源；仅 KPI/gauge/flipper/liquid 组件使用，优先于 datasetId。 */
  metricId?: number | null;
  options: ReportWidgetOptions;
  /** 全局筛选器 → 数据集参数 绑定 */
  paramBindings?: ReportWidgetParamBinding[];
  /** 点击联动：点击分类写入某筛选器 */
  interaction?: ReportWidgetInteraction;
  /** 钻取配置 */
  drilldown?: ReportWidgetDrilldown;
  /** 组件样式 */
  style?: ReportWidgetStyle;
  /** 多屏轮播：所属页码（1 基，缺省=第 1 页） */
  page?: number;
}

export interface ReportDashboard {
  id: number;
  name: string;
  ownerId?: number | null;
  ownerName?: string | null;
  folderId?: number | null;
  folderName?: string | null;
  layout: ReportGridItem[];
  /** 自由画布定位（canvas 模式） */
  canvasLayout: ReportCanvasItem[];
  widgets: ReportWidget[];
  /** 全局筛选器 */
  filters: ReportFilter[];
  /** 全局配置（主题/大屏/自动刷新） */
  config: ReportDashboardConfig;
  categoryId?: number | null;
  categoryName?: string | null;
  /** 当前用户是否已收藏（列表/详情按需附加） */
  favorited?: boolean;
  status: 'enabled' | 'disabled';
  lifecycleStatus: ReportDashboardLifecycleStatus;
  revision: number;
  publishedSnapshot?: ReportDashboardSnapshot | null;
  publishedAt?: string | null;
  publishedBy?: number | null;
  publishedByName?: string | null;
  remark?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

// ─── 报表中心 · 第二/三期扩展类型 ──────────────────────────────────────────────

/** 数据集参数定义 */
export interface ReportDatasetParam {
  name: string;
  label: string;
  type: ReportFieldType;
  required?: boolean;
  defaultValue?: string | number | boolean | null;
}

/** 表格条件格式规则 */
export interface ReportConditionalFormat {
  field: string;
  op: 'gte' | 'lte' | 'gt' | 'lt' | 'eq' | 'neq' | 'between';
  value: number;
  value2?: number;
  color?: string;
  background?: string;
}

/** 全局筛选器类型 */
export type ReportFilterType = 'date' | 'daterange' | 'select' | 'multiSelect' | 'input' | 'numberRange';

/** 筛选器选项来源 */
export interface ReportFilterOptionSource {
  kind: 'static' | 'dataset';
  options?: { value: string; label: string }[];
  datasetId?: number | null;
  valueField?: string;
  labelField?: string;
}

/** 仪表盘全局筛选器 */
export interface ReportFilter {
  id: string;
  label: string;
  type: ReportFilterType;
  defaultValue?: unknown;
  optionSource?: ReportFilterOptionSource;
  /** 栅格宽度（1-24） */
  width?: number;
}

/** 筛选器 → 数据集参数 绑定 */
export interface ReportWidgetParamBinding {
  filterId: string;
  param: string;
}

/** 点击联动配置 */
export interface ReportWidgetInteraction {
  enabled?: boolean;
  /** 点击分类时写入的目标筛选器 id */
  setFilterId?: string;
}

/** 钻取配置 */
export interface ReportWidgetDrilldown {
  enabled?: boolean;
  type?: 'fields' | 'dashboard' | 'url';
  /** type=fields：维度层级（逐层替换 categoryField） */
  fields?: string[];
  /** type=dashboard：目标仪表盘 */
  targetDashboardId?: number | null;
  /** type=url：目标外链（支持 {value} 占位） */
  url?: string;
  /** 传参：点击值写入目标筛选器/参数名 */
  paramName?: string;
}

/** 组件样式 */
export interface ReportWidgetStyle {
  background?: string;
  showHeader?: boolean;
  borderless?: boolean;
}

/** 大屏自由画布设置 */
export interface ReportScreenConfig {
  /** 设计宽度（px） */
  width: number;
  /** 设计高度（px） */
  height: number;
  /** 背景色 */
  background?: string;
  /** 背景图 URL */
  backgroundImage?: string;
  /** 缩放方式：fit=等比铺满(letterbox)，width=按宽度铺满，full=拉伸 */
  scaleMode?: 'fit' | 'width' | 'full';
}

/** 仪表盘全局配置 */
export interface ReportDashboardConfig {
  theme?: 'light' | 'dark';
  /** 布局模式：grid=响应式栅格；canvas=自由画布大屏 */
  layoutMode?: 'grid' | 'canvas';
  /** 大屏模式（全屏自适应缩放） */
  screen?: boolean;
  /** 自由画布大屏设置（layoutMode=canvas 时生效） */
  screenConfig?: ReportScreenConfig;
  /** 自动刷新间隔（秒，0=关闭） */
  refreshInterval?: number;
  /** 多屏轮播（大屏分页 + 自动切换） */
  carousel?: ReportCarouselConfig;
  /** 嵌入宿主安全策略；未配置来源时 SDK 仅接受同源宿主消息 */
  embed?: {
    allowedOrigins?: string[];
    readOnly?: boolean;
  };
}

/** 多屏轮播配置 */
export interface ReportCarouselConfig {
  /** 是否启用多屏轮播 */
  enabled?: boolean;
  /** 总页数（>=1） */
  pageCount?: number;
  /** 自动切换间隔（秒，0=不自动切换） */
  intervalSec?: number;
  /** 是否显示页码指示点 */
  showDots?: boolean;
}

/** 仪表盘分类 */
export interface ReportDashboardCategory {
  id: number;
  name: string;
  sort: number;
  dashboardCount?: number;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ReportDashboardLifecycleStatus = typeof REPORT_DASHBOARD_LIFECYCLE_STATUSES[number];
export type ReportDashboardVersionSource = typeof REPORT_DASHBOARD_VERSION_SOURCES[number];

/** 仪表盘快照内容（发布态 / 版本历史统一复用） */
export interface ReportDashboardSnapshot {
  name: string;
  layout: ReportGridItem[];
  canvasLayout?: ReportCanvasItem[];
  widgets: ReportWidget[];
  filters: ReportFilter[];
  config: ReportDashboardConfig;
  categoryId?: number | null;
  remark?: string | null;
}

/** 仪表盘版本快照内容 */
export interface ReportDashboardVersionSnapshot extends ReportDashboardSnapshot {}

/** 仪表盘版本 */
export interface ReportDashboardVersion {
  id: number;
  dashboardId: number;
  version: number;
  snapshot: ReportDashboardVersionSnapshot;
  source: ReportDashboardVersionSource;
  remark?: string | null;
  createdBy?: number | null;
  createdAt: string;
}

export interface ReportDashboardVersionWidgetChange {
  id: string;
  title: string;
  type: ReportWidgetType;
  changedFields?: string[];
}

export interface ReportDashboardVersionDiff {
  leftLabel: string;
  rightLabel: string;
  summary: string[];
  widgets: {
    added: ReportDashboardVersionWidgetChange[];
    removed: ReportDashboardVersionWidgetChange[];
    modified: ReportDashboardVersionWidgetChange[];
  };
  layoutChanged: boolean;
  filtersChanged: boolean;
  configChanged: boolean;
  metadataChanged: boolean;
}

/** 公开分享链接 */
export interface ReportDashboardShare {
  id: number;
  dashboardId: number;
  token: string;
  enabled: boolean;
  hasPassword?: boolean;
  expireAt?: string | null;
  maxAccessCount?: number | null;
  allowedCidrs?: string[];
  allowedIps?: string[];
  /** 累计访问次数（只读聚合，含被拒绝的尝试） */
  accessCount?: number;
  /** 最近访问时间（只读聚合） */
  lastAccessAt?: string | null;
  createdBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportDashboardEmbedToken {
  id: number;
  dashboardId: number;
  token: string;
  allowedFilterIds: string[];
  fixedFilters: Record<string, unknown>;
  expireAt?: string | null;
  revokedAt?: string | null;
  remark?: string | null;
  createdBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 通知渠道（预警/订阅共用）：邮件 / 站内信 / Webhook（企微/钉钉机器人或通用端点） */
export type ReportNotifyChannel = 'email' | 'inApp' | 'webhook';

export type ReportScheduleMisfirePolicy = 'skip' | 'fire_once';
export type ReportDeliveryTargetType = 'subscription' | 'alert' | 'sla';
export type ReportDeliveryTriggerType = 'manual' | 'scheduled' | 'trigger' | 'recover';
export type ReportDeliveryStatus = 'pending' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled';

export interface ReportDeliveryAttempt {
  id: number;
  runId: number;
  channel: ReportNotifyChannel;
  attempt: number;
  status: ReportDeliveryStatus;
  durationMs?: number | null;
  errorMessage?: string | null;
  payloadSummary?: Record<string, unknown> | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportDeliveryRun {
  id: number;
  targetType: ReportDeliveryTargetType;
  subscriptionId?: number | null;
  alertRuleId?: number | null;
  slaRuleId?: number | null;
  dashboardId?: number | null;
  datasetId?: number | null;
  targetName?: string | null;
  triggerType: ReportDeliveryTriggerType;
  status: ReportDeliveryStatus;
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
  durationMs?: number | null;
  errorMessage?: string | null;
  payloadSummary?: Record<string, unknown> | null;
  lastValue?: number | null;
  triggered?: boolean | null;
  acknowledgedAt?: string | null;
  acknowledgedBy?: number | null;
  acknowledgedByName?: string | null;
  acknowledgeNote?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  nextRetryAt?: string | null;
  attempts?: ReportDeliveryAttempt[];
  createdAt: string;
  updatedAt: string;
}

/** 订阅推送（按 Cron 推送报表摘要） */
export interface ReportDashboardSubscription {
  id: number;
  dashboardId: number;
  dashboardName?: string | null;
  cron: string;
  timezone: string;
  misfirePolicy: ReportScheduleMisfirePolicy;
  channels: ReportNotifyChannel[];
  /** 收件人邮箱（逗号分隔）；inApp 推给创建者 */
  recipients?: string | null;
  /** Webhook 通知地址（channels 含 webhook 时必填） */
  webhookUrl?: string | null;
  enabled: boolean;
  remark?: string | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastDeliveryAt?: string | null;
  lastDeliveryStatus?: ReportDeliveryStatus | null;
  lastDeliveryError?: string | null;
  createdBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 公开分享渲染 DTO（精简、无敏感字段） */
export interface ReportPublicDashboard {
  name: string;
  layout: ReportGridItem[];
  canvasLayout: ReportCanvasItem[];
  widgets: ReportWidget[];
  filters: ReportFilter[];
  config: ReportDashboardConfig;
  filterOptions?: Record<string, Array<{ value: string; label: string }>>;
}

export interface ReportPublicAccessSession {
  accessSessionToken: string;
  expiresAt: string;
  dashboard: ReportPublicDashboard;
}

// ─── 报表中心 · 第六期：类 Excel 单据/中国式报表 ──────────────────────────────

/** 打印报表单元格样式子集（不耦合 Univer，供归一化网格 + 导出复用） */
export interface ReportPrintBorderSide {
  style?: 'thin' | 'medium' | 'dashed' | 'dotted' | 'double';
  color?: string;
}

export interface ReportPrintBorder {
  top?: ReportPrintBorderSide;
  right?: ReportPrintBorderSide;
  bottom?: ReportPrintBorderSide;
  left?: ReportPrintBorderSide;
}

export interface ReportPrintCellStyle {
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  color?: string;
  background?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  /** 是否描边（兼容旧 boolean；新结构支持四边独立边框） */
  border?: boolean | ReportPrintBorder;
  /** 自动换行 */
  wrap?: boolean;
}

export interface ReportPrintCellImage {
  src: string;
  width?: number;
  height?: number;
  fit?: 'contain' | 'cover';
  alt?: string;
}

export interface ReportPrintSubreportCell {
  templateId: number;
  datasetKey?: string;
  paramBindings?: Record<string, string>;
}

export interface ReportPrintDatasetBinding {
  key: string;
  datasetId: number;
  /** 静态参数（兼容既有模板）；参数名仍须在目标数据集中声明 */
  params?: Record<string, unknown>;
  /** 目标数据集参数名 -> 打印模板参数名 */
  paramBindings?: Record<string, string>;
  /** 单绑定行数上限，不能超过渲染请求的总上限 */
  rowLimit?: number;
  parentKey?: string | null;
  parentField?: string | null;
  childField?: string | null;
}

export interface ReportPrintCrosstabValueField {
  field: string;
  aggregate: 'sum' | 'avg' | 'max' | 'min' | 'count';
  label?: string;
}

export interface ReportPrintCrosstabConfig {
  rowFields: string[];
  columnFields: string[];
  /** 多指标配置；新模板应使用此字段 */
  valueFields?: ReportPrintCrosstabValueField[];
  /** 旧模板单指标配置 */
  valueField?: string;
  /** 旧模板单指标聚合方式 */
  aggregate?: 'sum' | 'avg' | 'max' | 'min' | 'count';
  showRowTotals?: boolean;
  showColumnTotals?: boolean;
  emptyValue?: string | number | null;
  nullLabel?: string;
  /** 模板中用于继承样式/行高的表头、数据、总计行（0-based） */
  headerRow?: number;
  dataRow?: number;
  totalRow?: number;
  /** 交叉表起始列（0-based） */
  startColumn?: number;
}

export interface ReportPrintRepeatBlock {
  id: string;
  datasetKey: string;
  range: ReportPrintRowRange;
}

/** 打印报表单元格（归一化网格项） */
export interface ReportPrintCell {
  row: number;
  col: number;
  /** 原始值/表达式文本：${field}=纵向扩展明细，#{field}=标量，${SUM(field)}=聚合，其余=字面量 */
  v?: string | number | boolean | null;
  s?: ReportPrintCellStyle;
  kind?: 'text' | 'formula' | 'image' | 'qrcode' | 'barcode' | 'subreport';
  /** Excel/Univer 公式串（尽量保留，不在服务端求值） */
  formula?: string;
  /** 数字/日期格式（如 #,##0.00） */
  numFmt?: string;
  image?: ReportPrintCellImage;
  /** 多数据集模板中此单元格使用的数据集绑定 key */
  datasetKey?: string;
  /** 子报表单元格配置 */
  subreport?: ReportPrintSubreportCell;
}

/** 合并单元格区域 */
export interface ReportPrintMerge {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

/** 归一化打印网格（单 sheet，渲染/导出引擎的统一中间表示） */
export interface ReportPrintGrid {
  rows: number;
  cols: number;
  /** 列宽（px，按列索引） */
  colWidths?: number[];
  /** 行高（px，按行索引） */
  rowHeights?: number[];
  cells: ReportPrintCell[];
  merges?: ReportPrintMerge[];
}

export interface ReportPrintRowRange {
  start: number;
  end: number;
}

export interface ReportPrintSheet {
  id: string;
  name: string;
  /** Sheet 级默认数据集绑定 key */
  datasetKey?: string;
  grid: ReportPrintGrid;
  pageConfig?: ReportPrintPageConfig;
  /** 同一 Sheet 内可按不同数据集重复指定模板带；重复带不可相互重叠 */
  repeatBlocks?: ReportPrintRepeatBlock[];
}

/** 页面/打印配置 */
export interface ReportPrintPageConfig {
  paper?: 'A4' | 'A3' | 'A5' | 'Letter';
  orientation?: 'portrait' | 'landscape';
  /** 页边距（mm） */
  margin?: { top: number; right: number; bottom: number; left: number };
  /** 页眉文本（支持 ${param} 与 {page}/{pages}/{date} 占位） */
  header?: string;
  /** 页脚文本 */
  footer?: string;
  /** 套打背景图 URL（叠加预印表单） */
  backgroundImage?: string;
  /** 手动强制分页（逻辑行号，1-based，作用于渲染后的正文行） */
  pageBreaks?: number[];
  /** 每页重复表头的模板行范围 */
  repeatHeaderRows?: ReportPrintRowRange | null;
  /** 固定每页正文行数（不含重复表头） */
  rowsPerPage?: number;
  /** 按纸张可用高度自动计算分页 */
  calculateRowsPerPage?: boolean;
  /** 明细扩展方向：vertical=纵向明细带；horizontal=横向扩展列；crosstab=交叉表 */
  detailDirection?: 'vertical' | 'horizontal' | 'crosstab';
  crosstab?: ReportPrintCrosstabConfig;
  /** 分组字段 */
  groupByFields?: string[];
  /** 组头模板行范围 */
  groupHeaderRows?: ReportPrintRowRange | null;
  /** 组尾/组小计模板行范围 */
  groupFooterRows?: ReportPrintRowRange | null;
  /** 页小计模板行范围 */
  pageSubtotalRows?: ReportPrintRowRange | null;
  /** 总计模板行范围 */
  totalRows?: ReportPrintRowRange | null;
}

/** 打印报表内容：Univer 工作簿快照(编辑用) + 归一化网格/多 Sheet(渲染/导出用) */
export interface ReportPrintContent {
  /** Univer IWorkbookData 快照（设计器加载用，结构由前端维护） */
  workbook?: unknown;
  /** 归一化单 sheet（旧版兼容） */
  grid?: ReportPrintGrid;
  /** 归一化多 sheet（新版） */
  sheets?: ReportPrintSheet[];
  /** 模板可绑定多个数据集；旧版 datasetId 仍作为主数据集 */
  datasetBindings?: ReportPrintDatasetBinding[];
}

/** 打印报表模板 */
export interface ReportPrintTemplate {
  id: number;
  name: string;
  ownerId?: number | null;
  ownerName?: string | null;
  folderId?: number | null;
  folderName?: string | null;
  datasetId?: number | null;
  datasetName?: string | null;
  content: ReportPrintContent;
  params: ReportDatasetParam[];
  pageConfig: ReportPrintPageConfig;
  status: 'enabled' | 'disabled';
  remark?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportPrintRenderPage {
  sheetId: string;
  sheetName: string;
  pageNumber: number;
  totalPages: number;
  grid: ReportPrintGrid;
  pageConfig: ReportPrintPageConfig;
  headerText?: string;
  footerText?: string;
}

export interface ReportPrintSheetRenderResult {
  id: string;
  name: string;
  grid: ReportPrintGrid;
  pageConfig: ReportPrintPageConfig;
  pages: ReportPrintRenderPage[];
  rowCount: number;
}

/** 填充后的打印报表（渲染/导出结果） */
export interface ReportPrintRenderResult {
  name: string;
  /** 兼容旧单 sheet 返回结构：取首个 sheet 的完整网格 */
  grid: ReportPrintGrid;
  pageConfig: ReportPrintPageConfig;
  /** 兼容旧预览：平铺后的页面列表 */
  pages: ReportPrintRenderPage[];
  /** 新版多 sheet 渲染结果 */
  sheets: ReportPrintSheetRenderResult[];
}

export type ReportPrintDatasetRows = Record<string, Array<Record<string, unknown>>>;

export interface ReportPrintResolvedSubreport {
  sheetId: string;
  row: number;
  col: number;
  templateId: number;
  result: ReportPrintRenderResult;
}

export interface ReportPrintRenderOptions {
  datasets?: ReportPrintDatasetRows;
  bindings?: ReportPrintDatasetBinding[];
  subreports?: ReportPrintResolvedSubreport[];
  /** 已由调用方按系统时间规范格式化的渲染时间 */
  renderedAt?: string;
  crosstabBudget?: {
    maxDynamicColumns?: number;
    maxCells?: number;
    maxBytes?: number;
  };
}

// ─── 报表中心 · 第八期：数据预警 + 协作 ────────────────────────────────────────

/** 预警比较运算符 */
export type ReportAlertOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
/** 预警聚合方式 */
export type ReportAlertAggregate = 'sum' | 'avg' | 'max' | 'min' | 'count' | 'first';

/** 数据预警规则 */
export interface ReportAlertRule {
  id: number;
  name: string;
  /** 监控的数据集 */
  datasetId: number | null;
  datasetName?: string | null;
  /** 指标预警来源；设置后 datasetId 必须为空。 */
  metricId?: number | null;
  metricName?: string | null;
  /** 监控字段（count 可空） */
  field?: string | null;
  /** 分组维度（可空=全局聚合；有值=按组聚合，任一组命中即触发） */
  groupByField?: string | null;
  /** 聚合方式 */
  aggregate: ReportAlertAggregate;
  /** 比较运算符 */
  op: ReportAlertOp;
  /** 阈值 */
  threshold: number;
  /** 评估 Cron（留空=仅手动） */
  cron?: string | null;
  timezone: string;
  misfirePolicy: ReportScheduleMisfirePolicy;
  /** 通知渠道 */
  channels: ReportNotifyChannel[];
  /** 收件人邮箱（逗号分隔）；inApp 推给创建者 */
  recipients?: string | null;
  /** Webhook 通知地址（channels 含 webhook 时必填） */
  webhookUrl?: string | null;
  /** 静默期（分钟）：持续触发时，距上次通知不足该时长不重复通知；0=每次触发都通知 */
  silenceMins: number;
  /** 从触发恢复正常时是否发送恢复通知 */
  notifyOnRecover: boolean;
  enabled: boolean;
  /** 最近评估时间（只读） */
  lastCheckedAt?: string | null;
  /** 最近是否触发（只读） */
  lastTriggered?: boolean | null;
  /** 最近评估的实际值（只读） */
  lastValue?: number | null;
  /** 最近一次发送通知时间（只读，静默窗口基准） */
  lastNotifiedAt?: string | null;
  nextRunAt?: string | null;
  lastDeliveryAt?: string | null;
  lastDeliveryStatus?: ReportDeliveryStatus | null;
  lastDeliveryError?: string | null;
  remark?: string | null;
  createdBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 预警评估命中组明细（分组维度评估时返回） */
export interface ReportAlertEvalHit {
  group: string;
  value: number;
}
/** 预警评估结果 */
export interface ReportAlertEvalResult {
  value: number;
  triggered: boolean;
  status?: ReportDeliveryStatus | null;
  deliveryRunId?: number | null;
  /** 分组评估时的命中组明细（最多 10 条） */
  hits?: ReportAlertEvalHit[];
}

/** 数据集下游引用（血缘：删除保护与影响分析） */
export interface ReportDatasetRefs {
  /** 引用该数据集的仪表盘（组件绑定或筛选器动态选项） */
  dashboards: Array<{ id: number; name: string; widgets: string[]; filterIds: string[] }>;
  printTemplates: Array<{ id: number; name: string }>;
  metrics: Array<{ id: number; code: string; name: string }>;
  alerts: Array<{ id: number; name: string }>;
  subscriptions?: Array<{ id: number; dashboardId: number; name: string }>;
  shares?: Array<{ id: number; dashboardId: number; name: string }>;
  embedTokens?: Array<{ id: number; dashboardId: number; name: string }>;
  nodes?: Array<{
    id: string;
    type: 'datasource' | 'dataset' | 'metric' | 'dashboard' | 'widget' | 'filter' | 'print' | 'alert' | 'subscription' | 'share' | 'embed';
    refId?: number | null;
    parentId?: string | null;
    label: string;
    meta?: Record<string, unknown>;
  }>;
  edges?: Array<{
    id: string;
    source: string;
    target: string;
    label?: string | null;
  }>;
}

/** 仪表盘评论（协作批注） */
export interface ReportDashboardComment {
  id: number;
  dashboardId: number;
  /** 关联组件 id（可空，整盘评论） */
  widgetId?: string | null;
  parentId?: number | null;
  content: string;
  userId?: number | null;
  userName?: string | null;
  userAvatar?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: number | null;
  resolvedByName?: string | null;
  deletedAt?: string | null;
  updatedAt: string;
  createdAt: string;
  replies?: ReportDashboardComment[];
  canEdit?: boolean;
  canDelete?: boolean;
  canResolve?: boolean;
}

// ─── 报表平台化 P2：治理、质量、ChatBI 与填报 ────────────────────────────────────

export interface ReportFolder {
  id: number;
  tenantId: number | null;
  parentId: number | null;
  name: string;
  resourceType: ReportResourceType;
  ownerId: number | null;
  ownerName?: string | null;
  sort: number;
  status: 'enabled' | 'disabled';
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportFolderTreeNode extends ReportFolder {
  children?: ReportFolderTreeNode[];
  resourceCount?: number;
}

export interface ReportResourceSummary {
  resourceType: ReportResourceType;
  resourceId: number;
  name: string;
  ownerId: number | null;
  ownerName?: string | null;
  folderId: number | null;
  folderName?: string | null;
  status?: string | null;
  updatedAt: string;
}

export interface ReportPlatformListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  resourceType?: ReportResourceType;
  folderId?: number | null;
  ownerId?: number | null;
  status?: string;
  startAt?: string;
  endAt?: string;
}

export interface ReportMetric {
  id: number;
  tenantId: number | null;
  folderId: number | null;
  folderName?: string | null;
  ownerId: number | null;
  ownerName?: string | null;
  code: string;
  name: string;
  description?: string | null;
  type: ReportMetricType;
  datasetId: number;
  datasetName?: string | null;
  sourceField?: string | null;
  formula?: string | null;
  aggregate?: 'sum' | 'avg' | 'max' | 'min' | 'count' | 'distinct_count' | null;
  dimensions: string[];
  timeField?: string | null;
  unit?: string | null;
  format?: string | null;
  caliber?: string | null;
  lifecycleStatus: ReportMetricLifecycleStatus;
  revision: number;
  publishedSnapshot?: Record<string, unknown> | null;
  publishedAt?: string | null;
  publishedBy?: number | null;
  deprecatedAt?: string | null;
  deprecatedBy?: number | null;
  deprecationReason?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportMetricEvaluation {
  metricId: number;
  code: string;
  value: number;
  formattedValue: string;
  unit?: string | null;
  durationMs: number;
  cacheHit: boolean;
}

export interface ReportMetricRefs {
  dashboards: Array<{ id: number; name: string; widgets: string[] }>;
  alerts: Array<{ id: number; name: string }>;
  metrics: Array<{ id: number; code: string; name: string }>;
}

export interface ReportMetricLookupOption {
  id: number;
  name: string;
  code: string;
  status: ReportMetricLifecycleStatus;
  datasetId: number;
  type: 'metric';
}

export interface ReportResourceAcl {
  id: number;
  tenantId: number | null;
  resourceType: ReportResourceType;
  resourceId: number;
  subjectType: ReportAclSubjectType;
  subjectId: number;
  role: ReportAclRole;
  inheritFromFolder: boolean;
  expiresAt?: string | null;
  grantedBy: number | null;
  grantedByName?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export type ReportApprovalAction = 'publish' | 'promote' | 'deprecate';

export interface ReportPublishApproval {
  id: number;
  tenantId: number | null;
  resourceType: ReportResourceType;
  resourceId: number;
  resourceName?: string | null;
  action: ReportApprovalAction;
  requestedRevision: number;
  snapshot: Record<string, unknown>;
  status: ReportApprovalStatus;
  requestedBy: number | null;
  requestedByName?: string | null;
  requestedAt: string;
  decidedBy?: number | null;
  decidedByName?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportResourceTransfer {
  id: number;
  tenantId: number | null;
  resourceType: ReportResourceType;
  resourceId: number;
  resourceName?: string | null;
  fromOwnerId: number | null;
  fromOwnerName?: string | null;
  toOwnerId: number;
  toOwnerName?: string | null;
  status: ReportTransferStatus;
  reason?: string | null;
  requestedBy: number | null;
  decidedBy?: number | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportEnvironment {
  id: number;
  tenantId: number | null;
  code: string;
  name: string;
  kind: ReportEnvironmentKind;
  description?: string | null;
  baseUrl?: string | null;
  config: Record<string, unknown>;
  isDefault: boolean;
  status: 'enabled' | 'disabled';
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportEnvironmentPromotion {
  id: number;
  tenantId: number | null;
  resourceType: ReportResourceType;
  resourceId: number;
  resourceName?: string | null;
  sourceEnvironmentId: number;
  sourceEnvironmentName?: string | null;
  targetEnvironmentId: number;
  targetEnvironmentName?: string | null;
  sourceRevision: number;
  sourceSnapshot: Record<string, unknown>;
  targetSnapshot?: Record<string, unknown> | null;
  status: ReportPromotionStatus;
  requestedBy: number | null;
  approvedBy?: number | null;
  deployedBy?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
  rollbackSnapshot?: Record<string, unknown> | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportDqRuleConfig {
  min?: number | null;
  max?: number | null;
  pattern?: string | null;
  maxAgeMinutes?: number | null;
  minRows?: number | null;
  maxRows?: number | null;
  sql?: string | null;
}

export interface ReportDqRule {
  id: number;
  tenantId: number | null;
  datasetId: number;
  datasetName?: string | null;
  name: string;
  type: ReportDqRuleType;
  field?: string | null;
  severity: ReportDqSeverity;
  config: ReportDqRuleConfig;
  cron?: string | null;
  timezone: string;
  enabled: boolean;
  lastRunAt?: string | null;
  lastStatus?: ReportDqRunStatus | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportDqRun {
  id: number;
  tenantId: number | null;
  ruleId: number;
  datasetId: number;
  status: ReportDqRunStatus;
  triggerType: 'manual' | 'scheduled' | 'dataset_refresh';
  checkedRows: number;
  failedRows: number;
  passRate?: number | null;
  sampleRows: Record<string, unknown>[];
  sampleRowCount: number;
  sampleBytes: number;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  schemaSignature?: string | null;
  requestedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportDqScore {
  id: number;
  tenantId: number | null;
  datasetId: number;
  score: number;
  passedRules: number;
  failedRules: number;
  totalRules: number;
  measuredAt: string;
  dimensions: Record<string, number>;
  createdAt: string;
}

export interface ReportDqAnomaly {
  id: number;
  tenantId: number | null;
  datasetId: number;
  ruleId?: number | null;
  runId?: number | null;
  severity: ReportDqSeverity;
  title: string;
  detail?: string | null;
  sample: Record<string, unknown>;
  sampleRowCount?: number;
  sampleBytes?: number;
  status: ReportDqAnomalyStatus;
  acknowledgedAt?: string | null;
  acknowledgedBy?: number | null;
  acknowledgementNote?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportMaterializationSnapshot {
  id: number;
  tenantId: number | null;
  datasetId: number;
  strategy: ReportMaterializationStrategy;
  status: ReportSnapshotStatus;
  revision: number;
  keyField?: string | null;
  watermark?: string | null;
  deltaWindowMinutes?: number | null;
  fileId?: string | null;
  rowCount: number;
  byteSize: number;
  checksum?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  expiresAt?: string | null;
  errorMessage?: string | null;
  createdBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportQueryQuota {
  id: number;
  tenantId: number | null;
  scope: ReportQuotaScope;
  userId?: number | null;
  maxConcurrent: number;
  dailyQueryLimit: number;
  dailyRowLimit: number;
  dailyByteLimit: number;
  dailyCostLimit: number;
  resetTimezone: string;
  enabled: boolean;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportQueryCostLog {
  id: number;
  tenantId: number | null;
  userId?: number | null;
  datasetId?: number | null;
  datasourceId?: number | null;
  scene: string;
  requestId: string;
  queuedMs: number;
  durationMs: number;
  rowCount: number;
  byteSize: number;
  costUnits: number;
  cacheHit: boolean;
  success: boolean;
  errorCode?: string | null;
  occurredAt: string;
}

export interface ReportQueryCapacity {
  globalLimit: number;
  running: number;
  queueDepth: number;
  datasourceQueues: number;
}

export interface ReportQueryCostStats {
  queries: number;
  rows: number;
  bytes: number;
  costUnits: number;
  avgDurationMs: number;
  failures: number;
  capacity: ReportQueryCapacity;
}

export interface ReportQueryCostTrendPoint {
  bucket: string;
  queries: number;
  rows: number;
  bytes: number;
  costUnits: number;
  avgDurationMs: number;
  queueMs: number;
}

export interface ReportSlaRule {
  id: number;
  tenantId: number | null;
  datasetId: number;
  name: string;
  type: ReportSlaType;
  targetValue: number;
  warningValue?: number | null;
  windowMinutes: number;
  cron?: string | null;
  timezone: string;
  severity: ReportDqSeverity;
  channels: ReportNotifyChannel[];
  recipients?: string | null;
  webhookUrl?: string | null;
  silenceMins: number;
  enabled: boolean;
  lastEvaluatedAt?: string | null;
  lastNotifiedAt?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportSlaViolation {
  id: number;
  tenantId: number | null;
  ruleId: number;
  datasetId: number;
  status: ReportSlaViolationStatus;
  observedValue: number;
  targetValue: number;
  windowStartedAt: string;
  windowEndedAt: string;
  detail?: string | null;
  acknowledgedAt?: string | null;
  acknowledgedBy?: number | null;
  resolvedAt?: string | null;
  resolvedBy?: number | null;
  resolutionNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportAssetUsageLog {
  id: number;
  tenantId: number | null;
  resourceType: ReportResourceType;
  resourceId: number;
  userId?: number | null;
  action: 'view' | 'query' | 'export' | 'embed' | 'share';
  scene?: string | null;
  durationMs?: number | null;
  rowCount: number;
  byteSize: number;
  success: boolean;
  occurredAt: string;
}

export interface ReportDeprecationNotice {
  id: number;
  tenantId: number | null;
  resourceType: ReportResourceType;
  resourceId: number;
  title: string;
  message: string;
  replacementResourceType?: ReportResourceType | null;
  replacementResourceId?: number | null;
  effectiveAt: string;
  expiresAt?: string | null;
  publishedAt?: string | null;
  publishedBy?: number | null;
  processedAt?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportAssetTemplate {
  id: number;
  tenantId: number | null;
  folderId: number | null;
  folderName?: string | null;
  ownerId: number | null;
  ownerName?: string | null;
  code: string;
  name: string;
  type: ReportAssetTemplateType;
  description?: string | null;
  content: Record<string, unknown>;
  previewFileId?: string | null;
  version: number;
  usageCount: number;
  status: 'enabled' | 'disabled';
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportAssetUsageTrendPoint {
  bucket: string;
  views: number;
  queries: number;
  exports: number;
  embeds: number;
  shares: number;
  uniqueUsers: number;
}

export interface ReportAssetTemplateApplyResult {
  resourceType: ReportResourceType;
  resourceId: number;
  name: string;
}

export interface ReportChatbiChartSuggestion {
  type: ReportWidgetType;
  title: string;
  categoryField?: string;
  valueFields?: string[];
  options?: Record<string, unknown>;
}

export interface ReportChatbiContextSnapshot {
  datasourceId: number;
  datasourceName: string;
  datasourceType: ReportDatasourceType;
  datasetId?: number | null;
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string }>;
  }>;
  frozenAt: string;
}

export interface ReportChatbiSession {
  id: number;
  tenantId: number | null;
  userId: number;
  title: string;
  datasourceId?: number | null;
  datasetId?: number | null;
  allowedTables: string[];
  contextSnapshot: ReportChatbiContextSnapshot;
  status: ReportChatbiSessionStatus;
  totalTokens: number;
  totalCostUnits: number;
  lastMessageAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportChatbiMessage {
  id: number;
  tenantId: number | null;
  sessionId: number;
  userId?: number | null;
  role: ReportChatbiMessageRole;
  content: string;
  generatedSql?: string | null;
  chartSuggestion?: ReportChatbiChartSuggestion | null;
  resultSample: Record<string, unknown>[];
  resultRowCount: number;
  resultByteSize: number;
  savedResourceType?: ReportResourceType | null;
  savedResourceId?: number | null;
  savedDatasetId?: number | null;
  savedDashboardId?: number | null;
  promptTokens: number;
  completionTokens: number;
  costUnits: number;
  latencyMs?: number | null;
  modelId?: string | null;
  errorMessage?: string | null;
  createdAt: string;
}

export interface ReportChatbiSessionDetail {
  session: ReportChatbiSession;
  messages: ReportChatbiMessage[];
}

export interface ReportChatbiQuota {
  aiPromptTokensToday: number;
  aiCompletionTokensToday: number;
  aiRequestsToday: number;
  queryCountToday: number;
  queryRowsToday: number;
  queryBytesToday: number;
  queryCostUnitsToday: number;
}

export interface ReportChatbiSavedResource {
  resourceType: 'dataset' | 'dashboard';
  resourceId: number;
  name: string;
  datasetId?: number | null;
}

export interface ReportFillTemplate {
  id: number;
  tenantId: number | null;
  folderId: number | null;
  folderName?: string | null;
  ownerId: number | null;
  ownerName?: string | null;
  code: string;
  name: string;
  description?: string | null;
  formSchema: WorkflowFormSchema;
  publishedSchema?: WorkflowFormSchema | null;
  publishedRevision?: number | null;
  workflowDefinitionId?: number | null;
  workflowDefinitionName?: string | null;
  needReview: boolean;
  generatedDatasetId?: number | null;
  status: ReportFillTemplateStatus;
  revision: number;
  publishedAt?: string | null;
  publishedBy?: number | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportFillRecord {
  id: number;
  tenantId: number | null;
  templateId: number;
  templateName?: string | null;
  submitterId: number;
  submitterName?: string | null;
  status: ReportFillRecordStatus;
  data: Record<string, unknown>;
  templateRevision: number;
  templateSchemaSnapshot: WorkflowFormSchema;
  templateNeedReview: boolean;
  workflowDefinitionIdSnapshot?: number | null;
  submitComment?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: number | null;
  reviewComment?: string | null;
  workflowInstanceId?: number | null;
  generatedDatasetId?: number | null;
  syncStatus: ReportFillSyncStatus;
  syncTaskId?: number | null;
  syncError?: string | null;
  syncedAt?: string | null;
  revision: number;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportMobileDashboardPreference {
  dashboardId: number;
  compactMode?: boolean;
  hiddenWidgetIds?: string[];
  widgetOrder?: string[];
  defaultFilterValues?: Record<string, unknown>;
  refreshInterval?: number;
}

export interface ReportCapacityTrendPoint {
  time: string;
  queries: number;
  concurrentPeak: number;
  rows: number;
  bytes: number;
  costUnits: number;
  p95DurationMs: number;
}

export interface ReportQueryGovernanceSummary {
  concurrentRunning: number;
  concurrentLimit: number;
  dailyQueries: number;
  dailyQueryLimit: number;
  dailyRows: number;
  dailyRowLimit: number;
  dailyBytes: number;
  dailyByteLimit: number;
  dailyCostUnits: number;
  dailyCostLimit: number;
  trends: ReportCapacityTrendPoint[];
}

export interface ReportQualitySummary {
  datasetId: number;
  score: number | null;
  totalRules: number;
  passedRules: number;
  failedRules: number;
  openAnomalies: number;
  criticalAnomalies: number;
  lastMeasuredAt?: string | null;
}

export interface ReportAssetUsageSummary {
  resourceType: ReportResourceType;
  resourceId: number;
  views: number;
  queries: number;
  exports: number;
  uniqueUsers: number;
  lastUsedAt?: string | null;
  deprecated: boolean;
  deprecationNotice?: ReportDeprecationNotice | null;
}

export interface ReportAssetCatalogItem {
  resourceType: ReportResourceType;
  resourceId: number;
  tenantId: number | null;
  name: string;
  ownerId: number | null;
  ownerName?: string | null;
  folderId: number | null;
  folderName?: string | null;
  lifecycleStatus?: string | null;
  status?: string | null;
  deprecationEffectiveAt?: string | null;
  updatedAt: string;
}

export interface ReportQueryQuotaUsage {
  tenantId: number | null;
  userId: number | null;
  timezone: string;
  day: string;
  concurrent: number;
  queries: number;
  rows: number;
  bytes: number;
  costUnits: number;
  maxConcurrent: number;
  dailyQueryLimit: number;
  dailyRowLimit: number;
  dailyByteLimit: number;
  dailyCostLimit: number;
}

export interface ReportResourceDetail {
  resource: ReportResourceSummary;
  acls: ReportResourceAcl[];
  pendingApprovals: ReportPublishApproval[];
  usage: ReportAssetUsageSummary;
  deprecationNotices: ReportDeprecationNotice[];
}

export interface ReportDatasetPlatformDetail {
  dataset: ReportDataset;
  metrics: ReportMetric[];
  quality: ReportQualitySummary;
  materializationSnapshots: ReportMaterializationSnapshot[];
  slaRules: ReportSlaRule[];
  usage: ReportAssetUsageSummary;
}

export interface ReportFillRecordDetail extends ReportFillRecord {
  template: ReportFillTemplate;
  workflowStatus?: string | null;
  generatedDataset?: ReportDataset | null;
}

// ─── 规则中心：决策表 ────────────────────────────────────────────────────────────
export type RuleHitPolicy = 'first' | 'unique' | 'priority' | 'collect' | 'any';
export type RuleDecisionStatus = 'draft' | 'published' | 'disabled';
export type RuleFieldType = 'string' | 'number' | 'boolean' | 'date';
/** collect 策略聚合方式：list=输出数组（默认）；sum/min/max 数值聚合；count=命中行数；distinct=去重数组 */
export type RuleCollectAggregate = 'list' | 'sum' | 'min' | 'max' | 'count' | 'distinct';

/** 决策表行为设置（发布时随快照固化） */
export interface RuleDecisionTableSettings {
  /** collect 策略下的聚合方式，缺省 list */
  collectAggregate?: RuleCollectAggregate;
  /** 未命中时回退输出列默认值（matched 仍为 false，供调用方兜底） */
  fallbackToDefaults?: boolean;
}

/** 输入列：expr 为取值表达式（复用安全表达式引擎，从 scope 取值，如 form.amount） */
export interface RuleDecisionInput {
  key: string;
  label: string;
  expr: string;
  type: RuleFieldType;
  /** string 类型可绑定字典编码，编辑器条件/测试表单渲染为字典下拉 */
  dictCode?: string | null;
}
/** 输出列：default 为无命中时回填默认值；isExpr 标记该列输出为表达式（'= form.x * 0.8'，编辑器渲染文本框） */
export interface RuleDecisionOutput {
  key: string;
  label: string;
  type: RuleFieldType;
  default?: string | number | boolean | null;
  isExpr?: boolean;
}
/** 规则行：when 与 inputs 一一对应，'-' 或空为通配；then 为各 output 字面量 */
export interface RuleDecisionRow {
  id: string;
  when: string[];
  then: Record<string, string | number | boolean | null>;
  priority?: number;
  label?: string;
}
export interface RuleDecisionTable {
  id: number;
  key: string;
  name: string;
  description?: string | null;
  categoryId?: number | null;
  status: RuleDecisionStatus;
  hitPolicy: RuleHitPolicy;
  inputs: RuleDecisionInput[];
  outputs: RuleDecisionOutput[];
  rules: RuleDecisionRow[];
  version: number;
  publishedAt?: string | null;
  /** 当前编辑态与最新发布快照不一致（有未发布修改） */
  dirty?: boolean;
  settings?: RuleDecisionTableSettings;
  createdAt: string;
  updatedAt: string;
  createdBy?: number | null;
  createdByName?: string | null;
}
export interface RuleDecisionTableVersion {
  id: number;
  tableId: number;
  version: number;
  name: string;
  hitPolicy: RuleHitPolicy;
  inputs: RuleDecisionInput[];
  outputs: RuleDecisionOutput[];
  rules: RuleDecisionRow[];
  settings?: RuleDecisionTableSettings;
  publishedAt: string;
  publishedBy?: number | null;
  publishedByName?: string | null;
}
/** 求值未命中/冲突原因：no_match=无行命中；unique_conflict=唯一命中策略下命中多行；any_conflict=any 策略下多行输出不一致 */
export type RuleEvaluateReason = 'no_match' | 'unique_conflict' | 'any_conflict';

export interface RuleEvaluateResult {
  matched: boolean;
  outputs: Record<string, unknown>;
  matchedRowIds: string[];
  hitPolicy: RuleHitPolicy;
  collected?: Array<Record<string, unknown>>;
  /** matched 为 false 时的原因 */
  reason?: RuleEvaluateReason;
  /** 未命中但启用了回退默认值：outputs 为各输出列默认值 */
  usedFallback?: boolean;
}

/** 决策表引用方（where-used 分析） */
export interface RuleUsageItem {
  type: 'workflow' | 'coupon';
  id: number | null;
  name: string;
  status?: string | null;
}

// ─── 规则中心：版本 diff ─────────────────────────────────────────────────────────
export interface RuleVersionChange {
  kind: 'input' | 'output' | 'rule' | 'meta';
  op: 'added' | 'removed' | 'changed';
  ref: string;
  detail: string;
}
export interface RuleVersionDiff {
  from: number;
  to: number;
  changes: RuleVersionChange[];
}

// ─── 规则中心：测试矩阵 ──────────────────────────────────────────────────────────
export interface RuleTestCase {
  id: number;
  tableId: number;
  name: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export interface RuleCaseResult {
  id: number;
  name: string;
  pass: boolean;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
}
export interface RuleTestRunResult {
  total: number;
  passed: number;
  failed: number;
  coverage: number;
  uncoveredRowIds: string[];
  cases: RuleCaseResult[];
}

// ─── 规则中心：执行记录 ──────────────────────────────────────────────────────────
export interface RuleDecisionExecution {
  id: number;
  ruleKey: string;
  tableId: number | null;
  instanceId: number | null;
  nodeKey: string | null;
  source: 'runtime' | 'manual' | 'test';
  matched: boolean;
  hitPolicy: RuleHitPolicy;
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
  matchedRowIds: string[];
  createdAt: string;
}

// ─── 工作流：运行中实例迁移 ──────────────────────────────────────────────────────
export interface WorkflowMigrationNode { nodeKey: string; label: string; inNew: boolean; activeTasks: number; activeTokens: number; }
export interface WorkflowMigrationPreflight {
  instanceId: number;
  fromVersion: number;
  toVersion: number;
  migratable: boolean;
  nodes: WorkflowMigrationNode[];
  blocked: string[];
}
export interface WorkflowInstanceMigration {
  id: number; instanceId: number; fromVersion: number; toVersion: number;
  status: string; note: string | null; createdAt: string;
}

// ─── 工作流：补偿/人工修复工单 ──────────────────────────────────────────────────
/** 补偿工单的自动反向/兜底动作执行状态 */
export type WorkflowCompensationActionStatus = 'none' | 'pending' | 'running' | 'succeeded' | 'failed';

export interface WorkflowCompensation {
  id: number; instanceId: number; nodeKey: string; nodeName: string | null;
  errorMessage: string | null; action: string; status: 'pending' | 'resolved' | 'terminated';
  /** 自动反向/兜底动作执行状态 */
  compensationActionStatus: WorkflowCompensationActionStatus;
  /** 失败节点 key（用于恢复续跑重注 token） */
  failedNodeKey: string | null;
  resolution: string | null; resolvedBy: number | null; resolvedAt: string | null; createdAt: string;
}

/** 补偿工单处理历史条目 */
export interface WorkflowCompensationLog {
  id: number;
  compensationId: number;
  action: 'note' | 'attachment' | 'auto' | 'retry' | 'resume' | 'resolve' | 'terminate';
  note: string | null;
  attachments: Array<{ id: number; name: string; url: string }> | null;
  operatorId: number | null;
  operatorName: string | null;
  createdAt: string;
}

/** 补偿工单详情（含处理历史时间线） */
export interface WorkflowCompensationDetail extends WorkflowCompensation {
  logs: WorkflowCompensationLog[];
}

// ─── 意见反馈 ────────────────────────────────────────────────────────────────
export type UserFeedbackCategory = 'suggestion' | 'bug' | 'ux' | 'other';

export type UserFeedbackStatus = 'pending' | 'processing' | 'resolved' | 'ignored';

export interface UserFeedback {
  id: number;
  userId: number;
  /** 提交人昵称（JOIN 后附加） */
  userNickname?: string | null;
  /** 满意度评分 1-5，可空 */
  score: number | null;
  category: UserFeedbackCategory;
  content: string | null;
  /** 提交时所在页面路由 */
  pagePath: string | null;
  status: UserFeedbackStatus;
  handleRemark: string | null;
  handledBy: number | null;
  /** 处理人昵称（JOIN 后附加） */
  handlerNickname?: string | null;
  handledAt: string | null;
  createdAt: string;
  updatedAt: string;
}
