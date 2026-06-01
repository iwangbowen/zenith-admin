import { useState, useEffect, useCallback } from 'react';
import { request } from '@/utils/request';
import { TOKEN_KEY, REFRESH_TOKEN_KEY, PREFERENCES_KEY, TABS_STORAGE_KEY } from '@zenith/shared';
import type { User, LoginResponse } from '@zenith/shared';

interface AuthState {
  user: Omit<User, 'password'> | null;
  permissions: string[];
  loading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ user: null, permissions: [], loading: true });

  const fetchUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setState({ user: null, permissions: [], loading: false });
      return;
    }
    try {
      const res = await request.get<User & { permissions: string[] }>('/api/auth/me', { silent: true });
      if (res.code === 0) {
        const { permissions, ...userData } = res.data;
        setState({ user: userData, permissions: permissions ?? [], loading: false });
      } else if (res.code === -1) {
        // 网络错误（如后端未启动完成），不清除 token，只重置 loading
        setState((prev) => ({ ...prev, loading: false }));
      } else {
        // 认证失败（如 token 过期），清除所有用户相关数据
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        localStorage.removeItem(PREFERENCES_KEY);
        localStorage.removeItem(TABS_STORAGE_KEY);
        setState({ user: null, permissions: [], loading: false });
      }
    } catch {
      // 网络异常，不清除 token，只重置 loading
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = async (username: string, password: string, captchaId?: string, captchaCode?: string, tenantCode?: string) => {
    const res = await request.post<LoginResponse>('/api/auth/login', { username, password, captchaId, captchaCode, tenantCode }, { silent: true });
    if (res.code === 0) {
      localStorage.setItem(TOKEN_KEY, res.data.token.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, res.data.token.refreshToken);
      await fetchUser();
    }
    return res;
  };

  const register = async (data: { username: string; nickname: string; email: string; password: string }) => {
    const res = await request.post<LoginResponse>('/api/auth/register', data, { silent: true });
    if (res.code === 0) {
      localStorage.setItem(TOKEN_KEY, res.data.token.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, res.data.token.refreshToken);
      await fetchUser();
    }
    return res;
  };

  const logout = () => {
    // Immediately clear local state first
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(PREFERENCES_KEY);
    localStorage.removeItem(TABS_STORAGE_KEY);
    setState({ user: null, permissions: [], loading: false });
    // Best-effort: notify server to remove session from Redis (fire-and-forget)
    request.post('/api/auth/logout', {}, { silent: true }).catch(() => {});
  };

  const updateUser = (user: Omit<User, 'password'>) => {
    setState((prev) => ({ ...prev, user }));
  };

  return { ...state, login, register, logout, refresh: fetchUser, updateUser };
}
