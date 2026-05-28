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
  isLocked?: boolean;
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
  deptScopeIds?: number[];
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
  | { type: 'chat:vote-update'; payload: { conversationId: number; messageId: number; voteData: ChatVoteData } }
  | { type: 'workflow:taskCreated'; payload: { instanceId: number; taskId: number; instanceTitle: string; nodeName: string } }
  | { type: 'workflow:taskFinished'; payload: { instanceId: number; taskId: number; decision: 'approved' | 'rejected' | 'skipped' } }
  | { type: 'workflow:instanceFinished'; payload: { instanceId: number; status: WorkflowInstanceStatus; title: string } };

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
  | 'subProcess';
export type WorkflowConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';

// 连线条件表达式（排他网关出边使用）
export interface WorkflowEdgeCondition {
  field: string;         // 表单字段 key
  operator: WorkflowConditionOperator;
  value: string | number | boolean;
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
export type WorkflowOperationPermission =
  | 'approve'
  | 'reject'
  | 'transfer'
  | 'addSign'
  | 'return'
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
  /** 子流程：父实例字段映射到子实例 formData（key=子字段 key，value 支持 {{form.x}} 模板，引用父实例 formData） */
  subProcessFieldMapping?: Record<string, string>;
  /** 子流程：子实例审批通过后回填父实例 formData（key=父字段 key，value=子字段 key） */
  subProcessOutputMapping?: Record<string, string>;
  /** 子流程：是否等待子实例结束才推进父流程（默认 true） */
  subProcessWaitChild?: boolean;
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
  /** callback 类型回调验签模式（默认 none） */
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
}

export interface WorkflowAdvancedSettings {
  allowWithdraw: boolean;
  allowResubmit: boolean;
  notifyInitiator: boolean;
  autoApproveIfSameUser: boolean;
  timeoutAction: 'none' | 'auto-approve' | 'auto-reject' | 'notify';
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
  | 'select'        // 单选
  | 'multiSelect'   // 多选
  | 'amount'        // 金额
  | 'phone'         // 手机号
  | 'email'         // 邮箱
  | 'idCard'        // 身份证
  | 'url'           // 网址
  | 'rate'          // 评分
  | 'formula'       // 公式计算
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
  helpText?: string;               // 帮助提示（label 下方/旁边的说明）
  options?: string[];              // select/multiSelect 的选项
  defaultValue?: unknown;
  visibilityCondition?: WorkflowFieldVisibilityCondition;
  children?: WorkflowFormField[];  // 明细子字段
  precision?: number;              // 数字/金额精度
  step?: number;                   // 数字步长
  unit?: string;                   // 数字/金额单位（如 "元" "天" "件"）
  currency?: string;               // 金额币种
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
  // 字段联动
  daysFromKey?: string;            // 数字字段：从指定 dateRange 字段自动计算天数
  optionsFrom?: {                  // select/multiSelect：依据父字段值动态生成选项
    sourceKey: string;             // 父字段 key
    mapping: Record<string, string[]>; // 父值 -> 子选项数组
  };
  // Layout fields
  columns?: WorkflowFormFieldColumn[];  // for 'row' type
  title?: string;                       // for 'group' type header
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
  formFields: WorkflowFormField[] | null;
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
  formFields: WorkflowFormField[] | null;
  publishedAt: string;
  publishedBy: number | null;
  publishedByName?: string | null;
  tenantId: number | null;
}

export type WorkflowAutomationTrigger = 'approved' | 'rejected' | 'withdrawn';

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

export type WorkflowAutomationAction =
  | WorkflowAutomationActionStartWorkflow
  | WorkflowAutomationActionSendMessage;

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
  /** 任务原始处理人（创建时快照，转办/委派不会修改） */
  originalAssigneeId?: number | null;
  /** 转办/委派经手过的处理人 ID 链（含原始创建人之后的所有 assignee） */
  transferChain?: number[];
  /** 委派来源（仅委派期间设置；回执任务为 null） */
  delegatedFromId?: number | null;
  /** 外部审批回调 ID（task.status='waiting' + externalApproval 启用时生效） */
  externalCallbackId?: string | null;
  externalDispatchStatus?: WorkflowTaskExternalDispatchStatus | null;
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

export interface WorkflowInstance {
  id: number;
  definitionId: number;
  definitionName?: string;
  categoryId?: number | null;
  categoryName?: string | null;
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

// ─── 流程事件订阅 ────────────────────────────────────────────────────────────
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
  /** 已脱敏（列表/详情）或明文（请求"显示"时） */
  secret: string;
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
  requestUrl: string;
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
  nodeName: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface AiMessage {
  id: number;
  conversationId: number;
  role: AiMessageRole;
  content: string;
  tokensInput: number;
  tokensOutput: number;
  createdAt: string;
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
