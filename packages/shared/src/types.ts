export interface User {
  id: number;
  username: string;
  nickname: string;
  email: string;
  avatar?: string;
  role: 'admin' | 'user';
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
  sort: number;
  status: 'active' | 'disabled';
  remark?: string;
  createdAt: string;
  updatedAt: string;
}
