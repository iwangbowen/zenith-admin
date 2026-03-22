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
