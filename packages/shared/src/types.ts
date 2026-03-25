export interface User {
  id: number;
  username: string;
  nickname: string;
  email: string;
  avatar?: string;
  departmentId?: number | null;
  departmentName?: string | null;
  positionIds?: number[];
  positions?: Position[];
  roles: Role[];
  status: 'active' | 'disabled';
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
  user: Omit<User, 'password'>;
  token: AuthTokens;
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
export type FileStorageProvider = 'local' | 'oss';

export interface FileStorageConfig {
  id: number;
  name: string;
  provider: FileStorageProvider;
  status: 'active' | 'disabled';
  isDefault: boolean;
  basePath?: string;
  localRootPath?: string;
  ossRegion?: string;
  ossEndpoint?: string;
  ossBucket?: string;
  ossAccessKeyId?: string;
  ossAccessKeySecret?: string;
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

export interface Notice {
  id: number;
  title: string;
  content: string;
  type: string;
  publishStatus: string;
  priority: string;
  publishTime: string | null;
  createById: number | null;
  createByName: string | null;
  createdAt: string;
  updatedAt: string;
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
