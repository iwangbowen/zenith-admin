import type { PaymentChannel, PaymentMethod, PaymentOrderStatus, PaymentRefundStatus, PaymentRefundApprovalStatus, PaymentReconStatus, PaymentReconResult, PaymentWebhookDeliveryStatus, PaymentLedgerDirection, PaymentLedgerType, PaymentSettlementStatus, PaymentSharingReceiverType, PaymentSharingOrderStatus, PaymentLinkStatus, PaymentRiskScope, MemberStatus, PointTxType, WalletTxType, CouponType, CouponValidType, CouponTemplateStatus, MemberCouponStatus, WorkflowFormType } from './constants';

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
  email: string;
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
  url: string;
  uploaderName?: string | null;
  createdAt: string;
  updatedAt: string;
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
export interface LoginLog {
  id: number;
  userId: number | null;
  username: string;
  ip: string | null;
  location: string | null;
  browser: string | null;
  os: string | null;
  userAgent: string | null;
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

// ─── 系统监控告警 ─────────────────────────────────────────────────────────────
export type MonitorMetric =
  | 'cpu' | 'memory' | 'disk' | 'swap' | 'load1' | 'procCpu' | 'heap'
  | 'loopLag' | 'qps' | 'errorRate' | 'netRxBps' | 'netTxBps' | 'diskReadBps' | 'diskWriteBps';
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

/** 单条上报事件（客户端 → 服务端） */
export interface TrackEventInput {
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
}

export type AnalyticsEventMetaStatus = 'active' | 'deprecated' | 'blocked';
export interface AnalyticsEventPropertyDef {
  key: string;
  type: string;
  description?: string;
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
}

export interface FunnelStepInput {
  eventType?: UserBehaviorEventType;
  eventName?: string;
  pagePath?: string;
  elementKey?: string;
  label: string;
}
export interface FunnelStepResult {
  label: string;
  users: number;
  conversionRate: number;
  stepConversionRate: number;
  dropoff: number;
}
export interface FunnelResult {
  steps: FunnelStepResult[];
  totalUsers: number;
  overallConversionRate: number;
}

export interface RetentionResult {
  cohorts: {
    cohortDate: string;
    cohortSize: number;
    values: (number | null)[];
  }[];
  periods: number[];
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

export interface DimensionBreakdownItem { name: string; value: number; percent: number }
export interface DimensionBreakdown {
  dimension: string;
  total: number;
  items: DimensionBreakdownItem[];
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
  lastRunStatus: CronRunStatus | null;
  lastRunAt: string | null;
}

export interface CronJobDailyStat {
  date: string;
  total: number;
  successCount: number;
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
  recentLogs: CronJobRecentLog[];
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
  | { type: 'chat:group-update'; payload: { conversationId: number; name?: string | null; announcement?: string | null } }
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
  | { type: 'mp-kf:session-new'; payload: MpKfSession }
  | { type: 'mp-kf:session-update'; payload: MpKfSession }
  | { type: 'mp-kf:session-message'; payload: { sessionId: number; accountId: number; openid: string; direction: MpMessageDirection; msgType: MpMessageType; content: string | null; createdAt: string } };

/** Terminal WebSocket 消息（独立端点 /api/ws/terminal） */
export type TerminalMessage =
  | { type: 'terminal:input'; data: string }
  | { type: 'terminal:output'; data: string }
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
export type WorkflowInstanceStatus = 'draft' | 'running' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled';
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
  | 'expression';                // 流程表达式

/** 审批方式 */
export type WorkflowApproveMethod =
  | 'and'         // 会签：所有人通过
  | 'or'          // 或签：任一人通过
  | 'sequential'  // 顺序会签：按顺序逐一通过
  | 'ratio'       // 比例会签：达到指定百分比通过即可
  | 'random'      // 随机挑选一人审批（系统在候选人中随机指派一人）
  | 'auto';       // 自动通过

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
  /** 上传配置：执行此动作时是否强制要求上传附件 */
  uploadRequired?: boolean;
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
  /** webhook / callback：目标 URL */
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
  url: string;
  secret: string;
  signMode?: WorkflowEventSignMode;
  timeoutMs?: number;
  /** 调用外部 URL 失败时的兜底策略 */
  fallbackStrategy?: 'manual' | 'autoApprove' | 'autoReject';
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
export interface WorkflowSerialNoConfig {
  enabled: boolean;
  /** 固定前缀，如 'BX-' */
  prefix?: string;
  /** 日期段格式（拼接在前缀后） */
  dateFormat?: 'none' | 'YYYYMMDD' | 'YYYYMM' | 'YYYY';
  /** 序号位数（左补零），默认 4 */
  seqLength?: number;
  /** 序号重置周期 */
  resetPeriod?: 'never' | 'daily' | 'monthly' | 'yearly';
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

/** 字段级高级联动：多条件 and/or 组合显隐 */
export interface WorkflowFieldVisibilityRuleGroup {
  logic: 'and' | 'or';
  rules: WorkflowFieldVisibilityCondition[];
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
  detailSummary?: boolean;         // 明细子列：是否在底部显示合计
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
    byOption: Record<string, Record<string, string>>; // 选项值 -> { 目标key: 填充值 }
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
  /** 多人审批方式（and/or/sequential/ratio） */
  approveMethod?: string | null;
  /** 所在分支标签（条件/并行分支时） */
  branchLabel?: string | null;
  /** 审批人为空（需按节点空处理策略兜底） */
  empty?: boolean;
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
  /** 转办/委派经手过的处理人 ID 链（含原始创建人之后的所有 assignee） */
  transferChain?: number[];
  /** 委派来源（仅委派期间设置；回执任务为 null） */
  delegatedFromId?: number | null;
  /** 外部审批回调 ID（task.status='waiting' + externalApproval 启用时生效） */
  externalCallbackId?: string | null;
  externalDispatchStatus?: WorkflowTaskExternalDispatchStatus | null;
  /** 触发器调度/执行状态（trigger 节点副作用恢复与幂等） */
  triggerDispatchStatus?: WorkflowTriggerExecutionStatus | null;
  /** 触发器调度尝试次数 */
  triggerAttempt?: number;
  /** 触发器本次调度开始时间 */
  triggerStartedAt?: string | null;
  /** 触发器下一次恢复重试时间 */
  triggerNextRetryAt?: string | null;
  /** 触发器最近一次调度错误 */
  triggerLastError?: string | null;
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
  /** 最早待办的等待时长（秒） */
  oldestPendingSec: number | null;
}

export interface WorkflowAnalyticsTrendPoint {
  date: string;
  created: number;
  completed: number;
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
  definitionStats: WorkflowAnalyticsDefinitionStat[];
  nodeBottlenecks: WorkflowAnalyticsNodeBottleneck[];
  approverWorkloads: WorkflowAnalyticsApproverWorkload[];
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

export type WorkflowRuntimeIssueSeverity = 'info' | 'warning' | 'critical';

export interface WorkflowRuntimeIssue {
  severity: WorkflowRuntimeIssueSeverity;
  title: string;
  description: string;
  source: 'instance' | 'task' | 'trigger' | 'outbox';
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

export interface WorkflowRuntimeDiagnostics {
  instance: WorkflowInstance;
  tasks: WorkflowTask[];
  activeTasks: WorkflowTask[];
  triggerExecutions: WorkflowTriggerExecution[];
  outboxEvents: WorkflowRuntimeOutboxEvent[];
  issues: WorkflowRuntimeIssue[];
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

export interface WorkflowEngineSchedulerSnapshot {
  initialized: boolean;
  runningJobCount: number;
  registeredHandlers: string[];
  systemRecurringJobs: Array<{ name: string; cronExpression: string; registeredAt: string }>;
  systemQueueWorkers: Array<{ name: string; registeredAt: string }>;
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

/**
 * 引擎遥测指标（借鉴 Camunda/Zeebe/Temporal 内省端点对外暴露的吞吐 / 延迟 / 生命周期信号）。
 * 仅承载“只能由后端计算”的数据；饱和度、积压、SLA 分布等展示聚合由前端从其它字段派生。
 */
export interface WorkflowEngineTelemetry {
  /** 引擎健康分 0-100（规范化健康度，越高越好） */
  healthScore: number;
  /** 事件 Outbox 吞吐 + 延迟（Traffic / Errors / Latency） */
  events: {
    last1h: WorkflowEngineThroughputWindow;
    last24h: WorkflowEngineThroughputWindow;
    /** 当前 pending/retrying 待重放事件数 */
    pendingRetry: number;
    /** 近 24h 成功事件的平均处理延迟（processedAt - createdAt，毫秒） */
    avgLatencyMs: number | null;
  };
  /** 触发器执行吞吐 + 延迟 */
  triggers: {
    last24h: { total: number; success: number; failed: number; retrying: number };
    /** 近 24h 触发器平均耗时（毫秒） */
    avgDurationMs: number | null;
  };
  /** 流程实例生命周期吞吐 */
  instances: {
    running: number;
    createdLast24h: number;
    completedLast24h: number;
    canceledLast24h: number;
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
  telemetry: WorkflowEngineTelemetry;
  components: WorkflowEngineComponent[];
  queues: WorkflowEngineQueueSnapshot[];
  definitions: WorkflowEngineDefinitionSnapshot;
  eventBus: WorkflowEngineEventBusSnapshot;
  scheduler: WorkflowEngineSchedulerSnapshot;
  runtime: WorkflowEngineRuntimeSnapshot;
  issues: WorkflowEngineRuntimeIssue[];
}

export type WorkflowHealthIssueType =
  | 'external_dispatch_failed'
  | 'external_dispatch_pending'
  | 'trigger_waiting_no_execution'
  | 'trigger_execution_failed'
  | 'subprocess_waiting'
  | 'delay_overdue'
  | 'task_timeout_overdue'
  | 'workflow_event_outbox_failed'
  | 'workflow_event_outbox_pending'
  | 'waiting_task_stuck';

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
export type ChatMessageType = 'text' | 'image' | 'file' | 'system' | 'forward' | 'vote' | 'voice' | 'card';

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
  kind: 'image' | 'file' | 'voice';
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

export type AiProvider = 'openai_compatible' | 'anthropic' | 'gemini' | 'baidu';
export type AiMessageRole = 'system' | 'user' | 'assistant';

export interface AiProviderConfig {
  id: number;
  name: string;
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string | null;
  maxTokens: number;
  temperature: string;
  isDefault: boolean;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface AiMessage {
  id: number;
  conversationId: number;
  role: AiMessageRole;
  content: string;
  model: string | null;
  tokensInput: number;
  tokensOutput: number;
  /** 1 = 点赞, -1 = 点踩, null = 未反馈 */
  feedback: number | null;
  feedbackReason: string | null;
  feedbackStatus: AiFeedbackStatus | null;
  feedbackRemark: string | null;
  feedbackHandledAt: string | null;
  createdAt: string;
}

export type AiFeedbackStatus = 'pending' | 'resolved' | 'ignored';

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
  clientId: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
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
  status: 'enabled' | 'disabled';
  remark?: string | null;
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
  createdAt: string;
  updatedAt: string;
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
