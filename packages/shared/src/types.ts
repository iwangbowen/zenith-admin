export interface User {
  id: number;
  username: string;
  nickname: string;
  email: string;
  avatar?: string;
  roles: Role[];
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
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
export interface Role {
  id: number;
  name: string;
  code: string;
  description?: string;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
  menuIds?: number[];
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
